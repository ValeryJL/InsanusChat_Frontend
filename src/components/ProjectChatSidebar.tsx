import React, { useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Clock,
  Cloud,
  Code2,
  Folder,
  FolderGit2,
  Layers,
  Laptop,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import { ChatItem, ExecutionNodeItem } from '../types';

interface ProjectChatSidebarProps {
  chats: ChatItem[];
  nodes: ExecutionNodeItem[];
  activeChatId: string | null;
  mainSection: string;
  onSelectChat: (chat: ChatItem) => void;
  onDeleteChat: (chatId: string, e: React.MouseEvent) => void;
  onCreateChatInProject: (nodeId: string | null, workspacePath: string, openEditor?: boolean) => void;
  onOpenProjectEditor: (nodeId: string | null, workspacePath: string, existingChat?: ChatItem) => void;
}

interface ProjectGroup {
  key: string;
  label: string;
  workspacePath: string;
  nodeId: string | null;
  nodeName: string | null;
  isCloud: boolean;
  isGit?: boolean;
  chats: ChatItem[];
  latestTs: number;
}

const COLLAPSED_STORAGE_KEY = 'insanus_sidebar_collapsed_projects';

function readCollapsedState(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(COLLAPSED_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export const ProjectChatSidebar: React.FC<ProjectChatSidebarProps> = ({
  chats,
  nodes,
  activeChatId,
  mainSection,
  onSelectChat,
  onDeleteChat,
  onCreateChatInProject,
  onOpenProjectEditor,
}) => {
  const [filterText, setFilterText] = useState('');
  const [groupMode, setGroupMode] = useState<'project' | 'recent'>('project');
  const [collapsedMap, setCollapsedMap] = useState<Record<string, boolean>>(() => readCollapsedState());
  const [showEmptyWorkspaces, setShowEmptyWorkspaces] = useState(false);

  const toggleGroup = (key: string) => {
    setCollapsedMap((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try {
        localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  const nodeMap = useMemo(() => {
    const map = new Map<string, ExecutionNodeItem>();
    nodes.forEach((n) => map.set(n.node_id, n));
    return map;
  }, [nodes]);

  const { projectGroups, emptyWorkspaces, filteredFlatChats } = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    const groupsMap = new Map<string, ProjectGroup>();

    const primaryNode =
      nodes.find((n) => n.is_local_desktop) ||
      nodes.find((n) => n.status === 'online' || n.connected) ||
      nodes[0] ||
      null;

    for (const c of chats) {
      const isWs = c.execution_target === 'workstation';
      const wsPath = (c.workspace_path || '.').trim() || '.';
      const nid = isWs ? c.node_id || primaryNode?.node_id || null : null;
      const nodeObj = nid ? nodeMap.get(nid) : null;

      let label = 'General / Cloud';
      let isGit = false;
      if (isWs) {
        if (wsPath === '.') {
          const rootName = nodeObj?.root_dir
            ? nodeObj.root_dir.replace(/[\\/]+$/, '').split(/[\\/]/).pop()
            : null;
          label = rootName || nodeObj?.name || 'Workspace Local';
        } else {
          label = wsPath.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || wsPath;
        }
        const matchedWs = (nodeObj?.workspaces || []).find((w) => w.path === wsPath || w.name === label);
        isGit = Boolean(matchedWs?.is_git);
      }

      const key = isWs ? `ws::${nid || 'any'}::${wsPath}` : 'cloud::general';
      const ts = new Date(c.last_updated || c.created_at || 0).getTime() || 0;

      if (!groupsMap.has(key)) {
        groupsMap.set(key, {
          key,
          label,
          workspacePath: isWs ? wsPath : '.',
          nodeId: nid,
          nodeName: nodeObj?.name || null,
          isCloud: !isWs,
          isGit,
          chats: [],
          latestTs: ts,
        });
      }
      const g = groupsMap.get(key)!;
      g.chats.push(c);
      if (ts > g.latestTs) g.latestTs = ts;
    }

    // Ordenar chats dentro de cada grupo y los grupos por actividad más reciente (proyectos primero)
    let groups = Array.from(groupsMap.values()).map((g) => ({
      ...g,
      chats: [...g.chats].sort(
        (a, b) =>
          (new Date(b.last_updated || b.created_at || 0).getTime() || 0) -
          (new Date(a.last_updated || a.created_at || 0).getTime() || 0)
      ),
    }));

    if (q) {
      groups = groups
        .map((g) => {
          const groupMatches = g.label.toLowerCase().includes(q) || g.workspacePath.toLowerCase().includes(q);
          if (groupMatches) return g;
          const matchingChats = g.chats.filter((c) => (c.title || '').toLowerCase().includes(q));
          return { ...g, chats: matchingChats };
        })
        .filter((g) => g.chats.length > 0);
    }

    groups.sort((a, b) => {
      if (a.isCloud !== b.isCloud) return a.isCloud ? 1 : -1;
      return b.latestTs - a.latestTs;
    });

    // Workspaces disponibles del equipo que todavía no tienen chats
    const existingKeys = new Set(groups.map((g) => `${g.nodeId || ''}::${g.workspacePath}`));
    const emptyList: { nodeId: string; nodeName: string; name: string; path: string; isGit?: boolean }[] = [];
    for (const n of nodes) {
      for (const w of n.workspaces || []) {
        if (w.path === '.') continue;
        const k = `${n.node_id}::${w.path}`;
        if (existingKeys.has(k)) continue;
        if (q && !w.name.toLowerCase().includes(q) && !w.path.toLowerCase().includes(q)) continue;
        emptyList.push({
          nodeId: n.node_id,
          nodeName: n.name,
          name: w.name,
          path: w.path,
          isGit: w.is_git,
        });
      }
    }

    const flat = q
      ? chats.filter(
          (c) =>
            (c.title || '').toLowerCase().includes(q) ||
            (c.workspace_path || '').toLowerCase().includes(q)
        )
      : chats;

    return { projectGroups: groups, emptyWorkspaces: emptyList, filteredFlatChats: flat };
  }, [chats, filterText, nodeMap, nodes]);

  const showNodeSubtitle = nodes.length > 1;

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      {/* Barra compacta de búsqueda + conmutador Por Proyecto / Recientes */}
      <div className="px-2.5 pb-2 space-y-1.5 shrink-0">
        <div className="relative">
          <Search className="w-3 h-3 text-zinc-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            placeholder="Filtrar proyectos o chats..."
            className="w-full h-7 pl-7 pr-2 rounded-lg bg-[#09090b] border border-white/[0.08] text-[11.5px] text-zinc-200 placeholder:text-zinc-500 outline-none focus:border-emerald-500/50 transition"
          />
        </div>
        <div className="flex items-center justify-between px-0.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            {groupMode === 'project' ? 'Proyectos' : 'Recientes'}
          </span>
          <div className="flex items-center p-0.5 rounded-md bg-[#09090b] border border-white/[0.07]">
            <button
              type="button"
              onClick={() => setGroupMode('project')}
              className={`h-5 px-1.5 rounded text-[10px] flex items-center gap-1 transition ${
                groupMode === 'project'
                  ? 'bg-white/[0.10] text-zinc-100'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
              title="Agrupar chats por proyecto (Antigravity)"
            >
              <Layers className="w-2.5 h-2.5" />
              <span>Proyectos</span>
            </button>
            <button
              type="button"
              onClick={() => setGroupMode('recent')}
              className={`h-5 px-1.5 rounded text-[10px] flex items-center gap-1 transition ${
                groupMode === 'recent'
                  ? 'bg-white/[0.10] text-zinc-100'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
              title="Lista cronológica reciente"
            >
              <Clock className="w-2.5 h-2.5" />
              <span>Recientes</span>
            </button>
          </div>
        </div>
      </div>

      {/* Contenido scrolleable */}
      <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-1.5">
        {groupMode === 'recent' ? (
          <div className="space-y-0.5">
            {filteredFlatChats.map((c) => {
              const active = activeChatId === c._id && mainSection === 'chat';
              return (
                <div
                  key={c._id}
                  onClick={() => onSelectChat(c)}
                  className={`group h-8 flex items-center justify-between px-2 rounded-lg cursor-pointer text-xs transition ${
                    active
                      ? 'bg-white/[0.09] text-zinc-50 font-medium'
                      : 'text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200'
                  }`}
                >
                  <div className="truncate pr-1.5 flex items-center gap-2 min-w-0">
                    {c.execution_target === 'workstation' ? (
                      <Laptop className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    ) : (
                      <Cloud className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                    )}
                    <span className="truncate">{c.title || 'Nueva conversación'}</span>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => onDeleteChat(c._id, e)}
                    className="opacity-70 md:opacity-0 md:group-hover:opacity-100 p-1 rounded hover:bg-rose-500/15 text-zinc-500 hover:text-rose-400 transition shrink-0"
                    title="Eliminar chat"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <>
            {projectGroups.map((group) => {
              const isCollapsed = Boolean(collapsedMap[group.key]) && !filterText.trim();
              const hasActiveChat = group.chats.some((c) => c._id === activeChatId && mainSection === 'chat');

              return (
                <div key={group.key} className="space-y-0.5">
                  {/* Cabecera de Proyecto estilo Antigravity */}
                  <div
                    className={`group/proj h-7 px-1.5 rounded-lg flex items-center justify-between gap-1 select-none transition ${
                      hasActiveChat
                        ? 'bg-white/[0.04] text-zinc-200'
                        : 'text-zinc-400 hover:bg-white/[0.03] hover:text-zinc-200'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => toggleGroup(group.key)}
                      className="flex items-center gap-1.5 min-w-0 flex-1 text-left"
                      title={
                        group.isCloud
                          ? 'Conversaciones en la Nube'
                          : `${group.workspacePath}${group.nodeName ? ` (${group.nodeName})` : ''}`
                      }
                    >
                      {isCollapsed ? (
                        <ChevronRight className="w-3 h-3 text-zinc-500 shrink-0" />
                      ) : (
                        <ChevronDown className="w-3 h-3 text-zinc-500 shrink-0" />
                      )}
                      {group.isCloud ? (
                        <Cloud className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                      ) : group.isGit ? (
                        <FolderGit2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      ) : (
                        <Folder className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                      )}
                      <span className="text-[11.5px] font-semibold truncate">{group.label}</span>
                      {showNodeSubtitle && !group.isCloud && group.nodeName && (
                        <span className="text-[9.5px] font-mono text-zinc-600 truncate hidden sm:inline">
                          · {group.nodeName}
                        </span>
                      )}
                    </button>

                    <div className="flex items-center gap-0.5 shrink-0">
                      <span className="text-[10px] font-mono text-zinc-600 group-hover/proj:hidden px-1 tabular-nums">
                        {group.chats.length}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          onCreateChatInProject(group.isCloud ? null : group.nodeId, group.workspacePath, false)
                        }
                        className="hidden group-hover/proj:flex w-5 h-5 rounded hover:bg-emerald-500/20 text-zinc-400 hover:text-emerald-300 items-center justify-center transition"
                        title={`Nuevo chat en ${group.label}`}
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                      {!group.isCloud && (
                        <button
                          type="button"
                          onClick={() =>
                            onOpenProjectEditor(group.nodeId, group.workspacePath, group.chats[0])
                          }
                          className="hidden group-hover/proj:flex w-5 h-5 rounded hover:bg-sky-500/20 text-zinc-400 hover:text-sky-300 items-center justify-center transition"
                          title={`Abrir ${group.label} en Editor VS Code`}
                        >
                          <Code2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Lista de conversaciones dentro del proyecto */}
                  {!isCollapsed && (
                    <div className="pl-3.5 ml-2 border-l border-white/[0.06] space-y-0.5">
                      {group.chats.map((c) => {
                        const active = activeChatId === c._id && mainSection === 'chat';
                        return (
                          <div
                            key={c._id}
                            onClick={() => onSelectChat(c)}
                            className={`group h-7 flex items-center justify-between px-2 rounded-md cursor-pointer text-[11.5px] transition ${
                              active
                                ? 'bg-emerald-500/12 text-emerald-200 font-medium border border-emerald-500/20'
                                : 'text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200 border border-transparent'
                            }`}
                          >
                            <span className="truncate pr-1">{c.title || 'Nueva conversación'}</span>
                            <button
                              type="button"
                              onClick={(e) => onDeleteChat(c._id, e)}
                              className="opacity-70 md:opacity-0 md:group-hover:opacity-100 p-0.5 rounded hover:bg-rose-500/15 text-zinc-500 hover:text-rose-400 transition shrink-0"
                              title="Eliminar chat"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Workspaces detectados sin conversaciones todavía */}
            {emptyWorkspaces.length > 0 && (
              <div className="pt-2 border-t border-white/[0.06]">
                <button
                  type="button"
                  onClick={() => setShowEmptyWorkspaces((s) => !s)}
                  className="w-full h-6 px-1.5 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-zinc-500 hover:text-zinc-300 transition"
                >
                  <span>Otros proyectos ({emptyWorkspaces.length})</span>
                  {showEmptyWorkspaces ? (
                    <ChevronDown className="w-3 h-3" />
                  ) : (
                    <ChevronRight className="w-3 h-3" />
                  )}
                </button>
                {showEmptyWorkspaces && (
                  <div className="mt-1 space-y-0.5">
                    {emptyWorkspaces.map((w) => (
                      <div
                        key={`${w.nodeId}::${w.path}`}
                        className="group/ws h-7 px-2 rounded-lg flex items-center justify-between gap-1.5 text-[11.5px] text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-200 transition"
                      >
                        <button
                          type="button"
                          onClick={() => onCreateChatInProject(w.nodeId, w.path, false)}
                          className="flex items-center gap-1.5 min-w-0 flex-1 text-left"
                          title={`Iniciar chat en ${w.name}`}
                        >
                          {w.isGit ? (
                            <FolderGit2 className="w-3.5 h-3.5 text-zinc-500 group-hover/ws:text-emerald-400 shrink-0" />
                          ) : (
                            <Folder className="w-3.5 h-3.5 text-zinc-600 shrink-0" />
                          )}
                          <span className="truncate">{w.name}</span>
                        </button>
                        <div className="flex items-center gap-0.5 opacity-80 md:opacity-0 md:group-hover/ws:opacity-100 shrink-0">
                          <button
                            type="button"
                            onClick={() => onCreateChatInProject(w.nodeId, w.path, false)}
                            className="w-5 h-5 rounded hover:bg-emerald-500/20 text-zinc-400 hover:text-emerald-300 flex items-center justify-center"
                            title={`Nuevo chat en ${w.name}`}
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onCreateChatInProject(w.nodeId, w.path, true)}
                            className="w-5 h-5 rounded hover:bg-sky-500/20 text-zinc-400 hover:text-sky-300 flex items-center justify-center"
                            title={`Abrir ${w.name} en Editor VS Code`}
                          >
                            <Code2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {projectGroups.length === 0 && emptyWorkspaces.length === 0 && (
              <div className="px-2 py-6 text-center text-[11px] text-zinc-500">
                No hay conversaciones que coincidan.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
