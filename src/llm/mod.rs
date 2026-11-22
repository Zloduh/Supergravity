//! LLM Provider Management for Antigravity
//!
//! Supports OpenAI-compatible APIs: Ollama, llama.cpp, vLLM, LM Studio

use std::sync::Arc;
use std::collections::HashMap;
use std::time::Duration;
use serde::{Deserialize, Serialize};
use reqwest::{Client, header::AUTHORIZATION};
use tokio::sync::RwLock;
use anyhow::Result;
use uuid::Uuid;
use chrono::{DateTime, Utc};

use crate::config::{LLMProviderConfig, LLMProviderType};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LLMProvider {
    pub id: String,
    pub name: String,
    pub provider_type: LLMProviderType,
    pub base_url: String,
    pub api_key: Option<String>,
    pub models: Vec<LLMModel>,
    pub enabled: bool,
    pub headers: HashMap<String, String>,
    pub status: ProviderStatus,
    pub last_checked: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ProviderStatus {
    Unknown,
    Connected,
    Disconnected,
    Error(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LLMModel {
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub context_length: Option<u32>,
    #[serde(default = "default_true")]
    pub supports_streaming: bool,
    #[serde(default = "default_true")]
    pub supports_tools: bool,
    #[serde(default)]
    pub supports_vision: bool,
    #[serde(default)]
    pub owned_by: Option<String>,
    #[serde(default)]
    pub meta: Option<serde_json::Value>,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: MessageRole,
    #[serde(default)]
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning_content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<ToolCall>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum MessageRole {
    System,
    User,
    Assistant,
    Tool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ToolCall {
    pub id: String,
    pub r#type: String,
    pub function: ToolFunction,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ToolFunction {
    pub name: String,
    pub arguments: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatCompletionRequest {
    pub model: String,
    pub messages: Vec<ChatMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stream: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tools: Option<Vec<ToolDefinition>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_choice: Option<ToolChoice>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub top_p: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub frequency_penalty: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub presence_penalty: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stop: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolDefinition {
    pub r#type: String,
    pub function: ToolFunctionDefinition,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolFunctionDefinition {
    pub name: String,
    pub description: String,
    pub parameters: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ToolChoice {
    None,
    Auto,
    Required,
    Specific { r#type: String, function: ToolFunctionChoice },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolFunctionChoice {
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatCompletionResponse {
    pub id: String,
    pub object: String,
    pub created: u64,
    pub model: String,
    pub choices: Vec<ChatChoice>,
    pub usage: Option<Usage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatChoice {
    pub index: u32,
    pub message: ChatMessage,
    pub finish_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Usage {
    pub prompt_tokens: u32,
    pub completion_tokens: u32,
    pub total_tokens: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct ChatCompletionChunk {
    pub id: String,
    pub object: String,
    pub created: u64,
    pub model: String,
    pub choices: Vec<ChatChunkChoice>,
    pub usage: Option<Usage>,
    pub timings: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct ChatChunkChoice {
    pub index: u32,
    pub delta: ChatMessageDelta,
    pub finish_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct ChatMessageDelta {
    pub role: Option<MessageRole>,
    pub content: Option<String>,
    pub reasoning_content: Option<String>,
    pub tool_calls: Option<Vec<ToolCallDelta>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct ToolCallDelta {
    pub index: u32,
    pub id: Option<String>,
    pub r#type: Option<String>,
    pub function: Option<ToolFunctionDelta>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct ToolFunctionDelta {
    pub name: Option<String>,
    pub arguments: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelsResponse {
    #[serde(default)]
    pub object: String,
    pub data: Vec<LLMModel>,
}

#[derive(Debug, Clone, Default)]
pub struct LLMManagerOptions {
    pub skip_discovery: bool,
    pub probe_timeout: Option<Duration>,
}

pub struct LLMProviderManager {
    providers: RwLock<HashMap<String, LLMProvider>>,
    client: Client,
    stream_client: Client,
    probe_client: Client,
    config: Arc<crate::config::ConfigManager>,
}

impl LLMProviderManager {
    pub async fn new(config: Arc<crate::config::ConfigManager>) -> Result<Arc<Self>> {
        let skip_discovery = std::env::var("ANTIGRAVITY_OFFLINE_NO_DISCOVER")
            .map(|v| {
                let trimmed = v.trim();
                trimmed == "1" || trimmed.eq_ignore_ascii_case("true")
            })
            .unwrap_or(false);

        Self::new_with_options(
            config,
            LLMManagerOptions {
                skip_discovery,
                probe_timeout: None,
            },
        )
        .await
    }

    pub async fn new_offline(config: Arc<crate::config::ConfigManager>) -> Result<Arc<Self>> {
        Self::new_with_options(
            config,
            LLMManagerOptions {
                skip_discovery: true,
                probe_timeout: None,
            },
        )
        .await
    }

    pub async fn new_with_options(
        config: Arc<crate::config::ConfigManager>,
        options: LLMManagerOptions,
    ) -> Result<Arc<Self>> {
        let probe_timeout = options.probe_timeout.unwrap_or_else(|| Duration::from_secs(2));
        let client = Client::builder()
            .connect_timeout(Duration::from_secs(5))
            .timeout(Duration::from_secs(120))
            .build()?;
        let stream_client = Client::builder()
            .connect_timeout(Duration::from_secs(5))
            .build()?;
        let probe_client = Client::builder()
            .connect_timeout(probe_timeout)
            .timeout(probe_timeout)
            .build()?;

        let manager = Arc::new(Self {
            providers: RwLock::new(HashMap::new()),
            client,
            stream_client,
            probe_client,
            config: config.clone(),
        });

        // Load providers from config
        let llm_config = config.get_llm_config().await;
        for provider_config in llm_config.providers {
            let provider = Self::config_to_provider(provider_config);
            manager.providers.write().await.insert(provider.id.clone(), provider);
        }

        if !options.skip_discovery {
            // Auto-discover local & configured providers concurrently with short timeouts
            manager.discover_local_providers().await?;

            // Auto-fetch models for the active provider on startup
            if let Some(active) = manager.get_active_provider().await {
                let _ = manager.refresh_provider_models(&active.id).await;
            }
        }

        Ok(manager)
    }

    fn config_to_provider(config: LLMProviderConfig) -> LLMProvider {
        let models = config.models.iter().map(|m| LLMModel {
            id: m.clone(),
            name: m.clone(),
            context_length: None,
            supports_streaming: true,
            supports_tools: true,
            supports_vision: false,
            owned_by: Some(config.provider_type.to_string()),
            meta: None,
        }).collect();

        LLMProvider {
            id: config.id,
            name: config.name,
            provider_type: config.provider_type,
            base_url: config.base_url,
            api_key: config.api_key,
            models,
            enabled: config.enabled,
            headers: config.headers.unwrap_or_default(),
            status: ProviderStatus::Unknown,
            last_checked: None,
        }
    }

    async fn discover_local_providers(&self) -> Result<()> {
        let existing_strata = self.providers.read().await.get("strata").cloned();
        let remaining_providers: Vec<LLMProvider> = {
            let providers = self.providers.read().await;
            providers
                .values()
                .filter(|p| {
                    p.enabled
                        && !matches!(
                            p.id.as_str(),
                            "strata" | "ollama" | "lm-studio" | "llama-cpp" | "vllm"
                        )
                })
                .cloned()
                .collect()
        };

        // Run local provider checks concurrently and probe remaining enabled providers concurrently
        let strata_fut = async {
            if let Some(ref p) = existing_strata {
                if p.base_url.trim_end_matches('/') != "http://127.0.0.1:47831/v1" {
                    return Self::probe_provider_with_client(&self.probe_client, p).await;
                }
            }
            self.check_strata().await
        };

        let other_fut = async {
            let mut set = tokio::task::JoinSet::new();
            for p in remaining_providers {
                let client = self.probe_client.clone();
                set.spawn(async move {
                    let res = Self::probe_provider_with_client(&client, &p).await;
                    (p.id, res)
                });
            }
            let mut results = Vec::new();
            while let Some(joined) = set.join_next().await {
                if let Ok(item) = joined {
                    results.push(item);
                }
            }
            results
        };

        let (strata_res, ollama_res, lm_res, llama_res, vllm_res, other_results) = tokio::join!(
            strata_fut,
            self.check_ollama(),
            self.check_lm_studio(),
            self.check_llama_cpp(),
            self.check_vllm(),
            other_fut,
        );

        let now = Utc::now();
        let mut providers = self.providers.write().await;

        // Strata Local
        match strata_res {
            Ok(()) => {
                if let Some(p) = providers.get_mut("strata") {
                    if p.api_key.as_deref().unwrap_or("").trim().is_empty() {
                        p.api_key = Some("strata".to_string());
                    }
                    p.status = ProviderStatus::Connected;
                    p.last_checked = Some(now);
                } else {
                    providers.insert(
                        "strata".to_string(),
                        LLMProvider {
                            id: "strata".to_string(),
                            name: "Strata (Local)".to_string(),
                            provider_type: LLMProviderType::Custom,
                            base_url: "http://127.0.0.1:47831/v1".to_string(),
                            api_key: Some("strata".to_string()),
                            models: vec![],
                            enabled: true,
                            headers: HashMap::new(),
                            status: ProviderStatus::Connected,
                            last_checked: Some(now),
                        },
                    );
                }
            }
            Err(e) => {
                if let Some(p) = providers.get_mut("strata") {
                    p.status = ProviderStatus::Error(e.to_string());
                    p.last_checked = Some(now);
                }
            }
        }

        // Local auto-discovered endpoints
        let local_specs = [
            (
                "ollama",
                "Ollama",
                LLMProviderType::Ollama,
                "http://127.0.0.1:11434/v1",
                ollama_res,
            ),
            (
                "lm-studio",
                "LM Studio",
                LLMProviderType::LMStudio,
                "http://localhost:1234/v1",
                lm_res,
            ),
            (
                "llama-cpp",
                "llama.cpp",
                LLMProviderType::LlamaCpp,
                "http://localhost:8080/v1",
                llama_res,
            ),
            (
                "vllm",
                "vLLM",
                LLMProviderType::VLLM,
                "http://localhost:8000/v1",
                vllm_res,
            ),
        ];

        for (id, name, provider_type, base_url, res) in local_specs {
            match res {
                Ok(()) => {
                    if let Some(p) = providers.get_mut(id) {
                        p.status = ProviderStatus::Connected;
                        p.last_checked = Some(now);
                    } else {
                        providers.insert(
                            id.to_string(),
                            LLMProvider {
                                id: id.to_string(),
                                name: name.to_string(),
                                provider_type,
                                base_url: base_url.to_string(),
                                api_key: None,
                                models: vec![],
                                enabled: true,
                                headers: HashMap::new(),
                                status: ProviderStatus::Connected,
                                last_checked: Some(now),
                            },
                        );
                    }
                }
                Err(e) => {
                    if let Some(p) = providers.get_mut(id) {
                        p.status = ProviderStatus::Error(e.to_string());
                        p.last_checked = Some(now);
                    }
                }
            }
        }

        // Remaining enabled configured providers (e.g. strata-lan, custom endpoints)
        for (id, res) in other_results {
            if let Some(p) = providers.get_mut(&id) {
                p.status = match res {
                    Ok(()) => ProviderStatus::Connected,
                    Err(e) => ProviderStatus::Error(e.to_string()),
                };
                p.last_checked = Some(now);
            }
        }

        Ok(())
    }

    async fn check_strata(&self) -> Result<()> {
        let resp = self
            .probe_client
            .get("http://127.0.0.1:47831/v1/models")
            .header(AUTHORIZATION, "Bearer strata")
            .send()
            .await?;
        if resp.status().is_success() {
            Ok(())
        } else {
            Err(anyhow::anyhow!("Strata returned HTTP {}", resp.status()))
        }
    }

    async fn check_ollama(&self) -> Result<()> {
        let resp = self
            .probe_client
            .get("http://localhost:11434/api/tags")
            .send()
            .await?;
        if resp.status().is_success() {
            Ok(())
        } else {
            Err(anyhow::anyhow!("Ollama returned HTTP {}", resp.status()))
        }
    }

    async fn check_lm_studio(&self) -> Result<()> {
        let resp = self
            .probe_client
            .get("http://localhost:1234/v1/models")
            .send()
            .await?;
        if resp.status().is_success() {
            Ok(())
        } else {
            Err(anyhow::anyhow!("LM Studio returned HTTP {}", resp.status()))
        }
    }

    async fn check_llama_cpp(&self) -> Result<()> {
        let resp = self
            .probe_client
            .get("http://localhost:8080/v1/models")
            .send()
            .await?;
        if resp.status().is_success() {
            Ok(())
        } else {
            Err(anyhow::anyhow!("llama.cpp returned HTTP {}", resp.status()))
        }
    }

    async fn check_vllm(&self) -> Result<()> {
        let resp = self
            .probe_client
            .get("http://localhost:8000/v1/models")
            .send()
            .await?;
        if resp.status().is_success() {
            Ok(())
        } else {
            Err(anyhow::anyhow!("vLLM returned HTTP {}", resp.status()))
        }
    }

    pub async fn list_providers(&self) -> Vec<LLMProvider> {
        self.providers.read().await.values().cloned().collect()
    }

    pub async fn get_provider(&self, id: &str) -> Option<LLMProvider> {
        self.providers.read().await.get(id).cloned()
    }

    pub async fn add_provider(&self, mut config: LLMProviderConfig) -> Result<LLMProvider> {
        let normalized_url = config.base_url.trim().trim_end_matches('/').to_lowercase();
        if !normalized_url.is_empty() {
            let providers = self.providers.read().await;
            if let Some(existing) = providers
                .values()
                .find(|p| p.base_url.trim().trim_end_matches('/').to_lowercase() == normalized_url)
            {
                config.id = existing.id.clone();
            }
        }
        let provider = Self::config_to_provider(config);
        let id = provider.id.clone();

        // Test connection
        let mut provider = provider;
        provider.status = match self.test_provider(&provider).await {
            Ok(_) => ProviderStatus::Connected,
            Err(e) => ProviderStatus::Error(e.to_string()),
        };
        provider.last_checked = Some(Utc::now());

        self.providers.write().await.insert(id.clone(), provider.clone());

        // Save to config
        self.save_provider_to_config(&provider).await?;

        Ok(provider)
    }

    pub async fn remove_provider(&self, id: &str) -> Result<()> {
        self.providers.write().await.remove(id);
        self.remove_provider_from_config(id).await
    }

    pub async fn set_active_provider(&self, id: &str) -> Result<()> {
        self.config.update(|c| c.llm.active_provider = Some(id.to_string())).await
    }

    pub async fn get_active_provider(&self) -> Option<LLMProvider> {
        let config = self.config.get_llm_config().await;
        if let Some(active_id) = config.active_provider {
            self.get_provider(&active_id).await
        } else {
            // Return first enabled provider
            self.providers.read().await.values()
                .find(|p| p.enabled && p.status == ProviderStatus::Connected)
                .cloned()
        }
    }

    async fn probe_provider_with_client(client: &Client, provider: &LLMProvider) -> Result<()> {
        let url = format!("{}/models", provider.base_url.trim_end_matches('/'));
        let mut req = client.get(&url);

        if let Some(api_key) = provider.api_key.as_deref().map(str::trim).filter(|k| !k.is_empty()) {
            req = req.header(AUTHORIZATION, format!("Bearer {}", api_key));
        }

        for (key, value) in &provider.headers {
            req = req.header(key, value);
        }

        let resp = req.send().await?;
        if resp.status().is_success() {
            Ok(())
        } else {
            Err(anyhow::anyhow!("Provider returned HTTP {}", resp.status()))
        }
    }

    async fn test_provider(&self, provider: &LLMProvider) -> Result<()> {
        Self::probe_provider_with_client(&self.probe_client, provider).await
    }

    pub async fn refresh_provider_models(&self, id: &str) -> Result<()> {
        let provider = {
            let providers = self.providers.read().await;
            providers.get(id).cloned()
        };

        let Some(mut provider) = provider else {
            return Err(anyhow::anyhow!("Provider not found"));
        };

        let url = format!("{}/models", provider.base_url.trim_end_matches('/'));
        let mut req = self.probe_client.get(&url);

        if let Some(api_key) = provider.api_key.as_deref().map(str::trim).filter(|k| !k.is_empty()) {
            req = req.header(AUTHORIZATION, format!("Bearer {}", api_key));
        }

        for (key, value) in &provider.headers {
            req = req.header(key, value);
        }

        let resp = match req.send().await {
            Ok(resp) => resp,
            Err(e) => {
                let msg = e.to_string();
                provider.status = ProviderStatus::Error(msg.clone());
                provider.last_checked = Some(Utc::now());
                self.providers.write().await.insert(id.to_string(), provider);
                return Err(anyhow::anyhow!(msg));
            }
        };

        if !resp.status().is_success() {
            let msg = format!("HTTP {}", resp.status());
            provider.status = ProviderStatus::Error(msg.clone());
            provider.last_checked = Some(Utc::now());
            self.providers.write().await.insert(id.to_string(), provider);
            return Err(anyhow::anyhow!(msg));
        }

        let mut models_resp: ModelsResponse = match resp.json().await {
            Ok(parsed) => parsed,
            Err(e) => {
                let msg = format!("Invalid models payload: {}", e);
                provider.status = ProviderStatus::Error(msg.clone());
                provider.last_checked = Some(Utc::now());
                self.providers.write().await.insert(id.to_string(), provider);
                return Err(anyhow::anyhow!(msg));
            }
        };

        for m in &mut models_resp.data {
            if m.context_length.is_none() {
                if let Some(ctx) = m
                    .meta
                    .as_ref()
                    .and_then(|meta| {
                        meta.get("context_length")
                            .or_else(|| meta.get("ctx_size"))
                            .or_else(|| meta.get("n_ctx"))
                            .or_else(|| meta.get("max_context_length"))
                    })
                    .and_then(|v| v.as_u64())
                {
                    m.context_length = Some(ctx as u32);
                }
            }
            if m.name.is_empty() {
                if let Some(label) = m
                    .meta
                    .as_ref()
                    .and_then(|meta| meta.get("label"))
                    .and_then(|v| v.as_str())
                {
                    if !label.trim().is_empty() {
                        m.name = format!("{} ({})", label, m.id);
                    } else {
                        m.name = m.id.clone();
                    }
                } else {
                    m.name = m.id.clone();
                }
            }
        }
        provider.models = models_resp.data;
        provider.status = ProviderStatus::Connected;
        provider.last_checked = Some(Utc::now());

        self.providers.write().await.insert(id.to_string(), provider.clone());
        self.save_provider_to_config(&provider).await
    }

    async fn apply_llm_config_defaults(
        &self,
        provider: &LLMProvider,
        mut request: ChatCompletionRequest,
    ) -> (ChatCompletionRequest, Duration) {
        let llm_cfg = self.config.get_llm_config().await;

        if request.model.trim().is_empty() {
            request.model = llm_cfg
                .default_model
                .clone()
                .filter(|m| !m.trim().is_empty())
                .or_else(|| provider.models.first().map(|m| m.id.clone()))
                .unwrap_or_else(|| "coder-iq1_m".to_string());
        }

        if llm_cfg.inherit_model_settings {
            // Inherit model's own context length, max_tokens, and temperature configured on Strata/provider
            // by omitting explicit overrides unless the caller passed them directly.
        } else {
            if request.temperature.is_none() {
                request.temperature = llm_cfg.temperature;
            }

            if request.max_tokens.is_none() {
                request.max_tokens = llm_cfg.max_tokens;
            }

            if let Some(ctx) = llm_cfg.context_length {
                let cap = ctx.max(1);
                request.max_tokens = Some(request.max_tokens.map(|m| m.min(cap)).unwrap_or(cap));
            }
        }

        let timeout = Duration::from_secs(llm_cfg.timeout_seconds.unwrap_or(120).max(1));
        (request, timeout)
    }

    pub async fn resolve_provider(&self, provider_id: Option<&str>) -> Option<LLMProvider> {
        if let Some(id) = provider_id.map(str::trim).filter(|s| !s.is_empty()) {
            if let Some(p) = self.get_provider(id).await {
                return Some(p);
            }
        }
        self.get_active_provider().await
    }

    pub async fn chat_completion(&self, request: ChatCompletionRequest) -> Result<ChatCompletionResponse> {
        self.chat_completion_with_provider(None, request).await
    }

    pub async fn chat_completion_with_provider(
        &self,
        provider_id: Option<&str>,
        request: ChatCompletionRequest,
    ) -> Result<ChatCompletionResponse> {
        let provider = self.resolve_provider(provider_id).await
            .ok_or_else(|| anyhow::anyhow!("No active LLM provider"))?;

        let (request, timeout) = self.apply_llm_config_defaults(&provider, request).await;

        let url = format!("{}/chat/completions", provider.base_url.trim_end_matches('/'));
        let mut req = self.client.post(&url).timeout(timeout).json(&request);

        if let Some(api_key) = provider.api_key.as_deref().map(str::trim).filter(|k| !k.is_empty()) {
            req = req.header(AUTHORIZATION, format!("Bearer {}", api_key));
        }

        for (key, value) in &provider.headers {
            req = req.header(key, value);
        }

        let resp = req.send().await?;
        if resp.status().is_success() {
            Ok(resp.json().await?)
        } else {
            let error_text = resp.text().await?;
            Err(anyhow::anyhow!("LLM request failed: {}", error_text))
        }
    }

    pub async fn stream_chat_completion(
        &self,
        request: ChatCompletionRequest,
        on_chunk: impl FnMut(ChatCompletionChunk) + Send,
    ) -> Result<()> {
        self.stream_chat_completion_with_provider(None, request, on_chunk).await
    }

    pub async fn stream_chat_completion_with_provider(
        &self,
        provider_id: Option<&str>,
        request: ChatCompletionRequest,
        mut on_chunk: impl FnMut(ChatCompletionChunk) + Send,
    ) -> Result<()> {
        let provider = self.resolve_provider(provider_id).await
            .ok_or_else(|| anyhow::anyhow!("No active LLM provider"))?;

        let (mut request, timeout) = self.apply_llm_config_defaults(&provider, request).await;
        request.stream = Some(true);

        let url = format!("{}/chat/completions", provider.base_url.trim_end_matches('/'));
        let mut req = self.stream_client.post(&url).json(&request);

        if let Some(api_key) = provider.api_key.as_deref().map(str::trim).filter(|k| !k.is_empty()) {
            req = req.header(AUTHORIZATION, format!("Bearer {}", api_key));
        }

        for (key, value) in &provider.headers {
            req = req.header(key, value);
        }

        let resp = tokio::time::timeout(timeout, req.send())
            .await
            .map_err(|_| {
                anyhow::anyhow!(
                    "LLM stream timed out waiting for response headers after {}s",
                    timeout.as_secs()
                )
            })??;
        if !resp.status().is_success() {
            let error_text = resp.text().await?;
            return Err(anyhow::anyhow!("LLM request failed: {}", error_text));
        }

        let mut stream = resp.bytes_stream();
        use futures_util::StreamExt;
        let mut byte_buf: Vec<u8> = Vec::new();

        loop {
            let next_chunk = tokio::time::timeout(timeout, stream.next())
                .await
                .map_err(|_| {
                    anyhow::anyhow!(
                        "LLM stream stalled for {}s without receiving data",
                        timeout.as_secs()
                    )
                })?;
            let Some(chunk_result) = next_chunk else {
                break;
            };
            let chunk_bytes = chunk_result?;
            byte_buf.extend_from_slice(&chunk_bytes);

            while let Some(pos) = byte_buf.iter().position(|&b| b == b'\n') {
                let line_bytes: Vec<u8> = byte_buf.drain(..=pos).collect();
                let line_lossy = String::from_utf8_lossy(&line_bytes);
                let line = line_lossy.trim();

                if let Some(data) = line.strip_prefix("data:") {
                    let data = data.trim();
                    if data == "[DONE]" {
                        return Ok(());
                    }
                    if let Ok(chunk) = serde_json::from_str::<ChatCompletionChunk>(data) {
                        on_chunk(chunk);
                    }
                }
            }
        }

        // Process any remaining line in buffer
        if !byte_buf.is_empty() {
            let rem_lossy = String::from_utf8_lossy(&byte_buf);
            let rem = rem_lossy.trim();
            if let Some(data) = rem.strip_prefix("data:") {
                let data = data.trim();
                if data != "[DONE]" {
                    if let Ok(chunk) = serde_json::from_str::<ChatCompletionChunk>(data) {
                        on_chunk(chunk);
                    }
                }
            }
        }

        Ok(())
    }

    pub async fn list_models(&self, provider_id: Option<&str>) -> Result<Vec<LLMModel>> {
        let target_id = if let Some(id) = provider_id {
            Some(id.to_string())
        } else {
            self.get_active_provider().await.map(|p| p.id)
        };

        if let Some(id) = target_id {
            if let Some(provider) = self.get_provider(&id).await {
                if provider.models.is_empty() {
                    let _ = self.refresh_provider_models(&id).await;
                    if let Some(updated) = self.get_provider(&id).await {
                        return Ok(updated.models);
                    }
                }
                return Ok(provider.models);
            }
        }
        Ok(vec![])
    }

    /// Fallback XML/JSON tool-call parser for local models without strict native tool calling.
    pub fn parse_fallback_tool_calls(content: &str) -> (String, Vec<ToolCall>) {
        let mut calls = Vec::new();
        let mut cleaned = content.to_string();

        // 1. Parse <tool_call>{"name": "...", "arguments": {...}}</tool_call>
        while let Some(start) = cleaned.find("<tool_call>") {
            if let Some(rel_end) = cleaned[start..].find("</tool_call>") {
                let end = start + rel_end;
                let inner = cleaned[start + "<tool_call>".len()..end].trim();
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(inner) {
                    if let Some(name) = val.get("name").and_then(|v| v.as_str()) {
                        let args = val.get("arguments").cloned().unwrap_or(serde_json::json!({}));
                        let args_str = if args.is_string() {
                            args.as_str().unwrap_or("{}").to_string()
                        } else {
                            args.to_string()
                        };
                        calls.push(ToolCall {
                            id: format!("call_{}", Uuid::new_v4().simple()),
                            r#type: "function".to_string(),
                            function: ToolFunction {
                                name: name.to_string(),
                                arguments: args_str,
                            },
                        });
                    }
                }
                cleaned.replace_range(start..end + "</tool_call>".len(), "");
            } else {
                break;
            }
        }

        // 2. Parse <function=tool_name>{"arg": "val"}</function>
        while let Some(start) = cleaned.find("<function=") {
            if let Some(gt_rel) = cleaned[start..].find('>') {
                let gt = start + gt_rel;
                let name = cleaned[start + "<function=".len()..gt].trim().to_string();
                if let Some(end_rel) = cleaned[gt + 1..].find("</function>") {
                    let end = gt + 1 + end_rel;
                    let inner = cleaned[gt + 1..end].trim();
                    calls.push(ToolCall {
                        id: format!("call_{}", Uuid::new_v4().simple()),
                        r#type: "function".to_string(),
                        function: ToolFunction {
                            name,
                            arguments: if inner.is_empty() { "{}".to_string() } else { inner.to_string() },
                        },
                    });
                    cleaned.replace_range(start..end + "</function>".len(), "");
                } else {
                    break;
                }
            } else {
                break;
            }
        }

        // 3. Parse ```json {"name": "...", "arguments": {...}} ``` if no calls found yet
        if calls.is_empty() {
            if let Some(start) = cleaned.find("```json") {
                if let Some(end_rel) = cleaned[start + 7..].find("```") {
                    let end = start + 7 + end_rel;
                    let inner = cleaned[start + 7..end].trim();
                    if let Ok(val) = serde_json::from_str::<serde_json::Value>(inner) {
                        if let Some(name) = val.get("name").and_then(|v| v.as_str()) {
                            let args = val.get("arguments").cloned().unwrap_or(serde_json::json!({}));
                            let args_str = if args.is_string() {
                                args.as_str().unwrap_or("{}").to_string()
                            } else {
                                args.to_string()
                            };
                            calls.push(ToolCall {
                                id: format!("call_{}", Uuid::new_v4().simple()),
                                r#type: "function".to_string(),
                                function: ToolFunction {
                                    name: name.to_string(),
                                    arguments: args_str,
                                },
                            });
                            cleaned.replace_range(start..end + 3, "");
                        }
                    }
                }
            }
        }

        (cleaned.trim().to_string(), calls)
    }

    async fn save_provider_to_config(&self, provider: &LLMProvider) -> Result<()> {
        self.config.update(|c| {
            if let Some(idx) = c.llm.providers.iter().position(|p| p.id == provider.id) {
                c.llm.providers[idx] = self.provider_to_config(provider);
            } else {
                c.llm.providers.push(self.provider_to_config(provider));
            }
        }).await
    }

    async fn remove_provider_from_config(&self, id: &str) -> Result<()> {
        self.config.update(|c| {
            c.llm.providers.retain(|p| p.id != id);
            if c.llm.active_provider.as_deref() == Some(id) {
                c.llm.active_provider = None;
            }
        }).await
    }

    fn provider_to_config(&self, provider: &LLMProvider) -> LLMProviderConfig {
        LLMProviderConfig {
            id: provider.id.clone(),
            name: provider.name.clone(),
            provider_type: provider.provider_type.clone(),
            base_url: provider.base_url.clone(),
            api_key: provider.api_key.clone(),
            models: provider.models.iter().map(|m| m.id.clone()).collect(),
            enabled: provider.enabled,
            headers: Some(provider.headers.clone()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::ConfigManager;
    use tempfile::TempDir;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    static ENV_MUTEX: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

    async fn read_http_request(socket: &mut tokio::net::TcpStream) -> String {
        let mut buf = Vec::new();
        let mut tmp = [0u8; 4096];
        let mut header_end = None;
        let mut content_len = 0usize;

        loop {
            let n = socket.read(&mut tmp).await.unwrap_or(0);
            if n == 0 {
                break;
            }
            buf.extend_from_slice(&tmp[..n]);
            if header_end.is_none() {
                if let Some(pos) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
                    header_end = Some(pos + 4);
                    let headers_str = String::from_utf8_lossy(&buf[..pos + 4]);
                    for line in headers_str.lines() {
                        if let Some((k, v)) = line.split_once(':') {
                            if k.trim().eq_ignore_ascii_case("content-length") {
                                content_len = v.trim().parse().unwrap_or(0);
                            }
                        }
                    }
                }
            }
            if let Some(hend) = header_end {
                if buf.len() >= hend + content_len {
                    break;
                }
            }
        }
        String::from_utf8_lossy(&buf).to_string()
    }

    #[test]
    fn parse_fallback_tool_calls_handles_all_formats() {
        let (clean, calls) = LLMProviderManager::parse_fallback_tool_calls(
            "Hello <tool_call>{\"name\": \"read_file\", \"arguments\": {\"path\": \"a.txt\"}}</tool_call> world",
        );
        assert_eq!(clean, "Hello  world");
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].function.name, "read_file");
        assert!(calls[0].function.arguments.contains("a.txt"));

        let (clean2, calls2) = LLMProviderManager::parse_fallback_tool_calls(
            "<function=list_dir>{\"path\": \".\"}</function>",
        );
        assert_eq!(clean2, "");
        assert_eq!(calls2.len(), 1);
        assert_eq!(calls2[0].function.name, "list_dir");

        let (clean3, calls3) = LLMProviderManager::parse_fallback_tool_calls(
            "Sure:\n```json\n{\"name\": \"edit_file\", \"arguments\": {\"path\": \"b.rs\"}}\n```",
        );
        assert_eq!(clean3, "Sure:");
        assert_eq!(calls3.len(), 1);
        assert_eq!(calls3[0].function.name, "edit_file");

        let (clean4, calls4) = LLMProviderManager::parse_fallback_tool_calls("Just normal text.");
        assert_eq!(clean4, "Just normal text.");
        assert!(calls4.is_empty());
    }

    #[tokio::test]
    async fn offline_mode_skips_discovery_and_preserves_unknown_status() {
        let tmp = TempDir::new().unwrap();
        let cfg = ConfigManager::new_with_path(tmp.path().join("cfg.toml")).await.unwrap();
        let mgr = LLMProviderManager::new_offline(cfg).await.unwrap();

        let strata = mgr.get_provider("strata").await.unwrap();
        assert_eq!(strata.status, ProviderStatus::Unknown);
        assert!(strata.last_checked.is_none());

        let _guard = ENV_MUTEX.lock().await;
        struct EnvReset(Option<std::ffi::OsString>);
        impl Drop for EnvReset {
            fn drop(&mut self) {
                if let Some(prev) = self.0.take() {
                    std::env::set_var("ANTIGRAVITY_OFFLINE_NO_DISCOVER", prev);
                } else {
                    std::env::remove_var("ANTIGRAVITY_OFFLINE_NO_DISCOVER");
                }
            }
        }
        let _reset = EnvReset(std::env::var_os("ANTIGRAVITY_OFFLINE_NO_DISCOVER"));
        std::env::set_var("ANTIGRAVITY_OFFLINE_NO_DISCOVER", "1");

        let cfg2 = ConfigManager::new_with_path(tmp.path().join("cfg2.toml")).await.unwrap();
        let mgr2 = LLMProviderManager::new(cfg2).await.unwrap();
        assert_eq!(mgr2.get_provider("strata").await.unwrap().status, ProviderStatus::Unknown);
    }

    #[tokio::test]
    async fn refresh_provider_models_formats_meta_label_and_sets_error_on_failures() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();

        let server = tokio::spawn(async move {
            // 1. test_provider during add_provider + 2. refresh_provider_models
            for _ in 0..2 {
                let (mut sock, _) = listener.accept().await.unwrap();
                let req = read_http_request(&mut sock).await;
                assert!(req.contains("GET /v1/models"));
                assert!(!req.to_lowercase().contains("authorization:"));
                let body = r#"{"data":[{"id":"coder-iq1_m","meta":{"label":"Qwen3.8-Flash-Next Coder IQ1_M"}}]}"#;
                let resp = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body
                );
                sock.write_all(resp.as_bytes()).await.unwrap();
            }

            // 3. HTTP 500
            let (mut sock, _) = listener.accept().await.unwrap();
            let _ = read_http_request(&mut sock).await;
            sock.write_all(b"HTTP/1.1 500 Internal Server Error\r\nContent-Length: 5\r\nConnection: close\r\n\r\nerror")
                .await
                .unwrap();

            // 4. Invalid JSON
            let (mut sock, _) = listener.accept().await.unwrap();
            let _ = read_http_request(&mut sock).await;
            sock.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 3\r\nConnection: close\r\n\r\n{{{")
                .await
                .unwrap();
        });

        let tmp = TempDir::new().unwrap();
        let cfg = ConfigManager::new_with_path(tmp.path().join("cfg.toml")).await.unwrap();
        let mgr = LLMProviderManager::new_offline(cfg).await.unwrap();

        let p = mgr
            .add_provider(LLMProviderConfig {
                id: "mock".to_string(),
                name: "Mock".to_string(),
                provider_type: LLMProviderType::Custom,
                base_url: format!("http://{}/v1", addr),
                api_key: Some("   ".to_string()),
                models: vec![],
                enabled: true,
                headers: None,
            })
            .await
            .unwrap();
        assert_eq!(p.status, ProviderStatus::Connected);

        mgr.refresh_provider_models("mock").await.unwrap();
        let models = mgr.list_models(Some("mock")).await.unwrap();
        assert_eq!(models.len(), 1);
        assert_eq!(models[0].name, "Qwen3.8-Flash-Next Coder IQ1_M (coder-iq1_m)");
        assert_eq!(mgr.get_provider("mock").await.unwrap().status, ProviderStatus::Connected);

        // HTTP 500 -> ProviderStatus::Error
        let err_500 = mgr.refresh_provider_models("mock").await.unwrap_err();
        assert!(err_500.to_string().contains("500"));
        match mgr.get_provider("mock").await.unwrap().status {
            ProviderStatus::Error(msg) => assert!(msg.contains("500")),
            other => panic!("expected Error status, got {:?}", other),
        }

        // Invalid JSON -> ProviderStatus::Error
        let err_json = mgr.refresh_provider_models("mock").await.unwrap_err();
        assert!(err_json.to_string().contains("Invalid models payload"));
        match mgr.get_provider("mock").await.unwrap().status {
            ProviderStatus::Error(msg) => assert!(msg.contains("Invalid models payload")),
            other => panic!("expected Error status, got {:?}", other),
        }

        server.await.unwrap();

        // Connection refused (listener dropped) -> ProviderStatus::Error
        let err_conn = mgr.refresh_provider_models("mock").await.unwrap_err();
        assert!(!err_conn.to_string().is_empty());
        match mgr.get_provider("mock").await.unwrap().status {
            ProviderStatus::Error(_) => {}
            other => panic!("expected Error status, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn chat_completion_wires_config_defaults_context_clamping_and_timeout() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();

        let server = tokio::spawn(async move {
            // 1. Check wired defaults & context_length clamping
            let (mut sock, _) = listener.accept().await.unwrap();
            let raw = read_http_request(&mut sock).await;
            let body_start = raw.find("\r\n\r\n").unwrap() + 4;
            let sent: serde_json::Value = serde_json::from_str(&raw[body_start..]).unwrap();
            assert_eq!(sent["model"], "custom-default");
            assert!((sent["temperature"].as_f64().unwrap() - 0.35).abs() < 1e-4);
            // max_tokens=8192 clamped to context_length=2048
            assert_eq!(sent["max_tokens"], 2048);

            let reply = serde_json::json!({
                "id": "cmpl-1",
                "object": "chat.completion",
                "created": 123,
                "model": "custom-default",
                "choices": [{
                    "index": 0,
                    "message": { "role": "assistant", "content": "ok" },
                    "finish_reason": "stop"
                }]
            })
            .to_string();
            let resp = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                reply.len(),
                reply
            );
            sock.write_all(resp.as_bytes()).await.unwrap();

            // 2. Slow server to trigger timeout_seconds=1
            let (mut sock2, _) = listener.accept().await.unwrap();
            let _ = read_http_request(&mut sock2).await;
            tokio::time::sleep(Duration::from_secs(3)).await;
        });

        let tmp = TempDir::new().unwrap();
        let cfg = ConfigManager::new_with_path(tmp.path().join("cfg.toml")).await.unwrap();
        cfg.update(|c| {
            c.llm.providers = vec![LLMProviderConfig {
                id: "mock".to_string(),
                name: "Mock".to_string(),
                provider_type: LLMProviderType::Custom,
                base_url: format!("http://{}/v1", addr),
                api_key: Some("secret".to_string()),
                models: vec![],
                enabled: true,
                headers: None,
            }];
            c.llm.active_provider = Some("mock".to_string());
            c.llm.default_model = Some("custom-default".to_string());
            c.llm.inherit_model_settings = false;
            c.llm.temperature = Some(0.35);
            c.llm.max_tokens = Some(8192);
            c.llm.context_length = Some(2048);
            c.llm.timeout_seconds = Some(1);
        })
        .await
        .unwrap();

        let mgr = LLMProviderManager::new_offline(cfg).await.unwrap();
        let req = ChatCompletionRequest {
            model: String::new(),
            messages: vec![ChatMessage {
                role: MessageRole::User,
                content: "hi".to_string(),
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
        };

        let resp = mgr.chat_completion(req.clone()).await.unwrap();
        assert_eq!(resp.choices[0].message.content, "ok");

        // Second call hits slow socket and times out in ~1s (not 120s)
        let started = std::time::Instant::now();
        let err = mgr.chat_completion(req).await.unwrap_err();
        assert!(started.elapsed() < Duration::from_secs(5), "elapsed {:?}", started.elapsed());
        assert!(!err.to_string().is_empty());

        server.abort();
    }

    #[tokio::test]
    async fn stream_chat_completion_handles_split_utf8_and_trailing_buffer() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();

        let server = tokio::spawn(async move {
            let (mut sock, _) = listener.accept().await.unwrap();
            let _ = read_http_request(&mut sock).await;
            sock.write_all(
                b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n",
            )
            .await
            .unwrap();

            // Split a 4-byte UTF-8 emoji '🚀' (F0 9F 9A 80) across two HTTP chunks
            let sse1 = b"data: {\"choices\":[{\"index\":0,\"delta\":{\"reasoning_content\":\"think\",\"content\":\"\xF0\x9F";
            let sse2 = b"\x9A\x80\"}}]}\n\ndata: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"done\"}}]}";
            // Note: sse2 has NO trailing \n so trailing buffer parsing is exercised too!

            let chunk1 = format!("{:x}\r\n", sse1.len());
            sock.write_all(chunk1.as_bytes()).await.unwrap();
            sock.write_all(sse1).await.unwrap();
            sock.write_all(b"\r\n").await.unwrap();
            sock.flush().await.unwrap();

            tokio::time::sleep(Duration::from_millis(20)).await;

            let chunk2 = format!("{:x}\r\n", sse2.len());
            sock.write_all(chunk2.as_bytes()).await.unwrap();
            sock.write_all(sse2).await.unwrap();
            sock.write_all(b"\r\n0\r\n\r\n").await.unwrap();
        });

        let tmp = TempDir::new().unwrap();
        let cfg = ConfigManager::new_with_path(tmp.path().join("cfg.toml")).await.unwrap();
        cfg.update(|c| {
            c.llm.providers = vec![LLMProviderConfig {
                id: "mock".to_string(),
                name: "Mock".to_string(),
                provider_type: LLMProviderType::Custom,
                base_url: format!("http://{}/v1", addr),
                api_key: None,
                models: vec!["m1".to_string()],
                enabled: true,
                headers: None,
            }];
            c.llm.active_provider = Some("mock".to_string());
        })
        .await
        .unwrap();

        let mgr = LLMProviderManager::new_offline(cfg).await.unwrap();
        let mut chunks = Vec::new();
        mgr.stream_chat_completion(
            ChatCompletionRequest {
                model: "m1".to_string(),
                messages: vec![],
                temperature: None,
                max_tokens: None,
                stream: Some(true),
                tools: None,
                tool_choice: None,
                top_p: None,
                frequency_penalty: None,
                presence_penalty: None,
                stop: None,
            },
            |chunk| chunks.push(chunk),
        )
        .await
        .unwrap();

        assert_eq!(chunks.len(), 2);
        assert_eq!(chunks[0].choices[0].delta.reasoning_content.as_deref(), Some("think"));
        assert_eq!(chunks[0].choices[0].delta.content.as_deref(), Some("🚀"));
        assert_eq!(chunks[1].choices[0].delta.content.as_deref(), Some("done"));

        server.await.unwrap();
    }
}