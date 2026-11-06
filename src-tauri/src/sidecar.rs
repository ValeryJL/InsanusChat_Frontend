use rand::RngCore;
use serde::Serialize;
use std::net::TcpListener;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

#[derive(Debug, Clone, Serialize)]
pub struct DaemonBootstrapInfo {
    pub url: String,
    pub port: u16,
    pub token: String,
    pub running: bool,
    pub pid: Option<u32>,
    pub platform: String,
    pub minimize_to_tray: bool,
    pub last_error: Option<String>,
}

pub struct DaemonRuntime {
    pub port: u16,
    pub token: String,
    pub child: Option<CommandChild>,
    pub pid: Option<u32>,
    pub minimize_to_tray: bool,
    pub last_error: Option<String>,
}

impl DaemonRuntime {
    pub fn new() -> Self {
        Self {
            port: pick_available_port(8765),
            token: generate_hex_secret(),
            child: None,
            pid: None,
            minimize_to_tray: true,
            last_error: None,
        }
    }
}

pub type SharedDaemonState = Arc<Mutex<DaemonRuntime>>;

fn generate_hex_secret() -> String {
    let mut bytes = [0u8; 24];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

fn pick_available_port(preferred: u16) -> u16 {
    for port in preferred..(preferred + 35) {
        if TcpListener::bind(("127.0.0.1", port)).is_ok() {
            return port;
        }
    }
    if let Ok(listener) = TcpListener::bind(("127.0.0.1", 0)) {
        if let Ok(addr) = listener.local_addr() {
            return addr.port();
        }
    }
    preferred
}

pub fn spawn_sidecar(app: &AppHandle, state: &SharedDaemonState) -> Result<(), String> {
    let mut guard = state.lock().map_err(|_| "Mutex poisoned".to_string())?;
    if let Some(old_child) = guard.child.take() {
        let _ = old_child.kill();
    }
    guard.pid = None;
    guard.port = pick_available_port(8765);
    guard.token = generate_hex_secret();

    let port_str = guard.port.to_string();
    let parent_pid = std::process::id().to_string();
    let token = guard.token.clone();

    let mut cmd = app
        .shell()
        .sidecar("insanus-workstation-daemon")
        .map_err(|e| format!("No se encontró el binario sidecar: {e}"))?
        .args(["--port", &port_str, "--parent-pid", &parent_pid])
        .env("INSANUS_LOCAL_SECRET", &token)
        .env("INSANUS_BIND_PORT", &port_str);

    if let Ok(res_dir) = app.path().resource_dir() {
        let ext_dir = res_dir.join("resources").join("insanuschat-harness");
        if ext_dir.exists() {
            cmd = cmd.env("INSANUS_EXTENSION_DIR", ext_dir.to_string_lossy().to_string());
        } else {
            let direct_ext = res_dir.join("insanuschat-harness");
            if direct_ext.exists() {
                cmd = cmd.env("INSANUS_EXTENSION_DIR", direct_ext.to_string_lossy().to_string());
            }
        }
    }

    let spawn_res = cmd.spawn();
    let (_rx, child) = match spawn_res {
        Ok(pair) => pair,
        Err(e) => {
            let msg = format!("Error iniciando microservicio sidecar: {e}");
            guard.last_error = Some(msg.clone());
            return Err(msg);
        }
    };

    let child_pid = child.pid();
    guard.pid = Some(child_pid);
    guard.child = Some(child);
    guard.last_error = None;
    let check_port = guard.port;
    drop(guard);

    // Espera hasta ~9s para la auto-extracción inicial del sidecar PyInstaller en Windows/Linux
    for _ in 0..60 {
        if std::net::TcpStream::connect(("127.0.0.1", check_port)).is_ok() {
            break;
        }
        std::thread::sleep(Duration::from_millis(150));
    }
    Ok(())
}

pub fn stop_sidecar(state: &SharedDaemonState) {
    if let Ok(mut guard) = state.lock() {
        if let Some(child) = guard.child.take() {
            let _ = child.kill();
        }
        guard.pid = None;
    }
}

#[tauri::command]
pub fn get_daemon_bootstrap(state: State<'_, SharedDaemonState>) -> Result<DaemonBootstrapInfo, String> {
    let guard = state.lock().map_err(|_| "Mutex poisoned".to_string())?;
    let running = std::net::TcpStream::connect(("127.0.0.1", guard.port)).is_ok();
    Ok(DaemonBootstrapInfo {
        url: format!("http://127.0.0.1:{}", guard.port),
        port: guard.port,
        token: guard.token.clone(),
        running,
        pid: guard.pid,
        platform: std::env::consts::OS.to_string(),
        minimize_to_tray: guard.minimize_to_tray,
        last_error: guard.last_error.clone(),
    })
}

#[tauri::command]
pub fn restart_daemon(
    app: AppHandle,
    state: State<'_, SharedDaemonState>,
) -> Result<DaemonBootstrapInfo, String> {
    spawn_sidecar(&app, state.inner())?;
    get_daemon_bootstrap(state)
}

#[tauri::command]
pub fn set_minimize_to_tray(
    enabled: bool,
    state: State<'_, SharedDaemonState>,
) -> Result<bool, String> {
    let mut guard = state.lock().map_err(|_| "Mutex poisoned".to_string())?;
    guard.minimize_to_tray = enabled;
    Ok(guard.minimize_to_tray)
}
