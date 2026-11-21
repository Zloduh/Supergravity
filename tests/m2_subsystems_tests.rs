use std::time::Duration;
use tempfile::TempDir;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

use antigravity::agent::{AgentEngine, AgentTaskStatus, SendMessageRequest, StartAgentTaskRequest};
use antigravity::config::{
    ConfigManager, LLMProviderConfig, LLMProviderType, MCPServerConfig, MCPTransportConfig,
};
use antigravity::llm::LLMProviderManager;
use antigravity::mcp::{MCPClientManager, MCPServerStatus, MCPToolCallRequest};
use antigravity::skills::SkillManager;
use antigravity::terminal::{
    ResizeTerminalRequest, SpawnTerminalRequest, TerminalManager, TerminalStatus,
    WriteTerminalRequest,
};

static TEST_ENV_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[tokio::test]
async fn pty_terminal_spawn_write_resize_and_kill_lifecycle() {
    let _guard = TEST_ENV_LOCK.lock().await;
    let tmp = TempDir::new().unwrap();
    let cfg_path = tmp.path().join("config.toml");
    let config = ConfigManager::new_with_path(&cfg_path).await.unwrap();
    let tm = TerminalManager::new(config).await.unwrap();

    let term = tm
        .spawn_terminal(SpawnTerminalRequest {
            shell: Some("/bin/sh".to_string()),
            args: None,
            cwd: Some(tmp.path().to_string_lossy().to_string()),
            cols: Some(100),
            rows: Some(30),
        })
        .await
        .unwrap();

    assert!(term.pid.is_some());
    assert_eq!(term.status, TerminalStatus::Running);
    assert_eq!(term.cols, 100);
    assert_eq!(term.rows, 30);

    tm.write_terminal(WriteTerminalRequest {
        terminal_id: term.id.clone(),
        data: "echo PTY_HELLO_WORLD\n".to_string(),
    })
    .await
    .unwrap();

    // Wait for output to appear
    let mut saw_output = false;
    for _ in 0..40 {
        if let Some(out) = tm.get_output(&term.id).await {
            if out.contains("PTY_HELLO_WORLD") {
                saw_output = true;
                break;
            }
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    assert!(saw_output, "Expected PTY output to contain PTY_HELLO_WORLD");

    tm.resize_terminal(ResizeTerminalRequest {
        terminal_id: term.id.clone(),
        cols: 132,
        rows: 42,
    })
    .await
    .unwrap();

    let updated = tm.get_terminal(&term.id).await.unwrap();
    assert_eq!(updated.cols, 132);
    assert_eq!(updated.rows, 42);

    tm.kill_terminal(&term.id).await.unwrap();
    let killed = tm.get_terminal(&term.id).await.unwrap();
    assert_eq!(killed.status, TerminalStatus::Closed);
}

#[tokio::test]
async fn skills_manager_discovers_loads_unloads_and_preserves_softened_prompt() {
    let _guard = TEST_ENV_LOCK.lock().await;
    let tmp = TempDir::new().unwrap();
    let cfg_path = tmp.path().join("config.toml");
    let home_dir = tmp.path().join("isolated_home");
    let skill_dir = home_dir
        .join(".gemini")
        .join("antigravity")
        .join("builtin")
        .join("skills")
        .join("sample-skill");
    tokio::fs::create_dir_all(&skill_dir).await.unwrap();
    tokio::fs::write(
        skill_dir.join("SKILL.md"),
        "---\nname: sample-skill\ndescription: A sample test skill\n---\n# Sample Skill\nBody here.\n",
    )
    .await
    .unwrap();

    std::env::set_var("ANTIGRAVITY_HOME_DIR", &home_dir);
    let config = ConfigManager::new_with_path(&cfg_path).await.unwrap();
    config
        .update(|c| {
            c.skills.directories = vec![skill_dir
                .parent()
                .unwrap()
                .to_string_lossy()
                .to_string()];
            c.skills.auto_load = true;
        })
        .await
        .unwrap();

    let sm = SkillManager::new(config).await.unwrap();
    let skills = sm.list_skills(None, None).await;
    assert_eq!(skills.len(), 1);
    assert_eq!(skills[0].name, "sample-skill");
    assert!(skills[0].loaded);

    let schema = sm.get_skill_schema(&skills[0].id).await.unwrap();
    assert!(schema.is_some());

    let prompt_block = sm.build_skills_prompt_block().await;
    assert!(prompt_block.contains("Optional specialized skills are listed below."));
    assert!(prompt_block.contains("never load skills for greetings"));
    assert!(!prompt_block.contains("you MUST call"));

    sm.unload_skill(&skills[0].id).await.unwrap();
    assert!(sm.get_skill_schema(&skills[0].id).await.unwrap().is_none());

    let reloaded = sm.load_skill(&skills[0].id).await.unwrap();
    assert!(reloaded.loaded);
}

#[tokio::test]
async fn mcp_client_handles_mock_http_jsonrpc_and_unreachable_errors_gracefully() {
    let _guard = TEST_ENV_LOCK.lock().await;
    let tmp = TempDir::new().unwrap();
    let cfg_path = tmp.path().join("config.toml");
    let home_dir = tmp.path().join("isolated_home");
    tokio::fs::create_dir_all(&home_dir).await.unwrap();
    std::env::set_var("ANTIGRAVITY_HOME_DIR", &home_dir);
    std::env::set_var("ANTIGRAVITY_OFFLINE_NO_DISCOVER", "1");

    // Start mock HTTP JSON-RPC MCP server
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        loop {
            let Ok((mut stream, _)) = listener.accept().await else {
                break;
            };
            tokio::spawn(async move {
                let mut buf = vec![0u8; 8192];
                let n = stream.read(&mut buf).await.unwrap_or(0);
                if n == 0 {
                    return;
                }
                let req_str = String::from_utf8_lossy(&buf[..n]);
                if req_str.starts_with("GET ") {
                    let resp = "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
                    let _ = stream.write_all(resp.as_bytes()).await;
                    return;
                }
                let body_start = req_str.find("\r\n\r\n").map(|i| i + 4).unwrap_or(0);
                let body = &req_str[body_start..];
                let rpc: serde_json::Value = serde_json::from_str(body).unwrap_or_default();
                let id = rpc.get("id").and_then(|v| v.as_u64()).unwrap_or(1);
                let method = rpc.get("method").and_then(|v| v.as_str()).unwrap_or("");

                let resp_json = match method {
                    "initialize" => serde_json::json!({
                        "jsonrpc": "2.0",
                        "id": id,
                        "result": {
                            "protocolVersion": "2024-11-05",
                            "capabilities": {},
                            "serverInfo": { "name": "mock-mcp", "version": "1.0.0" }
                        }
                    }),
                    "tools/list" => serde_json::json!({
                        "jsonrpc": "2.0",
                        "id": id,
                        "result": {
                            "tools": [
                                {
                                    "name": "ping_tool",
                                    "description": "Returns pong",
                                    "inputSchema": { "type": "object", "properties": {} }
                                }
                            ]
                        }
                    }),
                    "tools/call" => serde_json::json!({
                        "jsonrpc": "2.0",
                        "id": id,
                        "result": {
                            "content": [{ "type": "text", "text": "pong_from_mcp" }]
                        }
                    }),
                    _ => serde_json::json!({
                        "jsonrpc": "2.0",
                        "id": id,
                        "result": {}
                    }),
                };
                let body_bytes = serde_json::to_vec(&resp_json).unwrap();
                let header = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    body_bytes.len()
                );
                let _ = stream.write_all(header.as_bytes()).await;
                let _ = stream.write_all(&body_bytes).await;
            });
        }
    });

    let config = ConfigManager::new_with_path(&cfg_path).await.unwrap();
    let mcp = MCPClientManager::new(config).await.unwrap();

    // Add valid mock server
    mcp.add_server(MCPServerConfig {
        id: "mock-sse".to_string(),
        name: "Mock SSE Server".to_string(),
        transport: MCPTransportConfig::SSE {
            url: format!("http://{}/mcp", addr),
            headers: None,
        },
        enabled: true,
        auto_start: false,
    })
    .await
    .unwrap();

    let connected = mcp.connect_server("mock-sse").await.unwrap();
    assert_eq!(connected.status, MCPServerStatus::Connected);
    assert_eq!(connected.tools.len(), 1);
    assert_eq!(connected.tools[0].name, "ping_tool");

    let call_res = mcp
        .call_tool(MCPToolCallRequest {
            server_id: "mock-sse".to_string(),
            tool_name: "ping_tool".to_string(),
            arguments: serde_json::json!({}),
        })
        .await
        .unwrap();
    assert!(call_res.success);

    // Add unreachable server and verify graceful Error status
    mcp.add_server(MCPServerConfig {
        id: "bad-sse".to_string(),
        name: "Bad Server".to_string(),
        transport: MCPTransportConfig::SSE {
            url: "http://127.0.0.1:1/unreachable".to_string(),
            headers: None,
        },
        enabled: true,
        auto_start: false,
    })
    .await
    .unwrap();

    let bad = mcp.connect_server("bad-sse").await.unwrap();
    assert!(matches!(bad.status, MCPServerStatus::Error(_)));
}

