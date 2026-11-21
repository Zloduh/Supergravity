# Supergravity

**Supergravity** is a local-first agentic AI IDE and desktop coding command center built with **Tauri v2 (Rust)** and **React 18 + TypeScript + Tailwind CSS**.

It connects directly to local or self-hosted OpenAI-compatible inference servers (**Strata**, **Ollama**, **llama.cpp**, **vLLM**, **LM Studio**, or custom endpoints) and pairs an autonomous ReAct tool-calling agent engine with multi-folder Projects, Git worktrees, interactive plan reviews, visual diffs, MCP tool servers, `SKILL.md` discovery, and an integrated PTY terminal.

---

## Core Features

### 1. Multi-Folder Projects & Git Worktrees
- **Projects Workspace Model**: Organize single or multi-folder workspaces (e.g., frontend + backend repositories simultaneously) with isolated project-level settings.
- **Flexible Folder Sources**:
  - **Create New Folder on Drive**: Creates a new directory on disk and registers it in the project.
  - **Open Existing Folder / Git Checkout**: Automatically inspects `.git/HEAD` and displays active Git branches.
  - **SSH Host…**: Reference remote Linux folders (`user@host:/path`).
- **Worktree Modes**:
  - **Local Mode**: Agents operate directly in your active project folders.
  - **New Worktree Mode**: Provisions an isolated Git worktree per conversation (`git worktree add --detach`) so parallel tasks never conflict.
  - **Interface Layouts**: Toggle between **Standard Layout** (shows the worktree selector) and **Knowledge Work Layout** (hides worktree selector and runs directly in project folders).
- **Conversation Mobility**: Move any existing conversation into a Project (or between projects) with one click from the sidebar or top header bar.

### 2. Local-First Multi-Provider LLM Engine & Live SSE Streaming
- **Out-of-the-Box Local Defaults**: Pre-configured for **Strata (Local)** (`http://127.0.0.1:47831/v1`) and **Strata (LAN)** (`http://192.168.0.92:47832/v1`), plus one-click presets for **Ollama** (`:11434`), **LM Studio** (`:1234`), **llama.cpp** (`:8080`), and **vLLM** (`:8000`).
- **Live Token & Reasoning Stream**: UTF-8-safe SSE streaming with collapsible **Thinking / Reasoning** blocks (`<think>` and `reasoning_content`) and automatic fallback parsing for models that emit tool calls in XML/JSON text blocks.

### 3. Autonomous ReAct Agent Loop, Subagents & Swarm
- **Built-in Agent Tools**:
  - File & Codebase: `read_file` (full or line-range), `write_file` (with `ArtifactMetadata`), `edit_file`, `search_files` (regex + glob).
  - Execution & Tasks: `run_command` (sync or background daemon), `manage_task` (`list`, `status`, `send_input`, `kill`), `schedule` (cron & timers).
  - Multi-Agent & Swarm: `define_subagent`, `invoke_subagent` (`self`, `research`, `browser`, or custom), `send_message`, `manage_subagents`, and `swarm` (`status`, `add`, `kill`, `title`).
  - Interactive Steering: `ask_question` (multi-choice UI cards) and `search_web` (SearXNG or DuckDuckGo).

### 4. Interactive Implementation Plans (`/plan`) & Visual Diff Reviewer
- **Approval Gate**: When the agent writes a plan with `RequestFeedback: true`, execution pauses and presents an interactive **Implementation Plan Ready for Review** card with **Proceed with Plan** and **Request Changes** steering controls.
- **Per-Conversation File Snapshots & Diffs**: Every `write_file` and `edit_file` operation snapshots the original file and renders a **Unified / Split** red/green visual diff in the Auxiliary Pane with one-click **Revert**.

### 5. 5-Tab Auxiliary Pane
- **Artifacts**: Rich GFM Markdown, Mermaid diagrams, KaTeX math, syntax-highlighted code with copy buttons, and sandboxed live HTML widgets (`html-widget`).
- **Diffs**: Line-by-line `+added` / `-removed` visual diff cards for all files modified in the conversation.
- **Subagents**: Live status cards for spawned child agents and swarm workers with one-click transcript inspection.
- **Tasks**: Running background shell commands and daemons with exit codes and live stdout/stderr previews.
- **Workspace Files**: Interactive directory tree browser.

### 6. Customizations: Skills (`SKILL.md`), Rules, Lifecycle Hooks & MCP
- **Progressive-Disclosure Skills**: Automatically discovers `SKILL.md` files (YAML frontmatter `name` & `description`) from `~/.agents/skills`, `~/.claude/skills`, and workspace directories.
- **Workspace Rules**: Automatically loads and deduplicates `AGENTS.md`, `.agents/rules/*.md`, and `.cursorrules`.
- **Lifecycle Hooks (`hooks.json`)**: Supports `PreToolUse` and `PostToolUse` shell hooks in `.agents/hooks.json` to inspect, validate, or block tool calls.
- **Model Context Protocol (MCP)**: Connect both `stdio` and `HTTP/SSE` JSON-RPC 2.0 MCP servers and expose their tools (`mcp__<server>__<tool>`) to the agent.

### 7. Integrated PTY Terminal Drawer & CLI Mode
- **Integrated PTY Terminal**: Real pseudo-terminal drawer powered by `portable-pty` and `xterm.js` (`Ctrl+\``).
- **Rich Chat Composer**: Categorized `@` mentions (`File`, `Folder`, `Project Folder`, `Conversation`, `Rule`, `MCP`), drag-and-drop / clipboard paste file & image attachments, and 10 slash commands (`/plan`, `/compact`, `/goal`, `/grill-me`, `/boost`, `/teamwork`, `/swarm`, `/learn`, `/schedule`, `/browser`).
- **Terminal CLI Mode**: Run the compiled binary directly from your terminal (`supergravity --help`, `supergravity run "<prompt>"`, `supergravity projects`, `supergravity skills`).

---

## Building & Running from Source

### Prerequisites
- **Rust** (1.78+ via `rustup`)
- **Node.js** (20+) & `npm`
- **Linux System Libraries** (for Tauri v2 WebKitGTK):
  - Arch / CachyOS / Manjaro: `sudo pacman -S webkit2gtk-4.1 base-devel curl wget file openssl appmenu-gtk-module libappindicator-gtk3 librsvg`
  - Ubuntu / Debian: `sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev`

### 1. Install Frontend Dependencies
```bash
npm install
```

### 2. Build Frontend & Compile Release Binary
```bash
npm run build
cargo build --release
```
The compiled desktop & CLI binary will be located at:
```bash
./target/release/supergravity
```

### 3. Configuring Your Local LLM Provider
On first launch, click the **Settings (gear icon)** or press `Ctrl+,` to configure your local LLM provider:
- **Config File Location**: `~/.config/antigravity/config.toml` (or override via `ANTIGRAVITY_CONFIG_PATH=/path/to/config.toml`).
- Add or select **Strata**, **Ollama**, **LM Studio**, **llama.cpp**, or **vLLM**, enter your base URL (e.g., `http://127.0.0.1:11434/v1`) and API key, and click **Refresh Models**.

### 4. Running the Automated Test Suites
```bash
# Rust unit & subsystem integration tests
cargo test

# Frontend store & component unit tests
npm test

# Headless Chromium E2E test suite
node e2e/run_e2e.mjs --tier=all
```
