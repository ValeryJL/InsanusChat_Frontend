use std::sync::{Arc, Mutex};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::sidecar::{spawn_sidecar, stop_sidecar, SharedDaemonState};

pub struct TrayUiState {
    pub status_item: Option<MenuItem<tauri::Wry>>,
    pub toggle_item: Option<MenuItem<tauri::Wry>>,
}

pub type SharedTrayState = Arc<Mutex<TrayUiState>>;

pub fn create_system_tray(app: &AppHandle, daemon_state: SharedDaemonState, tray_state: SharedTrayState) -> tauri::Result<()> {
    let show_i = MenuItem::with_id(app, "show", "Abrir InsanusChat Workstation", true, None::<&str>)?;
    let status_i = MenuItem::with_id(app, "status", "Estado: 🔒 Solo Local (127.0.0.1)", false, None::<&str>)?;
    let toggle_i = MenuItem::with_id(app, "toggle_remote", "🌐 Activar Control Remoto", true, None::<&str>)?;
    let vscode_i = MenuItem::with_id(app, "open_vscode", "Abrir VS Code Desktop", true, None::<&str>)?;
    let restart_i = MenuItem::with_id(app, "restart_daemon", "Reiniciar Microservicio Local", true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let quit_i = MenuItem::with_id(app, "quit", "Salir completamente", true, None::<&str>)?;

    if let Ok(mut guard) = tray_state.lock() {
        guard.status_item = Some(status_i.clone());
        guard.toggle_item = Some(toggle_i.clone());
    }

    let menu = Menu::with_items(
        app,
        &[&show_i, &sep1, &status_i, &toggle_i, &vscode_i, &restart_i, &sep2, &quit_i],
    )?;

    let daemon_for_menu = daemon_state.clone();
    let mut builder = TrayIconBuilder::with_id("insanuschat-tray")
        .menu(&menu)
        .tooltip("InsanusChat Workstation — 🔒 Solo Local")
        .show_menu_on_left_click(false)
        .on_menu_event(move |app_handle, event| match event.id.as_ref() {
            "show" => {
                if let Some(win) = app_handle.get_webview_window("main") {
                    let _ = win.unminimize();
                    let _ = win.show();
                    let _ = win.set_focus();
                }
            }
            "toggle_remote" => {
                let _ = app_handle.emit("tray:toggle-remote", ());
            }
            "open_vscode" => {
                let _ = app_handle.emit("tray:open-vscode", ());
            }
            "restart_daemon" => {
                let _ = spawn_sidecar(app_handle, &daemon_for_menu);
                let _ = app_handle.emit("tray:daemon-restarted", ());
            }
            "quit" => {
                stop_sidecar(&daemon_for_menu);
                app_handle.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app_handle = tray.app_handle();
                if let Some(win) = app_handle.get_webview_window("main") {
                    let _ = win.unminimize();
                    let _ = win.show();
                    let _ = win.set_focus();
                }
            }
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }

    builder.build(app)?;
    Ok(())
}

#[tauri::command]
pub fn set_tray_remote_status(
    app: AppHandle,
    exposed: bool,
    connected: bool,
    tray_state: State<'_, SharedTrayState>,
) -> Result<(), String> {
    let (status_text, toggle_text, tooltip) = if exposed && connected {
        (
            "Estado: 🌐 Control Remoto Online",
            "🔒 Desactivar Control Remoto",
            "InsanusChat Workstation — 🌐 Control Remoto Online",
        )
    } else if exposed {
        (
            "Estado: 🌐 Control Remoto (Conectando...)",
            "🔒 Desactivar Control Remoto",
            "InsanusChat Workstation — 🌐 Control Remoto (Conectando...)",
        )
    } else {
        (
            "Estado: 🔒 Solo Local (127.0.0.1)",
            "🌐 Activar Control Remoto",
            "InsanusChat Workstation — 🔒 Solo Local",
        )
    };

    if let Ok(guard) = tray_state.lock() {
        if let Some(item) = &guard.status_item {
            let _ = item.set_text(status_text);
        }
        if let Some(item) = &guard.toggle_item {
            let _ = item.set_text(toggle_text);
        }
    }
    if let Some(tray) = app.tray_by_id("insanuschat-tray") {
        let _ = tray.set_tooltip(Some(tooltip));
    }
    Ok(())
}
