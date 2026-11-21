//! Tauri Command Handlers for Antigravity
//!
//! All commands exposed to the frontend via Tauri's invoke system

use serde::Deserialize;
use tauri::{Emitter, Manager, State};

use crate::AppState;

// Re-export fs types for command handlers
pub use crate::fs::{
    CopyPathRequest, CreateDirRequest, DeletePathRequest, EditFileRequest, ListDirRequest,
    MovePathRequest, ReadFileRangeRequest, ReadFileRequest, SearchFilesRequest, WriteFileRequest,
};

#[derive(Debug, Clone, Deserialize)]
pub struct SearchFilesCommandRequest {
    pub path: String,
    pub pattern: String,
    #[serde(default)]
    pub ignore_patterns: Option<Vec<String>>,
    #[serde(default)]
    pub file_pattern: Option<String>,
}

pub mod fs_commands {
    use super::*;

    #[tauri::command(rename_all = "snake_case")]
    pub async fn read_file(
        _state: State<'_, AppState>,
        request: ReadFileRequest,
    ) -> Result<crate::fs::ReadFileResponse, String> {
        crate::fs::read_file(request).await.map_err(|e| e.to_string())
    }

    #[tauri::command(rename_all = "snake_case")]
    pub async fn write_file(
        _state: State<'_, AppState>,
        request: WriteFileRequest,
    ) -> Result<(), String> {
        crate::fs::write_file(request).await.map_err(|e| e.to_string())
    }

    #[tauri::command(rename_all = "snake_case")]
    pub async fn edit_file(
        _state: State<'_, AppState>,
        request: EditFileRequest,
    ) -> Result<(), String> {
        crate::fs::edit_file(request).await.map_err(|e| e.to_string())
    }

    #[tauri::command(rename_all = "snake_case")]
    pub async fn list_dir(
        _state: State<'_, AppState>,
        request: ListDirRequest,
    ) -> Result<crate::fs::ListDirResponse, String> {
        crate::fs::list_dir(request).await.map_err(|e| e.to_string())
    }

    #[tauri::command(rename_all = "snake_case")]
    pub async fn create_dir(
        _state: State<'_, AppState>,
        request: CreateDirRequest,
    ) -> Result<(), String> {
        crate::fs::create_dir(request).await.map_err(|e| e.to_string())
    }

    #[tauri::command(rename_all = "snake_case")]
    pub async fn delete_path(
        _state: State<'_, AppState>,
        request: DeletePathRequest,
    ) -> Result<(), String> {
        crate::fs::delete_path(request).await.map_err(|e| e.to_string())
    }

    #[tauri::command(rename_all = "snake_case")]
    pub async fn copy_path(
        _state: State<'_, AppState>,
        request: CopyPathRequest,
    ) -> Result<(), String> {
        crate::fs::copy_path(request).await.map_err(|e| e.to_string())
    }

    #[tauri::command(rename_all = "snake_case")]
    pub async fn move_path(
        _state: State<'_, AppState>,
        request: MovePathRequest,
    ) -> Result<(), String> {
        crate::fs::move_path(request).await.map_err(|e| e.to_string())
    }

    #[tauri::command(rename_all = "snake_case")]
    pub async fn search_files(
        _state: State<'_, AppState>,
        request: SearchFilesCommandRequest,
    ) -> Result<Vec<crate::fs::SearchResult>, String> {
        crate::fs::search_files_with_filter(
            SearchFilesRequest {
                path: request.path,
                pattern: request.pattern,
                ignore_patterns: request.ignore_patterns,
            },
            request.file_pattern,
        )
        .await
        .map_err(|e| e.to_string())
    }

    #[tauri::command(rename_all = "snake_case")]
    pub async fn read_file_range(
        _state: State<'_, AppState>,
        request: ReadFileRangeRequest,
    ) -> Result<crate::fs::ReadFileRangeResponse, String> {
        crate::fs::read_file_range(request).await.map_err(|e| e.to_string())
    }

