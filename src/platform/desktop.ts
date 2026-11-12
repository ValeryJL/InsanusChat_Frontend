/**
 * Puente de Runtime Dual-Mode (Web/Móvil vs App Desktop Tauri v2) (HU-41, HU-42, HU-45).
 * - Detecta automáticamente si corre dentro de Tauri v2 (`__TAURI_INTERNALS__`).
 * - Gestiona el bootstrap seguro del sidecar local (`127.0.0.1` + `X-Workstation-Token`).
 * - Permite configurar dinámicamente la URL del Backend Cloud (`InsanusChat_Backend`).
 * - Expone utilidades nativas del SO (Selector de carpetas, Autostart, System Tray, Enlaces externos).
 */

export interface DaemonBootstrapInfo {
  url: string;
  port: number;
  token: string;
  running: boolean;
  pid?: number | null;
  platform: string;
  minimize_to_tray: boolean;
}

const CLOUD_URL_STORAGE_KEY = 'insanus_cloud_server_url';
export const DEFAULT_CLOUD_SERVER_URL = 'https://harnes.insanustech.com.ar';

let cachedBootstrap: DaemonBootstrapInfo | null = null;
let localDesktopNodeId: string | null = null;

export function isDesktopRuntime(): boolean {
  if (typeof window === 'undefined') return false;
  return '__TAURI_INTERNALS__' in window || '__TAURI__' in window;
}

export function getCloudServerUrl(): string {
  const envBase = ((import.meta as any).env?.VITE_API_BASE_URL || '').trim().replace(/\/+$/, '');
  if (!isDesktopRuntime()) {
    return envBase;
  }
  const saved = (localStorage.getItem(CLOUD_URL_STORAGE_KEY) || '').trim().replace(/\/+$/, '');
  if (saved) return saved;
  return envBase || DEFAULT_CLOUD_SERVER_URL;
}

export function setCloudServerUrl(url: string): string {
  const clean = (url || '').trim().replace(/\/+$/, '');
  if (clean) {
    localStorage.setItem(CLOUD_URL_STORAGE_KEY, clean);
  } else {
    localStorage.removeItem(CLOUD_URL_STORAGE_KEY);
  }
  return getCloudServerUrl();
}

export function getLocalDaemonNodeId(): string | null {
  return localDesktopNodeId;
}

export function setLocalDaemonNodeId(nodeId: string | null): void {
  localDesktopNodeId = nodeId;
}

export async function getDaemonBootstrap(forceRefresh = false): Promise<DaemonBootstrapInfo | null> {
  if (!isDesktopRuntime()) return null;
  if (cachedBootstrap && !forceRefresh) return cachedBootstrap;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const info = await invoke<DaemonBootstrapInfo>('get_daemon_bootstrap');
    cachedBootstrap = info;
    return info;
  } catch {
    return null;
  }
}

export async function restartLocalDaemon(): Promise<DaemonBootstrapInfo | null> {
  if (!isDesktopRuntime()) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  const info = await invoke<DaemonBootstrapInfo>('restart_daemon');
  cachedBootstrap = info;
  return info;
}

export async function localDaemonRequest<T = any>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const boot = await getDaemonBootstrap();
  if (!boot) {
    throw new Error('El microservicio local Workstation solo está disponible en la aplicación Desktop.');
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Workstation-Token': boot.token,
    ...((options.headers as Record<string, string>) || {}),
  };

  const res = await fetch(`${boot.url}${path}`, {
    ...options,
    headers,
  });

  let payload: any = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }

  if (!res.ok) {
    const detail = payload?.detail || payload?.message || `Local Daemon HTTP ${res.status}`;
    throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
  }
  return payload as T;
}

export function getLocalTerminalWebSocketUrlSync(
  workspace = '.',
  opts?: { cols?: number; rows?: number; shell?: string }
): string | null {
  if (!cachedBootstrap) return null;
  const wsBase = cachedBootstrap.url.replace(/^http:\/\//i, 'ws://').replace(/^https:\/\//i, 'wss://');
  const params = new URLSearchParams({
    workspace,
    local_token: cachedBootstrap.token,
  });
  if (opts?.cols) params.set('cols', String(opts.cols));
  if (opts?.rows) params.set('rows', String(opts.rows));
  if (opts?.shell) params.set('shell', opts.shell);
  return `${wsBase}/local/terminal/ws?${params.toString()}`;
}

export async function pickNativeDirectory(defaultPath?: string): Promise<string | null> {
  if (!isDesktopRuntime()) return null;
  try {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({
      directory: true,
      multiple: false,
      defaultPath,
      title: 'Seleccionar carpeta raíz de proyectos',
    });
    if (typeof selected === 'string' && selected.trim()) {
      return selected;
    }
    return null;
  } catch {
    return null;
  }
}

export async function setDesktopMinimizeToTray(enabled: boolean): Promise<void> {
  if (!isDesktopRuntime()) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('set_minimize_to_tray', { enabled });
    if (cachedBootstrap) {
      cachedBootstrap = { ...cachedBootstrap, minimize_to_tray: enabled };
    }
  } catch {}
}

export async function setDesktopAutostart(enabled: boolean): Promise<boolean> {
  if (!isDesktopRuntime()) return false;
  try {
    const autostart = await import('@tauri-apps/plugin-autostart');
    if (enabled) {
      await autostart.enable();
    } else {
      await autostart.disable();
    }
    return await autostart.isEnabled();
  } catch {
    return false;
  }
}

export async function getDesktopAutostart(): Promise<boolean> {
  if (!isDesktopRuntime()) return false;
  try {
    const autostart = await import('@tauri-apps/plugin-autostart');
    return await autostart.isEnabled();
  } catch {
    return false;
  }
}

export async function syncTrayRemoteStatus(exposed: boolean, connected: boolean): Promise<void> {
  if (!isDesktopRuntime()) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('set_tray_remote_status', { exposed, connected });
  } catch {}
}

export async function openExternalLink(url: string): Promise<void> {
  if (isDesktopRuntime()) {
    try {
      const { openUrl } = await import('@tauri-apps/plugin-opener');
      await openUrl(url);
      return;
    } catch {}
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

export async function subscribeTrayEvents(handlers: {
  onToggleRemote?: () => void;
  onOpenVSCode?: () => void;
  onDaemonRestarted?: () => void;
}): Promise<() => void> {
  if (!isDesktopRuntime()) return () => {};
  try {
    const { listen } = await import('@tauri-apps/api/event');
    const unlisteners: Array<() => void> = [];
    if (handlers.onToggleRemote) {
      unlisteners.push(await listen('tray:toggle-remote', handlers.onToggleRemote));
    }
    if (handlers.onOpenVSCode) {
      unlisteners.push(await listen('tray:open-vscode', handlers.onOpenVSCode));
    }
    if (handlers.onDaemonRestarted) {
      unlisteners.push(
        await listen('tray:daemon-restarted', async () => {
          await getDaemonBootstrap(true);
          handlers.onDaemonRestarted?.();
        })
      );
    }
    return () => {
      unlisteners.forEach((fn) => {
        try {
          fn();
        } catch {}
      });
    };
  } catch {
    return () => {};
  }
}
