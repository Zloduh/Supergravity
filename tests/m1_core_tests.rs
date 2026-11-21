use std::time::{Duration, Instant};
use tempfile::TempDir;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

use antigravity::commands::SearchFilesCommandRequest;
use antigravity::config::{AppConfig, ConfigManager, LLMProviderConfig, LLMProviderType};
use antigravity::fs::{
    delete_path, edit_file, list_dir, move_path, read_file, read_file_range,
    search_files_with_filter, write_file, DeletePathRequest, EditFileRequest, FileWatcher,
    ListDirRequest, MovePathRequest, ReadFileRangeRequest, ReadFileRequest, SearchFilesRequest,
    WriteFileRequest,
};
use antigravity::llm::{
    ChatCompletionRequest, ChatMessage, LLMManagerOptions, LLMProviderManager, MessageRole,
    ProviderStatus,
};

#[tokio::test]
async fn config_and_llm_manager_preserve_strata_defaults_offline() {
    let tmp = TempDir::new().unwrap();
    let cfg_path = tmp.path().join("config.toml");

    let cfg = ConfigManager::new_with_path(&cfg_path).await.unwrap();
    let mgr = LLMProviderManager::new_offline(cfg.clone()).await.unwrap();

    let app_cfg = cfg.get().await;
    assert_eq!(app_cfg.llm.active_provider.as_deref(), Some("strata"));
    assert_eq!(app_cfg.llm.context_length, Some(32768));

    let providers = mgr.list_providers().await;
    let strata = providers.iter().find(|p| p.id == "strata").expect("strata");
    assert_eq!(strata.base_url, "http://127.0.0.1:47831/v1");
    assert_eq!(strata.api_key.as_deref(), Some("strata"));
    assert_eq!(strata.status, ProviderStatus::Unknown);

    let lan = providers.iter().find(|p| p.id == "strata-lan").expect("strata-lan");
    assert_eq!(lan.base_url, "http://192.168.0.92:47832/v1");
    assert_eq!(lan.api_key.as_deref(), Some("strata"));
}

#[tokio::test]
async fn config_corrupt_recovery_and_update_isolation() {
    let tmp = TempDir::new().unwrap();
    let cfg_path = tmp.path().join("config.toml");
    tokio::fs::write(&cfg_path, "not = [valid = toml").await.unwrap();

    let cfg = ConfigManager::new_with_path(&cfg_path).await.unwrap();
    assert!(tmp.path().join("config.toml.bak").exists());

    let mut updated = cfg.get().await;
    updated.ui.sidebar_width = 340;
    cfg.set(updated).await.unwrap();

    let reloaded = ConfigManager::new_with_path(&cfg_path).await.unwrap();
    assert_eq!(reloaded.get().await.ui.sidebar_width, 340);
    assert_eq!(reloaded.get().await.llm.context_length, Some(32768));
}

#[tokio::test]
async fn config_reset_preserves_strata_defaults() {
    let tmp = TempDir::new().unwrap();
    let cfg_path = tmp.path().join("config.toml");
    let cfg = ConfigManager::new_with_path(&cfg_path).await.unwrap();

    cfg.update(|c| {
        c.llm.active_provider = Some("custom".to_string());
        c.llm.providers.clear();
        c.ui.compact_mode = true;
    })
    .await
    .unwrap();

    // Equivalent of reset_config command
    cfg.set(AppConfig::default()).await.unwrap();

    let reloaded = ConfigManager::new_with_path(&cfg_path).await.unwrap();
    let state = reloaded.get().await;
    assert!(!state.ui.compact_mode);
    assert_eq!(state.llm.active_provider.as_deref(), Some("strata"));
    assert!(state.llm.providers.iter().any(|p| p.id == "strata"));
    assert!(state.llm.providers.iter().any(|p| p.id == "strata-lan"));
}