    #[tauri::command(rename_all = "snake_case")]
    pub async fn watch_path(
        state: State<'_, AppState>,
        path: String,
    ) -> Result<(), String> {
        state.fs_watcher.watch_path(&path).map_err(|e| e.to_string())
    }

    #[tauri::command(rename_all = "snake_case")]
    pub async fn unwatch_path(
        state: State<'_, AppState>,
        path: String,
    ) -> Result<(), String> {
        state.fs_watcher.unwatch_path(&path).map_err(|e| e.to_string())
    }
}

pub mod terminal {
    use super::*;

    #[tauri::command(rename_all = "snake_case")]
    pub async fn spawn_terminal(
        state: State<'_, AppState>,
        request: crate::terminal::SpawnTerminalRequest,
    ) -> Result<crate::terminal::Terminal, String> {
        state.terminal_manager.spawn_terminal(request).await.map_err(|e| e.to_string())
    }

    #[tauri::command(rename_all = "snake_case")]
    pub async fn write_terminal(
        state: State<'_, AppState>,
        request: crate::terminal::WriteTerminalRequest,
    ) -> Result<(), String> {
        state.terminal_manager.write_terminal(request).await.map_err(|e| e.to_string())
    }

    #[tauri::command(rename_all = "snake_case")]
    pub async fn resize_terminal(
        state: State<'_, AppState>,
        request: crate::terminal::ResizeTerminalRequest,
    ) -> Result<(), String> {
        state.terminal_manager.resize_terminal(request).await.map_err(|e| e.to_string())
    }

    #[tauri::command(rename_all = "snake_case")]
    pub async fn kill_terminal(
        state: State<'_, AppState>,
        terminal_id: String,
    ) -> Result<(), String> {
        state.terminal_manager.kill_terminal(&terminal_id).await.map_err(|e| e.to_string())
    }

    #[tauri::command(rename_all = "snake_case")]
    pub async fn list_terminals(
        state: State<'_, AppState>,
    ) -> Result<Vec<crate::terminal::Terminal>, String> {
        Ok(state.terminal_manager.list_terminals().await)
    }
}

pub mod llm {
    use super::*;

    #[tauri::command(rename_all = "snake_case")]
    pub async fn list_providers(
        state: State<'_, AppState>,
    ) -> Result<Vec<crate::llm::LLMProvider>, String> {
        Ok(state.llm_providers.list_providers().await)
    }

    #[tauri::command(rename_all = "snake_case")]
    pub async fn add_provider(
        state: State<'_, AppState>,
        config: crate::config::LLMProviderConfig,
    ) -> Result<crate::llm::LLMProvider, String> {
        state.llm_providers.add_provider(config).await.map_err(|e| e.to_string())
    }

    #[tauri::command(rename_all = "snake_case")]
    pub async fn remove_provider(
        state: State<'_, AppState>,
        id: String,
    ) -> Result<(), String> {
        state.llm_providers.remove_provider(&id).await.map_err(|e| e.to_string())
    }

    #[tauri::command(rename_all = "snake_case")]
    pub async fn set_active_provider(
        state: State<'_, AppState>,
        id: String,
    ) -> Result<(), String> {
        state.llm_providers.set_active_provider(&id).await.map_err(|e| e.to_string())
    }

    #[tauri::command(rename_all = "snake_case")]
    pub async fn chat_completion(
        state: State<'_, AppState>,
        request: crate::llm::ChatCompletionRequest,
    ) -> Result<crate::llm::ChatCompletionResponse, String> {
        state.llm_providers.chat_completion(request).await.map_err(|e| e.to_string())
    }

    #[tauri::command(rename_all = "snake_case")]
    pub async fn stream_chat_completion(
        state: State<'_, AppState>,
        request: crate::llm::ChatCompletionRequest,
        window: tauri::WebviewWindow,
    ) -> Result<(), String> {
        let window_clone = window.clone();
        state.llm_providers.stream_chat_completion(request, move |chunk| {
            let _ = window_clone.emit("llm-stream-chunk", chunk);
        }).await.map_err(|e| e.to_string())
    }

