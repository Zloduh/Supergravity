//! Antigravity - Agentic AI IDE and Coding Assistant
//!
//! A local-first agentic AI IDE with multi-conversation support,
//! artifact viewer, terminal integration, and MCP client.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{Emitter, Manager};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use antigravity::{
    AppState,
    agent::AgentEngine,
    commands,
    config::ConfigManager,
    fs::FileWatcher,
    llm::LLMProviderManager,
    mcp::MCPClientManager,
    skills::SkillManager,
    terminal::TerminalManager,
};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Initialize tracing
    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::new(
            std::env::var("RUST_LOG").unwrap_or_else(|_| "info,tauri=warn".into()),
        ))
        .with(tracing_subscriber::fmt::layer())
        .init();

    // Parse CLI subcommands (`--help`, `--version`, `projects`, `skills`, `run <prompt>`) or `--screenshot <file.png>`
    let args: Vec<String> = std::env::args().collect();
    if let Some(subcmd) = args.get(1).map(|s| s.as_str()) {
        match subcmd {
            "--help" | "-h" | "help" => {
                println!("Antigravity Local (v0.1.0) - Agentic AI IDE & CLI (`agy`)");
                println!("Usage:");
                println!("  antigravity                        Launch Tauri Desktop App");
                println!("  antigravity run <prompt>           Run an agent task from the terminal CLI");
                println!("  antigravity projects               List configured multi-folder Projects");
                println!("  antigravity skills                 List discovered SKILL.md skills");
                println!("  antigravity --screenshot <out.png> Capture desktop window screenshot");
                return Ok(());
            }
            "--version" | "-V" => {
                println!("antigravity 0.1.0");
                return Ok(());
            }
            _ => {}
        }
    }

    let screenshot_path: Option<std::path::PathBuf> = args
        .windows(2)
        .find(|w| w[0] == "--screenshot")
        .map(|w| std::path::PathBuf::from(&w[1]));

    // Load configuration
    let config = ConfigManager::new().await?;

    // Initialize LLM provider manager (constructors already return Arc<Self>)
    let llm_providers = LLMProviderManager::new(config.clone()).await?;

    // Initialize MCP client manager
    let mcp_client = MCPClientManager::new(config.clone()).await?;

    // Initialize skill manager
    let skill_manager = SkillManager::new(config.clone()).await?;

    // Initialize terminal manager
    let terminal_manager = TerminalManager::new(config.clone()).await?;

    // Initialize agent engine
    let agent_engine = AgentEngine::new(
        config.clone(),
        llm_providers.clone(),
        mcp_client.clone(),
        skill_manager.clone(),
        terminal_manager.clone(),
    ).await?;

    if let Some(subcmd) = args.get(1).map(|s| s.as_str()) {
        match subcmd {
            "projects" => {
                let ws = config.get_workspace_config().await;
                if ws.projects.is_empty() {
                    println!("No projects configured.");
                } else {
                    for p in ws.projects {
                        println!(
                            "- {} (id: {}, folders: {}, preset: {:?})",
                            p.name,
                            p.id,
                            p.folders.len(),
                            p.settings.permission_preset
                        );
                    }
                }
                return Ok(());
            }
            "skills" => {
                let list = skill_manager.list_skills(None, None).await;
                for sk in list {
                    println!("- {} ({}): {}", sk.name, sk.path.to_string_lossy(), sk.description);
                }
                return Ok(());
            }
            "run" => {
                let prompt = args.iter().skip(2).cloned().collect::<Vec<_>>().join(" ");
                if prompt.trim().is_empty() {
                    eprintln!("Error: provide a prompt to `antigravity run <prompt>`");
                    std::process::exit(1);
                }
                let task = agent_engine
                    .start_agent_task(antigravity::agent::StartAgentTaskRequest {
                        conversation_id: None,
                        prompt,
                        system_prompt: None,
                        provider_id: None,
                        model: None,
                        workspace_path: Some(
                            std::env::current_dir()
                                .unwrap_or_default()
                                .to_string_lossy()
                                .to_string(),
                        ),
                        project_id: config.get_workspace_config().await.active_project_id,
                        worktree_mode: None,
                    })
                    .await?;
                loop {
                    if let Some(st) = agent_engine.get_agent_status(&task.id).await {
                        match st.status {
                            antigravity::agent::AgentTaskStatus::Completed => {
                                if let Some(conv) =
                                    agent_engine.get_conversation(&st.conversation_id).await
                                {
                                    if let Some(last) =
                                        conv.messages.iter().rev().find(|m| m.role == "assistant")
                                    {
                                        println!("{}", last.content);
                                    }
                                }
                                break;
                            }
                            antigravity::agent::AgentTaskStatus::Failed => {
                                eprintln!(
                                    "Agent task failed: {}",
                                    st.error.unwrap_or_else(|| "unknown error".to_string())
                                );
                                std::process::exit(1);
                            }
                            antigravity::agent::AgentTaskStatus::Cancelled => {
                                eprintln!("Agent task cancelled.");
                                break;
                            }
                            _ => {}
                        }
                    }
                    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                }
                return Ok(());
            }
            _ => {}
        }
    }

    // Initialize file watcher
    let fs_watcher = FileWatcher::new()?;

    let app_state = AppState {
        config: config.clone(),
        llm_providers,
        mcp_client,
        agent_engine,
        skill_manager,
        terminal_manager,
        fs_watcher,
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_positioner::init())
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            // File operations
            commands::fs_commands::read_file,
            commands::fs_commands::write_file,
            commands::fs_commands::edit_file,
            commands::fs_commands::list_dir,
            commands::fs_commands::create_dir,
            commands::fs_commands::delete_path,
            commands::fs_commands::copy_path,
            commands::fs_commands::move_path,
            commands::fs_commands::search_files,
            commands::fs_commands::read_file_range,
            commands::fs_commands::watch_path,
            commands::fs_commands::unwatch_path,
            // Terminal operations
            commands::terminal::spawn_terminal,
            commands::terminal::write_terminal,
            commands::terminal::resize_terminal,
            commands::terminal::kill_terminal,
            commands::terminal::list_terminals,
            // LLM operations
            commands::llm::list_providers,
            commands::llm::add_provider,
            commands::llm::remove_provider,
            commands::llm::set_active_provider,
            commands::llm::chat_completion,
            commands::llm::stream_chat_completion,
            commands::llm::list_models,
            commands::llm::refresh_provider_models,
            // MCP operations
            commands::mcp::list_servers,
            commands::mcp::add_server,
            commands::mcp::remove_server,
            commands::mcp::connect_server,
            commands::mcp::disconnect_server,
            commands::mcp::list_tools,
            commands::mcp::call_tool,
            // Agent operations
            commands::agent::start_agent_task,
            commands::agent::cancel_agent_task,
            commands::agent::get_agent_status,
            commands::agent::list_conversations,
            commands::agent::create_conversation,
            commands::agent::delete_conversation,
            commands::agent::get_conversation,
            commands::agent::send_message,
            commands::agent::answer_question,
            commands::agent::approve_command,
            commands::agent::list_artifacts,
            // Skills operations
            commands::skills::list_skills,
            commands::skills::load_skill,
            commands::skills::unload_skill,
            commands::skills::reload_skills,
            commands::skills::get_skill_schema,
            // Config operations
            commands::config::get_config,
            commands::config::set_config,
            commands::config::reset_config,
            // Window operations
            commands::window::create_window,
            commands::window::close_window,
            commands::window::minimize_window,
            commands::window::maximize_window,
            commands::window::list_windows,
        ])
        .setup(move |app| {
            let handle = app.handle().clone();

            // Set app handle on terminal manager, agent engine, and file watcher for event emission
            let state = app.state::<AppState>();
            state.terminal_manager.set_app_handle(handle.clone());
            state.agent_engine.set_app_handle(handle.clone());
            state.fs_watcher.set_app_handle(handle.clone());

            // Set up global shortcuts (ignore errors if already registered or headless)
            #[cfg(desktop)]
            {
                use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
                let _ = handle.global_shortcut().on_shortcut(
                    "CmdOrCtrl+Shift+P",
                    |app, _shortcut, event| {
                        if event.state == ShortcutState::Pressed {
                            let _ = app.emit("global-shortcut", "command-palette");
                        }
                    },
                );
                let _ = handle.global_shortcut().on_shortcut(
                    "CmdOrCtrl+`",
                    |app, _shortcut, event| {
                        if event.state == ShortcutState::Pressed {
                            let _ = app.emit("global-shortcut", "toggle-terminal");
                        }
                    },
                );
            }

            // Handle --screenshot <file.png> mode
            if let Some(shot_path) = screenshot_path {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_focusable(false);
                }
                let app_handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    // Wait ~2 seconds (~120 frames) for initial render
                    tokio::time::sleep(std::time::Duration::from_millis(2000)).await;
                    if let Some(parent) = shot_path.parent() {
                        if !parent.as_os_str().is_empty() {
                            let _ = std::fs::create_dir_all(parent);
                        }
                    }
                    if let Some(window) = app_handle.get_webview_window("main") {
                        #[cfg(target_os = "linux")]
                        {
                            let shot_path_clone = shot_path.clone();
                            let exit_handle = app_handle.clone();
                            let _ = window.with_webview(move |wv| {
                                use webkit2gtk::WebViewExt;
                                let view = wv.inner();
                                let path_for_cb = shot_path_clone.clone();
                                let handle_for_cb = exit_handle.clone();
                                view.snapshot(
                                    webkit2gtk::SnapshotRegion::Visible,
                                    webkit2gtk::SnapshotOptions::NONE,
                                    None::<&webkit2gtk::gio::Cancellable>,
                                    move |res| {
                                        if let Ok(surface) = res {
                                            if let Ok(mut file) = std::fs::File::create(&path_for_cb) {
                                                let _ = surface.write_to_png(&mut file);
                                            }
                                        }
                                        handle_for_cb.exit(0);
                                    },
                                );
                            });
                            return;
                        }
                    }
                    app_handle.exit(0);
                });
            }

            // System tray disabled - tauri-plugin-tray not available in v2
            // #[cfg(desktop)]
            // {
            //     use tauri::{Manager, tray::TrayIconBuilder};
            //     TrayIconBuilder::new()
            //         .icon(app.default_window_icon().unwrap().clone())
            //         .menu(&tauri::menu::MenuBuilder::new(app)
            //             .item(&tauri::menu::MenuItemBuilder::new("Show").id("show").build(app)?)
            //             .item(&tauri::menu::MenuItemBuilder::new("Quit").id("quit").build(app)?)
            //             .build()?)
            //         .on_menu_event(|app, event| match event.id.as_ref() {
            //             "show" => {
            //                 if let Some(window) = app.get_webview_window("main") {
            //                     let _ = window.show();
            //                     let _ = window.set_focus();
            //                 }
            //             }
            //             "quit" => {
            //                 app.exit(0);
            //             }
            //             _ => {}
            //         })
            //         .build(app)?;
            // }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");

    Ok(())
}