#[tokio::test]
async fn concurrent_short_timeout_discovery_does_not_stall_on_unreachable_lan() {
    // Healthy mock Strata server
    let strata_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let strata_addr = strata_listener.local_addr().unwrap();
    let strata_task = tokio::spawn(async move {
        // Accept probe + refresh_provider_models
        for _ in 0..2 {
            let (mut sock, _) = strata_listener.accept().await.unwrap();
            let mut buf = [0u8; 2048];
            let _ = sock.read(&mut buf).await;
            let body = r#"{"data":[{"id":"coder-iq1_m","meta":{"label":"Qwen3.8-Flash-Next Coder IQ1_M"}}]}"#;
            let resp = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            let _ = sock.write_all(resp.as_bytes()).await;
        }
    });

    // Blackhole mock LAN server (accepts TCP, never responds)
    let blackhole_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let blackhole_addr = blackhole_listener.local_addr().unwrap();
    let _blackhole_task = tokio::spawn(async move {
        if let Ok((_sock, _)) = blackhole_listener.accept().await {
            tokio::time::sleep(Duration::from_secs(30)).await;
        }
    });

    let tmp = TempDir::new().unwrap();
    let cfg = ConfigManager::new_with_path(tmp.path().join("cfg.toml")).await.unwrap();
    cfg.update(|c| {
        for p in &mut c.llm.providers {
            if p.id == "strata" {
                p.base_url = format!("http://{}/v1", strata_addr);
            } else if p.id == "strata-lan" {
                p.base_url = format!("http://{}/v1", blackhole_addr);
            }
        }
        c.llm.providers.push(LLMProviderConfig {
            id: "dead-custom".to_string(),
            name: "Dead".to_string(),
            provider_type: LLMProviderType::Custom,
            base_url: "http://127.0.0.1:9/v1".to_string(),
            api_key: None,
            models: vec![],
            enabled: true,
            headers: None,
        });
    })
    .await
    .unwrap();

    let started = Instant::now();
    let mgr = LLMProviderManager::new_with_options(
        cfg,
        LLMManagerOptions {
            skip_discovery: false,
            probe_timeout: Some(Duration::from_millis(500)),
        },
    )
    .await
    .unwrap();
    let elapsed = started.elapsed();

    // Must complete fast (~0.5s), never 120s
    assert!(elapsed < Duration::from_secs(5), "startup stalled for {:?}", elapsed);

    let strata = mgr.get_provider("strata").await.unwrap();
    assert_eq!(strata.status, ProviderStatus::Connected);
    assert_eq!(strata.models.len(), 1);
    assert_eq!(
        strata.models[0].name,
        "Qwen3.8-Flash-Next Coder IQ1_M (coder-iq1_m)"
    );

    match mgr.get_provider("strata-lan").await.unwrap().status {
        ProviderStatus::Error(_) => {}
        other => panic!("expected Error for blackhole strata-lan, got {:?}", other),
    }
    match mgr.get_provider("dead-custom").await.unwrap().status {
        ProviderStatus::Error(_) => {}
        other => panic!("expected Error for dead-custom, got {:?}", other),
    }

    // Also confirm chat_completion fails cleanly against unreachable active provider
    mgr.set_active_provider("dead-custom").await.unwrap();
    let err = mgr
        .chat_completion(ChatCompletionRequest {
            model: "coder-iq1_m".to_string(),
            messages: vec![ChatMessage {
                role: MessageRole::User,
                content: "ping".to_string(),
                reasoning_content: None,
                name: None,
                tool_calls: None,
                tool_call_id: None,
            }],
            temperature: None,
            max_tokens: None,
            stream: Some(false),
            tools: None,
            tool_choice: None,
            top_p: None,
            frequency_penalty: None,
            presence_penalty: None,
            stop: None,
        })
        .await
        .unwrap_err();
    assert!(!err.to_string().is_empty());

    strata_task.abort();
}

#[tokio::test]
async fn fs_end_to_end_and_search_command_dto_compatibility() {
    let tmp = TempDir::new().unwrap();
    let watcher = FileWatcher::new().unwrap();
    let mut rx = watcher.subscribe();
    watcher.watch_path(&tmp.path().to_string_lossy()).unwrap();

    let file_a = tmp.path().join("src/hello.rs");
    write_file(WriteFileRequest {
        path: file_a.to_string_lossy().to_string(),
        content: "line1\nfn target_123() {}\nline3\n".to_string(),
        create_dirs: Some(true),
    })
    .await
    .unwrap();

    edit_file(EditFileRequest {
        path: file_a.to_string_lossy().to_string(),
        old_text: "line3".to_string(),
        new_text: "line3_edited".to_string(),
        replace_all: Some(false),
    })
    .await
    .unwrap();

    let read_res = read_file(ReadFileRequest {
        path: file_a.to_string_lossy().to_string(),
    })
    .await
    .unwrap();
    assert!(!read_res.is_binary);
    assert!(read_res.content.contains("line3_edited"));

    let range = read_file_range(ReadFileRangeRequest {
        path: file_a.to_string_lossy().to_string(),
        start_line: 2,
        end_line: 3,
    })
    .await
    .unwrap();
    assert_eq!(range.lines, vec!["fn target_123() {}", "line3_edited"]);

    // Verify SearchFilesCommandRequest deserializes both with and without file_pattern
    let dto: SearchFilesCommandRequest = serde_json::from_str(&format!(
        r#"{{"path": {:?}, "pattern": "target_\\d+", "file_pattern": "*.rs"}}"#,
        tmp.path().to_string_lossy()
    ))
    .unwrap();
    let found = search_files_with_filter(
        SearchFilesRequest {
            path: dto.path,
            pattern: dto.pattern,
            ignore_patterns: dto.ignore_patterns,
        },
        dto.file_pattern,
    )
    .await
    .unwrap();
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].matches[0].line_number, 2);

    let moved = tmp.path().join("src/moved.rs");
    move_path(MovePathRequest {
        source: file_a.to_string_lossy().to_string(),
        destination: moved.to_string_lossy().to_string(),
    })
    .await
    .unwrap();

    let dir_list = list_dir(ListDirRequest {
        path: tmp.path().join("src").to_string_lossy().to_string(),
        recursive: Some(false),
        ignore_patterns: None,
    })
    .await
    .unwrap();
    assert_eq!(dir_list.entries.len(), 1);
    assert_eq!(dir_list.entries[0].name, "moved.rs");

    // Verify watcher received at least one FS event
    let ev = tokio::time::timeout(Duration::from_secs(2), rx.recv())
        .await
        .expect("timed out waiting for fs event")
        .unwrap();
    assert!(!ev.kind.is_empty());

    watcher.unwatch_path(&tmp.path().to_string_lossy()).unwrap();

    delete_path(DeletePathRequest {
        path: moved.to_string_lossy().to_string(),
        recursive: Some(false),
    })
    .await
    .unwrap();
    assert!(!moved.exists());
}