    #[tauri::command(rename_all = "snake_case")]
    pub async fn list_models(
        state: State<'_, AppState>,
        provider_id: Option<String>,
    ) -> Result<Vec<crate::llm::LLMModel>, String> {
        state.llm_providers.list_models(provider_id.as_deref()).await.map_err(|e| e.to_string())
    }

    #[tauri::command(rename_all = "snake_case")]
    pub async fn refresh_provider_models(
        state: State<'_, AppState>,
        provider_id: String,
    ) -> Result<Vec<crate::llm::LLMModel>, String> {
        state.llm_providers.refresh_provider_models(&provider_id).await.map_err(|e| e.to_string())?;
        state.llm_providers.list_models(Some(&provider_id)).await.map_err(|e| e.to_string())
    }
}

pub mod mcp {
    use super::*;

    #[tauri::command(rename_all = "snake_case")]
    pub async fn list_servers(
        state: State<'_, AppState>,
    ) -> Result<Vec<crate::mcp::MCPServer>, String> {
        Ok(state.mcp_client.list_servers().await)
    }

    #[tauri::command(rename_all = "snake_case")]
    pub async fn add_server(
        state: State<'_, AppState>,
        config: crate::config::MCPServerConfig,
    ) -> Result<crate::mcp::MCPServer, String> {
        state.mcp_client.add_server(config).await.map_err(|e| e.to_string())
    }

    #[tauri::command(rename_all = "snake_case")]
    pub async fn remove_server(
        state: State<'_, AppState>,
        id: String,
    ) -> Result<(), String> {
        state.mcp_client.remove_server(&id).await.map_err(|e| e.to_string())
    }

    #[tauri::command(rename_all = "snake_case")]
    pub async fn connect_server(
        state: State<'_, AppState>,
        id: String,
    ) -> Result<crate::mcp::MCPServer, String> {
        state.mcp_client.connect_server(&id).await.map_err(|e| e.to_string())
    }

    #[tauri::command(rename_all = "snake_case")]
    pub async fn disconnect_server(
        state: State<'_, AppState>,
        id: String,
    ) -> Result<crate::mcp::MCPServer, String> {
        state.mcp_client.disconnect_server(&id).await.map_err(|e| e.to_string())
    }

    #[tauri::command(rename_all = "snake_case")]
    pub async fn list_tools(
        state: State<'_, AppState>,
        server_id: Option<String>,
    ) -> Result<Vec<crate::mcp::MCPTool>, String> {
        Ok(state.mcp_client.list_tools(server_id.as_deref()).await)
    }

    #[tauri::command(rename_all = "snake_case")]
    pub async fn call_tool(
        state: State<'_, AppState>,
        request: crate::mcp::MCPToolCallRequest,
    ) -> Result<crate::mcp::MCPToolCallResponse, String> {
        state.mcp_client.call_tool(request).await.map_err(|e| e.to_string())
    }
}

pub mod agent {
    use super::*;

    #[tauri::command(rename_all = "snake_case")]
    pub async fn start_agent_task(
        state: State<'_, AppState>,
        request: crate::agent::StartAgentTaskRequest,
    ) -> Result<crate::agent::AgentTask, String> {
        state.agent_engine.start_agent_task(request).await.map_err(|e| e.to_string())
    }

    #[tauri::command(rename_all = "snake_case")]
    pub async fn cancel_agent_task(
        state: State<'_, AppState>,
        task_id: String,
    ) -> Result<crate::agent::AgentTask, String> {
        state.agent_engine.cancel_agent_task(&task_id).await.map_err(|e| e.to_string())
    }

    #[tauri::command(rename_all = "snake_case")]
    pub async fn get_agent_status(
        state: State<'_, AppState>,
        task_id: String,
    ) -> Result<Option<crate::agent::AgentTask>, String> {
        Ok(state.agent_engine.get_agent_status(&task_id).await)
    }

