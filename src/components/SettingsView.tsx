import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  Check,
  Cloud,
  Code2,
  Cpu,
  Download,
  ExternalLink,
  FolderOpen,
  Globe,
  HardDrive,
  Laptop,
  Lock,
  Monitor,
  Plus,
  Power,
  RefreshCw,
  RotateCw,
  Server,
  Shield,
  ShieldAlert,
  Terminal,
  Trash2,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { api, getStoredToken } from '../api';
import {
  getCloudServerUrl,
  getDaemonBootstrap,
  getDesktopAutostart,
  isDesktopRuntime,
  openExternalLink,
  pickNativeDirectory,
  restartLocalDaemon,
  setCloudServerUrl,
  setDesktopAutostart,
  setDesktopMinimizeToTray,
  syncTrayRemoteStatus,
} from '../platform/desktop';
import {
  DesktopReleaseInfo,
  ExecutionNodeItem,
  LocalDaemonLogEntry,
  LocalDaemonStatus,
} from '../types';

type SettingsTab = 'remote' | 'harness' | 'vscode' | 'cloud' | 'desktop';

interface SettingsViewProps {
  nodes: ExecutionNodeItem[];
  localStatus: LocalDaemonStatus | null;
  cloudConnected: boolean;
  onRefreshAll: () => Promise<void>;
  onRefreshLocalStatus: () => Promise<LocalDaemonStatus | null>;
  onSyncLocalToBackend: (patch: Record<string, any>) => Promise<void>;
}

const RELEASES_PAGE_URL = 'https://github.com/ValeryJL/InsanusChat_Frontend/releases';

