//! MCP (Model Context Protocol) Client Management
//!
//! Discovers MCP servers from:
//! - ~/.gemini/config/plugins/*/.mcp.json
//! - ~/.gemini/config/mcp_config.json
//! - ~/.gemini/antigravity/mcp_config.json
//! - ~/.claude/mcp.json
//! - AppConfig MCP servers
//!
//! Implements real stdio and SSE JSON-RPC 2.0 transports.

use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::collections::HashMap;
use std::path::PathBuf;
use serde::{Deserialize, Serialize};
use tokio::sync::{RwLock, Mutex, oneshot};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use anyhow::Result;

use crate::config::{MCPServerConfig, MCPTransportConfig};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MCPServer {
    pub id: String,
    pub name: String,
    pub transport: MCPTransportConfig,
    pub enabled: bool,
    pub auto_start: bool,
    pub status: MCPServerStatus,
    pub tools: Vec<MCPTool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum MCPServerStatus {
    Disconnected,
    Connecting,
    Connected,
    Error(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MCPTool {
    pub name: String,
    pub description: String,
    pub input_schema: serde_json::Value,
    pub server_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MCPToolCallRequest {
    pub server_id: String,
    pub tool_name: String,
    pub arguments: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MCPToolCallResponse {
    pub success: bool,
    pub result: Option<serde_json::Value>,
    pub error: Option<String>,
}

struct StdioConnection {
    child: Mutex<Child>,
    stdin: Mutex<ChildStdin>,
    pending: Arc<Mutex<HashMap<u64, oneshot::Sender<serde_json::Value>>>>,
    next_id: AtomicU64,
}

struct SseConnection {
    client: reqwest::Client,
    post_url: String,
    headers: HashMap<String, String>,
    pending: Arc<Mutex<HashMap<u64, oneshot::Sender<serde_json::Value>>>>,
    next_id: AtomicU64,
}

enum ActiveTransport {
    Stdio(Arc<StdioConnection>),
    Sse(Arc<SseConnection>),
}

pub struct MCPClientManager {
    servers: RwLock<HashMap<String, MCPServer>>,
    connections: RwLock<HashMap<String, ActiveTransport>>,
    config: Arc<crate::config::ConfigManager>,
}

impl MCPClientManager {
    pub async fn new(config: Arc<crate::config::ConfigManager>) -> Result<Arc<Self>> {
        let manager = Arc::new(Self {
            servers: RwLock::new(HashMap::new()),
            connections: RwLock::new(HashMap::new()),
            config: config.clone(),
        });

        // Load servers from AppConfig
        let mcp_config = config.get_mcp_config().await;
        for server_config in mcp_config.servers {
            let server = MCPServer {
                id: server_config.id.clone(),
                name: server_config.name,
                transport: server_config.transport,
                enabled: server_config.enabled,
                auto_start: server_config.auto_start,
                status: MCPServerStatus::Disconnected,
                tools: vec![],
            };
            manager.servers.write().await.insert(server_config.id, server);
        }

        // Discover servers from plugin .mcp.json and user MCP config files
        manager.discover_mcp_configs().await;

        let skip_auto = std::env::var("SUPERGRAVITY_OFFLINE_NO_DISCOVER")
            .or_else(|_| std::env::var("ANTIGRAVITY_OFFLINE_NO_DISCOVER"))
            .map(|v| v.trim() == "1" || v.trim().eq_ignore_ascii_case("true"))
            .unwrap_or(false);
        if mcp_config.auto_connect && !skip_auto {
            let auto_ids: Vec<String> = manager
                .servers
                .read()
                .await
                .values()
                .filter(|s| s.enabled && s.auto_start)
                .map(|s| s.id.clone())
                .collect();
            for id in auto_ids {
                let mgr = manager.clone();
                tokio::spawn(async move {
                    let _ = mgr.connect_server(&id).await;
                });
            }
        }

        Ok(manager)
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

    async fn discover_mcp_configs(&self) {
        let home = Self::home_dir();
        let mut config_files = Vec::new();

        // ~/.supergravity/plugins/*/.mcp.json
        let plugin_glob = home
            .join(".supergravity")
            .join("plugins")
            .join("*")
            .join(".mcp.json");
        if let Ok(paths) = glob::glob(&plugin_glob.to_string_lossy()) {
            for p in paths.flatten() {
                if p.is_file() {
                    config_files.push(p);
                }
            }
        }

        // User MCP config files
        for rel in [
            ".supergravity/mcp_config.json",
            ".mcp.json",
        ] {
            let p = home.join(rel);
            if p.is_file() {
                config_files.push(p);
            }
        }

        for path in config_files {
            if let Ok(content) = tokio::fs::read_to_string(&path).await {
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                    let mcp_servers = json
                        .get("mcpServers")
                        .or_else(|| json.get("servers"))
                        .and_then(|v| v.as_object());

                    if let Some(map) = mcp_servers {
                        for (name, def) in map {
                            let id = format!("discovered::{}", name);
                            let transport = if let Some(url) = def.get("url").and_then(|v| v.as_str()) {
                                let headers = def.get("headers").and_then(|h| {
                                    serde_json::from_value::<HashMap<String, String>>(h.clone()).ok()
                                });
                                MCPTransportConfig::SSE {
                                    url: url.to_string(),
                                    headers,
                                }
                            } else if let Some(cmd) = def.get("command").and_then(|v| v.as_str()) {
                                let args = def
                                    .get("args")
                                    .and_then(|a| a.as_array())
                                    .map(|arr| {
                                        arr.iter()
                                            .filter_map(|v| v.as_str().map(|s| s.to_string()))
                                            .collect()
                                    })
                                    .unwrap_or_default();
                                let env = def.get("env").and_then(|e| {
                                    serde_json::from_value::<HashMap<String, String>>(e.clone()).ok()
                                });
                                let cwd = def
                                    .get("cwd")
                                    .and_then(|v| v.as_str())
                                    .map(|s| s.to_string());
                                MCPTransportConfig::Stdio {
                                    command: cmd.to_string(),
                                    args,
                                    env,
                                    cwd,
                                }
                            } else {
                                continue;
                            };

                            let server = MCPServer {
                                id: id.clone(),
                                name: name.clone(),
                                transport,
                                enabled: !def.get("disabled").and_then(|v| v.as_bool()).unwrap_or(false),
                                auto_start: false,
                                status: MCPServerStatus::Disconnected,
                                tools: vec![],
                            };
                            let mut servers = self.servers.write().await;
                            servers.entry(id).or_insert(server);
                        }
                    }
                }
            }
        }
    }

    pub async fn list_servers(&self) -> Vec<MCPServer> {
        self.servers.read().await.values().cloned().collect()
    }

    pub async fn get_server(&self, id: &str) -> Option<MCPServer> {
        self.servers.read().await.get(id).cloned()
    }

    pub async fn add_server(&self, config: MCPServerConfig) -> Result<MCPServer> {
        let server = MCPServer {
            id: config.id.clone(),
            name: config.name.clone(),
            transport: config.transport.clone(),
            enabled: config.enabled,
            auto_start: config.auto_start,
            status: MCPServerStatus::Disconnected,
            tools: vec![],
        };

        self.servers.write().await.insert(config.id.clone(), server.clone());
        self.save_server_to_config(&server).await?;

        Ok(server)
    }

    pub async fn remove_server(&self, id: &str) -> Result<()> {
        let _ = self.disconnect_server(id).await;
        self.servers.write().await.remove(id);
        self.remove_server_from_config(id).await
    }

    pub async fn connect_server(&self, id: &str) -> Result<MCPServer> {
        let mut server = {
            let servers = self.servers.read().await;
            servers
                .get(id)
                .cloned()
                .ok_or_else(|| anyhow::anyhow!("MCP server not found: {}", id))?
        };

        server.status = MCPServerStatus::Connecting;
        self.servers.write().await.insert(id.to_string(), server.clone());

        let result = match &server.transport {
            MCPTransportConfig::Stdio { command, args, env, cwd } => {
                self.connect_stdio(id, command, args, env.as_ref(), cwd.as_deref()).await
            }
            MCPTransportConfig::SSE { url, headers } => {
                self.connect_sse(id, url, headers.as_ref()).await
            }
        };

        match result {
            Ok((transport, tools)) => {
                self.connections.write().await.insert(id.to_string(), transport);
                server.status = MCPServerStatus::Connected;
                server.tools = tools;
            }
            Err(e) => {
                server.status = MCPServerStatus::Error(e.to_string());
            }
        }

        self.servers.write().await.insert(id.to_string(), server.clone());
        Ok(server)
    }

    pub async fn disconnect_server(&self, id: &str) -> Result<MCPServer> {
        if let Some(conn) = self.connections.write().await.remove(id) {
            if let ActiveTransport::Stdio(stdio) = conn {
                let mut child = stdio.child.lock().await;
                let _ = child.kill().await;
            }
        }

        let mut server = {
            let servers = self.servers.read().await;
            servers
                .get(id)
                .cloned()
                .ok_or_else(|| anyhow::anyhow!("MCP server not found: {}", id))?
        };

        server.status = MCPServerStatus::Disconnected;
        server.tools = vec![];
        self.servers.write().await.insert(id.to_string(), server.clone());
        Ok(server)
    }

    pub async fn list_tools(&self, server_id: Option<&str>) -> Vec<MCPTool> {
        let servers = self.servers.read().await;
        match server_id {
            Some(id) => servers.get(id).map(|s| s.tools.clone()).unwrap_or_default(),
            None => servers.values().flat_map(|s| s.tools.clone()).collect(),
        }
    }

    pub async fn call_tool(&self, request: MCPToolCallRequest) -> Result<MCPToolCallResponse> {
        let conn_opt = {
            let conns = self.connections.read().await;
            match conns.get(&request.server_id) {
                Some(ActiveTransport::Stdio(s)) => Some(ActiveTransport::Stdio(s.clone())),
                Some(ActiveTransport::Sse(s)) => Some(ActiveTransport::Sse(s.clone())),
                None => None,
            }
        };

        let Some(conn) = conn_opt else {
            return Ok(MCPToolCallResponse {
                success: false,
                result: None,
                error: Some(format!("MCP server not connected: {}", request.server_id)),
            });
        };

        let params = serde_json::json!({
            "name": request.tool_name,
            "arguments": request.arguments
        });

        let rpc_res = match conn {
            ActiveTransport::Stdio(stdio) => Self::stdio_request(&stdio, "tools/call", params).await,
            ActiveTransport::Sse(sse) => Self::sse_request(&sse, "tools/call", params).await,
        };

        match rpc_res {
            Ok(val) => {
                if let Some(err) = val.get("error") {
                    Ok(MCPToolCallResponse {
                        success: false,
                        result: None,
                        error: Some(err.to_string()),
                    })
                } else {
                    Ok(MCPToolCallResponse {
                        success: true,
                        result: val.get("result").cloned().or(Some(val)),
                        error: None,
                    })
                }
            }
            Err(e) => Ok(MCPToolCallResponse {
                success: false,
                result: None,
                error: Some(e.to_string()),
            }),
        }
    }

    async fn connect_stdio(
        &self,
        server_id: &str,
        command: &str,
        args: &[String],
        env: Option<&HashMap<String, String>>,
        cwd: Option<&str>,
    ) -> Result<(ActiveTransport, Vec<MCPTool>)> {
        let mut cmd = Command::new(command);
        cmd.args(args)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null());

        if let Some(envs) = env {
            for (k, v) in envs {
                cmd.env(k, v);
            }
        }
        if let Some(dir) = cwd {
            cmd.current_dir(dir);
        }

        let mut child = cmd.spawn()?;
        let stdin = child.stdin.take().ok_or_else(|| anyhow::anyhow!("Failed to open stdin"))?;
        let stdout = child.stdout.take().ok_or_else(|| anyhow::anyhow!("Failed to open stdout"))?;

        let pending: Arc<Mutex<HashMap<u64, oneshot::Sender<serde_json::Value>>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let pending_clone = pending.clone();

        tokio::spawn(async move {
            let mut reader = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(&line) {
                    if let Some(id) = val.get("id").and_then(|v| v.as_u64()) {
                        if let Some(tx) = pending_clone.lock().await.remove(&id) {
                            let _ = tx.send(val);
                        }
                    }
                }
            }
            // EOF / child exit: drop all pending senders so waiting callers fail immediately
            pending_clone.lock().await.clear();
        });

        let conn = Arc::new(StdioConnection {
            child: Mutex::new(child),
            stdin: Mutex::new(stdin),
            pending,
            next_id: AtomicU64::new(1),
        });

        // Initialize MCP session
        let init_params = serde_json::json!({
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": { "name": "Antigravity", "version": "0.1.0" }
        });
        Self::stdio_request(&conn, "initialize", init_params).await?;
        Self::stdio_notify(&conn, "notifications/initialized", serde_json::json!({})).await?;

        let tools_resp = Self::stdio_request(&conn, "tools/list", serde_json::json!({})).await?;
        let tools = Self::parse_tools(server_id, &tools_resp);

        Ok((ActiveTransport::Stdio(conn), tools))
    }

    async fn stdio_notify(conn: &StdioConnection, method: &str, params: serde_json::Value) -> Result<()> {
        let msg = serde_json::json!({
            "jsonrpc": "2.0",
            "method": method,
            "params": params
        });
        let mut line = serde_json::to_string(&msg)?;
        line.push('\n');
        let mut stdin = conn.stdin.lock().await;
        stdin.write_all(line.as_bytes()).await?;
        stdin.flush().await?;
        Ok(())
    }

    async fn stdio_request(
        conn: &StdioConnection,
        method: &str,
        params: serde_json::Value,
    ) -> Result<serde_json::Value> {
        let id = conn.next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = oneshot::channel();
        conn.pending.lock().await.insert(id, tx);

        let msg = serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params
        });
        let mut line = serde_json::to_string(&msg)?;
        line.push('\n');
        {
            let mut stdin = conn.stdin.lock().await;
            stdin.write_all(line.as_bytes()).await?;
            stdin.flush().await?;
        }

        let resp = tokio::time::timeout(std::time::Duration::from_secs(15), rx)
            .await
            .map_err(|_| anyhow::anyhow!("MCP stdio request timed out: {}", method))??;
        Ok(resp)
    }

    async fn connect_sse(
        &self,
        server_id: &str,
        url: &str,
        headers: Option<&HashMap<String, String>>,
    ) -> Result<(ActiveTransport, Vec<MCPTool>)> {
        let client = reqwest::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(5))
            .timeout(std::time::Duration::from_secs(15))
            .build()?;

        let hdrs = headers.cloned().unwrap_or_default();
        let pending: Arc<Mutex<HashMap<u64, oneshot::Sender<serde_json::Value>>>> =
            Arc::new(Mutex::new(HashMap::new()));

        // Probe GET on `url` to see if the server provides an MCP SSE `event: endpoint` stream
        let mut resolved_post_url = url.to_string();
        let mut get_req = client.get(url).header("Accept", "text/event-stream");
        for (k, v) in &hdrs {
            get_req = get_req.header(k.as_str(), v.as_str());
        }
        if let Ok(Ok(resp)) = tokio::time::timeout(std::time::Duration::from_secs(2), get_req.send()).await {
            let ct = resp
                .headers()
                .get(reqwest::header::CONTENT_TYPE)
                .and_then(|v| v.to_str().ok())
                .unwrap_or("")
                .to_lowercase();
            if resp.status().is_success() && ct.contains("text/event-stream") {
                use futures_util::StreamExt;
                let mut stream = resp.bytes_stream();
                let (ep_tx, ep_rx) = oneshot::channel::<String>();
                let mut ep_tx_opt = Some(ep_tx);
                let pending_clone = pending.clone();
                let base_url = url.to_string();

                tokio::spawn(async move {
                    let mut buf = String::new();
                    let mut current_event = String::new();
                    while let Some(Ok(chunk)) = stream.next().await {
                        buf.push_str(&String::from_utf8_lossy(&chunk));
                        while let Some(pos) = buf.find('\n') {
                            let line = buf[..pos].trim_end_matches('\r').to_string();
                            buf.drain(..=pos);
                            if line.is_empty() {
                                current_event.clear();
                                continue;
                            }
                            if let Some(ev) = line.strip_prefix("event:") {
                                current_event = ev.trim().to_string();
                            } else if let Some(data) = line.strip_prefix("data:") {
                                let data = data.trim();
                                if current_event == "endpoint" || (ep_tx_opt.is_some() && !data.starts_with('{')) {
                                    if let Some(tx) = ep_tx_opt.take() {
                                        let endpoint_url = if data.starts_with("http://") || data.starts_with("https://") {
                                            data.to_string()
                                        } else if let Ok(parsed_base) = url::Url::parse(&base_url) {
                                            parsed_base.join(data).map(|u| u.to_string()).unwrap_or_else(|_| data.to_string())
                                        } else {
                                            data.to_string()
                                        };
                                        let _ = tx.send(endpoint_url);
                                    }
                                } else if let Ok(val) = serde_json::from_str::<serde_json::Value>(data) {
                                    if let Some(id) = val.get("id").and_then(|v| v.as_u64()) {
                                        if let Some(tx) = pending_clone.lock().await.remove(&id) {
                                            let _ = tx.send(val);
                                        }
                                    }
                                }
                            }
                        }
                    }
                    pending_clone.lock().await.clear();
                });

                if let Ok(Ok(ep)) = tokio::time::timeout(std::time::Duration::from_secs(2), ep_rx).await {
                    resolved_post_url = ep;
                }
            }
        }

        let conn = Arc::new(SseConnection {
            client,
            post_url: resolved_post_url,
            headers: hdrs,
            pending,
            next_id: AtomicU64::new(1),
        });

        let init_params = serde_json::json!({
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": { "name": "Antigravity", "version": "0.1.0" }
        });
        Self::sse_request(&conn, "initialize", init_params).await?;
        let tools_resp = Self::sse_request(&conn, "tools/list", serde_json::json!({})).await?;
        let tools = Self::parse_tools(server_id, &tools_resp);

        Ok((ActiveTransport::Sse(conn), tools))
    }

    async fn sse_request(
        conn: &SseConnection,
        method: &str,
        params: serde_json::Value,
    ) -> Result<serde_json::Value> {
        let id = conn.next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = oneshot::channel();
        conn.pending.lock().await.insert(id, tx);

        let msg = serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params
        });

        let mut req = conn.client.post(&conn.post_url).json(&msg);
        for (k, v) in &conn.headers {
            req = req.header(k.as_str(), v.as_str());
        }
        let resp = match req.send().await {
            Ok(r) => r,
            Err(e) => {
                conn.pending.lock().await.remove(&id);
                return Err(e.into());
            }
        };
        let status = resp.status();
        if !status.is_success() {
            conn.pending.lock().await.remove(&id);
            return Err(anyhow::anyhow!("MCP SSE/HTTP error: {}", status));
        }

        let body_text = resp.text().await.unwrap_or_default();
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(&body_text) {
            if val.get("jsonrpc").is_some() || val.get("result").is_some() || val.get("error").is_some() {
                conn.pending.lock().await.remove(&id);
                return Ok(val);
            }
        }

        // Wait for async response on the SSE stream (e.g. when POST returned 202 Accepted)
        let streamed_val = tokio::time::timeout(std::time::Duration::from_secs(10), rx)
            .await
            .map_err(|_| anyhow::anyhow!("MCP SSE response timed out for {}", method))??;
        Ok(streamed_val)
    }

    fn parse_tools(server_id: &str, resp: &serde_json::Value) -> Vec<MCPTool> {
        let mut out = Vec::new();
        if let Some(tools) = resp
            .get("result")
            .and_then(|r| r.get("tools"))
            .and_then(|t| t.as_array())
        {
            for t in tools {
                if let Some(name) = t.get("name").and_then(|v| v.as_str()) {
                    out.push(MCPTool {
                        name: name.to_string(),
                        description: t
                            .get("description")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string(),
                        input_schema: t
                            .get("inputSchema")
                            .cloned()
                            .unwrap_or_else(|| serde_json::json!({"type": "object", "properties": {}})),
                        server_id: server_id.to_string(),
                    });
                }
            }
        }
        out
    }

    async fn save_server_to_config(&self, server: &MCPServer) -> Result<()> {
        self.config
            .update(|c| {
                if let Some(idx) = c.mcp.servers.iter().position(|s| s.id == server.id) {
                    c.mcp.servers[idx] = self.server_to_config(server);
                } else {
                    c.mcp.servers.push(self.server_to_config(server));
                }
            })
            .await
    }

    async fn remove_server_from_config(&self, id: &str) -> Result<()> {
        self.config
            .update(|c| {
                c.mcp.servers.retain(|s| s.id != id);
            })
            .await
    }

    fn server_to_config(&self, server: &MCPServer) -> MCPServerConfig {
        MCPServerConfig {
            id: server.id.clone(),
            name: server.name.clone(),
            transport: server.transport.clone(),
            enabled: server.enabled,
            auto_start: server.auto_start,
        }
    }
}
