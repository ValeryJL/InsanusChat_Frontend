mod sidecar;
mod tray;

use std::sync::{Arc, Mutex};
use tauri::{Manager, RunEvent, WindowEvent};
use tauri_plugin_autostart::MacosLauncher;

use sidecar::{
    get_daemon_bootstrap, restart_daemon, set_minimize_to_tray, spawn_sidecar, stop_sidecar,
    DaemonRuntime, SharedDaemonState,
};
use tray::{create_system_tray, set_tray_remote_status, SharedTrayState, TrayUiState};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let daemon_state: SharedDaemonState = Arc::new(Mutex::new(DaemonRuntime::new()));
    let tray_state: SharedTrayState = Arc::new(Mutex::new(TrayUiState {
        status_item: None,
        toggle_item: None,
    }));

    let daemon_setup = daemon_state.clone();
    let tray_setup = tray_state.clone();
    let daemon_exit = daemon_state.clone();
    let daemon_window = daemon_state.clone();

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.unminimize();
                let _ = win.show();
                let _ = win.set_focus();
            }
        }))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .manage(daemon_state)
        .manage(tray_state)
        .invoke_handler(tauri::generate_handler![
            get_daemon_bootstrap,
            restart_daemon,
            set_minimize_to_tray,
            set_tray_remote_status,
        ])
        .setup(move |app| {
            let handle = app.handle().clone();
            // Arrancar el microservicio sidecar local al iniciar la app
            let _ = spawn_sidecar(&handle, &daemon_setup);
            let _ = create_system_tray(&handle, daemon_setup.clone(), tray_setup.clone());
            Ok(())
        })
        .on_window_event(move |window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let minimize = daemon_window
                    .lock()
                    .map(|g| g.minimize_to_tray)
                    .unwrap_or(true);
                if minimize {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("Error inicializando InsanusChat Workstation (Tauri v2)");

    app.run(move |_app_handle, event| {
        if let RunEvent::Exit = event {
            stop_sidecar(&daemon_exit);
        }
    });
}
