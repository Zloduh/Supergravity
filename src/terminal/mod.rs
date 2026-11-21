//! Terminal Management for Antigravity
//!
//! Manages pseudo-terminals (PTY) for the integrated terminal drawer.

use std::collections::HashMap;
use std::os::unix::io::{FromRawFd, RawFd};
use std::sync::Arc;
use anyhow::Result;
use serde::{Deserialize, Serialize};
use tauri::Emitter;
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::config::ConfigManager;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Terminal {
    pub id: String,
    #[serde(default)]
    pub pid: Option<u32>,
    pub shell: String,
    pub args: Vec<String>,
    pub cwd: Option<String>,
    pub cols: u16,
    pub rows: u16,
    pub status: TerminalStatus,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub last_activity: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TerminalStatus {
    Starting,
    Running,
    Exited(i32),
    Closed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpawnTerminalRequest {
    pub shell: Option<String>,
    pub args: Option<Vec<String>>,
    pub cwd: Option<String>,
    pub cols: Option<u16>,
    pub rows: Option<u16>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WriteTerminalRequest {
    pub terminal_id: String,
    pub data: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResizeTerminalRequest {
    pub terminal_id: String,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalOutput {
    pub terminal_id: String,
    pub data: String,
    pub exit_code: Option<i32>,
}

struct TerminalSessionControl {
    tx: tokio::sync::mpsc::UnboundedSender<String>,
    master_fd: Option<RawFd>,
    pid: Option<u32>,
}

pub struct TerminalManager {
    terminals: Arc<RwLock<HashMap<String, Terminal>>>,
    config: Arc<ConfigManager>,
    sessions: Arc<RwLock<HashMap<String, TerminalSessionControl>>>,
    output_history: Arc<RwLock<HashMap<String, String>>>,
    app_handle: Arc<RwLock<Option<tauri::AppHandle>>>,
}

impl TerminalManager {
    pub async fn new(config: Arc<ConfigManager>) -> Result<Arc<Self>> {
        Ok(Arc::new(Self {
            terminals: Arc::new(RwLock::new(HashMap::new())),
            config,
            sessions: Arc::new(RwLock::new(HashMap::new())),
            output_history: Arc::new(RwLock::new(HashMap::new())),
            app_handle: Arc::new(RwLock::new(None)),
        }))
    }

    pub fn set_app_handle(&self, handle: tauri::AppHandle) {
        if let Ok(mut guard) = self.app_handle.try_write() {
            *guard = Some(handle);
        }
    }

    pub async fn spawn_terminal(&self, request: SpawnTerminalRequest) -> Result<Terminal> {
        let terminal_config = self.config.get_terminal_config().await;

        let shell = request
            .shell
            .filter(|s| !s.trim().is_empty())
            .or_else(|| terminal_config.shell.clone().filter(|s| !s.trim().is_empty()))
            .unwrap_or_else(|| {
                if cfg!(windows) {
                    "powershell.exe".to_string()
                } else {
                    std::env::var("SHELL")
                        .ok()
                        .filter(|s| !s.trim().is_empty())
                        .unwrap_or_else(|| "/bin/sh".to_string())
                }
            });

        let args = request.args.unwrap_or_else(|| terminal_config.args.clone());
        let cwd = request
            .cwd
            .filter(|s| !s.trim().is_empty())
            .or_else(|| terminal_config.cwd.clone().filter(|s| !s.trim().is_empty()));
        let cols = request.cols.unwrap_or(terminal_config.cols).max(1);
        let rows = request.rows.unwrap_or(terminal_config.rows).max(1);
        let env_vars = terminal_config.env.clone();

        let id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now();

        let (tx, rx) = tokio::sync::mpsc::unbounded_channel::<String>();

        let (child, master_fd, slave_fd) = Self::spawn_process(&shell, &args, cwd.as_deref(), cols, rows, &env_vars)?;
        let pid = child.id();

        let terminal = Terminal {
            id: id.clone(),
            pid,
            shell: shell.clone(),
            args: args.clone(),
            cwd: cwd.clone(),
            cols,
            rows,
            status: TerminalStatus::Running,
            created_at: now,
            last_activity: now,
        };

        self.terminals.write().await.insert(id.clone(), terminal.clone());
        self.sessions.write().await.insert(
            id.clone(),
            TerminalSessionControl {
                tx,
                master_fd,
                pid,
            },
        );
        self.output_history.write().await.insert(id.clone(), String::new());

        let inner = self.clone_inner();
        inner.emit_terminal_status(&id, TerminalStatus::Running).await;

        let terminal_id = id.clone();
        tokio::spawn(async move {
            inner
                .run_terminal_io(terminal_id, child, master_fd, slave_fd, rx)
                .await;
        });

        Ok(terminal)
    }

    fn spawn_process(
        shell: &str,
        args: &[String],
        cwd: Option<&str>,
        cols: u16,
        rows: u16,
        env_vars: &HashMap<String, String>,
    ) -> Result<(tokio::process::Child, Option<RawFd>, Option<RawFd>)> {
        let mut command = tokio::process::Command::new(shell);
        command.args(args);

        if let Some(dir) = cwd {
            let p = std::path::Path::new(dir);
            if p.is_dir() {
                command.current_dir(p);
            }
        }

        command.env("TERM", "xterm-256color");
        command.env("COLORTERM", "truecolor");
        for (k, v) in env_vars {
            command.env(k, v);
        }

        // Attempt real Unix PTY creation first
        if let Some((master, slave)) = Self::open_unix_pty(cols, rows) {
            unsafe {
                let slave_in = libc::dup(slave);
                let slave_out = libc::dup(slave);
                let slave_err = libc::dup(slave);
                if slave_in >= 0 && slave_out >= 0 && slave_err >= 0 {
                    command.stdin(std::process::Stdio::from_raw_fd(slave_in));
                    command.stdout(std::process::Stdio::from_raw_fd(slave_out));
                    command.stderr(std::process::Stdio::from_raw_fd(slave_err));
                    command.pre_exec(move || {
                        libc::setsid();
                        libc::ioctl(0, libc::TIOCSCTTY as _, 0);
                        Ok(())
                    });

                    match command.spawn() {
                        Ok(child) => {
                            libc::close(slave);
                            return Ok((child, Some(master), None));
                        }
                        Err(e) => {
                            libc::close(master);
                            libc::close(slave);
                            return Err(e.into());
                        }
                    }
                } else {
                    if slave_in >= 0 {
                        libc::close(slave_in);
                    }
                    if slave_out >= 0 {
                        libc::close(slave_out);
                    }
                    if slave_err >= 0 {
                        libc::close(slave_err);
                    }
                    libc::close(master);
                    libc::close(slave);
                }
            }
        }

        // Fallback to standard pipes if PTY allocation is unavailable
        command.stdin(std::process::Stdio::piped());
        command.stdout(std::process::Stdio::piped());
        command.stderr(std::process::Stdio::piped());
        let child = command.spawn()?;
        Ok((child, None, None))
    }

    fn open_unix_pty(cols: u16, rows: u16) -> Option<(RawFd, RawFd)> {
        unsafe {
            let mut master: libc::c_int = -1;
            let mut slave: libc::c_int = -1;
            let ws = libc::winsize {
                ws_row: rows.max(1),
                ws_col: cols.max(1),
                ws_xpixel: 0,
                ws_ypixel: 0,
            };
            let rc = libc::openpty(
                &mut master,
                &mut slave,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                &ws,
            );
            if rc == 0 && master >= 0 && slave >= 0 {
                // Set non-blocking mode on master fd works cleanly with async / spawn_blocking
                let flags = libc::fcntl(master, libc::F_GETFD);
                if flags >= 0 {
                    libc::fcntl(master, libc::F_SETFD, flags | libc::FD_CLOEXEC);
                }
                let sflags = libc::fcntl(slave, libc::F_GETFD);
                if sflags >= 0 {
                    libc::fcntl(slave, libc::F_SETFD, sflags | libc::FD_CLOEXEC);
                }
                Some((master, slave))
            } else {
                None
            }
        }
    }

    pub async fn write_terminal(&self, request: WriteTerminalRequest) -> Result<()> {
        let sessions = self.sessions.read().await;
        if let Some(session) = sessions.get(&request.terminal_id) {
            session
                .tx
                .send(request.data.clone())
                .map_err(|e| anyhow::anyhow!("Failed to write to terminal: {}", e))?;
        } else {
            return Err(anyhow::anyhow!("Terminal not found: {}", request.terminal_id));
        }
        drop(sessions);

        let mut terminals = self.terminals.write().await;
        if let Some(t) = terminals.get_mut(&request.terminal_id) {
            t.last_activity = chrono::Utc::now();
        }

        Ok(())
    }

    pub async fn resize_terminal(&self, request: ResizeTerminalRequest) -> Result<()> {
        let cols = request.cols.max(1);
        let rows = request.rows.max(1);

        let master_fd = {
            let sessions = self.sessions.read().await;
            sessions.get(&request.terminal_id).and_then(|s| s.master_fd)
        };

        let mut terminals = self.terminals.write().await;
        if let Some(t) = terminals.get_mut(&request.terminal_id) {
            t.cols = cols;
            t.rows = rows;
            t.last_activity = chrono::Utc::now();
        } else {
            return Err(anyhow::anyhow!("Terminal not found: {}", request.terminal_id));
        }
        drop(terminals);

        if let Some(fd) = master_fd {
            unsafe {
                let ws = libc::winsize {
                    ws_row: rows,
                    ws_col: cols,
                    ws_xpixel: 0,
                    ws_ypixel: 0,
                };
                libc::ioctl(fd, libc::TIOCSWINSZ as _, &ws);
            }
        }

        Ok(())
    }

    pub async fn kill_terminal(&self, terminal_id: &str) -> Result<()> {
        let session = self.sessions.write().await.remove(terminal_id);
        let existed_in_terminals = {
            let mut terminals = self.terminals.write().await;
            if let Some(t) = terminals.get_mut(terminal_id) {
                t.status = TerminalStatus::Closed;
                t.last_activity = chrono::Utc::now();
                true
            } else {
                false
            }
        };

        if session.is_none() && !existed_in_terminals {
            return Err(anyhow::anyhow!("Terminal not found: {}", terminal_id));
        }

        if let Some(sess) = session {
            if let Some(pid) = sess.pid {
                unsafe {
                    // Signal both process group and direct pid
                    libc::kill(-(pid as i32), libc::SIGTERM);
                    libc::kill(pid as i32, libc::SIGTERM);
                    libc::kill(-(pid as i32), libc::SIGKILL);
                    libc::kill(pid as i32, libc::SIGKILL);
                }
            }
        }

        self.clone_inner()
            .emit_terminal_status(terminal_id, TerminalStatus::Closed)
            .await;

        Ok(())
    }

    pub async fn list_terminals(&self) -> Vec<Terminal> {
        let mut list: Vec<Terminal> = self.terminals.read().await.values().cloned().collect();
        list.sort_by(|a, b| a.created_at.cmp(&b.created_at));
        list
    }

    pub async fn get_terminal(&self, terminal_id: &str) -> Option<Terminal> {
        self.terminals.read().await.get(terminal_id).cloned()
    }

    pub async fn get_output(&self, terminal_id: &str) -> Option<String> {
        self.output_history.read().await.get(terminal_id).cloned()
    }

    pub async fn send_output(&self, terminal_id: &str, data: &str) -> Result<()> {
        self.clone_inner().emit_terminal_output(terminal_id, data).await
    }

    fn clone_inner(&self) -> TerminalManagerInner {
        TerminalManagerInner {
            terminals: Arc::clone(&self.terminals),
            sessions: Arc::clone(&self.sessions),
            output_history: Arc::clone(&self.output_history),
            app_handle: Arc::clone(&self.app_handle),
        }
    }
}

#[derive(Clone)]
struct TerminalManagerInner {
    terminals: Arc<RwLock<HashMap<String, Terminal>>>,
    sessions: Arc<RwLock<HashMap<String, TerminalSessionControl>>>,
    output_history: Arc<RwLock<HashMap<String, String>>>,
    app_handle: Arc<RwLock<Option<tauri::AppHandle>>>,
}

impl TerminalManagerInner {
    async fn run_terminal_io(
        &self,
        terminal_id: String,
        mut child: tokio::process::Child,
        master_fd: Option<RawFd>,
        _slave_fd: Option<RawFd>,
        mut rx: tokio::sync::mpsc::UnboundedReceiver<String>,
    ) {
        if let Some(fd) = master_fd {
            let read_fd = unsafe { libc::dup(fd) };
            let write_fd = fd;

            if read_fd >= 0 {
                let manager_clone = self.clone();
                let tid = terminal_id.clone();
                tokio::spawn(async move {
                    loop {
                        let chunk = tokio::task::spawn_blocking(move || {
                            let mut buf = [0u8; 4096];
                            let n = unsafe {
                                libc::read(read_fd, buf.as_mut_ptr() as *mut libc::c_void, buf.len())
                            };
                            if n > 0 {
                                Some(buf[..(n as usize)].to_vec())
                            } else {
                                None
                            }
                        })
                        .await
                        .ok()
                        .flatten();

                        match chunk {
                            Some(bytes) => {
                                let data = String::from_utf8_lossy(&bytes).to_string();
                                let _ = manager_clone.emit_terminal_output(&tid, &data).await;
                            }
                            None => break,
                        }
                    }
                    unsafe {
                        libc::close(read_fd);
                    }
                });
            }

            tokio::spawn(async move {
                while let Some(data) = rx.recv().await {
                    let bytes = data.into_bytes();
                    let ok = tokio::task::spawn_blocking(move || {
                        let mut offset = 0;
                        while offset < bytes.len() {
                            let written = unsafe {
                                libc::write(
                                    write_fd,
                                    bytes[offset..].as_ptr() as *const libc::c_void,
                                    bytes.len() - offset,
                                )
                            };
                            if written <= 0 {
                                return false;
                            }
                            offset += written as usize;
                        }
                        true
                    })
                    .await
                    .unwrap_or(false);
                    if !ok {
                        break;
                    }
                }
            });
        } else {
            if let Some(mut stdout) = child.stdout.take() {
                let tid = terminal_id.clone();
                let manager_clone = self.clone();
                tokio::spawn(async move {
                    use tokio::io::AsyncReadExt;
                    let mut buffer = [0u8; 4096];
                    loop {
                        match stdout.read(&mut buffer).await {
                            Ok(0) => break,
                            Ok(n) => {
                                let data = String::from_utf8_lossy(&buffer[..n]).to_string();
                                let _ = manager_clone.emit_terminal_output(&tid, &data).await;
                            }
                            Err(_) => break,
                        }
                    }
                });
            }

            if let Some(mut stderr) = child.stderr.take() {
                let tid = terminal_id.clone();
                let manager_clone = self.clone();
                tokio::spawn(async move {
                    use tokio::io::AsyncReadExt;
                    let mut buffer = [0u8; 4096];
                    loop {
                        match stderr.read(&mut buffer).await {
                            Ok(0) => break,
                            Ok(n) => {
                                let data = String::from_utf8_lossy(&buffer[..n]).to_string();
                                let _ = manager_clone.emit_terminal_output(&tid, &data).await;
                            }
                            Err(_) => break,
                        }
                    }
                });
            }

            if let Some(mut stdin) = child.stdin.take() {
                tokio::spawn(async move {
                    use tokio::io::AsyncWriteExt;
                    while let Some(data) = rx.recv().await {
                        if stdin.write_all(data.as_bytes()).await.is_err() {
                            break;
                        }
                        let _ = stdin.flush().await;
                    }
                });
            }
        }

        let exit_code = match child.wait().await {
            Ok(status) => status.code().unwrap_or(0),
            Err(_) => -1,
        };

        let removed_session = self.sessions.write().await.remove(&terminal_id);
        if let Some(sess) = removed_session {
            if let Some(fd) = sess.master_fd {
                unsafe {
                    libc::close(fd);
                }
            }
        }

        let final_status = {
            let mut terminals = self.terminals.write().await;
            if let Some(t) = terminals.get_mut(&terminal_id) {
                if t.status != TerminalStatus::Closed {
                    t.status = TerminalStatus::Exited(exit_code);
                }
                t.last_activity = chrono::Utc::now();
                Some(t.status.clone())
            } else {
                None
            }
        };

        if let Some(st) = final_status {
            self.emit_terminal_status(&terminal_id, st).await;
        }
    }

    async fn emit_terminal_output(&self, terminal_id: &str, data: &str) -> Result<()> {
        {
            let mut terminals = self.terminals.write().await;
            if let Some(t) = terminals.get_mut(terminal_id) {
                t.last_activity = chrono::Utc::now();
            }
        }
        {
            let mut hist = self.output_history.write().await;
            let entry = hist.entry(terminal_id.to_string()).or_default();
            entry.push_str(data);
            if entry.len() > 250_000 {
                let drain_len = entry.len() - 250_000;
                entry.drain(..drain_len);
            }
        }

        if let Some(handle) = self.app_handle.read().await.as_ref() {
            let _ = handle.emit(
                "terminal-output",
                serde_json::json!({
                    "terminal_id": terminal_id,
                    "data": data,
                }),
            );
        }

        Ok(())
    }

    async fn emit_terminal_status(&self, terminal_id: &str, status: TerminalStatus) {
        if let Some(handle) = self.app_handle.read().await.as_ref() {
            let _ = handle.emit(
                "terminal-status",
                serde_json::json!({
                    "terminal_id": terminal_id,
                    "status": status,
                }),
            );
        }
    }
}