function formatBytes(bytes: number): string {
  if (!bytes) return '';
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  nodes,
  localStatus,
  cloudConnected,
  onRefreshAll,
  onRefreshLocalStatus,
  onSyncLocalToBackend,
}) => {
  const isDesktop = isDesktopRuntime();
  const [activeTab, setActiveTab] = useState<SettingsTab>(isDesktop ? 'remote' : 'cloud');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // Cloud Server URL & health probe
  const [serverUrlInput, setServerUrlInput] = useState(getCloudServerUrl());
  const [healthProbe, setHealthProbe] = useState<{ ok: boolean; latencyMs?: number; msg: string } | null>(null);
  const [probingHealth, setProbingHealth] = useState(false);

  // Local workstation editable fields
  const [nodeNameInput, setNodeNameInput] = useState(localStatus?.config.node_name || '');
  const [rootDirInput, setRootDirInput] = useState(localStatus?.config.root_projects_dir || '');
  const [customEditorInput, setCustomEditorInput] = useState(localStatus?.config.custom_editor_path || '');
  const [newAllowPattern, setNewAllowPattern] = useState('');
  const [newDenyPattern, setNewDenyPattern] = useState('');
  const [autostartEnabled, setAutostartEnabled] = useState(false);
  const [logs, setLogs] = useState<LocalDaemonLogEntry[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);

  // GitHub Releases info
  const [latestRelease, setLatestRelease] = useState<DesktopReleaseInfo | null>(null);
  const [loadingRelease, setLoadingRelease] = useState(false);

  const notify = (text: string, kind: 'ok' | 'err' = 'ok') => {
    setToast({ kind, text });
    setTimeout(() => setToast(null), 3200);
  };

  useEffect(() => {
    if (localStatus?.config) {
      setNodeNameInput(localStatus.config.node_name || '');
      setRootDirInput(localStatus.config.root_projects_dir || '');
      setCustomEditorInput(localStatus.config.custom_editor_path || '');
    }
  }, [localStatus?.config.node_name, localStatus?.config.root_projects_dir, localStatus?.config.custom_editor_path]);

  const loadLogs = useCallback(async () => {
    if (!isDesktop) return;
    setLoadingLogs(true);
    try {
      const res = await api.getLocalDaemonLogs();
      setLogs((res?.logs || []).slice().reverse());
    } catch {
    } finally {
      setLoadingLogs(false);
    }
  }, [isDesktop]);

  useEffect(() => {
    if (isDesktop) {
      getDesktopAutostart().then(setAutostartEnabled);
      if (activeTab === 'desktop') {
        loadLogs();
      }
    }
  }, [isDesktop, activeTab, loadLogs]);

  useEffect(() => {
    if (activeTab === 'desktop' && !latestRelease && !loadingRelease) {
      setLoadingRelease(true);
      api
        .fetchLatestDesktopRelease()
        .then((rel) => setLatestRelease(rel))
        .finally(() => setLoadingRelease(false));
    }
  }, [activeTab, latestRelease, loadingRelease]);

  const cfg = localStatus?.config;
  const bridge = localStatus?.bridge;
  const detectedEditors = localStatus?.vscode?.detected_editors || [];
  const allWorkspaces = (localStatus?.all_workspaces || localStatus?.workspaces || []).filter((w) => !w.is_root);

  const applyLocalAndBackendPatch = async (patch: Record<string, any>, successLabel?: string) => {
    setSaving(true);
    try {
      await onSyncLocalToBackend(patch);
      const updated = await onRefreshLocalStatus();
      if (updated) {
        await syncTrayRemoteStatus(updated.config.expose_to_cloud, updated.bridge.connected);
      }
      await onRefreshAll();
      if (successLabel) notify(successLabel);
    } catch (err: any) {
      notify(err.message || 'No se pudo actualizar la configuración', 'err');
    } finally {
      setSaving(false);
    }
  };

  const handlePickProjectsDir = async () => {
    const dir = await pickNativeDirectory(rootDirInput || undefined);
    if (!dir) return;
    setRootDirInput(dir);
    await applyLocalAndBackendPatch({ root_projects_dir: dir, allowed_workspaces: null }, 'Carpeta de proyectos actualizada');
  };

  const handleToggleWorkspaceWhitelist = async (wsPath: string) => {
    if (!cfg) return;
    const allNames = allWorkspaces.map((w) => w.path);
    const current = cfg.allowed_workspaces === null ? allNames : [...cfg.allowed_workspaces];
    const next = current.includes(wsPath) ? current.filter((x) => x !== wsPath) : [...current, wsPath];
    const normalized = next.length === allNames.length || next.length === 0 ? null : next;
    await applyLocalAndBackendPatch({ allowed_workspaces: normalized }, 'Proyectos autorizados actualizados');
  };

  const handleAddPattern = async (kind: 'allow' | 'deny') => {
    if (!cfg) return;
    const raw = (kind === 'allow' ? newAllowPattern : newDenyPattern).trim();
    if (!raw) return;
    if (kind === 'allow') {
      const next = Array.from(new Set([...(cfg.terminal_auto_approve_patterns || []), raw]));
      setNewAllowPattern('');
      await applyLocalAndBackendPatch({ terminal_auto_approve_patterns: next }, 'Comando agregado a Allowlist');
    } else {
      const next = Array.from(new Set([...(cfg.terminal_blocked_patterns || []), raw]));
      setNewDenyPattern('');
      await applyLocalAndBackendPatch({ terminal_blocked_patterns: next }, 'Patrón agregado a Denylist');
    }
  };

  const handleRemovePattern = async (kind: 'allow' | 'deny', pattern: string) => {
    if (!cfg) return;
    if (kind === 'allow') {
      const next = (cfg.terminal_auto_approve_patterns || []).filter((p) => p !== pattern);
      await applyLocalAndBackendPatch({ terminal_auto_approve_patterns: next });
    } else {
      const next = (cfg.terminal_blocked_patterns || []).filter((p) => p !== pattern);
      await applyLocalAndBackendPatch({ terminal_blocked_patterns: next });
    }
  };

  const handleTestCloudServer = async () => {
    const clean = serverUrlInput.trim().replace(/\/+$/, '');
    if (!clean) return;
    setProbingHealth(true);
    const t0 = performance.now();
    try {
      const data = await api.health(clean);
      const ms = Math.round(performance.now() - t0);
      setHealthProbe({
        ok: true,
        latencyMs: ms,
        msg: `Conectado (${ms} ms) · DB ${data?.database?.ok ? 'OK' : 'N/A'}`,
      });
    } catch (err: any) {
      setHealthProbe({ ok: false, msg: err.message || 'Servidor inalcanzable' });
    } finally {
      setProbingHealth(false);
    }
  };

  const handleSaveCloudServer = async () => {
    const saved = setCloudServerUrl(serverUrlInput);
    setServerUrlInput(saved);
    if (isDesktop) {
      const jwt = getStoredToken();
      if (jwt) {
        await api.bootstrapLocalDaemonSync({
          cloud_backend_url: saved,
          access_token: jwt,
        });
      } else {
        await api.updateLocalDaemonSettings({ cloud_backend_url: saved });
      }
      await onRefreshLocalStatus();
    }
    await onRefreshAll();
    notify(`Servidor Backend guardado: ${saved}`);
  };

  const handleRemoteNodePolicy = async (node: ExecutionNodeItem, patch: Record<string, any>, label: string) => {
    setSaving(true);
    try {
      const isSelf = isDesktop && cfg?.node_id === node.node_id;
      if (isSelf) {
        await applyLocalAndBackendPatch(patch, label);
        return;
      }
      await api.updateWorkstationPolicy(node.node_id, patch, false);
      await onRefreshAll();
      notify(label);
    } catch (err: any) {
      notify(err.message || 'Error actualizando política remota', 'err');
    } finally {
      setSaving(false);
    }
  };

  const handleRevokeNode = async (node: ExecutionNodeItem) => {
    if (!window.confirm(`¿Revocar y desconectar el equipo "${node.name}" de tu cuenta?`)) return;
    setSaving(true);
    try {
      await api.revokeWorkstationDevice(node.node_id);
      await onRefreshAll();
      if (isDesktop && cfg?.node_id === node.node_id) {
        await onRefreshLocalStatus();
      }
      notify(`Equipo "${node.name}" revocado`);
    } catch (err: any) {
      notify(err.message || 'No se pudo revocar el equipo', 'err');
    } finally {
      setSaving(false);
    }
  };

  const handleRestartDaemon = async () => {
    setSaving(true);
    try {
      await restartLocalDaemon();
      await new Promise((r) => setTimeout(r, 800));
      await getDaemonBootstrap(true);
      await onRefreshLocalStatus();
      await loadLogs();
      notify('Microservicio local reiniciado correctamente');
    } catch (err: any) {
      notify(err.message || 'Error reiniciando microservicio', 'err');
    } finally {
      setSaving(false);
    }
  };

  const handleLaunchTestEditor = async (editorId?: string) => {
    try {
      const res = await api.launchLocalEditor({ workspace: '.', editor_id: editorId });
      if (res?.ok) {
        notify(`Editor abierto (${res.binary})`);
      } else {
        notify(res?.message || 'No se encontró editor instalado', 'err');
      }
    } catch (err: any) {
      notify(err.message || 'No se pudo abrir el editor', 'err');
    }
  };

  const navItems: { id: SettingsTab; label: string; desc: string; icon: React.FC<any>; badge?: string }[] = [
    ...(isDesktop
      ? [
          {
            id: 'remote' as SettingsTab,
            label: 'Control Remoto & Privacidad',
            desc: 'Solo Local vs Túnel Cloud',
            icon: cfg?.expose_to_cloud ? Globe : Lock,
            badge: cfg?.expose_to_cloud ? 'ON' : 'LOCAL',
          },
          {
            id: 'harness' as SettingsTab,
            label: 'Agente & Guardrails',
            desc: 'Autonomía, Allowlist y Denylist',
            icon: Shield,
          },
          {
            id: 'vscode' as SettingsTab,
            label: 'VS Code & Terminal',
            desc: 'Editores, Extensión y Shell',
            icon: Code2,
          },
        ]
      : []),
    {
      id: 'cloud',
      label: 'Servidor Cloud & Equipos',
      desc: 'Backend SSOT y Workstations',
      icon: Server,
      badge: String(nodes.length),
    },
    {
      id: 'desktop',
      label: isDesktop ? 'Escritorio & Sistema' : 'Descargar App Desktop',
      desc: isDesktop ? 'Tray, Autostart, Logs y Versión' : 'Instaladores Windows & Linux',
      icon: isDesktop ? Monitor : Download,
    },
  ];

  const winAssets = (latestRelease?.assets || []).filter((a) => /\.(exe|msi)$/i.test(a.name));
  const linuxAssets = (latestRelease?.assets || []).filter((a) => /\.(AppImage|deb)$/i.test(a.name));

  return (
    <div className="flex-1 min-h-0 flex flex-col md:flex-row bg-[#09090b] text-zinc-100 overflow-hidden">
      {/* Sidebar de Categorías estilo Google Antigravity */}
      <aside className="w-full md:w-64 bg-[#0e1017] border-b md:border-b-0 md:border-r border-white/[0.07] p-3 flex md:flex-col gap-1 overflow-x-auto md:overflow-y-auto shrink-0">
        <div className="hidden md:block px-2.5 pb-2 mb-1 border-b border-white/[0.06]">
          <div className="text-xs font-semibold text-zinc-100">Configuración Workstation</div>
          <div className="text-[10.5px] text-zinc-500 mt-0.5 flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${cloudConnected ? 'bg-emerald-400' : 'bg-amber-400'}`} />
            <span>{isDesktop ? 'Desktop Nativo · Tauri v2' : 'Cliente Web · Cloud'}</span>
          </div>
        </div>

        {navItems.map((item) => {
          const Icon = item.icon;
          const active = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveTab(item.id)}
              className={`shrink-0 md:w-full px-2.5 py-2 rounded-xl text-left flex items-center justify-between gap-2 transition ${
                active
                  ? 'bg-white/[0.09] text-zinc-50 border border-white/[0.09]'
                  : 'text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200 border border-transparent'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <Icon
                  className={`w-4 h-4 shrink-0 ${
                    active ? 'text-emerald-400' : 'text-zinc-500'
                  }`}
                />
                <div className="min-w-0">
                  <div className="text-xs font-medium truncate">{item.label}</div>
                  <div className="hidden md:block text-[10px] text-zinc-500 truncate">{item.desc}</div>
                </div>
              </div>
              {item.badge && (
                <span
                  className={`px-1.5 py-0.5 rounded text-[9.5px] font-mono shrink-0 ${
                    item.badge === 'ON'
                      ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                      : item.badge === 'LOCAL'
                      ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                      : 'bg-white/[0.06] text-zinc-400'
                  }`}
                >
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </aside>

      {/* Panel de Contenido */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
        <div className="max-w-3xl mx-auto space-y-5">
          {toast && (
            <div
              className={`px-3.5 py-2.5 rounded-xl border text-xs flex items-center justify-between ${
                toast.kind === 'ok'
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                  : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
              }`}
            >
              <span>{toast.text}</span>
              <button type="button" onClick={() => setToast(null)} className="opacity-70 hover:opacity-100">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* TAB 1: CONTROL REMOTO & PRIVACIDAD (DESKTOP) */}
          {activeTab === 'remote' && isDesktop && cfg && (
            <>
              {/* Hero Status Banner */}
              <div
                className={`p-5 rounded-2xl border transition ${
                  cfg.expose_to_cloud
                    ? 'bg-emerald-500/[0.06] border-emerald-500/30'
                    : 'bg-[#11131a] border-white/[0.08]'
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-1 max-w-xl">
                    <div className="flex items-center gap-2">
                      {cfg.expose_to_cloud ? (
                        <Globe className="w-5 h-5 text-emerald-400" />
                      ) : (
                        <Lock className="w-5 h-5 text-amber-400" />
                      )}
                      <h2 className="text-sm font-semibold text-zinc-100">
                        {cfg.expose_to_cloud ? 'Control Remoto Activado' : 'Modo Solo Local (Aislado)'}
                      </h2>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-mono border ${
                          bridge?.connected
                            ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/35'
                            : cfg.expose_to_cloud
                            ? 'bg-sky-500/15 text-sky-300 border-sky-500/35'
                            : 'bg-amber-500/15 text-amber-300 border-amber-500/35'
                        }`}
                      >
                        {bridge?.connected
                          ? 'TÚNEL CLOUD ONLINE'
                          : cfg.expose_to_cloud
                          ? 'CONECTANDO TÚNEL...'
                          : '127.0.0.1 PRIVADO'}
                      </span>
                    </div>
                    <p className="text-xs text-zinc-400 leading-relaxed">
                      {cfg.expose_to_cloud
                        ? 'Tu PC mantiene un túnel WebSocket saliente autenticado hacia InsanusChat Backend. Podés acceder a tus archivos, diffs, VS Code y terminal desde la web o tu celular.'
                        : 'Ningún servicio externo puede acceder a tu disco ni a tu terminal. El Workbench local sigue funcionando al 100% directo contra 127.0.0.1 con 0 ms de latencia.'}
                    </p>
                  </div>

                  <button
                    type="button"
                    role="switch"
                    aria-checked={cfg.expose_to_cloud}
                    disabled={saving}
                    onClick={() =>
                      applyLocalAndBackendPatch(
                        { expose_to_cloud: !cfg.expose_to_cloud },
                        !cfg.expose_to_cloud
                          ? 'Control Remoto activado — abriendo túnel Cloud'
                          : 'Control Remoto desactivado — equipo en Solo Local'
                      )
                    }
                    className={`w-12 h-6 rounded-full p-0.5 transition flex items-center shrink-0 ${
                      cfg.expose_to_cloud ? 'bg-emerald-500 justify-end' : 'bg-zinc-700 justify-start'
                    }`}
                  >
                    <span className="w-5 h-5 rounded-full bg-white shadow" />
                  </button>
                </div>
              </div>

              {/* Permisos Granulares */}
              <div className="p-5 rounded-2xl bg-[#11131a] border border-white/[0.08] space-y-3">
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                    Permisos Granulares de Acceso Remoto
                  </h3>
                  <p className="text-[11.5px] text-zinc-500 mt-0.5">
                    Sincronizados con el Backend SSOT (v{cfg.config_version}) y aplicados inmediatamente sobre el túnel.
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="p-3.5 rounded-xl bg-[#09090b] border border-white/[0.07] flex items-center justify-between gap-4">
                    <div className="flex items-start gap-2.5">
                      <Terminal className="w-4 h-4 text-sky-400 mt-0.5 shrink-0" />
                      <div>
                        <div className="text-xs font-medium text-zinc-100">Terminal Remota Interactiva (PTY)</div>
                        <div className="text-[11px] text-zinc-500">
                          Permite abrir sesiones PowerShell/Bash y ejecutar comandos desde dispositivos remotos.
                        </div>
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={cfg.allow_remote_terminal}
                      disabled={saving}
                      onChange={(e) =>
                        applyLocalAndBackendPatch(
                          { allow_remote_terminal: e.target.checked },
                          e.target.checked ? 'Terminal remota habilitada' : 'Terminal remota bloqueada'
                        )
                      }
                      className="w-4 h-4 accent-emerald-500 cursor-pointer shrink-0"
                    />
                  </div>

                  <div className="p-3.5 rounded-xl bg-[#09090b] border border-white/[0.07] flex items-center justify-between gap-4">
                    <div className="flex items-start gap-2.5">
                      <Cpu className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
                      <div>
                        <div className="text-xs font-medium text-zinc-100">Herramientas de Agente Remoto (Harness)</div>
                        <div className="text-[11px] text-zinc-500">
                          Autoriza a los agentes de IA a leer, buscar y aplicar diffs en los proyectos de este equipo.
                        </div>
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={cfg.allow_remote_agent_tools}
                      disabled={saving}
                      onChange={(e) =>
                        applyLocalAndBackendPatch(
                          { allow_remote_agent_tools: e.target.checked },
                          e.target.checked
                            ? 'Herramientas de agente remoto habilitadas'
                            : 'Herramientas de agente remoto bloqueadas'
                        )
                      }
                      className="w-4 h-4 accent-emerald-500 cursor-pointer shrink-0"
                    />
                  </div>
                </div>
              </div>

              {/* Carpeta Raíz & Lista Blanca de Proyectos */}
              <div className="p-5 rounded-2xl bg-[#11131a] border border-white/[0.08] space-y-4">
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                    Carpeta Raíz y Proyectos Expuestos
                  </h3>
                  <p className="text-[11.5px] text-zinc-500 mt-0.5">
                    Ninguna herramienta ni usuario remoto puede salir de este directorio (protección anti-path traversal).
                  </p>
                </div>

                <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
                  <input
                    value={rootDirInput}
                    onChange={(e) => setRootDirInput(e.target.value)}
                    className="flex-1 h-9 px-3 rounded-xl bg-[#09090b] border border-white/[0.09] text-xs font-mono text-zinc-200 outline-none focus:border-emerald-500/60"
                  />
                  <button
                    type="button"
                    onClick={handlePickProjectsDir}
                    className="h-9 px-3 rounded-xl bg-white/[0.07] hover:bg-white/[0.12] border border-white/[0.08] text-xs text-zinc-200 flex items-center gap-1.5 shrink-0 transition"
                  >
                    <FolderOpen className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Elegir Carpeta</span>
                  </button>
                  <button
                    type="button"
                    disabled={saving || rootDirInput === cfg.root_projects_dir}
                    onClick={() =>
                      applyLocalAndBackendPatch(
                        { root_projects_dir: rootDirInput, allowed_workspaces: null },
                        'Directorio raíz guardado'
                      )
                    }
                    className="h-9 px-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-zinc-950 font-semibold text-xs shrink-0 transition"
                  >
                    Guardar
                  </button>
                </div>

                {allWorkspaces.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-zinc-400">
                        Proyectos visibles ({cfg.allowed_workspaces === null ? 'Todos' : `${cfg.allowed_workspaces.length} seleccionados`})
                      </span>
                      {cfg.allowed_workspaces !== null && (
                        <button
                          type="button"
                          onClick={() => applyLocalAndBackendPatch({ allowed_workspaces: null }, 'Todos los proyectos habilitados')}
                          className="text-emerald-400 hover:text-emerald-300"
                        >
                          Permitir todos
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-48 overflow-y-auto pr-1">
                      {allWorkspaces.map((ws) => {
                        const allowed = cfg.allowed_workspaces === null || cfg.allowed_workspaces.includes(ws.path);
                        return (
                          <label
                            key={ws.path}
                            className={`px-3 py-2 rounded-xl border text-xs flex items-center justify-between gap-2 cursor-pointer transition ${
                              allowed
                                ? 'bg-emerald-500/[0.06] border-emerald-500/25 text-zinc-100'
                                : 'bg-[#09090b] border-white/[0.06] text-zinc-500'
                            }`}
                          >
                            <span className="font-mono text-[11.5px] truncate">{ws.name}</span>
                            <input
                              type="checkbox"
                              checked={allowed}
                              onChange={() => handleToggleWorkspaceWhitelist(ws.path)}
                              className="w-3.5 h-3.5 accent-emerald-500 shrink-0"
                            />
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {/* TAB 2: AGENTE & GUARDRAILS ESTILO ANTIGRAVITY */}
          {activeTab === 'harness' && isDesktop && cfg && (
            <>
              <div className="p-5 rounded-2xl bg-[#11131a] border border-white/[0.08] space-y-3">
                <div>
                  <h2 className="text-sm font-semibold text-zinc-100">Política de Autonomía del Agente</h2>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Define cuánto control tiene el Agent Harness por defecto al trabajar en este equipo.
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  {(
                    [
                      {
                        id: 'ask',
                        title: 'Preguntar siempre',
                        desc: 'Requiere aprobación HITL antes de editar archivos o correr terminal.',
                      },
                      {
                        id: 'auto_edit',
                        title: 'Auto-editar archivos',
                        desc: 'Aplica diffs automáticamente y pide confirmación para terminal.',
                      },
                      {
                        id: 'autopilot',
                        title: 'Autopilot',
                        desc: 'Ejecuta archivos y comandos seguros sin pausa (respetando Denylist).',
                      },
                    ] as const
                  ).map((mode) => {
                    const selected = cfg.default_harness_mode === mode.id;
                    return (
                      <button
                        key={mode.id}
                        type="button"
                        onClick={() =>
                          applyLocalAndBackendPatch({ default_harness_mode: mode.id }, `Modo por defecto: ${mode.title}`)
                        }
                        className={`p-3.5 rounded-xl border text-left transition space-y-1 ${
                          selected
                            ? 'bg-emerald-500/10 border-emerald-500/40 text-zinc-100'
                            : 'bg-[#09090b] border-white/[0.07] text-zinc-400 hover:border-white/[0.15]'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-zinc-100">{mode.title}</span>
                          {selected && <Check className="w-3.5 h-3.5 text-emerald-400" />}
                        </div>
                        <p className="text-[11px] text-zinc-500 leading-relaxed">{mode.desc}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Allowlist & Denylist */}
              <div className="p-5 rounded-2xl bg-[#11131a] border border-white/[0.08] space-y-4">
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                    Terminal Allowlist (Comandos Seguros Auto-Aprobados)
                  </h3>
                  <p className="text-[11.5px] text-zinc-500 mt-0.5">
                    Prefijos de comandos de solo lectura o testeo aprobados automáticamente.
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {(cfg.terminal_auto_approve_patterns || []).map((pat) => (
                    <span
                      key={pat}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-emerald-300 font-mono text-[11px]"
                    >
                      {pat}
                      <button type="button" onClick={() => handleRemovePattern('allow', pat)} className="hover:text-white">
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    value={newAllowPattern}
                    onChange={(e) => setNewAllowPattern(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddPattern('allow')}
                    placeholder="ej: npm run lint, cargo check..."
                    className="flex-1 h-8 px-3 rounded-lg bg-[#09090b] border border-white/[0.09] text-xs font-mono text-zinc-200 outline-none focus:border-emerald-500/60"
                  />
                  <button
                    type="button"
                    onClick={() => handleAddPattern('allow')}
                    className="h-8 px-3 rounded-lg bg-white/[0.08] hover:bg-white/[0.14] text-xs text-zinc-100 flex items-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" /> Agregar
                  </button>
                </div>

                <div className="pt-3 border-t border-white/[0.07] space-y-3">
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-rose-300 flex items-center gap-1.5">
                      <ShieldAlert className="w-3.5 h-3.5" />
                      Terminal Denylist (Bloqueo Estricto Adicional)
                    </h3>
                    <p className="text-[11.5px] text-zinc-500 mt-0.5">
                      Además de los guardrails base (<code className="text-zinc-300">rm -rf /</code>, <code className="text-zinc-300">format</code>, <code className="text-zinc-300">shutdown</code>), cualquier comando que coincida será rechazado con HTTP 403.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {(cfg.terminal_blocked_patterns || []).length === 0 && (
                      <span className="text-[11px] text-zinc-500 italic">Sin reglas personalizadas adicionales.</span>
                    )}
                    {(cfg.terminal_blocked_patterns || []).map((pat) => (
                      <span
                        key={pat}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-rose-500/10 border border-rose-500/25 text-rose-300 font-mono text-[11px]"
                      >
                        {pat}
                        <button type="button" onClick={() => handleRemovePattern('deny', pat)} className="hover:text-white">
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <input
                      value={newDenyPattern}
                      onChange={(e) => setNewDenyPattern(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleAddPattern('deny')}
                      placeholder="ej: git push --force, drop table, docker rm -f"
                      className="flex-1 h-8 px-3 rounded-lg bg-[#09090b] border border-white/[0.09] text-xs font-mono text-zinc-200 outline-none focus:border-rose-500/60"
                    />
                    <button
                      type="button"
                      onClick={() => handleAddPattern('deny')}
                      className="h-8 px-3 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 text-xs text-rose-300 flex items-center gap-1"
                    >
                      <Plus className="w-3.5 h-3.5" /> Bloquear
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* TAB 3: INTEGRACIÓN VS CODE & TERMINAL */}
          {activeTab === 'vscode' && isDesktop && cfg && (
            <>
              <div className="p-5 rounded-2xl bg-[#11131a] border border-white/[0.08] space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h2 className="text-sm font-semibold text-zinc-100">Integración con VS Code / VSCodium / InsanusCode</h2>
                    <p className="text-xs text-zinc-400 mt-0.5">
                      Elegí qué editor de escritorio abrir con <code className="text-emerald-400">--goto archivo:línea</code> y la extensión nativa <code className="text-zinc-300">insanuschat-harness</code>.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleLaunchTestEditor()}
                    className="h-8 px-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold text-xs flex items-center gap-1.5 shrink-0 transition"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>Abrir Editor</span>
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => applyLocalAndBackendPatch({ preferred_editor: 'auto' }, 'Editor preferido: Automático')}
                    className={`p-3 rounded-xl border text-left transition ${
                      cfg.preferred_editor === 'auto'
                        ? 'bg-emerald-500/10 border-emerald-500/35'
                        : 'bg-[#09090b] border-white/[0.07] hover:border-white/[0.15]'
                    }`}
                  >
                    <div className="flex items-center justify-between text-xs font-medium text-zinc-100">
                      <span>Automático (Recomendado)</span>
                      {cfg.preferred_editor === 'auto' && <Check className="w-3.5 h-3.5 text-emerald-400" />}
                    </div>
                    <div className="text-[10.5px] text-zinc-500 mt-0.5 font-mono truncate">
                      {localStatus?.vscode?.desktop_binary || 'Ningún editor CLI detectado'}
                    </div>
                  </button>

                  {detectedEditors.map((ed) => {
                    const active = cfg.preferred_editor === ed.id;
                    return (
                      <button
                        key={ed.id}
                        type="button"
                        onClick={() => applyLocalAndBackendPatch({ preferred_editor: ed.id }, `Editor preferido: ${ed.name}`)}
                        className={`p-3 rounded-xl border text-left transition ${
                          active
                            ? 'bg-emerald-500/10 border-emerald-500/35'
                            : 'bg-[#09090b] border-white/[0.07] hover:border-white/[0.15]'
                        }`}
                      >
                        <div className="flex items-center justify-between text-xs font-medium text-zinc-100">
                          <span>{ed.name}</span>
                          {active && <Check className="w-3.5 h-3.5 text-emerald-400" />}
                        </div>
                        <div className="text-[10.5px] text-zinc-500 mt-0.5 font-mono truncate">{ed.path}</div>
                      </button>
                    );
                  })}
                </div>

                <div className="flex gap-2">
                  <input
                    value={customEditorInput}
                    onChange={(e) => setCustomEditorInput(e.target.value)}
                    placeholder="Ruta manual a binario de editor (opcional)"
                    className="flex-1 h-8 px-3 rounded-lg bg-[#09090b] border border-white/[0.09] text-xs font-mono text-zinc-200 outline-none focus:border-emerald-500/60"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      applyLocalAndBackendPatch(
                        {
                          custom_editor_path: customEditorInput.trim() || null,
                          preferred_editor: customEditorInput.trim() ? 'custom' : 'auto',
                        },
                        'Ruta personalizada actualizada'
                      )
                    }
                    className="h-8 px-3 rounded-lg bg-white/[0.08] hover:bg-white/[0.14] text-xs text-zinc-100"
                  >
                    Aplicar
                  </button>
                </div>

                <div className="p-4 rounded-xl bg-[#09090b] border border-white/[0.08] space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-xs font-semibold text-zinc-100">Motor del Editor Embebido (v1.5)</div>
                      <div className="text-[11px] text-zinc-500 mt-0.5">
                        Ejecuta VS Code real con Extension Host, LSP y tema Insanus Obsidian dentro de la pestaña Editor.
                      </div>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-mono ${
                        localStatus?.ide?.running
                          ? 'bg-emerald-500/15 text-emerald-300'
                          : 'bg-zinc-800 text-zinc-400'
                      }`}
                    >
                      {localStatus?.ide?.running
                        ? `ACTIVO · ${localStatus.ide.engine} (:${localStatus.ide.port})`
                        : 'EN ESPERA'}
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {(
                      [
                        { id: 'auto', label: 'Automático' },
                        { id: 'vscode', label: 'VS Code (serve-web)' },
                        { id: 'openvscode', label: 'OpenVSCode Server' },
                        { id: 'monaco', label: 'Solo Monaco Lite' },
                      ] as const
                    ).map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() =>
                          applyLocalAndBackendPatch({ ide_engine: opt.id }, `Motor IDE: ${opt.label}`)
                        }
                        className={`h-7 px-2.5 rounded-lg text-[11px] border transition ${
                          (cfg.ide_engine || 'auto') === opt.id
                            ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                            : 'bg-[#11131a] border-white/[0.08] text-zinc-400 hover:text-zinc-200'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                    <label className="flex items-start gap-2.5 p-2.5 rounded-lg bg-[#11131a] border border-white/[0.07] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={cfg.dressed_share_user_extensions !== false}
                        onChange={(e) =>
                          applyLocalAndBackendPatch(
                            { dressed_share_user_extensions: e.target.checked },
                            e.target.checked
                              ? 'Editor Vestido compartirá ~/.vscode/extensions'
                              : 'Editor Vestido usará carpeta de extensiones aislada'
                          )
                        }
                        className="mt-0.5 accent-emerald-500"
                      />
                      <span className="text-[11px] text-zinc-300 leading-snug">
                        <strong className="block text-zinc-100">Compartir extensiones personales</strong>
                        Hereda tus extensiones de <code className="text-emerald-400">~/.vscode/extensions</code> al abrir Editor Vestido.
                      </span>
                    </label>

                    <label className="flex items-start gap-2.5 p-2.5 rounded-lg bg-[#11131a] border border-white/[0.07] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={cfg.ide_embedded_hide_titlebar !== false}
                        onChange={(e) =>
                          applyLocalAndBackendPatch(
                            { ide_embedded_hide_titlebar: e.target.checked },
                            'Estilo embebido actualizado'
                          )
                        }
                        className="mt-0.5 accent-emerald-500"
                      />
                      <span className="text-[11px] text-zinc-300 leading-snug">
                        <strong className="block text-zinc-100">Ocultar barra de título duplicada</strong>
                        Fusiona el VS Code embebido directamente bajo el header Obsidian de insanus-harnes.
                      </span>
                    </label>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          const res = await api.launchDressedVSCode('.');
                          notify(res?.ok ? 'Editor Vestido abierto (Obsidian + Chat)' : res?.message || 'Error');
                        } catch (err: any) {
                          notify(err?.message || 'Error abriendo Editor Vestido');
                        }
                      }}
                      className="h-7 px-3 rounded-lg bg-sky-500/15 hover:bg-sky-500/25 border border-sky-500/35 text-sky-300 text-[11px] font-medium flex items-center gap-1.5"
                    >
                      <ExternalLink className="w-3 h-3" />
                      <span>Abrir Editor Vestido</span>
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await api.reinstallDressedProfile();
                          notify('Tema Insanus Obsidian y Extensión de Chat reinstalados');
                          await onRefreshLocalStatus();
                        } catch (err: any) {
                          notify(err?.message || 'No se pudo reinstalar el perfil');
                        }
                      }}
                      className="h-7 px-3 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.08] text-zinc-200 text-[11px]"
                    >
                      Reinstalar Tema + Extensión Chat
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          notify('Descargando OpenVSCode Server (~80 MB)...');
                          await api.installOpenVSCodeServer();
                          notify('OpenVSCode Server instalado correctamente');
                          await onRefreshLocalStatus();
                        } catch (err: any) {
                          notify(err?.message || 'Error descargando OpenVSCode Server');
                        }
                      }}
                      className="h-7 px-3 rounded-lg bg-white/[0.05] hover:bg-white/[0.10] border border-white/[0.08] text-zinc-300 text-[11px] flex items-center gap-1"
                    >
                      <Download className="w-3 h-3 text-emerald-400" />
                      <span>
                        {localStatus?.ide?.openvscode_installed
                          ? 'Actualizar OpenVSCode Server'
                          : 'Instalar OpenVSCode Server'}
                      </span>
                    </button>
                    {localStatus?.ide?.running && (
                      <button
                        type="button"
                        onClick={async () => {
                          await api.stopLocalIDE();
                          notify('Motor VS Code detenido');
                          await onRefreshLocalStatus();
                        }}
                        className="h-7 px-2.5 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-300 text-[11px]"
                      >
                        Detener Motor
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Shell por Defecto */}
              <div className="p-5 rounded-2xl bg-[#11131a] border border-white/[0.08] space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Shell Interactivo por Defecto (PTY)</h3>
                <div className="flex flex-wrap gap-2">
                  {(cfg.os.startsWith('win') ? ['auto', 'powershell', 'pwsh', 'cmd', 'bash'] : ['auto', 'bash', 'zsh', 'sh']).map((sh) => (
                    <button
                      key={sh}
                      type="button"
                      onClick={() => applyLocalAndBackendPatch({ default_shell: sh }, `Shell por defecto: ${sh}`)}
                      className={`h-8 px-3 rounded-lg text-xs font-mono border transition ${
                        cfg.default_shell === sh
                          ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                          : 'bg-[#09090b] border-white/[0.08] text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      {sh}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* TAB 4: SERVIDOR CLOUD SSOT & DISPOSITIVOS WORKSTATION */}
          {activeTab === 'cloud' && (
            <>
              {isDesktop && (
                <div className="p-5 rounded-2xl bg-[#11131a] border border-white/[0.08] space-y-4">
                  <div>
                    <h2 className="text-sm font-semibold text-zinc-100">Servidor InsanusChat Backend (Fuente de Verdad 100%)</h2>
                    <p className="text-xs text-zinc-400 mt-0.5">
                      Tus chats, agentes, API Keys, extensiones y políticas de dispositivos se sincronizan contra este servidor.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] text-zinc-400 mb-1">URL del Backend Cloud / LAN</label>
                      <input
                        value={serverUrlInput}
                        onChange={(e) => setServerUrlInput(e.target.value)}
                        placeholder="https://harnes.insanustech.com.ar"
                        className="w-full h-9 px-3 rounded-xl bg-[#09090b] border border-white/[0.09] text-xs font-mono text-zinc-100 outline-none focus:border-emerald-500/60"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-zinc-400 mb-1">Nombre visible de esta PC</label>
                      <input
                        value={nodeNameInput}
                        onChange={(e) => setNodeNameInput(e.target.value)}
                        placeholder="PC-Valeria"
                        className="w-full h-9 px-3 rounded-xl bg-[#09090b] border border-white/[0.09] text-xs text-zinc-100 outline-none focus:border-emerald-500/60"
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={handleTestCloudServer}
                      disabled={probingHealth}
                      className="h-8 px-3 rounded-lg bg-white/[0.07] hover:bg-white/[0.12] text-xs text-zinc-200 flex items-center gap-1.5"
                    >
                      <Activity className="w-3.5 h-3.5 text-sky-400" />
                      <span>{probingHealth ? 'Probando...' : 'Probar Conexión'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveCloudServer}
                      className="h-8 px-3.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold text-xs"
                    >
                      Guardar &amp; Sincronizar Sesión
                    </button>
                    {cfg && nodeNameInput.trim() && nodeNameInput.trim() !== cfg.node_name && (
                      <button
                        type="button"
                        onClick={() => applyLocalAndBackendPatch({ node_name: nodeNameInput.trim() }, 'Nombre del equipo actualizado')}
                        className="h-8 px-3 rounded-lg bg-white/[0.07] hover:bg-white/[0.12] text-xs text-zinc-200"
                      >
                        Renombrar PC
                      </button>
                    )}
                    {healthProbe && (
                      <span
                        className={`text-[11px] font-mono ${healthProbe.ok ? 'text-emerald-400' : 'text-rose-400'}`}
                      >
                        {healthProbe.msg}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Lista SSOT de Equipos Registrados */}
              <div className="p-5 rounded-2xl bg-[#11131a] border border-white/[0.08] space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-semibold text-zinc-100">Equipos Workstation Vinculados</h2>
                    <p className="text-xs text-zinc-400 mt-0.5">
                      Controlá el estado en vivo, políticas y desconexión remota (Kill-Switch) de tus PCs registradas en el Backend.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={onRefreshAll}
                    className="p-2 rounded-lg bg-white/[0.06] hover:bg-white/[0.11] text-zinc-300 transition"
                    title="Actualizar equipos"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                </div>

                {nodes.length === 0 ? (
                  <div className="p-6 rounded-xl bg-[#09090b] border border-white/[0.06] text-center space-y-2">
                    <Laptop className="w-6 h-6 text-zinc-500 mx-auto" />
                    <div className="text-xs font-medium text-zinc-300">No hay equipos Workstation vinculados todavía</div>
                    <p className="text-[11px] text-zinc-500">
                      Instalá InsanusChat Workstation en tu PC Windows o Linux e iniciá sesión para vincularlo automáticamente.
                    </p>
                    <button
                      type="button"
                      onClick={() => setActiveTab('desktop')}
                      className="mt-1 h-8 px-3.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold text-xs inline-flex items-center gap-1.5"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Descargar Instalador Desktop</span>
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {nodes.map((node) => {
                      const isOnline = node.status === 'online' || node.connected;
                      const isThisPc = isDesktop && cfg?.node_id === node.node_id;
                      return (
                        <div
                          key={node.node_id}
                          className="p-4 rounded-xl bg-[#09090b] border border-white/[0.08] flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                        >
                          <div className="space-y-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <Laptop className={`w-4 h-4 shrink-0 ${isOnline ? 'text-emerald-400' : 'text-zinc-500'}`} />
                              <span className="text-xs font-semibold text-zinc-100">{node.name}</span>
                              {isThisPc && (
                                <span className="px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-300 text-[9.5px] font-mono">
                                  ESTE EQUIPO
                                </span>
                              )}
                              <span className="px-1.5 py-0.5 rounded bg-white/[0.06] text-zinc-400 text-[9.5px] font-mono uppercase">
                                {node.os} {node.app_version ? `· v${node.app_version}` : ''}
                              </span>
                              <span
                                className={`px-2 py-0.5 rounded-full text-[10px] font-mono ${
                                  isOnline
                                    ? 'bg-emerald-500/15 text-emerald-300'
                                    : node.status === 'private_local_only'
                                    ? 'bg-amber-500/15 text-amber-300'
                                    : 'bg-zinc-800 text-zinc-400'
                                }`}
                              >
                                {isOnline ? 'ONLINE' : node.status === 'private_local_only' ? 'SOLO LOCAL' : 'OFFLINE'}
                              </span>
                            </div>
                            <div className="text-[11px] text-zinc-500 font-mono truncate">
                              {node.node_id} · {node.workspaces?.length || 0} proyectos · Política v{node.config_version || 1}
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                            {isOnline && !node.is_builtin_host && (
                              <button
                                type="button"
                                disabled={saving}
                                onClick={() =>
                                  handleRemoteNodePolicy(
                                    node,
                                    { expose_to_cloud: false },
                                    `Control Remoto apagado en "${node.name}"`
                                  )
                                }
                                className="h-7 px-2.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-300 text-[11px] font-medium flex items-center gap-1 transition"
                                title="Apagar Control Remoto y cerrar túnel inmediatamente (Kill-Switch)"
                              >
                                <Power className="w-3 h-3" />
                                <span>Desconectar</span>
                              </button>
                            )}
                            {!node.is_builtin_host && (
                              <button
                                type="button"
                                disabled={saving}
                                onClick={() => handleRevokeNode(node)}
                                className="h-7 px-2.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/25 text-rose-300 text-[11px] font-medium flex items-center gap-1 transition"
                                title="Revocar acceso de este dispositivo"
                              >
                                <Trash2 className="w-3 h-3" />
                                <span>Revocar</span>
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}

          {/* TAB 5: ESCRITORIO & SISTEMA (DESKTOP) + DESCARGA DE RELEASES (WEB & DESKTOP) */}
          {activeTab === 'desktop' && (
            <>
              {isDesktop && cfg && (
                <>
                  <div className="p-5 rounded-2xl bg-[#11131a] border border-white/[0.08] space-y-3">
                    <h2 className="text-sm font-semibold text-zinc-100">Comportamiento del Escritorio (Tauri v2)</h2>
                    <div className="space-y-2">
                      <label className="p-3.5 rounded-xl bg-[#09090b] border border-white/[0.07] flex items-center justify-between gap-3 cursor-pointer">
                        <div>
                          <div className="text-xs font-medium text-zinc-100">Minimizar a la bandeja del sistema (System Tray)</div>
                          <div className="text-[11px] text-zinc-500">
                            Al cerrar la ventana, mantiene el microservicio y el Control Remoto activos en segundo plano.
                          </div>
                        </div>
                        <input
                          type="checkbox"
                          checked={cfg.minimize_to_tray}
                          onChange={async (e) => {
                            await setDesktopMinimizeToTray(e.target.checked);
                            await applyLocalAndBackendPatch({ minimize_to_tray: e.target.checked });
                          }}
                          className="w-4 h-4 accent-emerald-500 shrink-0"
                        />
                      </label>

                      <label className="p-3.5 rounded-xl bg-[#09090b] border border-white/[0.07] flex items-center justify-between gap-3 cursor-pointer">
                        <div>
                          <div className="text-xs font-medium text-zinc-100">Iniciar automáticamente con Windows / Linux</div>
                          <div className="text-[11px] text-zinc-500">
                            Lanza InsanusChat Workstation al iniciar sesión en tu sistema operativo.
                          </div>
                        </div>
                        <input
                          type="checkbox"
                          checked={autostartEnabled}
                          onChange={async (e) => {
                            const ok = await setDesktopAutostart(e.target.checked);
                            setAutostartEnabled(ok);
                            await applyLocalAndBackendPatch({ launch_at_startup: ok });
                          }}
                          className="w-4 h-4 accent-emerald-500 shrink-0"
                        />
                      </label>
                    </div>
                  </div>

                  {/* Diagnóstico del Microservicio Local + Logs en vivo */}
                  <div className="p-5 rounded-2xl bg-[#11131a] border border-white/[0.08] space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                          Microservicio Local Sidecar (127.0.0.1:{localStatus?.port || 8765})
                        </h3>
                        <div className="text-[11px] font-mono text-zinc-500 mt-0.5">
                          PID {localStatus?.pid || '—'} · Config: {cfg.config_dir}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={loadLogs}
                          className="h-7 px-2.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.11] text-xs text-zinc-300 flex items-center gap-1"
                        >
                          <RefreshCw className={`w-3 h-3 ${loadingLogs ? 'animate-spin' : ''}`} />
                          <span>Logs</span>
                        </button>
                        <button
                          type="button"
                          disabled={saving}
                          onClick={handleRestartDaemon}
                          className="h-7 px-2.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-300 text-xs font-medium flex items-center gap-1"
                        >
                          <RotateCw className="w-3 h-3" />
                          <span>Reiniciar Sidecar</span>
                        </button>
                      </div>
                    </div>

                    <div className="rounded-xl bg-[#09090b] border border-white/[0.07] p-3 max-h-48 overflow-y-auto font-mono text-[11px] space-y-1">
                      {logs.length === 0 ? (
                        <div className="text-zinc-500">Sin eventos registrados todavía.</div>
                      ) : (
                        logs.map((entry, idx) => (
                          <div key={idx} className="flex items-start gap-2">
                            <span className="text-zinc-600 shrink-0">{entry.ts.slice(11, 19)}</span>
                            <span
                              className={
                                entry.level === 'error'
                                  ? 'text-rose-400'
                                  : entry.level === 'warn'
                                  ? 'text-amber-300'
                                  : entry.level === 'success'
                                  ? 'text-emerald-400'
                                  : 'text-zinc-300'
                              }
                            >
                              {entry.message}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </>
              )}

              {/* Tarjeta de Descarga / Actualización de Instaladores Oficiales (Windows & Linux) */}
              <div className="p-5 rounded-2xl bg-[#11131a] border border-white/[0.08] space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                      <Download className="w-4 h-4 text-emerald-400" />
                      <span>
                        {isDesktop
                          ? `insanus-harnes v${cfg?.app_version || '1.4.1'} — Actualizaciones`
                          : 'Descargar insanus-harnes (Escritorio)'}
                      </span>
                    </h2>
                    <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                      Instalador todo-en-uno para <strong>Windows</strong> y <strong>Linux</strong> preconfigurado para <code className="text-emerald-400">https://harnes.insanustech.com.ar</code> con el microservicio local VS Code embebido y System Tray.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => openExternalLink(latestRelease?.html_url || RELEASES_PAGE_URL)}
                    className="h-8 px-3 rounded-xl bg-white/[0.07] hover:bg-white/[0.12] border border-white/[0.08] text-xs text-zinc-200 flex items-center gap-1.5 shrink-0"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>GitHub Releases</span>
                  </button>
                </div>

                {loadingRelease ? (
                  <div className="text-xs text-zinc-500 font-mono">Consultando último Release en GitHub...</div>
                ) : latestRelease && (winAssets.length > 0 || linuxAssets.length > 0) ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="p-4 rounded-xl bg-[#09090b] border border-white/[0.08] space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-zinc-100 flex items-center gap-1.5">
                          <HardDrive className="w-3.5 h-3.5 text-sky-400" /> Windows x64
                        </span>
                        <span className="text-[10px] font-mono text-emerald-400">{latestRelease.tag_name}</span>
                      </div>
                      <div className="space-y-1.5">
                        {winAssets.map((asset) => (
                          <button
                            key={asset.name}
                            type="button"
                            onClick={() => openExternalLink(asset.browser_download_url)}
                            className="w-full px-3 py-2 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/25 text-left text-xs text-emerald-200 flex items-center justify-between gap-2 transition"
                          >
                            <span className="font-mono text-[11px] truncate">{asset.name}</span>
                            <span className="text-[10px] text-emerald-400 shrink-0">{formatBytes(asset.size)}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="p-4 rounded-xl bg-[#09090b] border border-white/[0.08] space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-zinc-100 flex items-center gap-1.5">
                          <Terminal className="w-3.5 h-3.5 text-amber-400" /> Linux x64
                        </span>
                        <span className="text-[10px] font-mono text-emerald-400">{latestRelease.tag_name}</span>
                      </div>
                      <div className="space-y-1.5">
                        {linuxAssets.map((asset) => (
                          <button
                            key={asset.name}
                            type="button"
                            onClick={() => openExternalLink(asset.browser_download_url)}
                            className="w-full px-3 py-2 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.08] text-left text-xs text-zinc-200 flex items-center justify-between gap-2 transition"
                          >
                            <span className="font-mono text-[11px] truncate">{asset.name}</span>
                            <span className="text-[10px] text-zinc-400 shrink-0">{formatBytes(asset.size)}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="p-4 rounded-xl bg-[#09090b] border border-white/[0.07] flex flex-wrap items-center justify-between gap-3">
                    <div className="text-xs text-zinc-400">
                      Descargá los paquetes oficiales <strong>Windows (.exe / .msi)</strong> y <strong>Linux (.AppImage / .deb)</strong> desde la sección de Releases.
                    </div>
                    <button
                      type="button"
                      onClick={() => openExternalLink(RELEASES_PAGE_URL)}
                      className="h-8 px-3.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold text-xs flex items-center gap-1.5"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Ir a Releases</span>
                    </button>
                  </div>
                )}

                {/* Estado de preparación Offline / Ollama (Épica 12) */}
                <div className="p-3.5 rounded-xl bg-[#09090b] border border-white/[0.06] flex items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-2 text-zinc-400">
                    {cloudConnected ? (
                      <Wifi className="w-4 h-4 text-emerald-400 shrink-0" />
                    ) : (
                      <WifiOff className="w-4 h-4 text-amber-400 shrink-0" />
                    )}
                    <span>
                      {cloudConnected
                        ? 'Conectado a InsanusChat Backend (SSOT activo). Editor local preparado para resiliencia offline.'
                        : 'Sin conexión al Backend Cloud — el Editor Monaco local y la Terminal PTY continúan activos.'}
                    </span>
                  </div>
                  <Cloud className="w-4 h-4 text-zinc-600 shrink-0" />
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