#[tokio::test]
async fn agent_engine_synchronous_user_message_scoped_provider_and_brain_isolation() {
    let _guard = TEST_ENV_LOCK.lock().await;
    let tmp = TempDir::new().unwrap();
    let cfg_path = tmp.path().join("config.toml");
    let brain_dir = tmp.path().join("isolated_brain");
    let home_dir = tmp.path().join("isolated_home");
    tokio::fs::create_dir_all(&brain_dir).await.unwrap();
    tokio::fs::create_dir_all(&home_dir).await.unwrap();

    std::env::set_var("ANTIGRAVITY_BRAIN_DIR", &brain_dir);
    std::env::set_var("ANTIGRAVITY_HOME_DIR", &home_dir);
    std::env::set_var("ANTIGRAVITY_OFFLINE_NO_DISCOVER", "1");

    // Start mock SSE LLM server
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        loop {
            let Ok((mut stream, _)) = listener.accept().await else {
                break;
            };
            tokio::spawn(async move {
                let mut buf = vec![0u8; 16384];
                let n = stream.read(&mut buf).await.unwrap_or(0);
                if n == 0 {
                    return;
                }
                let req_str = String::from_utf8_lossy(&buf[..n]);
                if req_str.starts_with("GET /v1/models") {
                    let body = r#"{"object":"list","data":[{"id":"coder-iq1_m","object":"model"}]}"#;
                    let resp = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        body.len(),
                        body
                    );
                    let _ = stream.write_all(resp.as_bytes()).await;
                    return;
                }
                let sse_payload = concat!(
                    "data: {\"id\":\"1\",\"object\":\"chat.completion.chunk\",\"created\":1,\"model\":\"coder-iq1_m\",\"choices\":[{\"index\":0,\"delta\":{\"reasoning_content\":\"Thinking step...\"}}]}\n\n",
                    "data: {\"id\":\"1\",\"object\":\"chat.completion.chunk\",\"created\":1,\"model\":\"coder-iq1_m\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"Hello from scoped mock provider!\"}}]}\n\n",
                    "data: [DONE]\n\n"
                );
                let resp = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    sse_payload.len(),
                    sse_payload
                );
                let _ = stream.write_all(resp.as_bytes()).await;
            });
        }
    });

    let config = ConfigManager::new_with_path(&cfg_path).await.unwrap();
    let llm = LLMProviderManager::new_offline(config.clone()).await.unwrap();
    llm.add_provider(LLMProviderConfig {
        id: "scoped-mock".to_string(),
        name: "Scoped Mock".to_string(),
        provider_type: LLMProviderType::Custom,
        base_url: format!("http://{}/v1", addr),
        api_key: Some("strata".to_string()),
        models: vec!["coder-iq1_m".to_string()],
        enabled: true,
        headers: None,
    })
    .await
    .unwrap();

    let mcp = MCPClientManager::new(config.clone()).await.unwrap();
    let skills = SkillManager::new(config.clone()).await.unwrap();
    let term = TerminalManager::new(config.clone()).await.unwrap();
    let agent = AgentEngine::new(config.clone(), llm, mcp, skills, term)
        .await
        .unwrap();

    let conv = agent
        .create_conversation(Some("New Conversation".to_string()), None, None)
        .await
        .unwrap();

    // Send message with scoped provider_id ("scoped-mock") while global active_provider remains "strata"
    let updated_conv = agent
        .send_message(SendMessageRequest {
            conversation_id: conv.id.clone(),
            content: "Test prompt for synchronous insertion".to_string(),
            provider_id: Some("scoped-mock".to_string()),
            model: Some("coder-iq1_m".to_string()),
            workspace_path: None,
            project_id: None,
            worktree_mode: None,
        })
        .await
        .unwrap();

    // User message must be present IMMEDIATELY on return from send_message
    assert!(!updated_conv.messages.is_empty());
    assert_eq!(updated_conv.messages[0].role, "user");
    assert_eq!(
        updated_conv.messages[0].content,
        "Test prompt for synchronous insertion"
    );
    // Global active_provider must still be "strata"
    assert_eq!(
        config.get_llm_config().await.active_provider.as_deref(),
        Some("strata")
    );

    // Wait for background streaming agent loop to complete
    let mut completed = false;
    for _ in 0..40 {
        if let Some(c) = agent.get_conversation(&conv.id).await {
            if c.messages.len() >= 2 && c.messages[1].content.contains("Hello from scoped mock provider!") {
                completed = true;
                break;
            }
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    assert!(completed, "Expected assistant reply from scoped mock provider");

    // Verify brain persistence went into isolated brain_dir
    assert!(brain_dir.join(&conv.id).join("metadata.json").exists());
    assert!(brain_dir.join(&conv.id).join("transcript.jsonl").exists());

    // Also test start_agent_task directly without existing conversation
    let direct_task = agent
        .start_agent_task(StartAgentTaskRequest {
            conversation_id: None,
            prompt: "Direct task".to_string(),
            system_prompt: None,
            provider_id: Some("scoped-mock".to_string()),
            model: None,
            workspace_path: None,
            project_id: None,
            worktree_mode: None,
        })
        .await
        .unwrap();

    for _ in 0..40 {
        if let Some(st) = agent.get_agent_status(&direct_task.id).await {
            if st.status == AgentTaskStatus::Completed {
                break;
            }
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    let final_st = agent.get_agent_status(&direct_task.id).await.unwrap();
    assert_eq!(final_st.status, AgentTaskStatus::Completed);

    // Test creating a multi-folder project and moving the existing conversation into it
    let proj_folder_1 = tmp.path().join("proj-frontend");
    let proj_folder_2 = tmp.path().join("proj-backend");
    std::fs::create_dir_all(&proj_folder_1).unwrap();
    std::fs::create_dir_all(proj_folder_2.join(".git")).unwrap();
    std::fs::write(proj_folder_2.join(".git/HEAD"), "ref: refs/heads/feat/projects\n").unwrap();

    let f1 = antigravity::config::ProjectFolder::inspect(&proj_folder_1.to_string_lossy(), None);
    let f2 = antigravity::config::ProjectFolder::inspect(&proj_folder_2.to_string_lossy(), None);
    assert!(!f1.is_git);
    assert!(f2.is_git);
    assert_eq!(f2.git_branch.as_deref(), Some("feat/projects"));

    let mut full_cfg = config.get().await;
    full_cfg.workspace.projects.push(antigravity::config::ProjectConfig {
        id: "proj-alpha".to_string(),
        name: "Alpha Fullstack".to_string(),
        description: Some("Multi-folder workspace".to_string()),
        folders: vec![f1.clone(), f2.clone()],
        settings: antigravity::config::ProjectSettings {
            permission_preset: antigravity::config::ProjectPermissionPreset::Default,
            default_worktree_mode: antigravity::config::WorktreeMode::Local,
            system_prompt: Some("Always test both frontend and backend.".to_string()),
            require_command_approval: None,
            allowed_paths: vec![],
        },
        created_at: "2026-11-21T00:00:00Z".to_string(),
        updated_at: "2026-11-21T00:00:00Z".to_string(),
    });
    full_cfg.workspace.active_project_id = Some("proj-alpha".to_string());
    config.set(full_cfg).await.unwrap();

    let moved = agent
        .move_conversation_to_project(
            &conv.id,
            Some("proj-alpha".to_string()),
            Some(f1.path.clone()),
            Some(antigravity::config::WorktreeMode::Local),
        )
        .await
        .unwrap();
    assert_eq!(moved.project_id.as_deref(), Some("proj-alpha"));
    assert_eq!(moved.workspace_path.as_deref(), Some(f1.path.as_str()));
    assert_eq!(
        moved.worktree_mode,
        Some(antigravity::config::WorktreeMode::Local)
    );

    // Test lifecycle hooks (`PreToolUse`) blocking a forbidden tool call and rule deduplication
    let agents_dir = proj_folder_1.join(".agents");
    std::fs::create_dir_all(agents_dir.join("rules")).unwrap();
    std::fs::write(
        agents_dir.join("rules/coding.md"),
        "Always use strict TypeScript.",
    )
    .unwrap();
    std::fs::write(proj_folder_1.join("AGENTS.md"), "Workspace AGENTS rule.").unwrap();
    std::fs::write(
        agents_dir.join("hooks.json"),
        r#"{
            "PreToolUse": [
                {
                    "matcher": "forbidden_tool",
                    "command": "echo 'Forbidden by test hook' >&2; exit 1"
                }
            ]
        }"#,
    )
    .unwrap();

    let skills_mgr = SkillManager::new(config.clone()).await.unwrap();
    let rules_text = skills_mgr
        .load_rules(Some(&proj_folder_1.to_string_lossy()))
        .await;
    assert!(rules_text.contains("Always use strict TypeScript."));
    assert!(rules_text.contains("Workspace AGENTS rule."));

    let hook_block = skills_mgr
        .run_lifecycle_hooks(
            "PreToolUse",
            "forbidden_tool",
            &serde_json::json!({}),
            Some(&proj_folder_1.to_string_lossy()),
        )
        .await;
    assert!(hook_block.is_err());
    assert!(hook_block.unwrap_err().contains("Forbidden by test hook"));

    let hook_allow = skills_mgr
        .run_lifecycle_hooks(
            "PreToolUse",
            "read_file",
            &serde_json::json!({}),
            Some(&proj_folder_1.to_string_lossy()),
        )
        .await;
    assert!(hook_allow.is_ok());
}
