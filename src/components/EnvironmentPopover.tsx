import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  Cloud,
  Download,
  FolderGit2,
  FolderPlus,
  Globe,
  Laptop,
  Lock,
  RefreshCw,
  Settings,
} from 'lucide-react';
import { api } from '../api';
import { isDesktopRuntime } from '../platform/desktop';
import { ChatItem, ExecutionNodeItem } from '../types';

interface EnvironmentPopoverProps {
  activeChat: ChatItem | null;
  nodes: ExecutionNodeItem[];
  onUpdateChatConfig: (updates: Partial<ChatItem>) => Promise<void>;
  onRefreshNodes: () => Promise<void>;
  onSwitchToAgentMode: () => void;
  onOpenSettings?: () => void;
  onToggleRemoteControl?: (node: ExecutionNodeItem) => Promise<void>;
}

export const EnvironmentPopover: React.FC<EnvironmentPopoverProps> = ({
  activeChat,
  nodes,
  onUpdateChatConfig,
  onRefreshNodes,
  onSwitchToAgentMode,
  onOpenSettings,
  onToggleRemoteControl,
}) => {
  const [open, setOpen] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [busy, setBusy] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onOutside = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onOutside);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onOutside);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!activeChat) return null;

  const executionTarget = activeChat.execution_target || 'cloud';
  const selectedNodeId = activeChat.node_id || nodes[0]?.node_id || 'local-workstation-host';
  const selectedNode = nodes.find((n) => n.node_id === selectedNodeId) || nodes[0] || null;
  const selectedWorkspace = activeChat.workspace_path || selectedNode?.workspaces?.[0]?.path || '.';
  const selectedWsLabel =
    selectedNode?.workspaces?.find((w) => w.path === selectedWorkspace)?.name ||
    (selectedWorkspace === '.' ? selectedNode?.name || 'Local' : selectedWorkspace);

  const selectCloud = async () => {
    onSwitchToAgentMode();
    await onUpdateChatConfig({ execution_target: 'cloud', node_id: null });
    setOpen(false);
  };

  const selectNode = async (node: ExecutionNodeItem) => {
    const defaultWs =
      node.workspaces?.find((w) => !w.is_root)?.path || node.workspaces?.[0]?.path || '.';
    await onUpdateChatConfig({
      execution_target: 'workstation',
      node_id: node.node_id,
      workspace_path: defaultWs,
    });
  };

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjectName.trim() || !selectedNode) return;
    setBusy(true);
    try {
      const res = await api.createNodeWorkspace(selectedNode.node_id, newProjectName.trim());
      const createdPath = res?.data?.path || newProjectName.trim();
      await onRefreshNodes();
      await onUpdateChatConfig({
        execution_target: 'workstation',
        node_id: selectedNode.node_id,
        workspace_path: createdPath,
      });
      setNewProjectName('');
      setCreatingProject(false);
    } catch {
    } finally {
      setBusy(false);
    }
  };

  const handleTogglePrivacy = async () => {
    if (!selectedNode) return;
    setBusy(true);
    try {
      if (onToggleRemoteControl) {
        await onToggleRemoteControl(selectedNode);
      } else {
        await api.updateLocalNodePrivacy({
          expose_to_cloud: !selectedNode.expose_to_cloud,
          allow_remote_terminal: selectedNode.allow_remote_terminal ?? true,
        });
      }
      await onRefreshNodes();
    } catch {
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="h-7 px-2 sm:px-2.5 rounded-lg bg-[#161922] hover:bg-[#1c202c] border border-white/[0.08] text-xs flex items-center gap-1.5 transition max-w-[165px] sm:max-w-[210px]"
        title="Cambiar entorno de ejecución (Nube vs Equipo Local y Proyecto)"
      >
        {executionTarget === 'cloud' ? (
          <>
            <Cloud className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
            <span className="hidden sm:inline text-zinc-200 font-medium truncate">Nube</span>
          </>
        ) : (
          <>
            <Laptop className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span className="hidden sm:inline text-zinc-100 font-medium truncate">
              {selectedWsLabel}
            </span>
            {selectedNode && !selectedNode.expose_to_cloud && (
              <Lock className="w-3 h-3 text-amber-400 shrink-0" />
            )}
          </>
        )}
        <ChevronDown className={`w-3 h-3 text-zinc-500 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-80 max-w-[calc(100vw-20px)] rounded-xl bg-[#161922] border border-white/[0.10] shadow-2xl shadow-black/80 p-3 space-y-3 z-50">
          {/* Sección 1: Entorno */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between px-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                Entorno de Ejecución
              </span>
              <button
                type="button"
                onClick={onRefreshNodes}
                className="p-1 rounded hover:bg-white/[0.06] text-zinc-400 hover:text-zinc-200 transition"
                title="Actualizar equipos conectados"
              >
                <RefreshCw className="w-3 h-3" />
              </button>
            </div>

            <button
              type="button"
              onClick={selectCloud}
              className={`w-full px-2.5 py-2 rounded-lg text-left text-xs flex items-center justify-between gap-2 transition ${
                executionTarget === 'cloud'
                  ? 'bg-white/[0.08] text-zinc-100'
                  : 'text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <Cloud className="w-4 h-4 text-zinc-400 shrink-0" />
                <div className="min-w-0">
                  <div className="font-medium text-zinc-100">Nube</div>
                  <div className="text-[10.5px] text-zinc-500 truncate">Chat estándar sin acceso a disco</div>
                </div>
              </div>
              {executionTarget === 'cloud' && <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />}
            </button>

            {nodes.map((node) => {
              const isSelected = executionTarget === 'workstation' && selectedNodeId === node.node_id;
              return (
                <button
                  key={node.node_id}
                  type="button"
                  onClick={() => selectNode(node)}
                  className={`w-full px-2.5 py-2 rounded-lg text-left text-xs flex items-center justify-between gap-2 transition ${
                    isSelected
                      ? 'bg-white/[0.08] text-zinc-100'
                      : 'text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Laptop className="w-4 h-4 text-emerald-400 shrink-0" />
                    <div className="min-w-0">
                      <div className="font-medium text-zinc-100 flex items-center gap-1.5 truncate">
                        <span className="truncate">{node.name}</span>
                        <span className="px-1 py-0.2 rounded bg-white/[0.06] text-[9px] font-mono text-zinc-400 uppercase shrink-0">
                          {node.os}
                        </span>
                      </div>
                      <div className="text-[10.5px] text-zinc-500 flex items-center gap-1">
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            node.expose_to_cloud ? 'bg-emerald-400' : 'bg-amber-400'
                          }`}
                        />
                        <span>{node.expose_to_cloud ? 'Online · Listo' : 'Aislado · Solo Local'}</span>
                      </div>
                    </div>
                  </div>
                  {isSelected && <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />}
                </button>
              );
            })}
          </div>

          {/* Sección 2: Proyecto / Workspace */}
          {executionTarget === 'workstation' && selectedNode && (
            <div className="pt-2.5 border-t border-white/[0.07] space-y-2">
              <div className="flex items-center justify-between px-1">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                  Proyecto Activo
                </span>
                <button
                  type="button"
                  onClick={() => setCreatingProject((c) => !c)}
                  disabled={!selectedNode.expose_to_cloud}
                  className="flex items-center gap-1 text-[11px] text-emerald-400 hover:text-emerald-300 disabled:opacity-40"
                >
                  <FolderPlus className="w-3 h-3" />
                  <span>Nuevo</span>
                </button>
              </div>

              {creatingProject && (
                <form onSubmit={handleCreateProject} className="flex items-center gap-1.5">
                  <input
                    value={newProjectName}
                    onChange={(e) => setNewProjectName(e.target.value)}
                    placeholder="mi-proyecto"
                    className="flex-1 h-7 px-2 rounded-lg bg-[#0b0d12] border border-white/[0.12] focus:border-emerald-500/60 text-xs font-mono text-zinc-100 outline-none"
                    autoFocus
                  />
                  <button
                    type="submit"
                    disabled={busy || !newProjectName.trim()}
                    className="h-7 px-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold text-xs"
                  >
                    Crear
                  </button>
                </form>
              )}

              <div className="max-h-36 overflow-y-auto space-y-0.5 pr-0.5">
                {(selectedNode.workspaces || []).map((ws) => {
                  const activeWs = selectedWorkspace === ws.path;
                  return (
                    <button
                      key={ws.path}
                      type="button"
                      onClick={async () => {
                        await onUpdateChatConfig({ workspace_path: ws.path });
                        setOpen(false);
                      }}
                      className={`w-full px-2.5 py-1.5 rounded-lg text-left text-xs flex items-center justify-between gap-2 transition ${
                        activeWs
                          ? 'bg-emerald-500/15 text-emerald-300 font-medium'
                          : 'text-zinc-300 hover:bg-white/[0.05]'
                      }`}
                    >
                      <span className="flex items-center gap-2 truncate font-mono text-[11.5px]">
                        <FolderGit2 className="w-3.5 h-3.5 shrink-0 opacity-75" />
                        <span className="truncate">{ws.is_root ? `${ws.name} (Raíz)` : ws.name}</span>
                      </span>
                      {activeWs && <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Sección 3: Switch de Control Remoto / Privacidad (HU-24, HU-34, HU-43) */}
          {executionTarget === 'workstation' &&
            selectedNode &&
            (selectedNode.is_local_desktop || selectedNode.is_builtin_host || selectedNode.expose_to_cloud) && (
              <div className="pt-2.5 border-t border-white/[0.07]">
                <button
                  type="button"
                  role="switch"
                  aria-checked={selectedNode.expose_to_cloud}
                  disabled={busy}
                  onClick={handleTogglePrivacy}
                  className="w-full px-2 py-1.5 rounded-lg hover:bg-white/[0.04] flex items-center justify-between gap-3 transition text-left"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {selectedNode.expose_to_cloud ? (
                      <Globe className="w-4 h-4 text-emerald-400 shrink-0" />
                    ) : (
                      <Lock className="w-4 h-4 text-amber-400 shrink-0" />
                    )}
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-zinc-200">Control Remoto (Cloud)</div>
                      <div className="text-[10.5px] text-zinc-500 truncate">
                        {selectedNode.expose_to_cloud
                          ? 'Expuesto a tu cuenta Web/Móvil'
                          : 'Aislado — Solo Local (127.0.0.1)'}
                      </div>
                    </div>
                  </div>
                  <div
                    className={`w-9 h-5 rounded-full p-0.5 transition shrink-0 flex items-center ${
                      selectedNode.expose_to_cloud ? 'bg-emerald-500 justify-end' : 'bg-amber-500/40 justify-start'
                    }`}
                  >
                    <span className="w-4 h-4 rounded-full bg-white shadow" />
                  </div>
                </button>
              </div>
            )}

          {onOpenSettings && (
            <div className="pt-2 border-t border-white/[0.07]">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onOpenSettings();
                }}
                className="w-full px-2.5 py-1.5 rounded-lg hover:bg-white/[0.05] text-xs text-zinc-300 hover:text-zinc-100 flex items-center justify-between transition"
              >
                <span className="flex items-center gap-2">
                  {!isDesktopRuntime() && nodes.length === 0 ? (
                    <Download className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Settings className="w-3.5 h-3.5 text-zinc-400" />
                  )}
                  <span>
                    {!isDesktopRuntime() && nodes.length === 0
                      ? 'Descargar Workstation Desktop'
                      : 'Configurar...'}
                  </span>
                </span>
                <span className="text-[10px] font-mono text-zinc-500">Ctrl+,</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
