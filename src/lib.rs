//! Antigravity Library Crate

pub mod agent;
pub mod commands;
pub mod config;
pub mod fs;
pub mod llm;
pub mod mcp;
pub mod skills;
pub mod terminal;

use std::sync::Arc;

#[derive(Clone)]
pub struct AppState {
    pub config: Arc<config::ConfigManager>,
    pub llm_providers: Arc<llm::LLMProviderManager>,
    pub mcp_client: Arc<mcp::MCPClientManager>,
    pub agent_engine: Arc<agent::AgentEngine>,
    pub skill_manager: Arc<skills::SkillManager>,
    pub terminal_manager: Arc<terminal::TerminalManager>,
    pub fs_watcher: Arc<fs::FileWatcher>,
}
