//! Skill/Plugin Discovery and Management
//!
//! Discovers SKILL.md files (parsing YAML frontmatter `name` and `description`) from:
//! - ~/.gemini/antigravity/builtin/skills
//! - ~/.gemini/config/plugins/*/skills
//! - ~/.gemini/config/skills
//! - ~/.claude/skills
//! - ~/.agents/skills

use std::sync::Arc;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;
use anyhow::Result;
use walkdir::WalkDir;

use crate::config::ConfigManager;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Skill {
    pub id: String,
    pub name: String,
    pub description: String,
    pub version: String,
    pub path: PathBuf,
    pub skill_type: SkillType,
    pub schema: Option<serde_json::Value>,
    pub loaded: bool,
    pub source: SkillSource,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SkillType {
    Builtin,
    Plugin,
    User,
    System,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SkillSource {
    BuiltinSkills,
    PluginSkills,
    ConfigSkills,
    ClaudeSkills,
    AgentsSkills,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillSchema {
    pub name: String,
    pub description: String,
    pub parameters: serde_json::Value,
    pub returns: Option<serde_json::Value>,
}

pub struct SkillManager {
    skills: RwLock<HashMap<String, Skill>>,
    config: Arc<ConfigManager>,
}

impl SkillManager {
    pub async fn new(config: Arc<ConfigManager>) -> Result<Arc<Self>> {
        let manager = Arc::new(Self {
            skills: RwLock::new(HashMap::new()),
            config,
        });

        manager.discover_skills().await?;
        Ok(manager)
    }

    pub async fn list_skills(&self, source: Option<&str>, skill_type: Option<&str>) -> Vec<Skill> {
        let skills = self.skills.read().await;
        let mut list: Vec<Skill> = skills
            .values()
            .filter(|skill| {
                let source_match = source.map_or(true, |s| match s {
                    "builtin" => matches!(skill.source, SkillSource::BuiltinSkills),
                    "plugin" => matches!(skill.source, SkillSource::PluginSkills),
                    "config" => matches!(skill.source, SkillSource::ConfigSkills),
                    "claude" => matches!(skill.source, SkillSource::ClaudeSkills),
                    "agents" => matches!(skill.source, SkillSource::AgentsSkills),
                    _ => true,
                });
                let type_match = skill_type.map_or(true, |t| match t {
                    "builtin" => matches!(skill.skill_type, SkillType::Builtin),
                    "plugin" => matches!(skill.skill_type, SkillType::Plugin),
                    "user" => matches!(skill.skill_type, SkillType::User),
                    "system" => matches!(skill.skill_type, SkillType::System),
                    _ => true,
                });
                source_match && type_match
            })
            .cloned()
            .collect();
        list.sort_by(|a, b| a.name.cmp(&b.name));
        list
    }

    pub async fn get_skill(&self, id: &str) -> Option<Skill> {
        self.skills.read().await.get(id).cloned()
    }

    pub async fn load_skill(&self, id: &str) -> Result<Skill> {
        let mut skills = self.skills.write().await;
        let skill = skills
            .get_mut(id)
            .ok_or_else(|| anyhow::anyhow!("Skill not found: {}", id))?;

        if skill.loaded {
            return Ok(skill.clone());
        }

        let schema = self.load_skill_schema(&skill.path).await?;
        skill.schema = schema;
        skill.loaded = true;

        Ok(skill.clone())
    }

    async fn load_skill_schema(&self, path: &Path) -> Result<Option<serde_json::Value>> {
        let file_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");

        if file_name == "SKILL.md" {
            let content = tokio::fs::read_to_string(path).await?;
            Ok(Some(serde_json::json!({ "markdown": content })))
        } else if file_name == "skill.json" {
            let content = tokio::fs::read_to_string(path).await?;
            let skill: serde_json::Value = serde_json::from_str(&content)?;
            Ok(skill.get("schema").cloned())
        } else if file_name == "skill.yaml" || file_name == "skill.yml" {
            let content = tokio::fs::read_to_string(path).await?;
            let skill: serde_yaml::Value = serde_yaml::from_str(&content)?;
            Ok(skill.get("schema").and_then(|v| serde_json::to_value(v).ok()))
        } else {
            Ok(None)
        }
    }

    pub async fn unload_skill(&self, id: &str) -> Result<()> {
        let mut skills = self.skills.write().await;
        if let Some(skill) = skills.get_mut(id) {
            skill.schema = None;
            skill.loaded = false;
        }
        Ok(())
    }

    pub async fn reload_skills(&self) -> Result<Vec<Skill>> {
        self.skills.write().await.clear();
        self.discover_skills().await?;
        Ok(self.list_skills(None, None).await)
    }

    pub async fn get_skill_schema(&self, id: &str) -> Result<Option<SkillSchema>> {
        let skills = self.skills.read().await;
        let skill = skills
            .get(id)
            .ok_or_else(|| anyhow::anyhow!("Skill not found: {}", id))?;

        if !skill.loaded {
            return Ok(None);
        }

        Ok(skill.schema.as_ref().map(|s| SkillSchema {
            name: skill.name.clone(),
            description: skill.description.clone(),
            parameters: s.clone(),
            returns: None,
        }))
    }

    /// Build the `<skills>` block for injection into the system prompt.
    pub async fn build_skills_prompt_block(&self) -> String {
        let skills = self.list_skills(None, None).await;
        if skills.is_empty() {
            return String::new();
        }

        let mut out = String::from(
            "<skills>\nOptional specialized skills are listed below. Only call `read_file` on a SKILL.md path when the user's request specifically asks for that skill's domain — never load skills for greetings, simple questions, or unrelated tasks.\n\nAvailable skills:\n",
        );
        for skill in skills {
            out.push_str(&format!(
                "- {} ({}): {}\n",
                skill.name,
                skill.path.to_string_lossy(),
                skill.description.replace('\n', " ").trim()
            ));
        }
        out.push_str("</skills>");
        out
    }

    /// Load custom rules from ~/.gemini/GEMINI.md or workspace rules files with canonical path deduplication.
    pub async fn load_rules(&self, workspace_path: Option<&str>) -> String {
        let mut rules = Vec::new();
        let mut seen_paths = std::collections::HashSet::new();
        let home = Self::home_dir();

        let mut push_rule = |title: String, path: &Path, content: String| {
            let canonical = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
            if seen_paths.insert(canonical) && !content.trim().is_empty() {
                rules.push(format!("### {}\n{}", title, content));
            }
        };

        let global_rules_md = home.join(".supergravity").join("RULES.md");
        if global_rules_md.exists() {
            if let Ok(content) = tokio::fs::read_to_string(&global_rules_md).await {
                push_rule(
                    "Global Rules (~/.supergravity/RULES.md)".to_string(),
                    &global_rules_md,
                    content,
                );
            }
        }

        if let Some(ws) = workspace_path {
            let ws_path = Path::new(ws);
            for candidate in ["SUPER.md", "AGENTS.md"] {
                let p = ws_path.join(candidate);
                if p.exists() {
                    if let Ok(content) = tokio::fs::read_to_string(&p).await {
                        push_rule(format!("Workspace Rules ({})", candidate), &p, content);
                    }
                }
            }
            for rules_subdir in [
                ws_path.join(".supergravity").join("rules"),
                ws_path.join(".agents").join("rules"),
                ws_path.join(".agent").join("rules"),
            ] {
                if rules_subdir.is_dir() {
                    if let Ok(mut entries) = tokio::fs::read_dir(&rules_subdir).await {
                        while let Ok(Some(entry)) = entries.next_entry().await {
                            let p = entry.path();
                            if p.extension().and_then(|e| e.to_str()) == Some("md") {
                                if let Ok(content) = tokio::fs::read_to_string(&p).await {
                                    let fname = p
                                        .file_name()
                                        .unwrap_or_default()
                                        .to_string_lossy()
                                        .to_string();
                                    push_rule(format!("Rule ({})", fname), &p, content);
                                }
                            }
                        }
                    }
                }
            }
        }

        if rules.is_empty() {
            String::new()
        } else {
            format!("<rules>\n{}\n</rules>", rules.join("\n\n"))
        }
    }

    /// Execute lifecycle hooks (`PreToolUse` or `PostToolUse`) from `~/.gemini/config/hooks.json` or `<workspace>/.agents/hooks.json`.
    /// Returns `Err(reason)` if a `PreToolUse` hook exits with non-zero status to block the tool call.
    pub async fn run_lifecycle_hooks(
        &self,
        phase: &str,
        tool_name: &str,
        args: &serde_json::Value,
        workspace_path: Option<&str>,
    ) -> std::result::Result<(), String> {
        let home = Self::home_dir();
        let mut hook_files = vec![home.join(".supergravity").join("hooks.json")];
        if let Some(ws) = workspace_path {
            hook_files.push(Path::new(ws).join(".supergravity").join("hooks.json"));
            hook_files.push(Path::new(ws).join(".agents").join("hooks.json"));
        }

        for hf in hook_files {
            if !hf.is_file() {
                continue;
            }
            let Ok(raw) = tokio::fs::read_to_string(&hf).await else {
                continue;
            };
            let Ok(json) = serde_json::from_str::<serde_json::Value>(&raw) else {
                continue;
            };
            let Some(entries) = json.get(phase).and_then(|v| v.as_array()) else {
                continue;
            };
            for entry in entries {
                let matcher = entry.get("matcher").or_else(|| entry.get("tool")).and_then(|v| v.as_str()).unwrap_or("*");
                if matcher != "*" && matcher != tool_name {
                    continue;
                }
                let Some(cmd_str) = entry.get("command").and_then(|v| v.as_str()) else {
                    continue;
                };
                let payload = serde_json::json!({
                    "phase": phase,
                    "tool_name": tool_name,
                    "arguments": args
                })
                .to_string();
                let output = tokio::process::Command::new("bash")
                    .arg("-c")
                    .arg(cmd_str)
                    .env("SUPERGRAVITY_HOOK_PHASE", phase)
                    .env("SUPERGRAVITY_HOOK_TOOL", tool_name)
                    .env("SUPERGRAVITY_HOOK_ARGS", &payload)
                    .output()
                    .await;
                if let Ok(out) = output {
                    if !out.status.success() && phase == "PreToolUse" {
                        let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
                        let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
                        let reason = if !stderr.is_empty() { stderr } else { stdout };
                        return Err(format!(
                            "Tool '{}' blocked by PreToolUse hook ({}): {}",
                            tool_name, cmd_str, reason
                        ));
                    }
                }
            }
        }
        Ok(())
    }

    fn home_dir() -> PathBuf {
        if let Some(override_dir) = std::env::var_os("SUPERGRAVITY_HOME_DIR")
            .or_else(|| std::env::var_os("ANTIGRAVITY_HOME_DIR"))
        {
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

    fn expand_pattern(pattern: &str) -> Vec<PathBuf> {
        let expanded = if let Some(rest) = pattern.strip_prefix("~/") {
            Self::home_dir().join(rest).to_string_lossy().to_string()
        } else {
            pattern.to_string()
        };

        if expanded.contains('*') || expanded.contains('?') || expanded.contains('[') {
            match glob::glob(&expanded) {
                Ok(paths) => paths.filter_map(|p| p.ok()).filter(|p| p.is_dir()).collect(),
                Err(_) => vec![],
            }
        } else {
            let p = PathBuf::from(&expanded);
            if p.is_dir() {
                vec![p]
            } else {
                vec![]
            }
        }
    }

    async fn discover_skills(&self) -> Result<()> {
        let skills_config = self.config.get_skills_config().await;
        let home = Self::home_dir();

        // Include configured directories + builtin_skills_path + canonical directories
        let mut patterns = skills_config.directories.clone();
        if let Some(ref builtin_path) = skills_config.builtin_skills_path {
            if !builtin_path.trim().is_empty() && !patterns.contains(builtin_path) {
                patterns.push(builtin_path.clone());
            }
        }
        let canonical = vec![
            home.join(".supergravity").join("builtin").join("skills").to_string_lossy().to_string(),
            home.join(".supergravity").join("plugins").join("*").join("skills").to_string_lossy().to_string(),
            home.join(".supergravity").join("skills").to_string_lossy().to_string(),
            home.join(".agents").join("skills").to_string_lossy().to_string(),
        ];
        for c in canonical {
            if !patterns.contains(&c) {
                patterns.push(c);
            }
        }

        for pattern in patterns {
            let dirs = Self::expand_pattern(&pattern);
            let source = self.determine_source(&pattern);
            let skill_type = self.determine_skill_type(&pattern);

            for dir in dirs {
                for entry in WalkDir::new(&dir)
                    .follow_links(true)
                    .into_iter()
                    .filter_map(|e| e.ok())
                {
                    let file_path = entry.path();
                    if file_path.is_file() {
                        if let Some(mut skill) = self
                            .parse_skill_file(file_path, source.clone(), skill_type.clone())
                            .await?
                        {
                            if skills_config.auto_load {
                                if let Ok(schema) = self.load_skill_schema(&skill.path).await {
                                    skill.schema = schema;
                                    skill.loaded = true;
                                }
                            }
                            self.skills.write().await.insert(skill.id.clone(), skill);
                        }
                    }
                }
            }
        }

        Ok(())
    }

    fn determine_source(&self, directory: &str) -> SkillSource {
        let path_str = directory.to_lowercase();
        if path_str.contains("builtin") {
            SkillSource::BuiltinSkills
        } else if path_str.contains("plugins") {
            SkillSource::PluginSkills
        } else if path_str.contains("gemini") && path_str.contains("config") {
            SkillSource::ConfigSkills
        } else if path_str.contains(".claude") {
            SkillSource::ClaudeSkills
        } else if path_str.contains(".agents") {
            SkillSource::AgentsSkills
        } else {
            SkillSource::ConfigSkills
        }
    }

    fn determine_skill_type(&self, directory: &str) -> SkillType {
        let path_str = directory.to_lowercase();
        if path_str.contains("builtin") {
            SkillType::Builtin
        } else if path_str.contains("plugins") {
            SkillType::Plugin
        } else if path_str.contains(".claude") || path_str.contains(".agents") {
            SkillType::User
        } else {
            SkillType::System
        }
    }

    async fn parse_skill_file(
        &self,
        path: &Path,
        source: SkillSource,
        skill_type: SkillType,
    ) -> Result<Option<Skill>> {
        let file_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");

        if file_name.eq_ignore_ascii_case("SKILL.md") {
            let content = tokio::fs::read_to_string(path).await?;
            let (name_opt, desc_opt) = Self::parse_yaml_frontmatter(&content);
            let dir_name = path
                .parent()
                .and_then(|p| p.file_name())
                .and_then(|n| n.to_str())
                .unwrap_or("skill");
            let name = name_opt.unwrap_or_else(|| dir_name.to_string());
            let description = desc_opt.unwrap_or_default();
            let id = format!("{}::{}", name, path.to_string_lossy());

            return Ok(Some(Skill {
                id,
                name,
                description,
                version: "1.0.0".to_string(),
                path: path.to_path_buf(),
                skill_type,
                schema: None,
                loaded: false,
                source,
            }));
        }

        if file_name == "skill.json" || file_name == "skill.yaml" || file_name == "skill.yml" {
            let content = tokio::fs::read_to_string(path).await?;
            let skill: serde_json::Value = if file_name == "skill.json" {
                serde_json::from_str(&content)?
            } else {
                serde_yaml::from_str(&content)?
            };

            let id = skill
                .get("id")
                .and_then(|v| v.as_str())
                .unwrap_or(file_name)
                .to_string();

            let name = skill
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or(&id)
                .to_string();

            let description = skill
                .get("description")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            let version = skill
                .get("version")
                .and_then(|v| v.as_str())
                .unwrap_or("0.1.0")
                .to_string();

            let schema = skill.get("schema").cloned();

            return Ok(Some(Skill {
                id,
                name,
                description,
                version,
                path: path.to_path_buf(),
                skill_type,
                schema,
                loaded: false,
                source,
            }));
        }

        Ok(None)
    }

    fn parse_yaml_frontmatter(content: &str) -> (Option<String>, Option<String>) {
        let trimmed = content.trim_start_matches('\u{feff}').trim_start();
        if !trimmed.starts_with("---") {
            return (None, None);
        }
        let after_start = &trimmed[3..];
        let after_newline = after_start
            .strip_prefix("\r\n")
            .or_else(|| after_start.strip_prefix('\n'))
            .unwrap_or(after_start);
        if let Some(end_idx) = after_newline.find("\n---") {
            let yaml_block = &after_newline[..end_idx];
            if let Ok(val) = serde_yaml::from_str::<serde_yaml::Value>(yaml_block) {
                let name = val
                    .get("name")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                let description = val
                    .get("description")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                return (name, description);
            }
        }
        (None, None)
    }
}
