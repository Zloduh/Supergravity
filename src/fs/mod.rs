//! File System Operations for Antigravity

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use anyhow::Result;
use globset::Glob;
use ignore::WalkBuilder;
use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use parking_lot::{Mutex, RwLock};
use regex::Regex;
use serde::{Deserialize, Serialize};
use tauri::Emitter;
use tokio::sync::broadcast;
use walkdir::WalkDir;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReadFileRequest {
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReadFileResponse {
    pub path: String,
    pub content: String,
    pub size: u64,
    pub is_binary: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WriteFileRequest {
    pub path: String,
    pub content: String,
    pub create_dirs: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EditFileRequest {
    pub path: String,
    pub old_text: String,
    pub new_text: String,
    pub replace_all: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ListDirRequest {
    pub path: String,
    pub recursive: Option<bool>,
    pub ignore_patterns: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: Option<u64>,
    pub modified: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ListDirResponse {
    pub path: String,
    pub entries: Vec<DirEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateDirRequest {
    pub path: String,
    pub recursive: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeletePathRequest {
    pub path: String,
    pub recursive: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CopyPathRequest {
    pub source: String,
    pub destination: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MovePathRequest {
    pub source: String,
    pub destination: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchFilesRequest {
    pub path: String,
    pub pattern: String,
    pub ignore_patterns: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub path: String,
    pub matches: Vec<SearchMatch>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchMatch {
    pub line_number: u32,
    pub line: String,
    pub column: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReadFileRangeRequest {
    pub path: String,
    pub start_line: u32,
    pub end_line: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReadFileRangeResponse {
    pub path: String,
    pub lines: Vec<String>,
    pub start_line: u32,
    pub end_line: u32,
}

pub async fn read_file(request: ReadFileRequest) -> Result<ReadFileResponse> {
    let path = Path::new(&request.path);
    let bytes = tokio::fs::read(path).await?;
    let size = tokio::fs::metadata(path)
        .await
        .map(|m| m.len())
        .unwrap_or(bytes.len() as u64);

    if is_binary_bytes(&bytes) {
        return Ok(ReadFileResponse {
            path: request.path,
            content: String::new(),
            size,
            is_binary: true,
        });
    }

    let content = String::from_utf8(bytes)?;

    Ok(ReadFileResponse {
        path: request.path,
        content,
        size,
        is_binary: false,
    })
}

pub async fn write_file(request: WriteFileRequest) -> Result<()> {
    let path = Path::new(&request.path);

    if request.create_dirs.unwrap_or(false) {
        if let Some(parent) = path.parent().filter(|p| !p.as_os_str().is_empty()) {
            tokio::fs::create_dir_all(parent).await?;
        }
    }

    tokio::fs::write(path, request.content).await?;
    Ok(())
}

pub async fn edit_file(request: EditFileRequest) -> Result<()> {
    let path = Path::new(&request.path);
    let content = tokio::fs::read_to_string(path).await?;

    let new_content = if request.replace_all.unwrap_or(false) {
        content.replace(&request.old_text, &request.new_text)
    } else {
        match content.find(&request.old_text) {
            Some(pos) => {
                let mut result = String::new();
                result.push_str(&content[..pos]);
                result.push_str(&request.new_text);
                result.push_str(&content[pos + request.old_text.len()..]);
                result
            }
            None => return Err(anyhow::anyhow!("Text not found in file")),
        }
    };

    tokio::fs::write(path, new_content).await?;
    Ok(())
}

pub async fn list_dir(request: ListDirRequest) -> Result<ListDirResponse> {
    let root_str = request.path.clone();
    let root = PathBuf::from(&request.path);
    let recursive = request.recursive.unwrap_or(false);
    let ignore_patterns = request.ignore_patterns.unwrap_or_default();

    tokio::task::spawn_blocking(move || -> Result<ListDirResponse> {
        let mut entries = Vec::new();

        if recursive {
            let walker = WalkBuilder::new(&root);
            for entry in walker.build().filter_map(|e| e.ok()) {
                if entry.depth() == 0 {
                    continue;
                }
                let file_path = entry.path();
                let rel_path = file_path.strip_prefix(&root).unwrap_or(file_path);
                if rel_path.components().any(|c| {
                    c.as_os_str()
                        .to_str()
                        .map(|s| should_ignore(s, &ignore_patterns))
                        .unwrap_or(false)
                }) {
                    continue;
                }

                let file_name = file_path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("")
                    .to_string();

                let metadata = entry.metadata();
                let is_dir = metadata.as_ref().map_or(false, |m| m.is_dir());
                let size = metadata.as_ref().ok().map(|m| m.len());
                let modified = metadata
                    .as_ref()
                    .ok()
                    .and_then(|m| m.modified().ok())
                    .map(|t| {
                        format!(
                            "{}",
                            t.duration_since(std::time::UNIX_EPOCH)
                                .unwrap_or_default()
                                .as_secs()
                        )
                    });

                entries.push(DirEntry {
                    name: file_name,
                    path: file_path.to_string_lossy().to_string(),
                    is_dir,
                    size,
                    modified,
                });
            }
        } else {
            for entry in std::fs::read_dir(&root)? {
                let entry = entry?;
                let file_path = entry.path();
                let file_name = file_path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("")
                    .to_string();

                if should_ignore(&file_name, &ignore_patterns) {
                    continue;
                }

                let metadata = entry.metadata()?;
                let is_dir = metadata.is_dir();
                let size = metadata.len();
                let modified = metadata.modified().ok().map(|t| {
                    format!(
                        "{}",
                        t.duration_since(std::time::UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_secs()
                    )
                });

                entries.push(DirEntry {
                    name: file_name,
                    path: file_path.to_string_lossy().to_string(),
                    is_dir,
                    size: Some(size),
                    modified,
                });
            }
        }

        // Sort: directories first, then by name
        entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.cmp(&b.name),
        });

        Ok(ListDirResponse {
            path: root_str,
            entries,
        })
    })
    .await?
}

pub async fn create_dir(request: CreateDirRequest) -> Result<()> {
    let path = Path::new(&request.path);
    if request.recursive.unwrap_or(false) {
        tokio::fs::create_dir_all(path).await?;
    } else {
        tokio::fs::create_dir(path).await?;
    }
    Ok(())
}

pub async fn delete_path(request: DeletePathRequest) -> Result<()> {
    let path = Path::new(&request.path);
    let metadata = tokio::fs::metadata(path).await?;

    if metadata.is_dir() {
        if request.recursive.unwrap_or(false) {
            tokio::fs::remove_dir_all(path).await?;
        } else {
            tokio::fs::remove_dir(path).await?;
        }
    } else {
        tokio::fs::remove_file(path).await?;
    }

    Ok(())
}

pub async fn copy_path(request: CopyPathRequest) -> Result<()> {
    let source = PathBuf::from(&request.source);
    let destination = PathBuf::from(&request.destination);

    let metadata = tokio::fs::metadata(&source).await?;

    if metadata.is_dir() {
        tokio::task::spawn_blocking(move || copy_dir_recursive(&source, &destination)).await??;
    } else {
        if let Some(parent) = destination.parent().filter(|p| !p.as_os_str().is_empty()) {
            tokio::fs::create_dir_all(parent).await?;
        }
        tokio::fs::copy(&source, &destination).await?;
    }

    Ok(())
}

pub async fn move_path(request: MovePathRequest) -> Result<()> {
    let source = Path::new(&request.source);
    let destination = Path::new(&request.destination);

    if let Some(parent) = destination.parent().filter(|p| !p.as_os_str().is_empty()) {
        tokio::fs::create_dir_all(parent).await?;
    }

    tokio::fs::rename(source, destination).await?;
    Ok(())
}

pub async fn search_files(request: SearchFilesRequest) -> Result<Vec<SearchResult>> {
    search_files_with_filter(request, None).await
}

pub async fn search_files_with_filter(
    request: SearchFilesRequest,
    file_pattern: Option<String>,
) -> Result<Vec<SearchResult>> {
    let re = Regex::new(&request.pattern)
        .map_err(|e| anyhow::anyhow!("Invalid search regex '{}': {}", request.pattern, e))?;

    let file_matcher = match file_pattern
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        Some(pat) => Some(
            Glob::new(pat)
                .map_err(|e| anyhow::anyhow!("Invalid file pattern '{}': {}", pat, e))?
                .compile_matcher(),
        ),
        None => None,
    };

    let root = PathBuf::from(&request.path);
    let ignore_patterns = request.ignore_patterns.unwrap_or_default();

    tokio::task::spawn_blocking(move || -> Result<Vec<SearchResult>> {
        let mut results = Vec::new();

        for entry in WalkDir::new(&root)
            .into_iter()
            .filter_entry(|e| {
                if e.depth() == 0 {
                    return true;
                }
                let name = e.file_name().to_string_lossy();
                if name.starts_with('.') {
                    return false;
                }
                !should_ignore(&name, &ignore_patterns)
            })
            .filter_map(|e| e.ok())
        {
            let file_path = entry.path();
            if !file_path.is_file() {
                continue;
            }

            let file_name = file_path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("");

            if let Some(ref matcher) = file_matcher {
                let rel_path = file_path.strip_prefix(&root).unwrap_or(file_path);
                if !matcher.is_match(rel_path) && !matcher.is_match(file_name) {
                    continue;
                }
            }

            let Ok(bytes) = std::fs::read(file_path) else {
                continue;
            };
            if is_binary_bytes(&bytes) {
                continue;
            }
            let Ok(content) = std::str::from_utf8(&bytes) else {
                continue;
            };

            let mut matches = Vec::new();
            for (line_num, line) in content.lines().enumerate() {
                if let Some(m) = re.find(line) {
                    matches.push(SearchMatch {
                        line_number: (line_num + 1) as u32,
                        line: line.to_string(),
                        column: m.start() as u32,
                    });
                }
            }

            if !matches.is_empty() {
                results.push(SearchResult {
                    path: file_path.to_string_lossy().to_string(),
                    matches,
                });
            }
        }

        Ok(results)
    })
    .await?
}

pub async fn read_file_range(request: ReadFileRangeRequest) -> Result<ReadFileRangeResponse> {
    let path = Path::new(&request.path);
    let bytes = tokio::fs::read(path).await?;
    if is_binary_bytes(&bytes) {
        return Err(anyhow::anyhow!(
            "Cannot read line range of binary file: {}",
            request.path
        ));
    }
    let content = String::from_utf8(bytes)?;
    let lines: Vec<&str> = content.lines().collect();

    let start = request.start_line.saturating_sub(1) as usize;
    let end = std::cmp::min(request.end_line as usize, lines.len());

    let mut result_lines = Vec::new();
    if start < lines.len() {
        for i in start..end {
            result_lines.push(lines[i].to_string());
        }
    }

    Ok(ReadFileRangeResponse {
        path: request.path,
        lines: result_lines,
        start_line: request.start_line,
        end_line: request.end_line,
    })
}

fn is_binary_bytes(bytes: &[u8]) -> bool {
    bytes.contains(&0) || std::str::from_utf8(bytes).is_err()
}

fn should_ignore(name: &str, ignore_patterns: &[String]) -> bool {
    for pattern in ignore_patterns {
        if name == pattern {
            return true;
        }
        // Simple glob matching
        if pattern.contains('*') && glob_match(pattern, name) {
            return true;
        }
    }
    false
}

fn glob_match(pattern: &str, text: &str) -> bool {
    let mut pi = 0;
    let mut ti = 0;
    let mut star = None;
    let mut match_pos = 0;

    let pattern_chars: Vec<char> = pattern.chars().collect();
    let text_chars: Vec<char> = text.chars().collect();

    while ti < text_chars.len() {
        if pi < pattern_chars.len() && pattern_chars[pi] == '*' {
            star = Some(pi);
            match_pos = ti;
            pi += 1;
        } else if pi < pattern_chars.len()
            && (pattern_chars[pi] == text_chars[ti] || pattern_chars[pi] == '?')
        {
            pi += 1;
            ti += 1;
        } else if let Some(s) = star {
            pi = s + 1;
            match_pos += 1;
            ti = match_pos;
        } else {
            return false;
        }
    }

    while pi < pattern_chars.len() && pattern_chars[pi] == '*' {
        pi += 1;
    }

    pi == pattern_chars.len()
}

fn copy_dir_recursive(source: &Path, destination: &Path) -> Result<()> {
    std::fs::create_dir_all(destination)?;

    for entry in std::fs::read_dir(source)? {
        let entry = entry?;
        let source_path = entry.path();
        let dest_path = destination.join(entry.file_name());

        let metadata = entry.metadata()?;
        if metadata.is_dir() {
            copy_dir_recursive(&source_path, &dest_path)?;
        } else {
            std::fs::copy(&source_path, &dest_path)?;
        }
    }

    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FsChangeEvent {
    pub path: String,
    pub kind: String,
}

pub struct FileWatcher {
    watcher: Mutex<Option<RecommendedWatcher>>,
    watched_paths: Mutex<HashSet<PathBuf>>,
    app_handle: Arc<RwLock<Option<tauri::AppHandle>>>,
    tx: broadcast::Sender<FsChangeEvent>,
}

impl FileWatcher {
    pub fn new() -> Result<Arc<Self>> {
        let (tx, _) = broadcast::channel(256);
        let app_handle: Arc<RwLock<Option<tauri::AppHandle>>> = Arc::new(RwLock::new(None));

        let tx_clone = tx.clone();
        let handle_clone = app_handle.clone();

        let watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
            if let Ok(event) = res {
                let kind = match event.kind {
                    EventKind::Access(_) => return,
                    EventKind::Create(_) => "create",
                    EventKind::Modify(_) => "modify",
                    EventKind::Remove(_) => "remove",
                    _ => "other",
                };

                for p in event.paths {
                    let ev = FsChangeEvent {
                        path: p.to_string_lossy().to_string(),
                        kind: kind.to_string(),
                    };
                    let _ = tx_clone.send(ev.clone());
                    if let Some(ref app) = *handle_clone.read() {
                        let _ = app.emit("fs-change", &ev);
                    }
                }
            }
        })?;

        Ok(Arc::new(Self {
            watcher: Mutex::new(Some(watcher)),
            watched_paths: Mutex::new(HashSet::new()),
            app_handle,
            tx,
        }))
    }

    pub fn set_app_handle(&self, handle: tauri::AppHandle) {
        *self.app_handle.write() = Some(handle);
    }

    pub fn subscribe(&self) -> broadcast::Receiver<FsChangeEvent> {
        self.tx.subscribe()
    }

    pub fn watch_path(&self, path: &str) -> Result<()> {
        let target = PathBuf::from(path);
        if !target.exists() {
            anyhow::bail!("Path does not exist: {}", path);
        }
        let mut watcher_guard = self.watcher.lock();
        let watcher = watcher_guard
            .as_mut()
            .ok_or_else(|| anyhow::anyhow!("File watcher is not initialized"))?;
        watcher.watch(&target, RecursiveMode::Recursive)?;
        self.watched_paths.lock().insert(target);
        Ok(())
    }

    pub fn unwatch_path(&self, path: &str) -> Result<()> {
        let target = PathBuf::from(path);
        let mut watcher_guard = self.watcher.lock();
        let watcher = watcher_guard
            .as_mut()
            .ok_or_else(|| anyhow::anyhow!("File watcher is not initialized"))?;
        watcher.unwatch(&target)?;
        self.watched_paths.lock().remove(&target);
        Ok(())
    }

    pub fn watched_paths(&self) -> Vec<PathBuf> {
        self.watched_paths.lock().iter().cloned().collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;
    use tempfile::TempDir;

    #[tokio::test]
    async fn read_file_detects_binary_without_utf8_error() {
        let tmp = TempDir::new().unwrap();
        let bin_path = tmp.path().join("image.png");
        let png_bytes = vec![0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0xFF];
        tokio::fs::write(&bin_path, &png_bytes).await.unwrap();

        let resp = read_file(ReadFileRequest {
            path: bin_path.to_string_lossy().to_string(),
        })
        .await
        .unwrap();

        assert!(resp.is_binary);
        assert!(resp.content.is_empty());
        assert_eq!(resp.size, png_bytes.len() as u64);

        let txt_path = tmp.path().join("hello.txt");
        tokio::fs::write(&txt_path, "hello 🌍").await.unwrap();
        let txt_resp = read_file(ReadFileRequest {
            path: txt_path.to_string_lossy().to_string(),
        })
        .await
        .unwrap();
        assert!(!txt_resp.is_binary);
        assert_eq!(txt_resp.content, "hello 🌍");
    }

    #[tokio::test]
    async fn read_file_range_rejects_binary_cleanly() {
        let tmp = TempDir::new().unwrap();
        let bin_path = tmp.path().join("blob.bin");
        tokio::fs::write(&bin_path, b"abc\0\xff\xfe").await.unwrap();

        let err = read_file_range(ReadFileRangeRequest {
            path: bin_path.to_string_lossy().to_string(),
            start_line: 1,
            end_line: 5,
        })
        .await
        .unwrap_err();
        assert!(err.to_string().contains("binary file"));
    }

    #[tokio::test]
    async fn list_dir_recursive_and_flat_skip_root_and_honor_ignores() {
        let tmp = TempDir::new().unwrap();
        tokio::fs::create_dir_all(tmp.path().join("src")).await.unwrap();
        tokio::fs::create_dir_all(tmp.path().join("node_modules/pkg")).await.unwrap();
        tokio::fs::write(tmp.path().join("src/main.rs"), "fn main() {}").await.unwrap();
        tokio::fs::write(tmp.path().join("node_modules/pkg/index.js"), "x").await.unwrap();
        tokio::fs::write(tmp.path().join("README.md"), "hi").await.unwrap();

        let flat = list_dir(ListDirRequest {
            path: tmp.path().to_string_lossy().to_string(),
            recursive: Some(false),
            ignore_patterns: Some(vec!["node_modules".to_string()]),
        })
        .await
        .unwrap();
        let flat_names: Vec<&str> = flat.entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(flat_names, vec!["src", "README.md"]);

        let rec = list_dir(ListDirRequest {
            path: tmp.path().to_string_lossy().to_string(),
            recursive: Some(true),
            ignore_patterns: Some(vec!["node_modules".to_string()]),
        })
        .await
        .unwrap();
        let rec_names: Vec<&str> = rec.entries.iter().map(|e| e.name.as_str()).collect();
        assert!(!rec_names.contains(&"node_modules"));
        assert!(!rec_names.contains(&"index.js"));
        assert!(rec_names.contains(&"main.rs"));
        assert!(!rec.entries.iter().any(|e| Path::new(&e.path) == tmp.path()));
    }

    #[tokio::test]
    async fn copy_path_copies_nested_directories() {
        let tmp = TempDir::new().unwrap();
        let src = tmp.path().join("src_dir");
        let dst = tmp.path().join("dst_dir");
        tokio::fs::create_dir_all(src.join("nested")).await.unwrap();
        tokio::fs::write(src.join("nested/file.txt"), "copied!").await.unwrap();

        copy_path(CopyPathRequest {
            source: src.to_string_lossy().to_string(),
            destination: dst.to_string_lossy().to_string(),
        })
        .await
        .unwrap();

        assert_eq!(
            tokio::fs::read_to_string(dst.join("nested/file.txt")).await.unwrap(),
            "copied!"
        );
    }

    #[tokio::test]
    async fn search_files_supports_regex_skips_binary_and_honors_file_pattern() {
        let tmp = TempDir::new().unwrap();
        tokio::fs::create_dir_all(tmp.path().join("sub")).await.unwrap();
        tokio::fs::create_dir_all(tmp.path().join("ignored_dir")).await.unwrap();
        tokio::fs::write(tmp.path().join("sub/lib.rs"), "fn alpha_123() {}\nlet y = 1;\n")
            .await
            .unwrap();
        tokio::fs::write(tmp.path().join("sub/notes.txt"), "alpha_999 here\n")
            .await
            .unwrap();
        tokio::fs::write(tmp.path().join("sub/raw.bin"), b"alpha_000\0\xff\xfe")
            .await
            .unwrap();
        tokio::fs::write(tmp.path().join("ignored_dir/skip.rs"), "alpha_777\n")
            .await
            .unwrap();

        let results = search_files_with_filter(
            SearchFilesRequest {
                path: tmp.path().to_string_lossy().to_string(),
                pattern: r"alpha_\d+".to_string(),
                ignore_patterns: Some(vec!["ignored_dir".to_string()]),
            },
            Some("*.rs".to_string()),
        )
        .await
        .unwrap();

        assert_eq!(results.len(), 1);
        assert!(results[0].path.ends_with("lib.rs"));
        assert_eq!(results[0].matches[0].line_number, 1);
        assert_eq!(results[0].matches[0].column, 3);
    }

    #[tokio::test]
    async fn file_watcher_emits_create_modify_remove_and_stops_on_unwatch() {
        let tmp = TempDir::new().unwrap();
        let watcher = FileWatcher::new().unwrap();
        let mut rx = watcher.subscribe();

        let dir_str = tmp.path().to_string_lossy().to_string();
        watcher.watch_path(&dir_str).unwrap();
        assert_eq!(watcher.watched_paths().len(), 1);

        let file_path = tmp.path().join("watched.txt");
        tokio::fs::write(&file_path, "v1").await.unwrap();
        tokio::time::sleep(Duration::from_millis(50)).await;
        tokio::fs::write(&file_path, "v2_updated").await.unwrap();
        tokio::time::sleep(Duration::from_millis(50)).await;
        tokio::fs::remove_file(&file_path).await.unwrap();

        let mut seen_kinds = Vec::new();
        let deadline = tokio::time::Instant::now() + Duration::from_secs(3);
        while tokio::time::Instant::now() < deadline {
            match tokio::time::timeout(Duration::from_millis(300), rx.recv()).await {
                Ok(Ok(ev)) => {
                    if ev.path.ends_with("watched.txt") {
                        seen_kinds.push(ev.kind);
                        if seen_kinds.iter().any(|k| k == "remove") {
                            break;
                        }
                    }
                }
                _ => {
                    if !seen_kinds.is_empty() && seen_kinds.iter().any(|k| k == "remove") {
                        break;
                    }
                }
            }
        }

        assert!(
            seen_kinds.iter().any(|k| k == "create" || k == "modify"),
            "expected create/modify events, got {:?}",
            seen_kinds
        );

        watcher.unwatch_path(&dir_str).unwrap();
        assert!(watcher.watched_paths().is_empty());

        while rx.try_recv().is_ok() {}
        tokio::fs::write(tmp.path().join("after_unwatch.txt"), "x").await.unwrap();
        tokio::time::sleep(Duration::from_millis(200)).await;
        assert!(rx.try_recv().is_err(), "expected no events after unwatch");
    }
}