    #[tauri::command(rename_all = "snake_case")]
    pub async fn list_conversations(
        state: State<'_, AppState>,
    ) -> Result<Vec<crate::agent::Conversation>, String> {
        Ok(state.agent_engine.list_conversations().await)
    }

    #[tauri::command(rename_all = "snake_case")]
    pub async fn create_conversation(
        state: State<'_, AppState>,
        conversation_id: Option<String>,
        title: Option<String>,
        system_prompt: Option<String>,
        workspace_path: Option<String>,
        project_id: Option<String>,
        worktree_mode: Option<crate::config::WorktreeMode>,
    ) -> Result<crate::agent::Conversation, String> {
        state
            .agent_engine
            .create_or_update_conversation(
                conversation_id,
                title,
                system_prompt,
                workspace_path,
                project_id,
                worktree_mode,
            )
            .await
            .map_err(|e| e.to_string())
    }

    #[tauri::command(rename_all = "snake_case")]
    pub async fn delete_conversation(
        state: State<'_, AppState>,
        conversation_id: String,
    ) -> Result<(), String> {
        state.agent_engine.delete_conversation(&conversation_id).await.map_err(|e| e.to_string())
    }

    #[tauri::command(rename_all = "snake_case")]
    pub async fn get_conversation(
        state: State<'_, AppState>,
        conversation_id: String,
    ) -> Result<Option<crate::agent::Conversation>, String> {
        Ok(state.agent_engine.get_conversation(&conversation_id).await)
    }

    #[tauri::command(rename_all = "snake_case")]
    pub async fn send_message(
        state: State<'_, AppState>,
        request: crate::agent::SendMessageRequest,
    ) -> Result<crate::agent::Conversation, String> {
        state.agent_engine.send_message(request).await.map_err(|e| e.to_string())
    }

    #[tauri::command(rename_all = "snake_case")]
    pub async fn answer_question(
        state: State<'_, AppState>,
        question_id: String,
        answers: serde_json::Value,
    ) -> Result<(), String> {
        state.agent_engine.answer_question(&question_id, answers).await.map_err(|e| e.to_string())
    }

    #[tauri::command(rename_all = "snake_case")]
    pub async fn approve_command(
        state: State<'_, AppState>,
        approval_id: String,
        approved: bool,
    ) -> Result<(), String> {
        state.agent_engine.approve_command(&approval_id, approved).await.map_err(|e| e.to_string())
    }

    #[tauri::command(rename_all = "snake_case")]
    pub async fn list_artifacts(
        state: State<'_, AppState>,
        conversation_id: String,
    ) -> Result<Vec<crate::agent::ArtifactInfo>, String> {
        state.agent_engine.list_artifacts(&conversation_id).await.map_err(|e| e.to_string())
    }
}

pub mod skills {
    use super::*;

    #[tauri::command(rename_all = "snake_case")]
    pub async fn list_skills(
        state: State<'_, AppState>,
        source: Option<String>,
        skill_type: Option<String>,
    ) -> Result<Vec<crate::skills::Skill>, String> {
        Ok(state.skill_manager.list_skills(source.as_deref(), skill_type.as_deref()).await)
    }

    #[tauri::command(rename_all = "snake_case")]
    pub async fn load_skill(
        state: State<'_, AppState>,
        id: String,
    ) -> Result<crate::skills::Skill, String> {
        state.skill_manager.load_skill(&id).await.map_err(|e| e.to_string())
    }

    #[tauri::command(rename_all = "snake_case")]
    pub async fn unload_skill(
        state: State<'_, AppState>,
        id: String,
    ) -> Result<(), String> {
        state.skill_manager.unload_skill(&id).await.map_err(|e| e.to_string())
    }

    #[tauri::command(rename_all = "snake_case")]
    pub async fn reload_skills(
        state: State<'_, AppState>,
    ) -> Result<Vec<crate::skills::Skill>, String> {
        state.skill_manager.reload_skills().await.map_err(|e| e.to_string())
    }

