//! Agent Engine for Antigravity
//!
//! Manages agent tasks, conversations, streaming tool execution,
//! background command tasks, subagents, interactive questions,
//! and persistence in ~/.gemini/antigravity/brain/<conversation-id>/.

use std::sync::Arc;
use std::collections::HashMap;
use std::path::PathBuf;
use serde::{Deserialize, Serialize};
use tokio::sync::{RwLock, Mutex, oneshot};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use anyhow::Result;
use uuid::Uuid;
use chrono::{DateTime, Utc};
use tauri::Emitter;

use crate::config::ConfigManager;
use crate::llm::{
    LLMProviderManager, ChatCompletionRequest, ChatMessage, MessageRole,
    ToolDefinition, ToolFunctionDefinition, ToolCall,
};
use crate::mcp::{MCPClientManager, MCPToolCallRequest};
use crate::skills::SkillManager;
use crate::terminal::TerminalManager;
use crate::fs as fs_mod;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentTask {
    pub id: String,
    pub conversation_id: String,
    pub prompt: String,
    pub status: AgentTaskStatus,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub iterations: u32,
    pub max_iterations: u32,
    pub result: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AgentTaskStatus {
    Pending,
    Running,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileChangeEntry {
    pub path: String,
    pub change_type: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub original_content: Option<String>,
    pub new_content: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BgTaskSummary {
    pub task_id: String,
    pub command: String,
    pub cwd: String,
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
    #[serde(default)]
    pub output_preview: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlanReviewRequest {
    pub review_id: String,
    pub conversation_id: String,
    pub path: String,
    pub summary: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Conversation {
    pub id: String,
    pub title: String,
    pub messages: Vec<ConversationMessage>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub system_prompt: Option<String>,
    pub provider_id: Option<String>,
    pub model: Option<String>,
    #[serde(default)]
    pub workspace_path: Option<String>,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub worktree_mode: Option<crate::config::WorktreeMode>,
    #[serde(default)]
    pub worktree_paths: Vec<String>,
    #[serde(default)]
    pub files_changed: Vec<FileChangeEntry>,
    #[serde(default)]
    pub subagents: Vec<SubagentInfo>,
    #[serde(default)]
    pub background_tasks: Vec<BgTaskSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationMessage {
    pub id: String,
    pub role: String,
    pub content: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning_content: Option<String>,
    pub created_at: DateTime<Utc>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<serde_json::Value>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StartAgentTaskRequest {
    pub conversation_id: Option<String>,
    pub prompt: String,
    pub system_prompt: Option<String>,
    pub provider_id: Option<String>,
    pub model: Option<String>,
    pub workspace_path: Option<String>,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub worktree_mode: Option<crate::config::WorktreeMode>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SendMessageRequest {
    pub conversation_id: String,
    pub content: String,
    pub provider_id: Option<String>,
    pub model: Option<String>,
    pub workspace_path: Option<String>,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub worktree_mode: Option<crate::config::WorktreeMode>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArtifactInfo {
    pub name: String,
    pub path: String,
    pub size: u64,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubagentDefinition {
    pub name: String,
    pub description: String,
    pub system_prompt: String,
    pub enable_write_tools: bool,
    pub enable_mcp_tools: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubagentInfo {
    pub conversation_id: String,
    pub type_name: String,
    pub role: String,
    pub status: String,
}

struct BackgroundCommandTask {
    id: String,
    command: String,
    cwd: String,
    status: Arc<Mutex<String>>,
    exit_code: Arc<Mutex<Option<i32>>>,
    output: Arc<Mutex<String>>,
    stdin: Arc<Mutex<Option<ChildStdin>>>,
    child: Arc<Mutex<Option<Child>>>,
}

#[derive(Clone)]
pub struct AgentEngine {
    inner: AgentEngineInner,
}

#[derive(Clone)]
struct AgentEngineInner {
    tasks: Arc<RwLock<HashMap<String, AgentTask>>>,
    conversations: Arc<RwLock<HashMap<String, Conversation>>>,
    bg_commands: Arc<RwLock<HashMap<String, Arc<BackgroundCommandTask>>>>,
    pending_questions: Arc<Mutex<HashMap<String, oneshot::Sender<serde_json::Value>>>>,
    pending_approvals: Arc<Mutex<HashMap<String, oneshot::Sender<bool>>>>,
    subagent_defs: Arc<RwLock<HashMap<String, SubagentDefinition>>>,
    subagents: Arc<RwLock<HashMap<String, SubagentInfo>>>,
    config: Arc<ConfigManager>,
    llm_providers: Arc<LLMProviderManager>,
    mcp_client: Arc<MCPClientManager>,
    skill_manager: Arc<SkillManager>,
    _terminal_manager: Arc<TerminalManager>,
    app_handle: Arc<RwLock<Option<tauri::AppHandle>>>,
}

impl AgentEngine {
    pub async fn new(
        config: Arc<ConfigManager>,
        llm_providers: Arc<LLMProviderManager>,
        mcp_client: Arc<MCPClientManager>,
        skill_manager: Arc<SkillManager>,
        terminal_manager: Arc<TerminalManager>,
    ) -> Result<Arc<Self>> {
        let mut default_defs = HashMap::new();
        default_defs.insert(
            "self".to_string(),
            SubagentDefinition {
                name: "self".to_string(),
                description: "Full-capability child agent with all tools".to_string(),
                system_prompt: "You are a child agent executing a focused subtask. Return a concise, factual summary of your findings and actions.".to_string(),
                enable_write_tools: true,
                enable_mcp_tools: true,
            },
        );
        default_defs.insert(
            "research".to_string(),
            SubagentDefinition {
                name: "research".to_string(),
                description: "Read-only research subagent for codebase exploration and web search".to_string(),
                system_prompt: "You are a read-only research subagent. Explore files and search the web, then report exact findings with file paths and line numbers.".to_string(),
                enable_write_tools: false,
                enable_mcp_tools: false,
            },
        );
        default_defs.insert(
            "browser".to_string(),
            SubagentDefinition {
                name: "browser".to_string(),
                description: "Web/browser research subagent with web search and MCP tools".to_string(),
                system_prompt: "You are a browser/web research subagent. Use search_web and available browser MCP tools to gather information.".to_string(),
                enable_write_tools: false,
                enable_mcp_tools: true,
            },
        );

        let inner = AgentEngineInner {
            tasks: Arc::new(RwLock::new(HashMap::new())),
            conversations: Arc::new(RwLock::new(HashMap::new())),
            bg_commands: Arc::new(RwLock::new(HashMap::new())),
            pending_questions: Arc::new(Mutex::new(HashMap::new())),
            pending_approvals: Arc::new(Mutex::new(HashMap::new())),
            subagent_defs: Arc::new(RwLock::new(default_defs)),
            subagents: Arc::new(RwLock::new(HashMap::new())),
            config,
            llm_providers,
            mcp_client,
            skill_manager,
            _terminal_manager: terminal_manager,
            app_handle: Arc::new(RwLock::new(None)),
        };

        inner.load_saved_conversations().await;

        Ok(Arc::new(Self { inner }))
    }

    pub fn set_app_handle(&self, handle: tauri::AppHandle) {
        if let Ok(mut guard) = self.inner.app_handle.try_write() {
            *guard = Some(handle);
        }
    }

    pub async fn start_agent_task(&self, request: StartAgentTaskRequest) -> Result<AgentTask> {
        let agent_config = self.inner.config.get_agent_config().await;

        let conversation_id = if let Some(cid) = &request.conversation_id {
            let mut conv_opt = None;
            {
                let mut convs = self.inner.conversations.write().await;
                if let Some(c) = convs.get_mut(cid) {
                    if let Some(ws) = &request.workspace_path {
                        c.workspace_path = Some(ws.clone());
                    }
                    if let Some(pid) = &request.provider_id {
                        c.provider_id = Some(pid.clone());
                    }
                    if let Some(m) = &request.model {
                        c.model = Some(m.clone());
                    }
                    if let Some(proj_id) = &request.project_id {
                        c.project_id = if proj_id.is_empty() { None } else { Some(proj_id.clone()) };
                    }
                    if let Some(wt_mode) = &request.worktree_mode {
                        c.worktree_mode = Some(wt_mode.clone());
                    }
                    if c.messages.is_empty() && c.title == "New Conversation" {
                        c.title = request.prompt.chars().take(48).collect();
                    }
                    c.messages.push(ConversationMessage {
                        id: Uuid::new_v4().to_string(),
                        role: "user".to_string(),
                        content: request.prompt.clone(),
                        reasoning_content: None,
                        created_at: Utc::now(),
                        tool_calls: None,
                        tool_call_id: None,
                        tool_name: None,
                    });
                    c.updated_at = Utc::now();
                    conv_opt = Some(c.clone());
                }
            }
            if let Some(mut conv) = conv_opt {
                self.inner.ensure_project_worktrees(&mut conv).await;
                self.inner
                    .conversations
                    .write()
                    .await
                    .insert(conv.id.clone(), conv.clone());
                let _ = self.inner.persist_conversation(&conv).await;
                self.inner.emit_conversation(&conv).await;
                cid.clone()
            } else {
                return Err(anyhow::anyhow!("Conversation not found: {}", cid));
            }
        } else {
            let user_msg = ConversationMessage {
                id: Uuid::new_v4().to_string(),
                role: "user".to_string(),
                content: request.prompt.clone(),
                reasoning_content: None,
                created_at: Utc::now(),
                tool_calls: None,
                tool_call_id: None,
                tool_name: None,
            };
            let mut conversation = Conversation {
                id: Uuid::new_v4().to_string(),
                title: request.prompt.chars().take(48).collect(),
                messages: vec![user_msg],
                created_at: Utc::now(),
                updated_at: Utc::now(),
                system_prompt: request.system_prompt.clone(),
                provider_id: request.provider_id.clone(),
                model: request.model.clone(),
                workspace_path: request.workspace_path.clone(),
                project_id: request.project_id.clone().filter(|s| !s.is_empty()),
                worktree_mode: request.worktree_mode.clone(),
                worktree_paths: Vec::new(),
                files_changed: Vec::new(),
                subagents: Vec::new(),
                background_tasks: Vec::new(),
            };
            self.inner.ensure_project_worktrees(&mut conversation).await;
            let conv_id = conversation.id.clone();
            self.inner
                .conversations
                .write()
                .await
                .insert(conv_id.clone(), conversation.clone());
            let _ = self.inner.persist_conversation(&conversation).await;
            self.inner.emit_conversation(&conversation).await;
            conv_id
        };

        let task = AgentTask {
            id: Uuid::new_v4().to_string(),
            conversation_id: conversation_id.clone(),
            prompt: request.prompt.clone(),
            status: AgentTaskStatus::Pending,
            created_at: Utc::now(),
            updated_at: Utc::now(),
            iterations: 0,
            max_iterations: agent_config.max_iterations,
            result: None,
            error: None,
        };

        let task_id = task.id.clone();
        self.inner.tasks.write().await.insert(task_id.clone(), task.clone());

        let inner = self.inner.clone();
        let prompt = request.prompt;
        let system_prompt = request.system_prompt;
        let provider_id = request.provider_id;
        let model = request.model;

        tokio::spawn(async move {
            let _ = inner
                .run_agent_loop(task_id, prompt, system_prompt, provider_id, model, true, true, false)
                .await;
        });

        Ok(task)
    }

    pub async fn cancel_agent_task(&self, task_id: &str) -> Result<AgentTask> {
        let mut tasks = self.inner.tasks.write().await;
        let task = tasks
            .get_mut(task_id)
            .ok_or_else(|| anyhow::anyhow!("Task not found: {}", task_id))?;

        task.status = AgentTaskStatus::Cancelled;
        task.updated_at = Utc::now();

        if let Some(handle) = self.inner.app_handle.read().await.as_ref() {
            let _ = handle.emit("agent-task-update", task.clone());
        }

        Ok(task.clone())
    }

    pub async fn get_agent_status(&self, task_id: &str) -> Option<AgentTask> {
        self.inner.tasks.read().await.get(task_id).cloned()
    }

    pub async fn list_conversations(&self) -> Vec<Conversation> {
        let mut list: Vec<Conversation> =
            self.inner.conversations.read().await.values().cloned().collect();
        list.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        list
    }

    pub async fn create_conversation(
        &self,
        title: Option<String>,
        system_prompt: Option<String>,
        workspace_path: Option<String>,
    ) -> Result<Conversation> {
        self.create_or_update_conversation(None, title, system_prompt, workspace_path, None, None)
            .await
    }

    pub async fn create_or_update_conversation(
        &self,
        conversation_id: Option<String>,
        title: Option<String>,
        system_prompt: Option<String>,
        workspace_path: Option<String>,
        project_id: Option<String>,
        worktree_mode: Option<crate::config::WorktreeMode>,
    ) -> Result<Conversation> {
        if let Some(cid) = conversation_id {
            let mut conv_opt = None;
            {
                let mut convs = self.inner.conversations.write().await;
                if let Some(c) = convs.get_mut(&cid) {
                    if let Some(t) = title {
                        if !t.is_empty() {
                            c.title = t;
                        }
                    }
                    if let Some(sp) = system_prompt {
                        c.system_prompt = if sp.is_empty() { None } else { Some(sp) };
                    }
                    if let Some(ws) = workspace_path {
                        c.workspace_path = if ws.is_empty() { None } else { Some(ws) };
                    }
                    if let Some(pid) = project_id {
                        c.project_id = if pid.is_empty() { None } else { Some(pid) };
                    }
                    if let Some(wt) = worktree_mode {
                        c.worktree_mode = Some(wt);
                    }
                    c.updated_at = Utc::now();
                    conv_opt = Some(c.clone());
                }
            }
            if let Some(mut updated) = conv_opt {
                self.inner.ensure_project_worktrees(&mut updated).await;
                self.inner
                    .conversations
                    .write()
                    .await
                    .insert(updated.id.clone(), updated.clone());
                let _ = self.inner.persist_conversation(&updated).await;
                self.inner.emit_conversation(&updated).await;
                return Ok(updated);
            } else {
                return Err(anyhow::anyhow!("Conversation not found: {}", cid));
            }
        }

        let mut conversation = Conversation {
            id: Uuid::new_v4().to_string(),
            title: title.unwrap_or_else(|| "New Conversation".to_string()),
            messages: vec![],
            created_at: Utc::now(),
            updated_at: Utc::now(),
            system_prompt,
            provider_id: None,
            model: None,
            workspace_path,
            project_id: project_id.filter(|s| !s.is_empty()),
            worktree_mode,
            worktree_paths: Vec::new(),
            files_changed: Vec::new(),
            subagents: Vec::new(),
            background_tasks: Vec::new(),
        };

        self.inner.ensure_project_worktrees(&mut conversation).await;

        self.inner
            .conversations
            .write()
            .await
            .insert(conversation.id.clone(), conversation.clone());
        let _ = self.inner.persist_conversation(&conversation).await;
        self.inner.emit_conversation(&conversation).await;

        Ok(conversation)
    }

    pub async fn move_conversation_to_project(
        &self,
        conversation_id: &str,
        project_id: Option<String>,
        workspace_path: Option<String>,
        worktree_mode: Option<crate::config::WorktreeMode>,
    ) -> Result<Conversation> {
        self.create_or_update_conversation(
            Some(conversation_id.to_string()),
            None,
            None,
            workspace_path,
            Some(project_id.unwrap_or_default()),
            worktree_mode,
        )
        .await
    }

    pub async fn delete_conversation(&self, conversation_id: &str) -> Result<()> {
        self.inner.conversations.write().await.remove(conversation_id);
        let dir = AgentEngineInner::brain_dir(conversation_id);
        if dir.exists() {
            let _ = tokio::fs::remove_dir_all(dir).await;
        }
        Ok(())
    }

    pub async fn get_conversation(&self, conversation_id: &str) -> Option<Conversation> {
        self.inner.conversations.read().await.get(conversation_id).cloned()
    }

    pub async fn send_message(&self, request: SendMessageRequest) -> Result<Conversation> {
        let _task = self
            .start_agent_task(StartAgentTaskRequest {
                conversation_id: Some(request.conversation_id.clone()),
                prompt: request.content,
                system_prompt: None,
                provider_id: request.provider_id,
                model: request.model,
                workspace_path: request.workspace_path,
                project_id: request.project_id,
                worktree_mode: request.worktree_mode,
            })
            .await?;

        self.get_conversation(&request.conversation_id)
            .await
            .ok_or_else(|| anyhow::anyhow!("Conversation not found"))
    }

    pub async fn answer_question(&self, question_id: &str, answers: serde_json::Value) -> Result<()> {
        let tx = self.inner.pending_questions.lock().await.remove(question_id);
        if let Some(sender) = tx {
            let _ = sender.send(answers);
            Ok(())
        } else {
            Err(anyhow::anyhow!("Question not found or already answered"))
        }
    }

    pub async fn approve_command(&self, approval_id: &str, approved: bool) -> Result<()> {
        let tx = self.inner.pending_approvals.lock().await.remove(approval_id);
        if let Some(sender) = tx {
            let _ = sender.send(approved);
            Ok(())
        } else {
            Err(anyhow::anyhow!("Approval request not found"))
        }
    }

    pub async fn list_artifacts(&self, conversation_id: &str) -> Result<Vec<ArtifactInfo>> {
        let dir = AgentEngineInner::brain_dir(conversation_id);
        let mut out = Vec::new();
        let mut seen_names = std::collections::HashSet::new();

        if dir.exists() {
            let mut entries = tokio::fs::read_dir(&dir).await?;
            while let Ok(Some(entry)) = entries.next_entry().await {
                let path = entry.path();
                if path.is_file() {
                    let name = path.file_name().unwrap_or_default().to_string_lossy().to_string();
                    if name == "metadata.json" || name == "transcript.jsonl" {
                        continue;
                    }
                    if let Ok(meta) = entry.metadata().await {
                        let modified: DateTime<Utc> = meta
                            .modified()
                            .unwrap_or(std::time::SystemTime::UNIX_EPOCH)
                            .into();
                        seen_names.insert(name.clone());
                        out.push(ArtifactInfo {
                            name,
                            path: path.to_string_lossy().to_string(),
                            size: meta.len(),
                            updated_at: modified.to_rfc3339(),
                        });
                    }
                }
            }
        }

        // Also surface plan.md / task.md / walkthrough.md from the conversation's workspace
        // when they were written directly to the project folder.
        let ws_path = self
            .inner
            .conversations
            .read()
            .await
            .get(conversation_id)
            .and_then(|c| c.workspace_path.clone());
        if let Some(ws) = ws_path {
            let ws_dir = PathBuf::from(ws);
            for fname in ["plan.md", "task.md", "walkthrough.md"] {
                if seen_names.contains(fname) {
                    continue;
                }
                let candidate = ws_dir.join(fname);
                if candidate.is_file() {
                    if let Ok(meta) = tokio::fs::metadata(&candidate).await {
                        let modified: DateTime<Utc> = meta
                            .modified()
                            .unwrap_or(std::time::SystemTime::UNIX_EPOCH)
                            .into();
                        seen_names.insert(fname.to_string());
                        out.push(ArtifactInfo {
                            name: fname.to_string(),
                            path: candidate.to_string_lossy().to_string(),
                            size: meta.len(),
                            updated_at: modified.to_rfc3339(),
                        });
                    }
                }
            }
        }

        out.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        Ok(out)
    }

    pub fn start_scheduler(&self) {
        let engine = AgentEngine {
            inner: self.inner.clone(),
        };
        tokio::spawn(async move {
            let mut last_fired: HashMap<String, String> = HashMap::new();
            let mut ticker = tokio::time::interval(std::time::Duration::from_secs(30));
            loop {
                ticker.tick().await;
                let cfg = engine.inner.config.get().await;
                if cfg.workspace.scheduled_tasks.is_empty() {
                    continue;
                }
                let now = chrono::Local::now();
                let minute_key = now.format("%Y-%m-%dT%H:%M").to_string();
                for task in cfg.workspace.scheduled_tasks {
                    if !task.enabled {
                        continue;
                    }
                    let Some(expr) = task.cron_expression.as_deref() else {
                        continue;
                    };
                    if last_fired.get(&task.id).map(|k| k.as_str()) == Some(minute_key.as_str()) {
                        continue;
                    }
                    if cron_matches(expr, &now) {
                        last_fired.insert(task.id.clone(), minute_key.clone());
                        let eng = engine.clone();
                        let prompt = task.prompt.clone();
                        let proj_id = task.project_id.clone();
                        tokio::spawn(async move {
                            let _ = eng
                                .start_agent_task(StartAgentTaskRequest {
                                    conversation_id: None,
                                    prompt: format!("[Scheduled Cron Task] {}", prompt),
                                    system_prompt: None,
                                    provider_id: None,
                                    model: None,
                                    workspace_path: None,
                                    project_id: proj_id,
                                    worktree_mode: None,
                                })
                                .await;
                        });
                    }
                }
            }
        });
    }
}

fn spawn_delayed_agent_task(
    inner: AgentEngineInner,
    secs: u64,
    conversation_id: String,
    prompt: String,
) {
    let engine_clone = AgentEngine { inner };
    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(secs.max(1))).await;
        let _ = engine_clone
            .start_agent_task(StartAgentTaskRequest {
                conversation_id: Some(conversation_id),
                prompt: format!("[Scheduled Timer Fired] {}", prompt),
                system_prompt: None,
                provider_id: None,
                model: None,
                workspace_path: None,
                project_id: None,
                worktree_mode: None,
            })
            .await;
    });
}

fn cron_field_matches(field: &str, value: u32) -> bool {
    let field = field.trim();
    if field == "*" {
        return true;
    }
    for part in field.split(',') {
        let part = part.trim();
        if let Some(step_str) = part.strip_prefix("*/") {
            if let Ok(step) = step_str.parse::<u32>() {
                if step > 0 && value % step == 0 {
                    return true;
                }
            }
        } else if let Some((start_s, end_s)) = part.split_once('-') {
            if let (Ok(start), Ok(end)) = (start_s.parse::<u32>(), end_s.parse::<u32>()) {
                if value >= start && value <= end {
                    return true;
                }
            }
        } else if let Ok(exact) = part.parse::<u32>() {
            if value == exact {
                return true;
            }
        }
    }
    false
}

fn cron_matches(expr: &str, now: &chrono::DateTime<chrono::Local>) -> bool {
    use chrono::{Datelike, Timelike};
    let parts: Vec<&str> = expr.split_whitespace().collect();
    if parts.len() != 5 {
        return false;
    }
    let minute = now.minute();
    let hour = now.hour();
    let day = now.day();
    let month = now.month();
    let weekday = now.weekday().num_days_from_sunday();
    cron_field_matches(parts[0], minute)
        && cron_field_matches(parts[1], hour)
        && cron_field_matches(parts[2], day)
        && cron_field_matches(parts[3], month)
        && cron_field_matches(parts[4], weekday)
}

impl AgentEngineInner {
    fn home_dir() -> PathBuf {
        if let Some(override_dir) = std::env::var_os("ANTIGRAVITY_HOME_DIR") {
            if !override_dir.is_empty() {
                return PathBuf::from(override_dir);
            }
        }
        directories::BaseDirs::new()
            .map(|b| b.home_dir().to_path_buf())
            .unwrap_or_else(|| {
                PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| ".".to_string()))
            })
    }

    fn brain_root() -> PathBuf {
        if let Some(override_dir) = std::env::var_os("ANTIGRAVITY_BRAIN_DIR") {
            if !override_dir.is_empty() {
                return PathBuf::from(override_dir);
            }
        }
        Self::home_dir()
            .join(".gemini")
            .join("antigravity")
            .join("brain")
    }

    fn brain_dir(conversation_id: &str) -> PathBuf {
        Self::brain_root().join(conversation_id)
    }

    async fn persist_conversation(&self, conv: &Conversation) -> Result<()> {
        let dir = Self::brain_dir(&conv.id);
        tokio::fs::create_dir_all(&dir).await?;

        let meta_path = dir.join("metadata.json");
        let meta_json = serde_json::to_string_pretty(conv)?;
        tokio::fs::write(&meta_path, meta_json).await?;

        let transcript_path = dir.join("transcript.jsonl");
        let mut lines = String::new();
        for msg in &conv.messages {
            if let Ok(line) = serde_json::to_string(msg) {
                lines.push_str(&line);
                lines.push('\n');
            }
        }
        tokio::fs::write(&transcript_path, lines).await?;
        Ok(())
    }

    async fn load_saved_conversations(&self) {
        let root = Self::brain_root();
        if !root.is_dir() {
            return;
        }
        if let Ok(mut entries) = tokio::fs::read_dir(&root).await {
            while let Ok(Some(entry)) = entries.next_entry().await {
                let meta_path = entry.path().join("metadata.json");
                if meta_path.is_file() {
                    if let Ok(content) = tokio::fs::read_to_string(&meta_path).await {
                        if let Ok(conv) = serde_json::from_str::<Conversation>(&content) {
                            self.conversations.write().await.insert(conv.id.clone(), conv);
                        }
                    }
                }
            }
        }
    }

    async fn emit_conversation(&self, conv: &Conversation) {
        if let Some(handle) = self.app_handle.read().await.as_ref() {
            let _ = handle.emit("agent-conversation-update", conv.clone());
        }
    }

    async fn sync_conversation_telemetry(&self, conversation_id: &str) {
        let subagents: Vec<SubagentInfo> = self.subagents.read().await.values().cloned().collect();
        let bg_tasks_raw: Vec<Arc<BackgroundCommandTask>> =
            self.bg_commands.read().await.values().cloned().collect();
        let mut bg_summaries = Vec::new();
        for t in bg_tasks_raw {
            let (st, code) = Self::refresh_bg_task_state(&t).await;
            let out = t.output.lock().await.clone();
            let preview: String = out
                .lines()
                .rev()
                .take(12)
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect::<Vec<_>>()
                .join("\n");
            bg_summaries.push(BgTaskSummary {
                task_id: t.id.clone(),
                command: t.command.clone(),
                cwd: t.cwd.clone(),
                status: st,
                exit_code: code,
                output_preview: preview,
            });
        }

        let mut updated_conv = None;
        {
            let mut convs = self.conversations.write().await;
            if let Some(c) = convs.get_mut(conversation_id) {
                c.subagents = subagents;
                c.background_tasks = bg_summaries;
                updated_conv = Some(c.clone());
            }
        }
        if let Some(conv) = updated_conv {
            let _ = self.persist_conversation(&conv).await;
            self.emit_conversation(&conv).await;
        }
    }

    async fn record_file_change(
        &self,
        conversation_id: &str,
        path: &str,
        original_content: Option<String>,
        new_content: String,
    ) {
        let change_type = if original_content.is_none() {
            "created".to_string()
        } else {
            "modified".to_string()
        };
        let entry = FileChangeEntry {
            path: path.to_string(),
            change_type,
            original_content,
            new_content,
            updated_at: Utc::now().to_rfc3339(),
        };
        let mut updated_conv = None;
        {
            let mut convs = self.conversations.write().await;
            if let Some(c) = convs.get_mut(conversation_id) {
                if let Some(existing) = c.files_changed.iter_mut().find(|f| f.path == path) {
                    existing.new_content = entry.new_content;
                    existing.updated_at = entry.updated_at;
                } else {
                    c.files_changed.push(entry);
                }
                updated_conv = Some(c.clone());
            }
        }
        if let Some(conv) = updated_conv {
            let _ = self.persist_conversation(&conv).await;
            self.emit_conversation(&conv).await;
        }
    }

    async fn resolve_conversation_project(&self, conv: &Conversation) -> Option<crate::config::ProjectConfig> {
        let pid = conv.project_id.as_deref()?;
        let ws_cfg = self.config.get_workspace_config().await;
        ws_cfg.projects.into_iter().find(|p| p.id == pid)
    }

    async fn check_file_boundary(
        &self,
        conversation_id: &str,
        workspace_path: Option<&str>,
        target_path: &str,
    ) -> std::result::Result<(), String> {
        if target_path.contains("/.ssh/") || target_path.ends_with("/.ssh") {
            return Err("Access to ~/.ssh is blocked by Antigravity security policy.".to_string());
        }
        let agent_cfg = self.config.get_agent_config().await;
        let conv_opt = self.conversations.read().await.get(conversation_id).cloned();
        let proj_opt = match conv_opt.as_ref() {
            Some(c) => self.resolve_conversation_project(c).await,
            None => None,
        };
        let policy = proj_opt
            .as_ref()
            .and_then(|p| p.settings.file_access_policy.as_deref())
            .filter(|s| !s.is_empty() && *s != "inherit")
            .unwrap_or(agent_cfg.non_workspace_file_access.as_str())
            .to_lowercase();
        if policy == "allow" || policy.is_empty() {
            return Ok(());
        }
        let brain = Self::brain_dir(conversation_id);
        if target_path.starts_with(&brain.to_string_lossy().to_string()) || target_path.starts_with("/tmp") {
            return Ok(());
        }
        let mut allowed_roots: Vec<String> = Vec::new();
        if let Some(ws) = workspace_path {
            if !ws.is_empty() && ws != "." {
                allowed_roots.push(ws.to_string());
            }
        }
        if let Some(conv) = self.conversations.read().await.get(conversation_id).cloned() {
            allowed_roots.extend(conv.worktree_paths.clone());
            if let Some(proj) = self.resolve_conversation_project(&conv).await {
                for f in proj.folders {
                    allowed_roots.push(f.path);
                }
                allowed_roots.extend(proj.settings.allowed_paths);
            }
        }
        if allowed_roots.is_empty()
            || allowed_roots
                .iter()
                .any(|root| !root.is_empty() && target_path.starts_with(root))
        {
            return Ok(());
        }
        if policy == "deny" {
            return Err(format!(
                "File access outside project/workspace boundary denied by policy: {}",
                target_path
            ));
        }
        Ok(())
    }

    async fn ensure_project_worktrees(&self, conv: &mut Conversation) {
        let Some(project) = self.resolve_conversation_project(conv).await else {
            return;
        };
        let effective_mode = conv
            .worktree_mode
            .clone()
            .unwrap_or_else(|| project.settings.default_worktree_mode.clone());
        conv.worktree_mode = Some(effective_mode.clone());

        if conv.workspace_path.is_none() {
            if let Some(first_folder) = project.folders.first() {
                conv.workspace_path = Some(first_folder.path.clone());
            }
        }

        if effective_mode == crate::config::WorktreeMode::NewWorktree && conv.worktree_paths.is_empty() {
            let wt_root = Self::brain_dir(&conv.id).join("worktrees");
            let mut provisioned = Vec::new();
            for (idx, folder) in project.folders.iter().enumerate() {
                if folder.ssh_host.is_some() {
                    provisioned.push(folder.path.clone());
                    continue;
                }
                let src_path = PathBuf::from(&folder.path);
                let is_git = folder.is_git || src_path.join(".git").exists();
                if is_git {
                    let safe_name: String = folder
                        .name
                        .chars()
                        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
                        .collect();
                    let target_wt = wt_root.join(format!("{}_{}", idx, safe_name));
                    let _ = tokio::fs::create_dir_all(&wt_root).await;
                    let target_str = target_wt.to_string_lossy().to_string();
                    if !target_wt.exists() {
                        let status = tokio::process::Command::new("git")
                            .arg("-C")
                            .arg(&folder.path)
                            .arg("worktree")
                            .arg("add")
                            .arg("--detach")
                            .arg(&target_str)
                            .output()
                            .await;
                        if let Ok(out) = status {
                            if out.status.success() && target_wt.exists() {
                                provisioned.push(target_str);
                                continue;
                            }
                        }
                    } else {
                        provisioned.push(target_str);
                        continue;
                    }
                }
                provisioned.push(folder.path.clone());
            }
            if !provisioned.is_empty() {
                if conv.workspace_path.as_deref() == project.folders.first().map(|f| f.path.as_str()) {
                    conv.workspace_path = provisioned.first().cloned();
                }
                conv.worktree_paths = provisioned;
            }
        }
    }

    async fn build_system_prompt(&self, conv: &Conversation, extra: Option<&str>) -> String {
        let skills_block = self.skill_manager.build_skills_prompt_block().await;
        let rules_block = self
            .skill_manager
            .load_rules(conv.workspace_path.as_deref())
            .await;
        let brain = Self::brain_dir(&conv.id);
        let ws = conv
            .workspace_path
            .clone()
            .unwrap_or_else(|| std::env::current_dir().unwrap_or_default().to_string_lossy().to_string());

        let mut prompt = String::from(
            "You are Supergravity, an expert local-first agentic AI IDE and coding assistant.\n\
            Use your tools to inspect files, edit code, run commands, search the workspace, and complete tasks accurately.\n\n\
            Execution & Verification Rules:\n\
            1. Plan-driven work: If a plan.md or task.md exists (or you create one), execute ONE stage/task at a time in order. After completing and verifying each stage, immediately update plan.md (mark completed items [x] and note status) with edit_file before starting the next stage.\n\
            2. Skills & Rules: Follow all active rules below. If a task matches an available skill, read its SKILL.md with read_file before acting.\n\
            3. Honesty & Verification: Only report file paths, symbol names, and test/command results you directly observed in tool output after your final edit.\n",
        );
        prompt.push_str(&format!("\nActive Workspace: {}\n", ws));
        prompt.push_str(&format!("Artifact & Brain Directory: {}\n", brain.to_string_lossy()));

        if let Some(project) = self.resolve_conversation_project(conv).await {
            let mode_str = match conv
                .worktree_mode
                .as_ref()
                .unwrap_or(&project.settings.default_worktree_mode)
            {
                crate::config::WorktreeMode::Local => "local",
                crate::config::WorktreeMode::NewWorktree => "new_worktree",
            };
            prompt.push_str(&format!(
                "\n<project id=\"{}\" name=\"{}\" worktree_mode=\"{}\">\n",
                project.id, project.name, mode_str
            ));
            if let Some(desc) = &project.description {
                if !desc.trim().is_empty() {
                    prompt.push_str(&format!("Description: {}\n", desc.trim()));
                }
            }
            prompt.push_str("Active Project Folders:\n");
            for (idx, f) in project.folders.iter().enumerate() {
                let kind = if let Some(ssh) = &f.ssh_host {
                    format!("SSH Host: {}", ssh)
                } else if f.is_git {
                    format!(
                        "Git checkout{}",
                        f.git_branch
                            .as_ref()
                            .map(|b| format!(" (branch: {})", b))
                            .unwrap_or_default()
                    )
                } else {
                    "Local folder".to_string()
                };
                if let Some(wt_path) = conv.worktree_paths.get(idx) {
                    if wt_path != &f.path {
                        prompt.push_str(&format!(
                            "- {} ({}) [{}] -> Isolated Worktree: {}\n",
                            f.name, f.path, kind, wt_path
                        ));
                        continue;
                    }
                }
                prompt.push_str(&format!("- {} ({}) [{}]\n", f.name, f.path, kind));
            }
            if !project.settings.allowed_paths.is_empty() {
                prompt.push_str(&format!(
                    "Additional Allowed Paths: {}\n",
                    project.settings.allowed_paths.join(", ")
                ));
            }
            if let Some(psp) = &project.settings.system_prompt {
                if !psp.trim().is_empty() {
                    prompt.push_str(&format!("Project Instructions:\n{}\n", psp.trim()));
                }
            }
            prompt.push_str("</project>\n");
        }

        let agent_cfg = self.config.get_agent_config().await;
        if let Some(cfg_sp) = &agent_cfg.system_prompt {
            if !cfg_sp.trim().is_empty() {
                prompt.push_str("\n");
                prompt.push_str(cfg_sp);
            }
        }
        if let Some(sp) = &conv.system_prompt {
            prompt.push_str("\n");
            prompt.push_str(sp);
        }
        if let Some(ex) = extra {
            prompt.push_str("\n");
            prompt.push_str(ex);
        }
        if !rules_block.is_empty() {
            prompt.push_str("\n\n");
            prompt.push_str(&rules_block);
        }
        if !skills_block.is_empty() {
            prompt.push_str("\n\n");
            prompt.push_str(&skills_block);
        }
        prompt
    }

    async fn build_tool_definitions(
        &self,
        enable_write: bool,
        enable_mcp: bool,
    ) -> Vec<ToolDefinition> {
        let mut tools = vec![
            Self::tool_def(
                "read_file",
                "Read the contents of a file on disk. Supports optional StartLine, EndLine, and ByteOffset.",
                serde_json::json!({
                    "type": "object",
                    "properties": {
                        "Path": { "type": "string", "description": "Absolute path to the file" },
                        "StartLine": { "type": "integer", "description": "1-based start line" },
                        "EndLine": { "type": "integer", "description": "1-based end line" },
                        "ByteOffset": { "type": "integer", "description": "Optional byte offset" }
                    },
                    "required": ["Path"]
                }),
            ),
            Self::tool_def(
                "search_files",
                "Search for text patterns or file names in a directory using ripgrep/ignore rules.",
                serde_json::json!({
                    "type": "object",
                    "properties": {
                        "directory": { "type": "string", "description": "Directory to search" },
                        "pattern": { "type": "string", "description": "Text or regex pattern to search for" },
                        "file_pattern": { "type": "string", "description": "Optional glob pattern for file names" }
                    },
                    "required": ["directory", "pattern"]
                }),
            ),
            Self::tool_def(
                "search_web",
                "Search the web using DuckDuckGo or configured local SearXNG URL.",
                serde_json::json!({
                    "type": "object",
                    "properties": {
                        "query": { "type": "string", "description": "Search query" },
                        "domain": { "type": "string", "description": "Optional domain filter" }
                    },
                    "required": ["query"]
                }),
            ),
            Self::tool_def(
                "ask_question",
                "Ask the user an interactive multiple-choice question in the chat UI and wait for their selection.",
                serde_json::json!({
                    "type": "object",
                    "properties": {
                        "questions": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "question": { "type": "string" },
                                    "options": { "type": "array", "items": { "type": "string" } },
                                    "is_multi_select": { "type": "boolean" }
                                },
                                "required": ["question", "options"]
                            }
                        }
                    },
                    "required": ["questions"]
                }),
            ),
        ];

        if enable_write {
            tools.extend([
                Self::tool_def(
                    "write_file",
                    "Create or overwrite/append a file on disk. When creating an implementation plan or artifact, pass ArtifactMetadata (Summary, UserFacing, RequestFeedback).",
                    serde_json::json!({
                        "type": "object",
                        "properties": {
                            "Path": { "type": "string", "description": "Absolute path to the file" },
                            "Content": { "type": "string", "description": "File contents" },
                            "Overwrite": { "type": "boolean" },
                            "Append": { "type": "boolean" },
                            "ArtifactMetadata": {
                                "type": "object",
                                "properties": {
                                    "Summary": { "type": "string" },
                                    "UserFacing": { "type": "boolean" },
                                    "RequestFeedback": { "type": "boolean" }
                                }
                            }
                        },
                        "required": ["Path", "Content"]
                    }),
                ),
                Self::tool_def(
                    "edit_file",
                    "Replace an exact target string in a file with a replacement string.",
                    serde_json::json!({
                        "type": "object",
                        "properties": {
                            "Path": { "type": "string", "description": "Absolute path to the file" },
                            "Target": { "type": "string", "description": "Exact existing text to replace" },
                            "Replacement": { "type": "string", "description": "Replacement text" }
                        },
                        "required": ["Path", "Target", "Replacement"]
                    }),
                ),
                Self::tool_def(
                    "run_command",
                    "Execute a shell command in the workspace. Can run synchronously or background as a daemon/async task.",
                    serde_json::json!({
                        "type": "object",
                        "properties": {
                            "CommandLine": { "type": "string" },
                            "WaitMsBeforeAsync": { "type": "integer" },
                            "IsDaemon": { "type": "boolean" },
                            "BypassSandbox": { "type": "boolean" },
                            "toolSummary": { "type": "string" }
                        },
                        "required": ["CommandLine", "WaitMsBeforeAsync", "toolSummary"]
                    }),
                ),
                Self::tool_def(
                    "manage_task",
                    "Manage background commands: list, status, send_input, or kill.",
                    serde_json::json!({
                        "type": "object",
                        "properties": {
                            "Action": { "type": "string", "enum": ["list", "status", "send_input", "kill"] },
                            "TaskId": { "type": "string" },
                            "Input": { "type": "string" }
                        },
                        "required": ["Action"]
                    }),
                ),
                Self::tool_def(
                    "invoke_subagent",
                    "Launch a child subagent (e.g. self, research, browser, or custom) with its own isolated context.",
                    serde_json::json!({
                        "type": "object",
                        "properties": {
                            "TypeName": { "type": "string" },
                            "Role": { "type": "string" },
                            "Prompt": { "type": "string" },
                            "Model": { "type": "string" },
                            "Workspace": { "type": "string" }
                        },
                        "required": ["TypeName", "Role", "Prompt"]
                    }),
                ),
                Self::tool_def(
                    "define_subagent",
                    "Define a new reusable subagent type.",
                    serde_json::json!({
                        "type": "object",
                        "properties": {
                            "Name": { "type": "string" },
                            "Description": { "type": "string" },
                            "SystemPrompt": { "type": "string" },
                            "EnableWriteTools": { "type": "boolean" },
                            "EnableMCPTools": { "type": "boolean" }
                        },
                        "required": ["Name", "Description", "SystemPrompt"]
                    }),
                ),
                Self::tool_def(
                    "send_message",
                    "Send a follow-up message to an existing subagent conversation and get its response.",
                    serde_json::json!({
                        "type": "object",
                        "properties": {
                            "Recipient": { "type": "string" },
                            "Message": { "type": "string" }
                        },
                        "required": ["Recipient", "Message"]
                    }),
                ),
                Self::tool_def(
                    "manage_subagents",
                    "List or terminate active subagents.",
                    serde_json::json!({
                        "type": "object",
                        "properties": {
                            "Action": { "type": "string", "enum": ["list", "kill", "kill_all"] },
                            "ConversationIds": { "type": "array", "items": { "type": "string" } }
                        },
                        "required": ["Action"]
                    }),
                ),
                Self::tool_def(
                    "schedule",
                    "Schedule a one-shot timer (DurationSeconds) or recurring cron job (CronExpression) that triggers an automated agent prompt.",
                    serde_json::json!({
                        "type": "object",
                        "properties": {
                            "Prompt": { "type": "string" },
                            "DurationSeconds": { "type": "integer" },
                            "CronExpression": { "type": "string" },
                            "IsDaemon": { "type": "boolean" }
                        },
                        "required": ["Prompt"]
                    }),
                ),
                Self::tool_def(
                    "swarm",
                    "Manage the multi-agent swarm working on the shared message board (status, models, add, model, kill, title).",
                    serde_json::json!({
                        "type": "object",
                        "properties": {
                            "action": { "type": "string", "enum": ["status", "models", "add", "model", "kill", "title"] },
                            "name": { "type": "string" },
                            "brief": { "type": "string" },
                            "workspace": { "type": "string", "enum": ["inherit", "share", "branch"] },
                            "title": { "type": "string" }
                        },
                        "required": ["action"]
                    }),
                ),
            ]);
        }

        if enable_mcp {
            let mcp_tools = self.mcp_client.list_tools(None).await;
            for mt in mcp_tools {
                tools.push(Self::tool_def(
                    &format!("mcp__{}__{}", mt.server_id, mt.name),
                    &mt.description,
                    mt.input_schema,
                ));
            }
        }

        tools
    }

    fn tool_def(name: &str, description: &str, parameters: serde_json::Value) -> ToolDefinition {
        ToolDefinition {
            r#type: "function".to_string(),
            function: ToolFunctionDefinition {
                name: name.to_string(),
                description: description.to_string(),
                parameters,
            },
        }
    }

    async fn run_agent_loop(
        &self,
        task_id: String,
        prompt: String,
        system_prompt_extra: Option<String>,
        provider_id: Option<String>,
        model: Option<String>,
        enable_write: bool,
        enable_mcp: bool,
        append_user_msg: bool,
    ) -> Result<String> {
        let conversation_id = {
            let mut tasks = self.tasks.write().await;
            let task = tasks
                .get_mut(&task_id)
                .ok_or_else(|| anyhow::anyhow!("Task not found"))?;
            task.status = AgentTaskStatus::Running;
            task.updated_at = Utc::now();
            if let Some(handle) = self.app_handle.read().await.as_ref() {
                let _ = handle.emit("agent-task-update", task.clone());
            }
            task.conversation_id.clone()
        };

        let mut conversation = self
            .conversations
            .read()
            .await
            .get(&conversation_id)
            .cloned()
            .ok_or_else(|| anyhow::anyhow!("Conversation not found"))?;

        if append_user_msg {
            if conversation.messages.is_empty() && conversation.title == "New Conversation" {
                conversation.title = prompt.chars().take(48).collect();
            }

            conversation.messages.push(ConversationMessage {
                id: Uuid::new_v4().to_string(),
                role: "user".to_string(),
                content: prompt,
                reasoning_content: None,
                created_at: Utc::now(),
                tool_calls: None,
                tool_call_id: None,
                tool_name: None,
            });
            conversation.updated_at = Utc::now();
            self.conversations
                .write()
                .await
                .insert(conversation_id.clone(), conversation.clone());
            let _ = self.persist_conversation(&conversation).await;
            self.emit_conversation(&conversation).await;
        }

        let agent_config = self.config.get_agent_config().await;
        let llm_config = self.config.get_llm_config().await;
        let sys_prompt = self
            .build_system_prompt(&conversation, system_prompt_extra.as_deref())
            .await;
        let tool_defs = self.build_tool_definitions(enable_write, enable_mcp).await;
        let effective_provider_id = provider_id.or_else(|| conversation.provider_id.clone());
        let mut edits_since_plan_update: usize = 0;

        for iteration in 0..agent_config.max_iterations {
            // Check cancellation
            if let Some(t) = self.tasks.read().await.get(&task_id) {
                if t.status == AgentTaskStatus::Cancelled {
                    return Ok("Cancelled".to_string());
                }
            }

            {
                let mut tasks = self.tasks.write().await;
                if let Some(task) = tasks.get_mut(&task_id) {
                    task.iterations = iteration + 1;
                    task.updated_at = Utc::now();
                }
            }

            let provider = self
                .llm_providers
                .resolve_provider(effective_provider_id.as_deref())
                .await;
            let Some(provider) = provider else {
                let err_msg = "No active local LLM provider configured. Open Settings to connect Strata, Ollama, LM Studio, llama.cpp, or vLLM.".to_string();
                let mut tasks = self.tasks.write().await;
                if let Some(task) = tasks.get_mut(&task_id) {
                    task.status = AgentTaskStatus::Failed;
                    task.error = Some(err_msg.clone());
                    task.updated_at = Utc::now();
                    if let Some(handle) = self.app_handle.read().await.as_ref() {
                        let _ = handle.emit("agent-task-update", task.clone());
                    }
                }
                return Err(anyhow::anyhow!(err_msg));
            };

            let mut llm_messages = vec![ChatMessage {
                role: MessageRole::System,
                content: sys_prompt.clone(),
                reasoning_content: None,
                name: None,
                tool_calls: None,
                tool_call_id: None,
            }];

            for m in &conversation.messages {
                if m.role == "system" {
                    continue;
                }
                llm_messages.push(ChatMessage {
                    role: match m.role.as_str() {
                        "user" => MessageRole::User,
                        "assistant" => MessageRole::Assistant,
                        "tool" => MessageRole::Tool,
                        _ => MessageRole::User,
                    },
                    content: m.content.clone(),
                    reasoning_content: None,
                    name: m.tool_name.clone(),
                    tool_calls: m.tool_calls.clone().map(|calls| {
                        calls
                            .into_iter()
                            .filter_map(|v| serde_json::from_value::<ToolCall>(v).ok())
                            .collect()
                    }),
                    tool_call_id: m.tool_call_id.clone(),
                });
            }

            let chosen_model = model
                .clone()
                .or_else(|| conversation.model.clone())
                .or_else(|| llm_config.default_model.clone())
                .or_else(|| provider.models.first().map(|m| m.id.clone()))
                .unwrap_or_else(|| "coder-iq1_m".to_string());

            let llm_request = ChatCompletionRequest {
                model: chosen_model,
                messages: llm_messages,
                temperature: if llm_config.inherit_model_settings {
                    None
                } else {
                    llm_config.temperature
                },
                max_tokens: if llm_config.inherit_model_settings {
                    None
                } else {
                    llm_config.max_tokens
                },
                stream: Some(agent_config.enable_streaming),
                tools: if tool_defs.is_empty() { None } else { Some(tool_defs.clone()) },
                tool_choice: None,
                top_p: None,
                frequency_penalty: None,
                presence_penalty: None,
                stop: None,
            };

            let assistant_msg_id = Uuid::new_v4().to_string();
            let mut full_content = String::new();
            let mut full_reasoning = String::new();
            let mut native_tool_calls: Vec<ToolCall> = Vec::new();

            if agent_config.enable_streaming {
                let mut acc_content = String::new();
                let mut acc_reasoning = String::new();
                let mut acc_tools: HashMap<u32, ToolCall> = HashMap::new();
                let handle_opt = self.app_handle.read().await.clone();
                let conv_id_clone = conversation_id.clone();
                let msg_id_clone = assistant_msg_id.clone();
                let convs_map = self.conversations.clone();

                let stream_res = self
                    .llm_providers
                    .stream_chat_completion_with_provider(
                        effective_provider_id.as_deref(),
                        llm_request,
                        |chunk| {
                        if let Some(choice) = chunk.choices.first() {
                            let content_delta = choice.delta.content.clone().unwrap_or_default();
                            let reasoning_delta = choice.delta.reasoning_content.clone().unwrap_or_default();

                            if !content_delta.is_empty() {
                                acc_content.push_str(&content_delta);
                            }
                            if !reasoning_delta.is_empty() {
                                acc_reasoning.push_str(&reasoning_delta);
                            }
                            if let Some(tc_deltas) = &choice.delta.tool_calls {
                                for d in tc_deltas {
                                    let entry = acc_tools.entry(d.index).or_insert_with(|| ToolCall {
                                        id: d.id.clone().unwrap_or_else(|| format!("call_{}", d.index)),
                                        r#type: d.r#type.clone().unwrap_or_else(|| "function".to_string()),
                                        function: crate::llm::ToolFunction::default(),
                                    });
                                    if let Some(id) = &d.id {
                                        entry.id = id.clone();
                                    }
                                    if let Some(f) = &d.function {
                                        if let Some(name) = &f.name {
                                            entry.function.name.push_str(name);
                                        }
                                        if let Some(args) = &f.arguments {
                                            entry.function.arguments.push_str(args);
                                        }
                                    }
                                }
                            }

                            if !content_delta.is_empty() || !reasoning_delta.is_empty() {
                                if let Ok(mut guard) = convs_map.try_write() {
                                    if let Some(c) = guard.get_mut(&conv_id_clone) {
                                        if let Some(existing) = c.messages.iter_mut().find(|m| m.id == msg_id_clone) {
                                            existing.content = acc_content.clone();
                                            existing.reasoning_content = if acc_reasoning.is_empty() {
                                                None
                                            } else {
                                                Some(acc_reasoning.clone())
                                            };
                                        } else {
                                            c.messages.push(ConversationMessage {
                                                id: msg_id_clone.clone(),
                                                role: "assistant".to_string(),
                                                content: acc_content.clone(),
                                                reasoning_content: if acc_reasoning.is_empty() {
                                                    None
                                                } else {
                                                    Some(acc_reasoning.clone())
                                                },
                                                created_at: Utc::now(),
                                                tool_calls: None,
                                                tool_call_id: None,
                                                tool_name: None,
                                            });
                                        }
                                    }
                                }
                                if let Some(h) = &handle_opt {
                                    let _ = h.emit(
                                        "agent-stream-delta",
                                        serde_json::json!({
                                            "conversation_id": conv_id_clone,
                                            "message_id": msg_id_clone,
                                            "content_delta": content_delta,
                                            "reasoning_delta": reasoning_delta,
                                        }),
                                    );
                                }
                            }
                        }
                    })
                    .await;

                if let Err(e) = stream_res {
                    return self.fail_task(&task_id, e).await;
                }

                full_content = acc_content;
                full_reasoning = acc_reasoning;
                let mut sorted: Vec<(u32, ToolCall)> = acc_tools.drain().collect();
                sorted.sort_by_key(|(idx, _)| *idx);
                native_tool_calls = sorted.into_iter().map(|(_, tc)| tc).collect();
            } else {
                match self
                    .llm_providers
                    .chat_completion_with_provider(effective_provider_id.as_deref(), llm_request)
                    .await
                {
                    Ok(resp) => {
                        if let Some(choice) = resp.choices.first() {
                            full_content = choice.message.content.clone();
                            full_reasoning = choice.message.reasoning_content.clone().unwrap_or_default();
                            native_tool_calls = choice.message.tool_calls.clone().unwrap_or_default();
                        }
                    }
                    Err(e) => return self.fail_task(&task_id, e).await,
                }
            }

            // Fallback XML/JSON tool-call parser if native tool_calls is empty
            let tool_calls = if native_tool_calls.is_empty() {
                let (cleaned, parsed) = LLMProviderManager::parse_fallback_tool_calls(&full_content);
                if !parsed.is_empty() {
                    full_content = cleaned;
                }
                parsed
            } else {
                native_tool_calls
            };

            let assistant_message = ConversationMessage {
                id: assistant_msg_id.clone(),
                role: "assistant".to_string(),
                content: full_content.clone(),
                reasoning_content: if full_reasoning.is_empty() {
                    None
                } else {
                    Some(full_reasoning)
                },
                created_at: Utc::now(),
                tool_calls: if tool_calls.is_empty() {
                    None
                } else {
                    Some(
                        tool_calls
                            .iter()
                            .filter_map(|c| serde_json::to_value(c).ok())
                            .collect(),
                    )
                },
                tool_call_id: None,
                tool_name: None,
            };
            if let Some(existing) = conversation.messages.iter_mut().find(|m| m.id == assistant_msg_id) {
                *existing = assistant_message;
            } else {
                conversation.messages.push(assistant_message);
            }
            conversation.updated_at = Utc::now();
            self.conversations
                .write()
                .await
                .insert(conversation_id.clone(), conversation.clone());
            let _ = self.persist_conversation(&conversation).await;
            self.emit_conversation(&conversation).await;

            // If no tool calls, task is complete!
            if tool_calls.is_empty() {
                let mut tasks = self.tasks.write().await;
                if let Some(task) = tasks.get_mut(&task_id) {
                    task.status = AgentTaskStatus::Completed;
                    task.result = Some(full_content.clone());
                    task.updated_at = Utc::now();
                    if let Some(handle) = self.app_handle.read().await.as_ref() {
                        let _ = handle.emit("agent-task-update", task.clone());
                    }
                }
                return Ok(full_content);
            }

            // Execute each tool call
            let tool_timeout = std::time::Duration::from_secs(agent_config.tool_timeout_seconds.max(1));
            for tc in tool_calls {
                let parsed_args = serde_json::from_str::<serde_json::Value>(&tc.function.arguments);
                let result_str = match parsed_args {
                    Err(parse_err) => format!(
                        "Error: Invalid or truncated JSON arguments for tool '{}' (likely hit max_tokens while generating a large payload). Split large writes into smaller write_file + Append=true chunks or increase max_tokens in Settings. Parse error: {}",
                        tc.function.name, parse_err
                    ),
                    Ok(args) => {
                        let target_path = args
                            .get("Path")
                            .or_else(|| args.get("path"))
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();
                        let is_interactive_write = tc.function.name == "write_file"
                            && args
                                .get("ArtifactMetadata")
                                .and_then(|m| m.get("RequestFeedback"))
                                .and_then(|v| v.as_bool())
                                == Some(true);
                        let tool_fut = self.execute_tool(
                            &conversation_id,
                            conversation.workspace_path.as_deref(),
                            &tc.function.name,
                            args,
                        );
                        let mut out = if tc.function.name == "ask_question"
                            || is_interactive_write
                            || (tc.function.name == "run_command"
                                && agent_config.require_command_approval)
                        {
                            tool_fut.await
                        } else {
                            match tokio::time::timeout(tool_timeout, tool_fut).await {
                                Ok(res) => res,
                                Err(_) => format!(
                                    "Tool '{}' timed out after {} seconds.",
                                    tc.function.name, agent_config.tool_timeout_seconds
                                ),
                            }
                        };

                        if tc.function.name == "write_file" || tc.function.name == "edit_file" {
                            if target_path.ends_with("plan.md") || target_path.ends_with("task.md")
                            {
                                edits_since_plan_update = 0;
                            } else {
                                edits_since_plan_update += 1;
                                if edits_since_plan_update >= 3 {
                                    let brain_plan =
                                        AgentEngineInner::brain_dir(&conversation_id).join("plan.md");
                                    let ws_plan = conversation
                                        .workspace_path
                                        .as_deref()
                                        .map(|w| std::path::PathBuf::from(w).join("plan.md"));
                                    if brain_plan.is_file()
                                        || ws_plan.as_ref().is_some_and(|p| p.is_file())
                                    {
                                        out.push_str(
                                            "\n\n[Plan Progress Reminder: plan.md exists and has not been updated after recent code edits. If you finished a stage or task, update plan.md (mark [x] / progress) before moving on.]",
                                        );
                                        edits_since_plan_update = 0;
                                    }
                                }
                            }
                        }
                        out
                    }
                };

                conversation.messages.push(ConversationMessage {
                    id: Uuid::new_v4().to_string(),
                    role: "tool".to_string(),
                    content: result_str,
                    reasoning_content: None,
                    created_at: Utc::now(),
                    tool_calls: None,
                    tool_call_id: Some(tc.id),
                    tool_name: Some(tc.function.name),
                });
                conversation.updated_at = Utc::now();
                self.conversations
                    .write()
                    .await
                    .insert(conversation_id.clone(), conversation.clone());
                let _ = self.persist_conversation(&conversation).await;
                self.emit_conversation(&conversation).await;
            }
        }

        let msg = format!("Agent completed after {} iterations (max reached)", agent_config.max_iterations);
        let mut tasks = self.tasks.write().await;
        if let Some(task) = tasks.get_mut(&task_id) {
            task.status = AgentTaskStatus::Completed;
            task.result = Some(msg.clone());
            task.updated_at = Utc::now();
            if let Some(handle) = self.app_handle.read().await.as_ref() {
                let _ = handle.emit("agent-task-update", task.clone());
            }
        }
        Ok(msg)
    }

    async fn fail_task(&self, task_id: &str, err: anyhow::Error) -> Result<String> {
        let mut tasks = self.tasks.write().await;
        if let Some(task) = tasks.get_mut(task_id) {
            task.status = AgentTaskStatus::Failed;
            task.error = Some(err.to_string());
            task.updated_at = Utc::now();
            if let Some(handle) = self.app_handle.read().await.as_ref() {
                let _ = handle.emit("agent-task-update", task.clone());
            }
        }
        Err(err)
    }

    async fn execute_tool(
        &self,
        conversation_id: &str,
        workspace_path: Option<&str>,
        name: &str,
        args: serde_json::Value,
    ) -> String {
        if let Err(blocked_reason) = self
            .skill_manager
            .run_lifecycle_hooks("PreToolUse", name, &args, workspace_path)
            .await
        {
            return blocked_reason;
        }
        let result = match name {
            "read_file" => {
                let path = args.get("Path").or_else(|| args.get("path")).and_then(|v| v.as_str()).unwrap_or("");
                if path.trim().is_empty() {
                    return "Error: Missing required 'Path' argument for read_file.".to_string();
                }
                if let Err(e) = self.check_file_boundary(conversation_id, workspace_path, path).await {
                    return e;
                }
                let start = args.get("StartLine").and_then(|v| v.as_u64()).map(|n| n as u32);
                let end = args.get("EndLine").and_then(|v| v.as_u64()).map(|n| n as u32);
                if let (Some(s), Some(e)) = (start, end) {
                    match fs_mod::read_file_range(fs_mod::ReadFileRangeRequest {
                        path: path.to_string(),
                        start_line: s,
                        end_line: e,
                    }).await {
                        Ok(r) => r.lines.join("\n"),
                        Err(err) => format!("Error: {}", err),
                    }
                } else {
                    match fs_mod::read_file(fs_mod::ReadFileRequest { path: path.to_string() }).await {
                        Ok(r) => r.content,
                        Err(err) => format!("Error: {}", err),
                    }
                }
            }
            "write_file" => {
                let path = args.get("Path").or_else(|| args.get("path")).and_then(|v| v.as_str()).unwrap_or("");
                if path.trim().is_empty() {
                    return "Error: Missing required 'Path' argument for write_file.".to_string();
                }
                if let Err(e) = self.check_file_boundary(conversation_id, workspace_path, path).await {
                    return e;
                }
                let content = args.get("Content").or_else(|| args.get("content")).and_then(|v| v.as_str()).unwrap_or("");
                let append = args.get("Append").and_then(|v| v.as_bool()).unwrap_or(false);
                let orig = tokio::fs::read_to_string(path).await.ok();
                let write_res = if append {
                    if let Some(existing) = &orig {
                        let combined = format!("{}{}", existing, content);
                        fs_mod::write_file(fs_mod::WriteFileRequest {
                            path: path.to_string(),
                            content: combined.clone(),
                            create_dirs: Some(true),
                        })
                        .await
                        .map(|_| (format!("Appended to {}", path), combined))
                    } else {
                        fs_mod::write_file(fs_mod::WriteFileRequest {
                            path: path.to_string(),
                            content: content.to_string(),
                            create_dirs: Some(true),
                        })
                        .await
                        .map(|_| (format!("Wrote {}", path), content.to_string()))
                    }
                } else {
                    fs_mod::write_file(fs_mod::WriteFileRequest {
                        path: path.to_string(),
                        content: content.to_string(),
                        create_dirs: Some(true),
                    })
                    .await
                    .map(|_| (format!("Wrote {}", path), content.to_string()))
                };

                match write_res {
                    Ok((mut msg, final_content)) => {
                        self.record_file_change(conversation_id, path, orig, final_content.clone())
                            .await;
                        let has_artifact_meta = args.get("ArtifactMetadata").is_some();
                        let is_plan_or_artifact = has_artifact_meta
                            || path.ends_with("/plan.md")
                            || path.ends_with("/task.md")
                            || path.ends_with("/walkthrough.md");
                        if is_plan_or_artifact {
                            let brain_dir = Self::brain_dir(conversation_id);
                            if !path.starts_with(&brain_dir.to_string_lossy().to_string()) {
                                if let Some(fname) = std::path::Path::new(path).file_name() {
                                    let _ = tokio::fs::create_dir_all(&brain_dir).await;
                                    let _ = tokio::fs::write(brain_dir.join(fname), &final_content).await;
                                }
                            }
                        }
                        let req_feedback = args
                            .get("ArtifactMetadata")
                            .and_then(|m| m.get("RequestFeedback"))
                            .and_then(|v| v.as_bool())
                            .unwrap_or(false);
                        let summary = args
                            .get("ArtifactMetadata")
                            .and_then(|m| m.get("Summary"))
                            .and_then(|v| v.as_str())
                            .unwrap_or("Implementation Plan ready for review");
                        if req_feedback {
                            let review_id = format!("plan_review:{}", Uuid::new_v4());
                            let (tx, rx) = oneshot::channel();
                            self.pending_questions.lock().await.insert(review_id.clone(), tx);
                            if let Some(handle) = self.app_handle.read().await.as_ref() {
                                let _ = handle.emit(
                                    "agent-plan-review",
                                    PlanReviewRequest {
                                        review_id: review_id.clone(),
                                        conversation_id: conversation_id.to_string(),
                                        path: path.to_string(),
                                        summary: summary.to_string(),
                                        content: final_content,
                                    },
                                );
                            }
                            if let Ok(Ok(decision)) =
                                tokio::time::timeout(std::time::Duration::from_secs(300), rx).await
                            {
                                let approved = decision
                                    .get("approved")
                                    .and_then(|v| v.as_bool())
                                    .unwrap_or(true);
                                let feedback = decision
                                    .get("feedback")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("");
                                if approved {
                                    msg.push_str("\nUser approved the plan (Proceed). Execute the plan stage-by-stage in order. After completing and verifying each stage, update plan.md (mark completed tasks [x] / progress) before starting the next stage.");
                                } else {
                                    msg.push_str(&format!(
                                        "\nUser requested changes to the plan: {}",
                                        feedback
                                    ));
                                }
                            }
                        }
                        msg
                    }
                    Err(e) => format!("Error: {}", e),
                }
            }
            "edit_file" => {
                let path = args.get("Path").or_else(|| args.get("path")).and_then(|v| v.as_str()).unwrap_or("");
                if path.trim().is_empty() {
                    return "Error: Missing required 'Path' argument for edit_file.".to_string();
                }
                if let Err(e) = self.check_file_boundary(conversation_id, workspace_path, path).await {
                    return e;
                }
                let target = args.get("Target").or_else(|| args.get("target")).and_then(|v| v.as_str()).unwrap_or("");
                let replacement = args.get("Replacement").or_else(|| args.get("replacement")).and_then(|v| v.as_str()).unwrap_or("");
                let orig = tokio::fs::read_to_string(path).await.ok();
                match fs_mod::edit_file(fs_mod::EditFileRequest {
                    path: path.to_string(),
                    old_text: target.to_string(),
                    new_text: replacement.to_string(),
                    replace_all: Some(true),
                }).await {
                    Ok(_) => {
                        if let Ok(after) = tokio::fs::read_to_string(path).await {
                            self.record_file_change(conversation_id, path, orig, after).await;
                        }
                        format!("Edited {}", path)
                    }
                    Err(e) => format!("Error: {}", e),
                }
            }
            "search_files" => {
                let dir = args.get("directory").and_then(|v| v.as_str()).or(workspace_path).unwrap_or(".");
                let pattern = args.get("pattern").and_then(|v| v.as_str()).unwrap_or("");
                match fs_mod::search_files(fs_mod::SearchFilesRequest {
                    path: dir.to_string(),
                    pattern: pattern.to_string(),
                    ignore_patterns: None,
                }).await {
                    Ok(results) => serde_json::to_string_pretty(&results).unwrap_or_default(),
                    Err(e) => format!("Error: {}", e),
                }
            }
            "run_command" => {
                let cmd_line = args.get("CommandLine").and_then(|v| v.as_str()).unwrap_or("");
                let wait_ms = args.get("WaitMsBeforeAsync").and_then(|v| v.as_u64()).unwrap_or(5000);
                let is_daemon = args.get("IsDaemon").and_then(|v| v.as_bool()).unwrap_or(false);
                let bypass = args.get("BypassSandbox").and_then(|v| v.as_bool()).unwrap_or(false);
                let summary = args.get("toolSummary").and_then(|v| v.as_str()).unwrap_or(cmd_line);

                let agent_cfg = self.config.get_agent_config().await;
                let lower_cmd = cmd_line.to_lowercase();
                if agent_cfg
                    .command_denylist
                    .iter()
                    .any(|pat| !pat.is_empty() && lower_cmd.contains(&pat.to_lowercase()))
                {
                    return format!("Command blocked by security denylist: {}", cmd_line);
                }
                let is_allowlisted = agent_cfg
                    .command_allowlist
                    .iter()
                    .any(|pat| !pat.is_empty() && lower_cmd.contains(&pat.to_lowercase()));

                let mut needs_approval = if is_allowlisted {
                    false
                } else {
                    agent_cfg.require_command_approval
                };
                if let Some(conv) = self.conversations.read().await.get(conversation_id).cloned() {
                    if let Some(project) = self.resolve_conversation_project(&conv).await {
                        match project.settings.permission_preset {
                            crate::config::ProjectPermissionPreset::InheritGlobal => {
                                needs_approval = project
                                    .settings
                                    .require_command_approval
                                    .unwrap_or(agent_cfg.require_command_approval);
                            }
                            crate::config::ProjectPermissionPreset::AlwaysAsk => {
                                needs_approval = true;
                            }
                            crate::config::ProjectPermissionPreset::Default => {
                                let cwd = workspace_path.unwrap_or("");
                                let in_project_scope = project
                                    .folders
                                    .iter()
                                    .any(|f| !f.path.is_empty() && cwd.starts_with(&f.path))
                                    || conv
                                        .worktree_paths
                                        .iter()
                                        .any(|w| !w.is_empty() && cwd.starts_with(w))
                                    || project
                                        .settings
                                        .allowed_paths
                                        .iter()
                                        .any(|a| !a.is_empty() && cwd.starts_with(a));
                                needs_approval = !in_project_scope
                                    || project.settings.require_command_approval.unwrap_or(false);
                            }
                            crate::config::ProjectPermissionPreset::Auto => {
                                let lower = cmd_line.to_lowercase();
                                let is_risky = lower.contains("rm -rf")
                                    || lower.contains("mkfs")
                                    || lower.contains("dd if=")
                                    || lower.contains("sudo ")
                                    || lower.contains("chmod -r 777");
                                needs_approval = is_risky
                                    || project.settings.require_command_approval.unwrap_or(false);
                            }
                        }
                    }
                }
                if needs_approval && !bypass {
                    let approval_id = Uuid::new_v4().to_string();
                    let (tx, rx) = oneshot::channel();
                    self.pending_approvals.lock().await.insert(approval_id.clone(), tx);
                    if let Some(handle) = self.app_handle.read().await.as_ref() {
                        let _ = handle.emit(
                            "agent-command-approval",
                            serde_json::json!({
                                "approval_id": approval_id,
                                "conversation_id": conversation_id,
                                "command": cmd_line,
                                "summary": summary,
                            }),
                        );
                    }
                    let approved = tokio::time::timeout(std::time::Duration::from_secs(120), rx)
                        .await
                        .ok()
                        .and_then(|r| r.ok())
                        .unwrap_or(false);
                    if !approved {
                        return "Command denied by user or timed out.".to_string();
                    }
                }

                let out = self.run_shell_command(cmd_line, workspace_path, wait_ms, is_daemon).await;
                self.sync_conversation_telemetry(conversation_id).await;
                out
            }
            "manage_task" => {
                let action = args.get("Action").and_then(|v| v.as_str()).unwrap_or("list");
                let task_id = args.get("TaskId").and_then(|v| v.as_str());
                let input = args.get("Input").and_then(|v| v.as_str());
                let out = self.handle_manage_task(action, task_id, input).await;
                self.sync_conversation_telemetry(conversation_id).await;
                out
            }
            "ask_question" => {
                let question_id = Uuid::new_v4().to_string();
                let (tx, rx) = oneshot::channel();
                self.pending_questions.lock().await.insert(question_id.clone(), tx);
                if let Some(handle) = self.app_handle.read().await.as_ref() {
                    let _ = handle.emit(
                        "agent-ask-question",
                        serde_json::json!({
                            "question_id": question_id,
                            "conversation_id": conversation_id,
                            "questions": args.get("questions").cloned().unwrap_or(serde_json::json!([])),
                        }),
                    );
                }
                match tokio::time::timeout(std::time::Duration::from_secs(300), rx).await {
                    Ok(Ok(ans)) => serde_json::to_string_pretty(&ans).unwrap_or_default(),
                    _ => "User did not answer in time.".to_string(),
                }
            }
            "search_web" => {
                let query = args.get("query").and_then(|v| v.as_str()).unwrap_or("");
                let domain = args.get("domain").and_then(|v| v.as_str());
                let agent_cfg = self.config.get_agent_config().await;
                let conv_opt = self.conversations.read().await.get(conversation_id).cloned();
                let proj_opt = match conv_opt.as_ref() {
                    Some(c) => self.resolve_conversation_project(c).await,
                    None => None,
                };
                let net_policy = proj_opt
                    .as_ref()
                    .and_then(|p| p.settings.internet_access_policy.as_deref())
                    .filter(|s| !s.is_empty() && *s != "inherit")
                    .unwrap_or(agent_cfg.internet_access_policy.as_str())
                    .to_lowercase();
                if net_policy == "deny" {
                    "Blocked: internet_access_policy is set to 'deny'.".to_string()
                } else if net_policy == "ask" {
                    let approval_id = Uuid::new_v4().to_string();
                    let (tx, rx) = oneshot::channel();
                    self.pending_approvals.lock().await.insert(approval_id.clone(), tx);
                    if let Some(handle) = self.app_handle.read().await.as_ref() {
                        let _ = handle.emit(
                            "agent-command-approval",
                            serde_json::json!({
                                "approval_id": approval_id,
                                "conversation_id": conversation_id,
                                "command": format!("search_web: {}", query),
                                "working_dir": workspace_path.unwrap_or("."),
                            }),
                        );
                    }
                    let approved = matches!(
                        tokio::time::timeout(std::time::Duration::from_secs(120), rx).await,
                        Ok(Ok(true))
                    );
                    if !approved {
                        "Web search rejected by user (internet_access_policy = ask).".to_string()
                    } else {
                        self.execute_search_web(query, domain).await
                    }
                } else {
                    self.execute_search_web(query, domain).await
                }
            }
            "define_subagent" => {
                let name = args.get("Name").and_then(|v| v.as_str()).unwrap_or("custom").to_string();
                let desc = args.get("Description").and_then(|v| v.as_str()).unwrap_or("").to_string();
                let sp = args.get("SystemPrompt").and_then(|v| v.as_str()).unwrap_or("").to_string();
                let write = args.get("EnableWriteTools").and_then(|v| v.as_bool()).unwrap_or(true);
                let mcp = args.get("EnableMCPTools").and_then(|v| v.as_bool()).unwrap_or(true);
                self.subagent_defs.write().await.insert(
                    name.clone(),
                    SubagentDefinition {
                        name: name.clone(),
                        description: desc,
                        system_prompt: sp,
                        enable_write_tools: write,
                        enable_mcp_tools: mcp,
                    },
                );
                format!("Defined subagent type '{}'", name)
            }
            "invoke_subagent" => {
                let type_name = args.get("TypeName").and_then(|v| v.as_str()).unwrap_or("self").to_string();
                let role = args.get("Role").and_then(|v| v.as_str()).unwrap_or("Subagent").to_string();
                let prompt = args.get("Prompt").and_then(|v| v.as_str()).unwrap_or("").to_string();
                let model = args.get("Model").and_then(|v| v.as_str()).map(|s| s.to_string());
                let out = self.run_subagent(workspace_path, &type_name, &role, &prompt, model).await;
                self.sync_conversation_telemetry(conversation_id).await;
                out
            }
            "send_message" => {
                let recipient = args.get("Recipient").and_then(|v| v.as_str()).unwrap_or("");
                let msg = args.get("Message").and_then(|v| v.as_str()).unwrap_or("");
                let out = self.message_subagent(recipient, msg).await;
                self.sync_conversation_telemetry(conversation_id).await;
                out
            }
            "manage_subagents" => {
                let action = args.get("Action").and_then(|v| v.as_str()).unwrap_or("list");
                let out = match action {
                    "list" => {
                        let list: Vec<SubagentInfo> = self.subagents.read().await.values().cloned().collect();
                        serde_json::to_string_pretty(&list).unwrap_or_default()
                    }
                    "kill_all" => {
                        self.subagents.write().await.clear();
                        "Killed all subagents.".to_string()
                    }
                    "kill" => {
                        if let Some(ids) = args.get("ConversationIds").and_then(|v| v.as_array()) {
                            let mut subs = self.subagents.write().await;
                            for id in ids {
                                if let Some(s) = id.as_str() {
                                    subs.remove(s);
                                }
                            }
                        }
                        "Killed specified subagents.".to_string()
                    }
                    _ => "Unknown action".to_string(),
                };
                self.sync_conversation_telemetry(conversation_id).await;
                out
            }
            "schedule" => {
                let prompt = args.get("Prompt").and_then(|v| v.as_str()).unwrap_or("");
                let cron_expr = args.get("CronExpression").and_then(|v| v.as_str()).map(|s| s.to_string());
                let dur_secs = args.get("DurationSeconds").and_then(|v| v.as_u64());
                let sched_id = format!("sched-{}", &Uuid::new_v4().simple().to_string()[..8]);
                let mut full_cfg = self.config.get().await;
                let proj_id = full_cfg.workspace.active_project_id.clone();
                full_cfg.workspace.scheduled_tasks.push(crate::config::ScheduledTaskConfig {
                    id: sched_id.clone(),
                    name: prompt.chars().take(36).collect(),
                    prompt: prompt.to_string(),
                    cron_expression: cron_expr.clone(),
                    duration_seconds: dur_secs,
                    project_id: proj_id,
                    enabled: true,
                    created_at: Utc::now().to_rfc3339(),
                });
                let _ = self.config.set(full_cfg).await;
                if let Some(secs) = dur_secs {
                    spawn_delayed_agent_task(
                        self.clone(),
                        secs,
                        conversation_id.to_string(),
                        prompt.to_string(),
                    );
                }
                format!(
                    "Scheduled task '{}' created (cron={:?}, duration_seconds={:?})",
                    sched_id, cron_expr, dur_secs
                )
            }
            "swarm" => {
                let action = args.get("action").and_then(|v| v.as_str()).unwrap_or("status");
                let out = match action {
                    "status" => {
                        let list: Vec<SubagentInfo> = self.subagents.read().await.values().cloned().collect();
                        serde_json::to_string_pretty(&list).unwrap_or_default()
                    }
                    "add" => {
                        let worker_name = args.get("name").and_then(|v| v.as_str()).unwrap_or("worker");
                        let brief = args.get("brief").and_then(|v| v.as_str()).unwrap_or("");
                        self.run_subagent(workspace_path, "self", worker_name, brief, None).await
                    }
                    "kill" => {
                        let worker_name = args.get("name").and_then(|v| v.as_str()).unwrap_or("");
                        self.subagents.write().await.retain(|_, v| v.role != worker_name);
                        format!("Terminated swarm worker '{}'", worker_name)
                    }
                    "title" => {
                        let t = args.get("title").and_then(|v| v.as_str()).unwrap_or("Swarm");
                        format!("Swarm titled '{}'", t)
                    }
                    _ => "Swarm action completed".to_string(),
                };
                self.sync_conversation_telemetry(conversation_id).await;
                out
            }
            other if other.starts_with("mcp__") => {
                let rest = &other["mcp__".len()..];
                if let Some((server_id, tool_name)) = rest.split_once("__") {
                    match self
                        .mcp_client
                        .call_tool(MCPToolCallRequest {
                            server_id: server_id.to_string(),
                            tool_name: tool_name.to_string(),
                            arguments: args.clone(),
                        })
                        .await
                    {
                        Ok(resp) => serde_json::to_string_pretty(&resp).unwrap_or_default(),
                        Err(e) => format!("MCP Error: {}", e),
                    }
                } else {
                    format!("Invalid MCP tool name: {}", other)
                }
            }
            unknown => format!("Unknown tool: {}", unknown),
        };
        let _ = self
            .skill_manager
            .run_lifecycle_hooks("PostToolUse", name, &args, workspace_path)
            .await;
        result
    }

    async fn run_shell_command(
        &self,
        cmd_line: &str,
        workspace_path: Option<&str>,
        wait_ms: u64,
        is_daemon: bool,
    ) -> String {
        let cwd = workspace_path
            .map(|s| s.to_string())
            .unwrap_or_else(|| std::env::current_dir().unwrap_or_default().to_string_lossy().to_string());

        let mut cmd = if cfg!(windows) {
            let mut c = Command::new("cmd");
            c.args(["/C", cmd_line]);
            c
        } else {
            let mut c = Command::new("bash");
            c.args(["-c", cmd_line]);
            c
        };
        cmd.current_dir(&cwd)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());

        let mut child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => return format!("Failed to spawn command: {}", e),
        };

        let task_id = format!("cmd_{}", &Uuid::new_v4().simple().to_string()[..8]);
        let stdin = child.stdin.take();
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        let output = Arc::new(Mutex::new(String::new()));

        if let Some(out) = stdout {
            let buf_out = output.clone();
            tokio::spawn(async move {
                let mut lines = BufReader::new(out).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    let mut g = buf_out.lock().await;
                    g.push_str(&line);
                    g.push('\n');
                }
            });
        }
        if let Some(err) = stderr {
            let buf_err = output.clone();
            tokio::spawn(async move {
                let mut lines = BufReader::new(err).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    let mut g = buf_err.lock().await;
                    g.push_str(&line);
                    g.push('\n');
                }
            });
        }

        let bg = Arc::new(BackgroundCommandTask {
            id: task_id.clone(),
            command: cmd_line.to_string(),
            cwd,
            status: Arc::new(Mutex::new("running".to_string())),
            exit_code: Arc::new(Mutex::new(None)),
            output: output.clone(),
            stdin: Arc::new(Mutex::new(stdin)),
            child: Arc::new(Mutex::new(Some(child))),
        });
        self.bg_commands.write().await.insert(task_id.clone(), bg.clone());

        if is_daemon {
            tokio::time::sleep(std::time::Duration::from_millis(wait_ms.min(1000))).await;
            return format!("Started daemon task {}:\n{}", task_id, output.lock().await.clone());
        }

        let start = std::time::Instant::now();
        let timeout = std::time::Duration::from_millis(wait_ms.max(100));
        loop {
            if let Some(child_ref) = bg.child.lock().await.as_mut() {
                if let Ok(Some(status)) = child_ref.try_wait() {
                    let code = status.code().unwrap_or(-1);
                    *bg.status.lock().await = "completed".to_string();
                    *bg.exit_code.lock().await = Some(code);
                    // Wait briefly for stdout/stderr tasks to flush remaining lines
                    tokio::time::sleep(std::time::Duration::from_millis(15)).await;
                    let out = output.lock().await.clone();
                    return format!("Command exited with code {}.\nOutput:\n{}", code, out);
                }
            }
            if start.elapsed() >= timeout {
                let out = output.lock().await.clone();
                return format!(
                    "Command still running in background (TaskId: {}). Partial output:\n{}",
                    task_id, out
                );
            }
            tokio::time::sleep(std::time::Duration::from_millis(25)).await;
        }
    }

    async fn refresh_bg_task_state(t: &BackgroundCommandTask) -> (String, Option<i32>) {
        if let Some(child_ref) = t.child.lock().await.as_mut() {
            if let Ok(Some(status)) = child_ref.try_wait() {
                let code = status.code().unwrap_or(-1);
                *t.status.lock().await = "completed".to_string();
                *t.exit_code.lock().await = Some(code);
            }
        }
        let st = t.status.lock().await.clone();
        let code = *t.exit_code.lock().await;
        (st, code)
    }

    async fn handle_manage_task(&self, action: &str, task_id: Option<&str>, input: Option<&str>) -> String {
        match action {
            "list" => {
                let tasks: Vec<Arc<BackgroundCommandTask>> =
                    self.bg_commands.read().await.values().cloned().collect();
                let mut items = Vec::new();
                for t in tasks {
                    let (st, code) = Self::refresh_bg_task_state(&t).await;
                    items.push(serde_json::json!({
                        "task_id": t.id,
                        "command": t.command,
                        "cwd": t.cwd,
                        "status": st,
                        "exit_code": code
                    }));
                }
                serde_json::to_string_pretty(&items).unwrap_or_default()
            }
            "status" => {
                let Some(id) = task_id else {
                    return "TaskId required".to_string();
                };
                let task_opt = self.bg_commands.read().await.get(id).cloned();
                if let Some(t) = task_opt {
                    let (st, _) = Self::refresh_bg_task_state(&t).await;
                    let out = t.output.lock().await.clone();
                    format!("Task {} ({}):\n{}", t.id, st, out)
                } else {
                    format!("Task not found: {}", id)
                }
            }
            "send_input" => {
                let Some(id) = task_id else {
                    return "TaskId required".to_string();
                };
                let task_opt = self.bg_commands.read().await.get(id).cloned();
                if let Some(t) = task_opt {
                    if let Some(stdin) = t.stdin.lock().await.as_mut() {
                        let data = input.unwrap_or("");
                        let _ = stdin.write_all(data.as_bytes()).await;
                        let _ = stdin.flush().await;
                        return format!("Sent input to {}", id);
                    }
                    "Task stdin closed".to_string()
                } else {
                    format!("Task not found: {}", id)
                }
            }
            "kill" => {
                let Some(id) = task_id else {
                    return "TaskId required".to_string();
                };
                let task_opt = self.bg_commands.read().await.get(id).cloned();
                if let Some(t) = task_opt {
                    if let Some(child) = t.child.lock().await.as_mut() {
                        let _ = child.kill().await;
                    }
                    *t.status.lock().await = "killed".to_string();
                    format!("Killed task {}", id)
                } else {
                    format!("Task not found: {}", id)
                }
            }
            _ => format!("Unknown manage_task action: {}", action),
        }
    }

    async fn execute_search_web(&self, query: &str, domain: Option<&str>) -> String {
        let q = if let Some(d) = domain {
            format!("site:{} {}", d, query)
        } else {
            query.to_string()
        };
        let llm_cfg = self.config.get_llm_config().await;
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(15))
            .user_agent("Antigravity/0.1")
            .build()
            .unwrap_or_default();

        if let Some(searxng) = llm_cfg.searxng_url {
            if !searxng.trim().is_empty() {
                let url = format!("{}/search", searxng.trim_end_matches('/'));
                if let Ok(resp) = client.get(&url).query(&[("q", q.as_str()), ("format", "json")]).send().await {
                    if let Ok(val) = resp.json::<serde_json::Value>().await {
                        if let Some(results) = val.get("results").and_then(|r| r.as_array()) {
                            let summary: Vec<serde_json::Value> = results.iter().take(8).cloned().collect();
                            return serde_json::to_string_pretty(&summary).unwrap_or_default();
                        }
                    }
                }
            }
        }

        // DuckDuckGo Instant Answer API fallback
        match client
            .get("https://api.duckduckgo.com/")
            .query(&[("q", q.as_str()), ("format", "json"), ("no_html", "1")])
            .send()
            .await
        {
            Ok(resp) => match resp.text().await {
                Ok(text) => text,
                Err(e) => format!("Search error: {}", e),
            },
            Err(e) => format!("Search error: {}", e),
        }
    }

    async fn run_subagent(
        &self,
        workspace_path: Option<&str>,
        type_name: &str,
        role: &str,
        prompt: &str,
        model: Option<String>,
    ) -> String {
        let agent_cfg = self.config.get_agent_config().await;
        let running_count = self
            .subagents
            .read()
            .await
            .values()
            .filter(|s| s.status == "running")
            .count() as u32;
        if running_count >= agent_cfg.max_subagents {
            return format!(
                "Cannot invoke subagent: maximum concurrent subagents ({}) reached.",
                agent_cfg.max_subagents
            );
        }

        let def = self.subagent_defs.read().await.get(type_name).cloned().unwrap_or(SubagentDefinition {
            name: type_name.to_string(),
            description: role.to_string(),
            system_prompt: format!("You are a {} subagent.", role),
            enable_write_tools: type_name != "research",
            enable_mcp_tools: type_name != "research",
        });

        let conv_id = Uuid::new_v4().to_string();
        let conv = Conversation {
            id: conv_id.clone(),
            title: format!("[Subagent: {}] {}", role, prompt.chars().take(30).collect::<String>()),
            messages: vec![],
            created_at: Utc::now(),
            updated_at: Utc::now(),
            system_prompt: Some(def.system_prompt.clone()),
            provider_id: None,
            model: model.clone(),
            workspace_path: workspace_path.map(|s| s.to_string()),
            project_id: None,
            worktree_mode: None,
            worktree_paths: Vec::new(),
            files_changed: Vec::new(),
            subagents: Vec::new(),
            background_tasks: Vec::new(),
        };
        self.conversations.write().await.insert(conv_id.clone(), conv);
        self.subagents.write().await.insert(
            conv_id.clone(),
            SubagentInfo {
                conversation_id: conv_id.clone(),
                type_name: type_name.to_string(),
                role: role.to_string(),
                status: "running".to_string(),
            },
        );

        let task_id = Uuid::new_v4().to_string();
        let task = AgentTask {
            id: task_id.clone(),
            conversation_id: conv_id.clone(),
            prompt: prompt.to_string(),
            status: AgentTaskStatus::Pending,
            created_at: Utc::now(),
            updated_at: Utc::now(),
            iterations: 0,
            max_iterations: 20,
            result: None,
            error: None,
        };
        self.tasks.write().await.insert(task_id.clone(), task);

        let res = Box::pin(self.run_agent_loop(
            task_id,
            prompt.to_string(),
            None,
            None,
            model,
            def.enable_write_tools,
            def.enable_mcp_tools,
            true,
        ))
        .await;

        if let Some(info) = self.subagents.write().await.get_mut(&conv_id) {
            info.status = "completed".to_string();
        }

        match res {
            Ok(text) => format!("Subagent {} ({}) result:\n{}", conv_id, role, text),
            Err(e) => format!("Subagent {} failed: {}", conv_id, e),
        }
    }

    async fn message_subagent(&self, conversation_id: &str, message: &str) -> String {
        if !self.conversations.read().await.contains_key(conversation_id) {
            return format!("Subagent conversation not found: {}", conversation_id);
        }
        let task_id = Uuid::new_v4().to_string();
        let task = AgentTask {
            id: task_id.clone(),
            conversation_id: conversation_id.to_string(),
            prompt: message.to_string(),
            status: AgentTaskStatus::Pending,
            created_at: Utc::now(),
            updated_at: Utc::now(),
            iterations: 0,
            max_iterations: 20,
            result: None,
            error: None,
        };
        self.tasks.write().await.insert(task_id.clone(), task);

        match Box::pin(self.run_agent_loop(task_id, message.to_string(), None, None, None, true, true, true)).await {
            Ok(text) => text,
            Err(e) => format!("Error: {}", e),
        }
    }
}
