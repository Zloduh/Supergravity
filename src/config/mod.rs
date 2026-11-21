//! Configuration management for Antigravity

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::collections::HashMap;
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;
use anyhow::Result;
use directories::ProjectDirs;
use config::{Config, Environment};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct AppConfig {
    pub llm: LLMConfig,
    pub mcp: MCPConfig,
    pub agent: AgentConfig,
    pub terminal: TerminalConfig,
    pub ui: UIConfig,
    pub skills: SkillsConfig,
    pub workspace: WorkspaceConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct LLMConfig {
    pub providers: Vec<LLMProviderConfig>,
    pub active_provider: Option<String>,
    pub default_model: Option<String>,
    pub max_tokens: Option<u32>,
    pub context_length: Option<u32>,
    pub temperature: Option<f32>,
    pub timeout_seconds: Option<u64>,
    pub searxng_url: Option<String>,
    pub inherit_model_settings: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct LLMProviderConfig {
    pub id: String,
    pub name: String,
    pub provider_type: LLMProviderType,
    pub base_url: String,
    pub api_key: Option<String>,
    pub models: Vec<String>,
    pub enabled: bool,
    pub headers: Option<HashMap<String, String>>,
}

impl Default for LLMProviderConfig {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            provider_type: LLMProviderType::Custom,
            base_url: String::new(),
            api_key: None,
            models: vec![],
            enabled: true,
            headers: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum LLMProviderType {
    Ollama,
    LlamaCpp,
    VLLM,
    LMStudio,
    #[default]
    Custom,
}

impl std::fmt::Display for LLMProviderType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LLMProviderType::Ollama => write!(f, "ollama"),
            LLMProviderType::LlamaCpp => write!(f, "llama.cpp"),
            LLMProviderType::VLLM => write!(f, "vllm"),
            LLMProviderType::LMStudio => write!(f, "lm-studio"),
            LLMProviderType::Custom => write!(f, "custom"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct MCPConfig {
    pub servers: Vec<MCPServerConfig>,
    pub auto_connect: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct MCPServerConfig {
    pub id: String,
    pub name: String,
    pub transport: MCPTransportConfig,
    pub enabled: bool,
    pub auto_start: bool,
}

impl Default for MCPServerConfig {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            transport: MCPTransportConfig::default(),
            enabled: true,
            auto_start: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum MCPTransportConfig {
    Stdio {
        #[serde(default)]
        command: String,
        #[serde(default)]
        args: Vec<String>,
        #[serde(default)]
        env: Option<HashMap<String, String>>,
        #[serde(default)]
        cwd: Option<String>,
    },
    SSE {
        #[serde(default)]
        url: String,
        #[serde(default)]
        headers: Option<HashMap<String, String>>,
    },
}

impl Default for MCPTransportConfig {
    fn default() -> Self {
        Self::Stdio {
            command: String::new(),
            args: vec![],
            env: None,
            cwd: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct AgentConfig {
    pub max_iterations: u32,
    pub max_subagents: u32,
    pub tool_timeout_seconds: u64,
    pub enable_streaming: bool,
    pub system_prompt: Option<String>,
    pub require_command_approval: bool,
    pub sandbox_enabled: bool,
    pub non_workspace_file_access: String,
    pub internet_access_policy: String,
    pub command_allowlist: Vec<String>,
    pub command_denylist: Vec<String>,
    pub browser_allowlist: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct TerminalConfig {
    pub shell: Option<String>,
    pub args: Vec<String>,
    pub env: HashMap<String, String>,
    pub cwd: Option<String>,
    pub cols: u16,
    pub rows: u16,
    pub scrollback: u32,
    pub font_size: f32,
    pub font_family: String,
    pub theme: TerminalTheme,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum TerminalTheme {
    Dark,
    Light,
    #[default]
    System,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct UIConfig {
    pub theme: UITheme,
    pub sidebar_width: u32,
    pub terminal_height: u32,
    pub artifact_panel_width: u32,
    pub font_size: f32,
    pub font_family: String,
    pub animations_enabled: bool,
    pub compact_mode: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum UITheme {
    Dark,
    Light,
    #[default]
    System,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct SkillsConfig {
    pub directories: Vec<String>,
    pub auto_load: bool,
    pub builtin_skills_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum ProjectPermissionPreset {
    #[default]
    InheritGlobal,
    Default,
    Auto,
    AlwaysAsk,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum WorktreeMode {
    #[default]
    Local,
    NewWorktree,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct ProjectFolder {
    pub path: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub is_git: bool,
    #[serde(default)]
    pub git_branch: Option<String>,
    #[serde(default)]
    pub ssh_host: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(default)]
pub struct ProjectSettings {
    pub permission_preset: ProjectPermissionPreset,
    pub default_worktree_mode: WorktreeMode,
    pub system_prompt: Option<String>,
    pub require_command_approval: Option<bool>,
    pub allowed_paths: Vec<String>,
    pub file_access_policy: Option<String>,
    pub internet_access_policy: Option<String>,
    pub sandbox_enabled: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(default)]
pub struct ProjectConfig {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub folders: Vec<ProjectFolder>,
    pub settings: ProjectSettings,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(default)]
pub struct ScheduledTaskConfig {
    pub id: String,
    pub name: String,
    pub prompt: String,
    pub cron_expression: Option<String>,
    pub duration_seconds: Option<u64>,
    pub project_id: Option<String>,
    pub enabled: bool,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct WorkspaceConfig {
    pub recent_paths: Vec<String>,
    pub max_recent: usize,
    pub default_path: Option<String>,
    pub ignored_patterns: Vec<String>,
    pub projects: Vec<ProjectConfig>,
    pub active_project_id: Option<String>,
    pub interface_layout: String,
    pub scheduled_tasks: Vec<ScheduledTaskConfig>,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            llm: LLMConfig::default(),
            mcp: MCPConfig::default(),
            agent: AgentConfig::default(),
            terminal: TerminalConfig::default(),
            ui: UIConfig::default(),
            skills: SkillsConfig::default(),
            workspace: WorkspaceConfig::default(),
        }
    }
}

impl Default for LLMConfig {
    fn default() -> Self {
        Self {
            providers: vec![
                LLMProviderConfig {
                    id: "strata".to_string(),
                    name: "Strata (Local)".to_string(),
                    provider_type: LLMProviderType::Custom,
                    base_url: "http://127.0.0.1:47831/v1".to_string(),
                    api_key: Some("strata".to_string()),
                    models: vec![],
                    enabled: true,
                    headers: None,
                },
                LLMProviderConfig {
                    id: "strata-lan".to_string(),
                    name: "Strata (LAN)".to_string(),
                    provider_type: LLMProviderType::Custom,
                    base_url: "http://192.168.0.92:47832/v1".to_string(),
                    api_key: Some("strata".to_string()),
                    models: vec![],
                    enabled: true,
                    headers: None,
                },
            ],
            active_provider: Some("strata".to_string()),
            default_model: None,
            max_tokens: Some(4096),
            context_length: Some(32768),
            temperature: Some(0.7),
            timeout_seconds: Some(120),
            searxng_url: None,
            inherit_model_settings: true,
        }
    }
}

impl Default for MCPConfig {
    fn default() -> Self {
        Self {
            servers: vec![],
            auto_connect: true,
        }
    }
}

impl Default for AgentConfig {
    fn default() -> Self {
        Self {
            max_iterations: 50,
            max_subagents: 10,
            tool_timeout_seconds: 60,
            enable_streaming: true,
            system_prompt: None,
            require_command_approval: false,
            sandbox_enabled: true,
            non_workspace_file_access: "allow".to_string(),
            internet_access_policy: "allow".to_string(),
            command_allowlist: vec![],
            command_denylist: vec![],
            browser_allowlist: vec![],
        }
    }
}

impl Default for TerminalConfig {
    fn default() -> Self {
        let shell = if cfg!(windows) {
            Some("powershell.exe".to_string())
        } else {
            std::env::var("SHELL").ok()
        };

        Self {
            shell,
            args: vec![],
            env: HashMap::new(),
            cwd: None,
            cols: 120,
            rows: 30,
            scrollback: 10000,
            font_size: 13.0,
            font_family: "JetBrains Mono, Fira Code, Consolas, monospace".to_string(),
            theme: TerminalTheme::System,
        }
    }
}

impl Default for UIConfig {
    fn default() -> Self {
        Self {
            theme: UITheme::System,
            sidebar_width: 280,
            terminal_height: 200,
            artifact_panel_width: 400,
            font_size: 13.0,
            font_family: "Inter, system-ui, sans-serif".to_string(),
            animations_enabled: true,
            compact_mode: false,
        }
    }
}

impl Default for SkillsConfig {
    fn default() -> Self {
        let home = directories::BaseDirs::new()
            .map(|b| b.home_dir().to_path_buf())
            .unwrap_or_else(|| PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| ".".to_string())));
        let directories = vec![
            home.join(".gemini").join("antigravity").join("builtin").join("skills").to_string_lossy().to_string(),
            home.join(".gemini").join("config").join("plugins").join("*").join("skills").to_string_lossy().to_string(),
            home.join(".gemini").join("config").join("skills").to_string_lossy().to_string(),
            home.join(".claude").join("skills").to_string_lossy().to_string(),
            home.join(".agents").join("skills").to_string_lossy().to_string(),
        ];

        Self {
            directories,
            auto_load: true,
            builtin_skills_path: None,
        }
    }
}

impl Default for WorkspaceConfig {
    fn default() -> Self {
        Self {
            recent_paths: vec![],
            max_recent: 20,
            default_path: None,
            ignored_patterns: vec![
                "node_modules".to_string(),
                ".git".to_string(),
                "target".to_string(),
                "dist".to_string(),
                "build".to_string(),
                "*.log".to_string(),
                "*.tmp".to_string(),
                ".DS_Store".to_string(),
            ],
            projects: vec![],
            active_project_id: None,
            interface_layout: "standard".to_string(),
            scheduled_tasks: vec![],
        }
    }
}

impl ProjectFolder {
    pub fn inspect(path_str: &str, ssh_host: Option<String>) -> Self {
        let p = Path::new(path_str);
        let name = p
            .file_name()
            .and_then(|n| n.to_str())
            .filter(|s| !s.is_empty())
            .unwrap_or(path_str)
            .to_string();
        if ssh_host.is_some() {
            return Self {
                path: path_str.to_string(),
                name,
                is_git: false,
                git_branch: None,
                ssh_host,
            };
        }
        let git_path = p.join(".git");
        let is_git = git_path.exists();
        let git_branch = if is_git {
            let head_file = if git_path.is_dir() {
                Some(git_path.join("HEAD"))
            } else {
                None
            };
            head_file
                .and_then(|hf| std::fs::read_to_string(hf).ok())
                .and_then(|head| {
                    let trimmed = head.trim();
                    if let Some(rest) = trimmed.strip_prefix("ref: refs/heads/") {
                        Some(rest.to_string())
                    } else if trimmed.len() >= 7 {
                        Some(trimmed[..7].to_string())
                    } else {
                        None
                    }
                })
        } else {
            None
        };

        Self {
            path: path_str.to_string(),
            name,
            is_git,
            git_branch,
            ssh_host: None,
        }
    }
}

pub struct ConfigManager {
    config: RwLock<AppConfig>,
    config_path: PathBuf,
}

impl ConfigManager {
    pub async fn new() -> Result<Arc<Self>> {
        let config_path = match std::env::var_os("ANTIGRAVITY_CONFIG_PATH") {
            Some(path) if !path.is_empty() => PathBuf::from(path),
            _ => {
                let proj_dirs = ProjectDirs::from("com", "antigravity", "Antigravity")
                    .ok_or_else(|| anyhow::anyhow!("Could not determine config directory"))?;
                proj_dirs.config_dir().join("config.toml")
            }
        };

        Self::new_with_path(config_path).await
    }

    pub async fn new_with_path(path: impl Into<PathBuf>) -> Result<Arc<Self>> {
        let config_path = path.into();
        if config_path.is_dir() {
            anyhow::bail!("Config path '{}' is a directory", config_path.display());
        }

        if let Some(parent) = config_path.parent().filter(|p| !p.as_os_str().is_empty()) {
            tokio::fs::create_dir_all(parent).await?;
        }

        let mut recovered_from_corrupt = false;
        let mut config = if config_path.exists() {
            let load_result: Result<AppConfig> = async {
                let raw = tokio::fs::read_to_string(&config_path).await?;
                let mut cfg: AppConfig = toml::from_str(&raw)?;

                let has_env_overrides = std::env::vars().any(|(k, _)| {
                    k.len() > "ANTIGRAVITY__".len()
                        && k[.."ANTIGRAVITY__".len()].eq_ignore_ascii_case("ANTIGRAVITY__")
                });
                if has_env_overrides {
                    let env_settings = Config::builder()
                        .add_source(
                            Environment::with_prefix("ANTIGRAVITY")
                                .separator("__")
                                .try_parsing(true),
                        )
                        .build()?;
                    let env_val: serde_json::Value = env_settings.try_deserialize()?;
                    let mut base_val = serde_json::to_value(&cfg)?;
                    merge_json_values(&mut base_val, env_val);
                    cfg = serde_json::from_value(base_val)?;
                }

                Ok(cfg)
            }
            .await;

            match load_result {
                Ok(cfg) => cfg,
                Err(e) => {
                    let backup_path = PathBuf::from(format!("{}.bak", config_path.display()));
                    tracing::warn!(
                        "Failed to load config from '{}': {}. Backing up to '{}' and falling back to defaults.",
                        config_path.display(),
                        e,
                        backup_path.display()
                    );
                    if let Err(rename_err) = tokio::fs::rename(&config_path, &backup_path).await {
                        tracing::warn!(
                            "Failed to back up corrupt config '{}' to '{}': {}",
                            config_path.display(),
                            backup_path.display(),
                            rename_err
                        );
                    }
                    recovered_from_corrupt = true;
                    AppConfig::default()
                }
            }
        } else {
            AppConfig::default()
        };

        // Ensure Strata local and LAN endpoints are present with API key "strata"
        let mut migrated = false;
        if let Some(p) = config.llm.providers.iter_mut().find(|p| p.id == "strata" || p.base_url.contains("47831")) {
            if p.api_key.as_deref().unwrap_or("").is_empty() {
                p.api_key = Some("strata".to_string());
                migrated = true;
            }
        } else {
            config.llm.providers.insert(0, LLMProviderConfig {
                id: "strata".to_string(),
                name: "Strata (Local)".to_string(),
                provider_type: LLMProviderType::Custom,
                base_url: "http://127.0.0.1:47831/v1".to_string(),
                api_key: Some("strata".to_string()),
                models: vec![],
                enabled: true,
                headers: None,
            });
            migrated = true;
        }
        if config.llm.active_provider.as_deref().map(|s| s.is_empty() || s == "ollama").unwrap_or(true) {
            config.llm.active_provider = Some("strata".to_string());
            migrated = true;
        }
        if let Some(p) = config.llm.providers.iter_mut().find(|p| p.id == "strata-lan" || p.base_url.contains("47832")) {
            if p.api_key.as_deref().unwrap_or("").is_empty() {
                p.api_key = Some("strata".to_string());
                migrated = true;
            }
        } else {
            config.llm.providers.push(LLMProviderConfig {
                id: "strata-lan".to_string(),
                name: "Strata (LAN)".to_string(),
                provider_type: LLMProviderType::Custom,
                base_url: "http://192.168.0.92:47832/v1".to_string(),
                api_key: Some("strata".to_string()),
                models: vec![],
                enabled: true,
                headers: None,
            });
            migrated = true;
        }

        let manager = Arc::new(Self {
            config: RwLock::new(config),
            config_path,
        });

        // Save config if it didn't exist, was migrated, or recovered from corruption
        if !manager.config_path.exists() || migrated || recovered_from_corrupt {
            if let Err(e) = manager.save().await {
                tracing::warn!("Failed to persist config to '{}': {}", manager.config_path.display(), e);
            }
        }

        Ok(manager)
    }

    pub async fn get(&self) -> AppConfig {
        self.config.read().await.clone()
    }

    pub async fn set(&self, config: AppConfig) -> Result<()> {
        *self.config.write().await = config;
        self.save().await
    }

    pub async fn update<F>(&self, f: F) -> Result<()>
    where
        F: FnOnce(&mut AppConfig),
    {
        f(&mut *self.config.write().await);
        self.save().await
    }

    pub async fn get_llm_config(&self) -> LLMConfig {
        self.config.read().await.llm.clone()
    }

    pub async fn set_llm_config(&self, config: LLMConfig) -> Result<()> {
        self.update(|c| c.llm = config).await
    }

    pub async fn get_mcp_config(&self) -> MCPConfig {
        self.config.read().await.mcp.clone()
    }

    pub async fn set_mcp_config(&self, config: MCPConfig) -> Result<()> {
        self.update(|c| c.mcp = config).await
    }

    pub async fn get_agent_config(&self) -> AgentConfig {
        self.config.read().await.agent.clone()
    }

    pub async fn set_agent_config(&self, config: AgentConfig) -> Result<()> {
        self.update(|c| c.agent = config).await
    }

    pub async fn get_terminal_config(&self) -> TerminalConfig {
        self.config.read().await.terminal.clone()
    }

    pub async fn set_terminal_config(&self, config: TerminalConfig) -> Result<()> {
        self.update(|c| c.terminal = config).await
    }

    pub async fn get_ui_config(&self) -> UIConfig {
        self.config.read().await.ui.clone()
    }

    pub async fn set_ui_config(&self, config: UIConfig) -> Result<()> {
        self.update(|c| c.ui = config).await
    }

    pub async fn get_skills_config(&self) -> SkillsConfig {
        self.config.read().await.skills.clone()
    }

    pub async fn set_skills_config(&self, config: SkillsConfig) -> Result<()> {
        self.update(|c| c.skills = config).await
    }

    pub async fn get_workspace_config(&self) -> WorkspaceConfig {
        self.config.read().await.workspace.clone()
    }

    pub async fn set_workspace_config(&self, config: WorkspaceConfig) -> Result<()> {
        self.update(|c| c.workspace = config).await
    }

    async fn save(&self) -> Result<()> {
        if let Some(parent) = self.config_path.parent().filter(|p| !p.as_os_str().is_empty()) {
            tokio::fs::create_dir_all(parent).await?;
        }
        let config = self.config.read().await.clone();
        let toml = toml::to_string_pretty(&config)?;
        tokio::fs::write(&self.config_path, toml).await?;
        Ok(())
    }

    pub fn config_path(&self) -> &Path {
        &self.config_path
    }
}

fn merge_json_values(base: &mut serde_json::Value, overlay: serde_json::Value) {
    match (base, overlay) {
        (serde_json::Value::Object(base_map), serde_json::Value::Object(overlay_map)) => {
            for (k, v) in overlay_map {
                match base_map.get_mut(&k) {
                    Some(existing) => merge_json_values(existing, v),
                    None => {
                        base_map.insert(k, v);
                    }
                }
            }
        }
        (base_slot, overlay_val) => {
            *base_slot = overlay_val;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    static ENV_MUTEX: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

    #[test]
    fn default_config_preserves_r3_strata_defaults() {
        let cfg = AppConfig::default();
        assert_eq!(cfg.llm.active_provider.as_deref(), Some("strata"));
        assert_eq!(cfg.llm.context_length, Some(32768));
        assert_eq!(cfg.llm.max_tokens, Some(4096));
        assert_eq!(cfg.llm.temperature, Some(0.7));
        assert_eq!(cfg.llm.timeout_seconds, Some(120));

        let strata = cfg.llm.providers.iter().find(|p| p.id == "strata").expect("strata present");
        assert_eq!(strata.base_url, "http://127.0.0.1:47831/v1");
        assert_eq!(strata.api_key.as_deref(), Some("strata"));
        assert!(strata.enabled);

        let lan = cfg.llm.providers.iter().find(|p| p.id == "strata-lan").expect("strata-lan present");
        assert_eq!(lan.base_url, "http://192.168.0.92:47832/v1");
        assert_eq!(lan.api_key.as_deref(), Some("strata"));
        assert!(lan.enabled);
    }

    #[tokio::test]
    async fn partial_toml_deserializes_with_struct_defaults() {
        let tmp = TempDir::new().unwrap();
        let cfg_path = tmp.path().join("partial.toml");
        tokio::fs::write(
            &cfg_path,
            "[ui]\ntheme = \"light\"\n[llm]\ntemperature = 0.2\n",
        )
        .await
        .unwrap();

        let mgr = ConfigManager::new_with_path(&cfg_path).await.unwrap();
        let cfg = mgr.get().await;
        assert_eq!(cfg.ui.theme, UITheme::Light);
        assert_eq!(cfg.ui.sidebar_width, 280);
        assert_eq!(cfg.llm.temperature, Some(0.2));
        // Critical: context_length must fall back to Some(32768), NOT None
        assert_eq!(cfg.llm.context_length, Some(32768));
        assert_eq!(cfg.llm.max_tokens, Some(4096));
        assert!(cfg.mcp.auto_connect);
        assert_eq!(cfg.agent.max_iterations, 50);
        assert_eq!(cfg.terminal.cols, 120);
    }

    #[tokio::test]
    async fn empty_toml_deserializes_to_defaults() {
        let tmp = TempDir::new().unwrap();
        let cfg_path = tmp.path().join("empty.toml");
        tokio::fs::write(&cfg_path, "").await.unwrap();

        let mgr = ConfigManager::new_with_path(&cfg_path).await.unwrap();
        let cfg = mgr.get().await;
        assert_eq!(cfg.llm.active_provider.as_deref(), Some("strata"));
        assert_eq!(cfg.llm.context_length, Some(32768));
        assert!(cfg.llm.providers.iter().any(|p| p.id == "strata"));
        assert!(cfg.llm.providers.iter().any(|p| p.id == "strata-lan"));
    }

    #[test]
    fn partial_provider_and_mcp_server_entries_use_defaults() {
        let raw = r#"
[[llm.providers]]
id = "custom-1"
name = "Custom"
base_url = "http://localhost:9000/v1"

[[mcp.servers]]
id = "mcp-1"
name = "Local MCP"
[mcp.servers.transport]
type = "stdio"
command = "npx"

[[mcp.servers]]
id = "mcp-2"
name = "Remote SSE"
[mcp.servers.transport]
type = "sse"
url = "http://localhost:3001/sse"
"#;
        let cfg: AppConfig = toml::from_str(raw).unwrap();
        let p = &cfg.llm.providers[0];
        assert!(p.enabled);
        assert_eq!(p.provider_type, LLMProviderType::Custom);
        assert!(p.models.is_empty());

        let s1 = &cfg.mcp.servers[0];
        assert!(s1.enabled);
        assert!(!s1.auto_start);
        match &s1.transport {
            MCPTransportConfig::Stdio { command, args, env, cwd } => {
                assert_eq!(command, "npx");
                assert!(args.is_empty());
                assert!(env.is_none());
                assert!(cwd.is_none());
            }
            _ => panic!("expected stdio"),
        }

        let s2 = &cfg.mcp.servers[1];
        assert!(s2.enabled);
        assert!(!s2.auto_start);
        match &s2.transport {
            MCPTransportConfig::SSE { url, headers } => {
                assert_eq!(url, "http://localhost:3001/sse");
                assert!(headers.is_none());
            }
            _ => panic!("expected sse"),
        }
    }

    #[tokio::test]
    async fn corrupt_toml_syntax_recovers_and_creates_backup() {
        let tmp = TempDir::new().unwrap();
        let cfg_path = tmp.path().join("config.toml");
        tokio::fs::write(&cfg_path, "[[[broken toml").await.unwrap();

        let mgr = ConfigManager::new_with_path(&cfg_path).await.unwrap();
        let cfg = mgr.get().await;
        assert_eq!(cfg.llm.active_provider.as_deref(), Some("strata"));
        assert_eq!(cfg.llm.context_length, Some(32768));

        let bak_path = tmp.path().join("config.toml.bak");
        assert!(bak_path.exists());
        assert_eq!(tokio::fs::read_to_string(&bak_path).await.unwrap(), "[[[broken toml");

        // Reloading the repaired file succeeds cleanly
        let mgr2 = ConfigManager::new_with_path(&cfg_path).await.unwrap();
        assert_eq!(mgr2.get().await.llm.active_provider.as_deref(), Some("strata"));
    }

    #[tokio::test]
    async fn invalid_type_toml_recovers_and_creates_backup() {
        let tmp = TempDir::new().unwrap();
        let cfg_path = tmp.path().join("config.toml");
        tokio::fs::write(
            &cfg_path,
            "[agent]\nmax_iterations = \"bad\"\n[ui]\ntheme = \"neon\"\n",
        )
        .await
        .unwrap();

        let mgr = ConfigManager::new_with_path(&cfg_path).await.unwrap();
        let cfg = mgr.get().await;
        assert_eq!(cfg.agent.max_iterations, 50);
        assert_eq!(cfg.ui.theme, UITheme::System);
        assert!(tmp.path().join("config.toml.bak").exists());
    }

    #[tokio::test]
    async fn strata_migration_from_ollama_and_missing_endpoints() {
        let tmp = TempDir::new().unwrap();
        let cfg_path = tmp.path().join("config.toml");
        let old_toml = r#"
[llm]
active_provider = "ollama"

[[llm.providers]]
id = "strata"
name = "Strata (Local)"
provider_type = "custom"
base_url = "http://127.0.0.1:47831/v1"
api_key = ""
models = []
enabled = true
"#;
        tokio::fs::write(&cfg_path, old_toml).await.unwrap();

        let mgr = ConfigManager::new_with_path(&cfg_path).await.unwrap();
        let cfg = mgr.get().await;
        assert_eq!(cfg.llm.active_provider.as_deref(), Some("strata"));
        let strata = cfg.llm.providers.iter().find(|p| p.id == "strata").unwrap();
        assert_eq!(strata.api_key.as_deref(), Some("strata"));
        let lan = cfg.llm.providers.iter().find(|p| p.id == "strata-lan").unwrap();
        assert_eq!(lan.base_url, "http://192.168.0.92:47832/v1");
        assert_eq!(lan.api_key.as_deref(), Some("strata"));
    }

    #[tokio::test]
    async fn new_with_path_creates_nested_dirs_and_roundtrips_env_and_headers() {
        let tmp = TempDir::new().unwrap();
        let cfg_path = tmp.path().join("nested").join("dir").join("custom.dat");
        let mgr = ConfigManager::new_with_path(&cfg_path).await.unwrap();
        mgr.update(|c| {
            c.terminal.env.insert("FOO".to_string(), "bar".to_string());
            if let Some(p) = c.llm.providers.first_mut() {
                let mut h = HashMap::new();
                h.insert("X-Test".to_string(), "1".to_string());
                p.headers = Some(h);
            }
        })
        .await
        .unwrap();

        let reloaded = ConfigManager::new_with_path(&cfg_path).await.unwrap();
        let cfg = reloaded.get().await;
        assert_eq!(cfg.terminal.env.get("FOO").map(String::as_str), Some("bar"));
        assert_eq!(
            cfg.llm.providers[0].headers.as_ref().and_then(|h| h.get("X-Test")).map(String::as_str),
            Some("1")
        );
    }

    #[tokio::test]
    async fn env_override_antigravity_config_path_isolates_new() {
        let _guard = ENV_MUTEX.lock().await;
        struct EnvReset(Option<std::ffi::OsString>);
        impl Drop for EnvReset {
            fn drop(&mut self) {
                if let Some(prev) = self.0.take() {
                    std::env::set_var("ANTIGRAVITY_CONFIG_PATH", prev);
                } else {
                    std::env::remove_var("ANTIGRAVITY_CONFIG_PATH");
                }
            }
        }
        let _reset = EnvReset(std::env::var_os("ANTIGRAVITY_CONFIG_PATH"));

        let tmp = TempDir::new().unwrap();
        let cfg_path = tmp.path().join("isolated_config.toml");
        std::env::set_var("ANTIGRAVITY_CONFIG_PATH", &cfg_path);

        let mgr = ConfigManager::new().await.unwrap();
        assert_eq!(mgr.config_path(), cfg_path.as_path());
        assert!(cfg_path.exists());
    }

    #[test]
    fn frontend_json_payload_compatibility() {
        let provider_json = r#"{
            "id": "llama-custom",
            "name": "Local Llama",
            "provider_type": "llamacpp",
            "base_url": "http://127.0.0.1:8080/v1",
            "api_key": null,
            "models": ["qwen"],
            "enabled": true,
            "headers": null
        }"#;
        let provider: LLMProviderConfig = serde_json::from_str(provider_json).unwrap();
        assert_eq!(provider.provider_type, LLMProviderType::LlamaCpp);
        assert!(provider.enabled);

        let partial_cfg_json = r#"{"ui": {"theme": "dark"}}"#;
        let cfg: AppConfig = serde_json::from_str(partial_cfg_json).unwrap();
        assert_eq!(cfg.ui.theme, UITheme::Dark);
        assert_eq!(cfg.llm.context_length, Some(32768));
    }
}