    #[tauri::command(rename_all = "snake_case")]
    pub async fn get_skill_schema(
        state: State<'_, AppState>,
        id: String,
    ) -> Result<Option<crate::skills::SkillSchema>, String> {
        state.skill_manager.get_skill_schema(&id).await.map_err(|e| e.to_string())
    }
}

pub mod config {
    use super::*;

    #[tauri::command(rename_all = "snake_case")]
    pub async fn get_config(
        state: State<'_, AppState>,
    ) -> Result<crate::config::AppConfig, String> {
        Ok(state.config.get().await)
    }

    #[tauri::command(rename_all = "snake_case")]
    pub async fn set_config(
        state: State<'_, AppState>,
        mut config: crate::config::AppConfig,
    ) -> Result<(), String> {
        for proj in &mut config.workspace.projects {
            for folder in &mut proj.folders {
                if folder.ssh_host.is_none() && !folder.path.is_empty() {
                    let inspected = crate::config::ProjectFolder::inspect(&folder.path, None);
                    if folder.name.is_empty() {
                        folder.name = inspected.name;
                    }
                    folder.is_git = inspected.is_git;
                    if inspected.git_branch.is_some() {
                        folder.git_branch = inspected.git_branch;
                    }
                }
            }
        }
        state.config.set(config).await.map_err(|e| e.to_string())
    }

    #[tauri::command(rename_all = "snake_case")]
    pub async fn reset_config(
        state: State<'_, AppState>,
    ) -> Result<(), String> {
        state.config.set(crate::config::AppConfig::default()).await.map_err(|e| e.to_string())
    }
}

pub mod window {
    use super::*;

    #[tauri::command(rename_all = "snake_case")]
    pub async fn create_window(
        app: tauri::AppHandle,
        url: Option<String>,
        label: Option<String>,
    ) -> Result<(), String> {
        let window_label = label
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| format!("window-{}", uuid::Uuid::new_v4()));

        let webview_url = match url.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()) {
            Some(u) if u.starts_with("http://") || u.starts_with("https://") => {
                let parsed: tauri::Url = u.parse().map_err(|e: url::ParseError| e.to_string())?;
                tauri::WebviewUrl::External(parsed)
            }
            Some(path) => tauri::WebviewUrl::App(path.into()),
            None => tauri::WebviewUrl::App("index.html".into()),
        };

        tauri::WebviewWindowBuilder::new(&app, window_label, webview_url)
            .title("Antigravity")
            .inner_size(1200.0, 800.0)
            .min_inner_size(800.0, 600.0)
            .decorations(true)
            .build()
            .map_err(|e| e.to_string())?;

        Ok(())
    }

    #[tauri::command(rename_all = "snake_case")]
    pub async fn close_window(
        app: tauri::AppHandle,
        label: String,
    ) -> Result<(), String> {
        let win = app
            .get_webview_window(&label)
            .ok_or_else(|| format!("Window '{}' not found", label))?;
        win.close().map_err(|e| e.to_string())
    }

    #[tauri::command(rename_all = "snake_case")]
    pub async fn minimize_window(
        window: tauri::WebviewWindow,
    ) -> Result<(), String> {
        window.minimize().map_err(|e| e.to_string())
    }

    #[tauri::command(rename_all = "snake_case")]
    pub async fn maximize_window(
        window: tauri::WebviewWindow,
    ) -> Result<(), String> {
        if window.is_maximized().map_err(|e| e.to_string())? {
            window.unmaximize().map_err(|e| e.to_string())
        } else {
            window.maximize().map_err(|e| e.to_string())
        }
    }

    #[tauri::command(rename_all = "snake_case")]
    pub async fn list_windows(
        app: tauri::AppHandle,
    ) -> Result<Vec<String>, String> {
        let mut labels: Vec<String> = app.webview_windows().into_keys().collect();
        labels.sort();
        Ok(labels)
    }
}
