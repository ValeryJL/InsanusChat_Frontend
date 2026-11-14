import React, { useCallback, useEffect, useRef, useState } from 'react';
import Editor, { DiffEditor } from '@monaco-editor/react';
import {
  ChevronDown,
  ChevronRight,
  Code2,
  ExternalLink,
  FileCode2,
  FileDiff,
  FilePlus,
  Files,
  Folder,
  FolderOpen,
  GitBranch,
  Globe,
  Loader2,
  Lock,
  Play,
  RefreshCw,
  Save,
  Search,
  Square,
  TerminalSquare,
  Trash2,
  X,
} from 'lucide-react';
import { api } from '../api';
import { defineInsanusTheme, ensureMonacoConfigured } from '../monacoSetup';
import { getLocalDaemonNodeId, isDesktopRuntime } from '../platform/desktop';
import { ExecutionNodeItem, FileTreeNode } from '../types';
import { XtermTerminal } from './XtermTerminal';

ensureMonacoConfigured();

interface VSCodeEditorViewProps {
  node: ExecutionNodeItem | null;
  workspace: string;
  initialFilePath?: string | null;
  initialDiff?: string | null;
  showAgentDock: boolean;
  onToggleAgentDock: () => void;
  agentDockSlot?: React.ReactNode;
  onActiveFileChange?: (path: string | null) => void;
  onTogglePrivacy?: () => Promise<void>;
}

interface OpenTab {
  path: string;
  name: string;
  content: string;
  savedContent: string;
  originalContent?: string;
  language: string;
  diff?: string;
}

type ActivityTab = 'explorer' | 'search' | 'git';

function fileIconColor(filename: string): string {
  const low = filename.toLowerCase();
  if (low.endsWith('.tsx') || low.endsWith('.ts')) return 'text-sky-400';
  if (low.endsWith('.jsx') || low.endsWith('.js')) return 'text-amber-300';
  if (low.endsWith('.py')) return 'text-yellow-400';
  if (low.endsWith('.json')) return 'text-amber-400';
  if (low.endsWith('.css') || low.endsWith('.scss')) return 'text-pink-400';
  if (low.endsWith('.html')) return 'text-orange-400';
  if (low.endsWith('.md')) return 'text-zinc-300';
  if (low.endsWith('.yml') || low.endsWith('.yaml')) return 'text-rose-400';
  if (low.endsWith('.sh') || low.endsWith('.ps1') || low.endsWith('.bat')) return 'text-emerald-400';
  return 'text-zinc-400';
}

export const VSCodeEditorView: React.FC<VSCodeEditorViewProps> = ({
  node,
  workspace,
  initialFilePath,
  initialDiff,
  showAgentDock,
  agentDockSlot,
  onActiveFileChange,
  onTogglePrivacy,
}) => {
  const [activeActivity, setActiveActivity] = useState<ActivityTab | null>(() =>
    typeof window !== 'undefined' && window.innerWidth >= 768 ? 'explorer' : null
  );
  const [tree, setTree] = useState<FileTreeNode[]>([]);
  const [expandedDirs, setExpandedDirs] = useState<Record<string, boolean>>({});
  const [loadingTree, setLoadingTree] = useState(false);

  // Search (Workspace Grep)
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<{ path: string; line: number; content: string }[]>([]);
  const [searching, setSearching] = useState(false);

  // Source Control (Git)
  const [gitInfo, setGitInfo] = useState<{ branch?: string; status_short?: string; diff_stat?: string } | null>(null);

  // Tabs & Monaco Editor state
  const [tabs, setTabs] = useState<OpenTab[]>([]);
  const [activeTabPath, setActiveTabPath] = useState<string | null>(null);
  const [diffMode, setDiffMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [cursorPos, setCursorPos] = useState({ line: 1, col: 1 });
  const [creatingFile, setCreatingFile] = useState(false);
  const [newFilePath, setNewFilePath] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Bottom Terminal Panel (starts collapsed on mobile <768px)
  const [terminalOpen, setTerminalOpen] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 768 : true
  );
  const [terminalTall, setTerminalTall] = useState(false);
  const [terminalTab, setTerminalTab] = useState<'console' | 'processes'>('console');
  const [bgProcesses, setBgProcesses] = useState<any[]>([]);
  const [newBgCommand, setNewBgCommand] = useState('');

  const editorInstanceRef = useRef<any>(null);
  const pendingJumpLineRef = useRef<number | null>(null);
  const nodeId = node?.node_id || 'local-workstation-host';

  const notify = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  };

  const loadWorkspaceData = useCallback(async () => {
    if (!nodeId) return;
    setLoadingTree(true);
    try {
      const [treeRes, gitRes, procRes] = await Promise.all([
        api.getWorkspaceFileTree(nodeId, workspace, '.', 4),
        api.getWorkspaceGitStatus(nodeId, workspace).catch(() => null),
        api.listWorkspaceProcesses(nodeId, workspace).catch(() => null),
      ]);
      if (treeRes?.data?.tree) setTree(treeRes.data.tree);
      if (gitRes?.data) setGitInfo(gitRes.data);
      if (procRes?.data?.processes) setBgProcesses(procRes.data.processes);
    } catch (e: any) {
      notify(e.message || 'Error cargando archivos del proyecto');
    } finally {
      setLoadingTree(false);
    }
  }, [nodeId, workspace]);

  useEffect(() => {
    loadWorkspaceData();
  }, [loadWorkspaceData]);

  const openFileInTab = useCallback(
    async (filePath: string, customDiff?: string | null, jumpLine?: number, openInDiff = false) => {
      if (!nodeId || !filePath) return;
      try {
        const res = await api.readWorkspaceFile(nodeId, workspace, filePath);
        const data = res?.data;
        if (!data) return;
        const name = filePath.split('/').pop() || filePath;
        const rawText = data.raw_content ?? data.content ?? '';

        let originalText: string | undefined = undefined;
        if (openInDiff) {
          try {
            const gitShow = await api.execWorkspaceCommand(nodeId, workspace, `git show HEAD:${data.path}`, 8);
            if (gitShow?.data?.ok) {
              originalText = gitShow.data.stdout;
            }
          } catch {}
        }

        setTabs((prev) => {
          const exists = prev.find((t) => t.path === data.path);
          if (exists) {
            return prev.map((t) =>
              t.path === data.path
                ? {
                    ...t,
                    content: rawText,
                    savedContent: rawText,
                    originalContent: originalText ?? t.originalContent,
                    diff: customDiff || t.diff,
                  }
                : t
            );
          }
          return [
            ...prev,
            {
              path: data.path,
              name,
              content: rawText,
              savedContent: rawText,
              originalContent: originalText,
              language: data.language || 'plaintext',
              diff: customDiff || undefined,
            },
          ];
        });
        setActiveTabPath(data.path);
        setConfirmDelete(false);
        setDiffMode(Boolean(openInDiff));
        if (jumpLine) {
          pendingJumpLineRef.current = jumpLine;
          setTimeout(() => {
            if (editorInstanceRef.current && pendingJumpLineRef.current) {
              editorInstanceRef.current.revealLineInCenter(pendingJumpLineRef.current);
              editorInstanceRef.current.setPosition({ lineNumber: pendingJumpLineRef.current, column: 1 });
              editorInstanceRef.current.focus();
              pendingJumpLineRef.current = null;
            }
          }, 120);
        }
        if (typeof window !== 'undefined' && window.innerWidth < 768) {
          setActiveActivity(null);
        }
      } catch (e: any) {
        notify(e.message || `No se pudo abrir ${filePath}`);
      }
    },
    [nodeId, workspace]
  );

  useEffect(() => {
    if (initialFilePath) {
      openFileInTab(initialFilePath, initialDiff, undefined, Boolean(initialDiff));
    }
  }, [initialFilePath, initialDiff, openFileInTab]);

  useEffect(() => {
    onActiveFileChange?.(activeTabPath);
  }, [activeTabPath, onActiveFileChange]);

  const activeTab = tabs.find((t) => t.path === activeTabPath) || null;
  const activeTabRef = useRef<OpenTab | null>(null);
  activeTabRef.current = activeTab;

  const handleSaveActiveFile = useCallback(async () => {
    const tab = activeTabRef.current;
    if (!tab || !nodeId) return;
    setSaving(true);
    try {
      const res = await api.writeWorkspaceFile(nodeId, workspace, tab.path, tab.content);
      const diff = res?.data?.diff || '';
      setTabs((prev) =>
        prev.map((t) =>
          t.path === tab.path
            ? { ...t, savedContent: tab.content, originalContent: t.originalContent ?? t.savedContent, diff: diff || t.diff }
            : t
        )
      );
      notify(`Guardado: ${tab.name}`);
      await loadWorkspaceData();
    } catch (e: any) {
      notify(e.message || 'Error guardando archivo');
    } finally {
      setSaving(false);
    }
  }, [nodeId, workspace, loadWorkspaceData]);

  // Atajos globales: Ctrl+S guardar y Ctrl+` abrir/cerrar terminal
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        if (activeTabRef.current) {
          e.preventDefault();
          handleSaveActiveFile();
        }
      } else if (e.ctrlKey && e.key === '`') {
        e.preventDefault();
        setTerminalOpen((t) => !t);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleSaveActiveFile]);

  const handleSearchWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim() || !nodeId) return;
    setSearching(true);
    try {
      const res = await api.searchWorkspaceFiles(nodeId, workspace, searchQuery.trim());
      setSearchResults(res?.data?.matches || []);
    } catch (err: any) {
      notify(err.message || 'Error en búsqueda');
    } finally {
      setSearching(false);
    }
  };

  const handleCreateFile = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = newFilePath.trim();
    if (!clean || !nodeId) return;
    try {
      await api.writeWorkspaceFile(nodeId, workspace, clean, '');
      setNewFilePath('');
      setCreatingFile(false);
      await loadWorkspaceData();
      await openFileInTab(clean);
    } catch (err: any) {
      notify(err.message || 'No se pudo crear el archivo');
    }
  };

  const toggleActivity = (tab: ActivityTab) => {
    setActiveActivity((prev) => (prev === tab ? null : tab));
  };

  const gitChangedFiles = (gitInfo?.status_short || '')
    .split('\n')
    .map((l) => l.trimEnd())
    .filter(Boolean)
    .map((line) => ({
      code: line.slice(0, 2).trim() || 'M',
      path: line.slice(2).trim(),
    }));

  const isDirty = Boolean(activeTab && activeTab.content !== activeTab.savedContent);

  const renderFileTree = (items: FileTreeNode[], depth = 0) =>
    items.map((item) => {
      const isDir = item.type === 'directory';
      const isExpanded = expandedDirs[item.path] ?? depth < 1;
      const isSelected = activeTabPath === item.path;

      if (isDir) {
        return (
          <div key={item.path}>
            <button
              type="button"
              onClick={() => setExpandedDirs((prev) => ({ ...prev, [item.path]: !isExpanded }))}
              style={{ paddingLeft: `${depth * 12 + 8}px` }}
              className="w-full h-[26px] pr-2 flex items-center gap-1.5 text-left text-[12.5px] text-zinc-300 hover:bg-white/[0.04] rounded transition"
            >
              {isExpanded ? (
                <ChevronDown className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
              )}
              {isExpanded ? (
                <FolderOpen className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
              ) : (
                <Folder className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
              )}
              <span className="truncate">{item.name}</span>
            </button>
            {isExpanded && item.children && <div>{renderFileTree(item.children, depth + 1)}</div>}
          </div>
        );
      }

      return (
        <button
          key={item.path}
          type="button"
          onClick={() => openFileInTab(item.path)}
          style={{ paddingLeft: `${depth * 12 + 22}px` }}
          className={`w-full h-[26px] pr-2 flex items-center gap-1.5 text-left text-[12.5px] rounded transition ${
            isSelected
              ? 'bg-white/[0.08] text-zinc-100 font-medium'
              : 'text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200'
          }`}
        >
          <FileCode2 className={`w-3.5 h-3.5 shrink-0 ${fileIconColor(item.name)}`} />
          <span className="truncate font-mono text-[12px]">{item.name}</span>
        </button>
      );
    });

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-[#0b0d12] text-zinc-100 overflow-hidden relative">
      {/* FILA PRINCIPAL DEL WORKBENCH VS CODE */}
      <div className="flex-1 min-h-0 flex overflow-hidden relative">
        {/* 1. VS CODE ACTIVITY BAR (w-11) */}
        <div className="w-10 sm:w-11 bg-[#0e1017] border-r border-white/[0.07] flex flex-col items-center justify-between py-1.5 shrink-0 z-20">
          <div className="w-full flex flex-col items-center gap-0.5">
            {(
              [
                { id: 'explorer', icon: Files, title: 'Explorador de Archivos' },
                { id: 'search', icon: Search, title: 'Buscar en Workspace (Grep)' },
                { id: 'git', icon: GitBranch, title: 'Control de Código Fuente (Git)', badge: gitChangedFiles.length },
              ] as const
            ).map((item) => {
              const Icon = item.icon;
              const isActive = activeActivity === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => toggleActivity(item.id)}
                  title={item.title}
                  className={`relative w-full h-10 flex items-center justify-center transition ${
                    isActive
                      ? 'text-zinc-100 before:absolute before:left-0 before:inset-y-2 before:w-[2px] before:bg-emerald-500 before:rounded-r'
                      : 'text-zinc-500 hover:text-zinc-200'
                  }`}
                >
                  <Icon className="w-[18px] h-[18px]" />
                  {'badge' in item && item.badge > 0 && (
                    <span className="absolute top-1.5 right-1.5 min-w-[14px] h-[14px] px-1 rounded-full bg-sky-500 text-zinc-950 text-[9px] font-bold flex items-center justify-center tabular-nums">
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => setTerminalOpen((o) => !o)}
            title="Alternar Terminal Integrada (Ctrl+`)"
            className={`relative w-full h-10 flex items-center justify-center transition ${
              terminalOpen ? 'text-emerald-400' : 'text-zinc-500 hover:text-zinc-200'
            }`}
          >
            <TerminalSquare className="w-[18px] h-[18px]" />
            {terminalOpen && (
              <span className="absolute bottom-1.5 right-2 w-1.5 h-1.5 rounded-full bg-emerald-400" />
            )}
          </button>
        </div>

        {/* Backdrop móvil cuando se abre un panel de la Activity Bar */}
        {activeActivity && (
          <div
            onClick={() => setActiveActivity(null)}
            className="fixed inset-0 top-12 z-20 bg-black/60 backdrop-blur-sm md:hidden"
          />
        )}

        {/* 2. PRIMARY SIDE PANEL (Explorer / Search / Git / Complementos Oficiales VS Code) */}
        {activeActivity && (
          <aside className="fixed inset-y-0 top-12 left-10 z-30 w-64 md:static md:w-64 bg-[#11131a] border-r border-white/[0.07] flex flex-col shrink-0 overflow-hidden shadow-2xl md:shadow-none">
            {/* PANEL A: EXPLORADOR */}
            {activeActivity === 'explorer' && (
              <>
                <div className="h-9 px-3 border-b border-white/[0.06] flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-zinc-400 shrink-0">
                  <span className="truncate">{workspace === '.' ? node?.name || 'Workspace' : workspace}</span>
                  <div className="flex items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => setCreatingFile((c) => !c)}
                      className="p-1 rounded hover:bg-white/[0.06] text-zinc-400 hover:text-zinc-100"
                      title="Nuevo archivo"
                    >
                      <FilePlus className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={loadWorkspaceData}
                      className="p-1 rounded hover:bg-white/[0.06] text-zinc-400 hover:text-zinc-100"
                      title="Refrescar"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${loadingTree ? 'animate-spin' : ''}`} />
                    </button>
                  </div>
                </div>

                {creatingFile && (
                  <form onSubmit={handleCreateFile} className="p-2 border-b border-white/[0.06] flex gap-1.5">
                    <input
                      value={newFilePath}
                      onChange={(e) => setNewFilePath(e.target.value)}
                      placeholder="src/archivo.py"
                      className="flex-1 h-7 px-2 rounded-md bg-[#0b0d12] border border-white/[0.12] focus:border-emerald-500/60 text-xs font-mono text-zinc-100 outline-none"
                      autoFocus
                    />
                    <button
                      type="submit"
                      className="h-7 px-2 rounded-md bg-emerald-500 text-zinc-950 font-semibold text-xs"
                    >
                      +
                    </button>
                  </form>
                )}

                <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
                  {tree.length === 0 && !loadingTree && (
                    <div className="p-4 text-center text-xs text-zinc-500">
                      Sin archivos accesibles (verificá el modo Solo Local).
                    </div>
                  )}
                  {renderFileTree(tree)}
                </div>
              </>
            )}

            {/* PANEL B: BUSCAR EN WORKSPACE (GREP) */}
            {activeActivity === 'search' && (
              <>
                <div className="h-9 px-3 border-b border-white/[0.06] flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-zinc-400 shrink-0">
                  <span>Buscar</span>
                  {searchResults.length > 0 && (
                    <span className="font-mono text-[10px] text-zinc-500 tabular-nums">
                      {searchResults.length} res.
                    </span>
                  )}
                </div>
                <form onSubmit={handleSearchWorkspace} className="p-2.5 border-b border-white/[0.06] space-y-2">
                  <div className="flex gap-1.5">
                    <input
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Texto o regex..."
                      className="flex-1 h-8 px-2.5 rounded-md bg-[#0b0d12] border border-white/[0.09] focus:border-emerald-500/60 text-xs font-mono text-zinc-100 outline-none"
                      autoFocus
                    />
                    <button
                      type="submit"
                      disabled={searching}
                      className="h-8 px-2.5 rounded-md bg-white/[0.08] hover:bg-white/[0.14] text-zinc-200 text-xs"
                    >
                      {searching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </form>
                <div className="flex-1 overflow-y-auto p-1.5 space-y-1">
                  {searchResults.map((m, idx) => (
                    <button
                      key={`${m.path}-${m.line}-${idx}`}
                      type="button"
                      onClick={() => openFileInTab(m.path, null, m.line, false)}
                      className="w-full p-2 rounded-md hover:bg-white/[0.05] text-left transition space-y-0.5"
                    >
                      <div className="flex items-center justify-between gap-2 text-[11px] font-mono">
                        <span className="text-zinc-200 truncate">{m.path}</span>
                        <span className="text-zinc-500 shrink-0">:{m.line}</span>
                      </div>
                      <div className="text-[11px] font-mono text-zinc-500 truncate">{m.content}</div>
                    </button>
                  ))}
                  {searchResults.length === 0 && !searching && (
                    <div className="p-4 text-center text-xs text-zinc-500">
                      Ingresá un término para buscar en todo el proyecto.
                    </div>
                  )}
                </div>
              </>
            )}

            {/* PANEL C: CONTROL DE CÓDIGO FUENTE (GIT) */}
            {activeActivity === 'git' && (
              <>
                <div className="h-9 px-3 border-b border-white/[0.06] flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-zinc-400 shrink-0">
                  <span>Control de Código</span>
                  <button
                    type="button"
                    onClick={loadWorkspaceData}
                    className="p-1 rounded hover:bg-white/[0.06] text-zinc-400 hover:text-zinc-100"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="p-3 border-b border-white/[0.06] flex items-center gap-2 text-xs">
                  <GitBranch className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="font-mono text-zinc-200">{gitInfo?.branch || 'Sin repo Git'}</span>
                </div>
                <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
                  {gitChangedFiles.map((f) => (
                    <button
                      key={f.path}
                      type="button"
                      onClick={() => openFileInTab(f.path, null, undefined, true)}
                      className="w-full h-7 px-2 rounded hover:bg-white/[0.05] flex items-center justify-between gap-2 text-xs transition"
                    >
                      <span className="font-mono text-[11.5px] text-zinc-300 truncate">{f.path}</span>
                      <span
                        className={`font-mono text-[10px] font-bold shrink-0 ${
                          f.code.includes('M')
                            ? 'text-amber-400'
                            : f.code.includes('D')
                            ? 'text-rose-400'
                            : 'text-emerald-400'
                        }`}
                      >
                        {f.code}
                      </span>
                    </button>
                  ))}
                  {gitChangedFiles.length === 0 && (
                    <div className="p-4 text-center text-xs text-zinc-500">
                      Árbol de trabajo limpio. Clic en archivos modificados abre Monaco DiffEditor.
                    </div>
                  )}
                </div>
              </>
            )}
          </aside>
        )}

        {/* 3. COLUMNA CENTRAL: MONACO EDITOR / DIFFEDITOR + BOTTOM XTERM TERMINAL */}
        <div className="flex-1 min-w-0 flex flex-col bg-[#0b0d12] overflow-hidden">
          {/* Tab Bar (h-9) */}
          <div className="h-9 bg-[#0e1017] border-b border-white/[0.07] flex items-center overflow-x-auto no-scrollbar shrink-0">
            {tabs.map((tab) => {
              const tabDirty = tab.content !== tab.savedContent;
              const isActive = tab.path === activeTabPath;
              return (
                <div
                  key={tab.path}
                  onClick={() => {
                    setActiveTabPath(tab.path);
                    setConfirmDelete(false);
                  }}
                  className={`group h-full px-3 flex items-center gap-2 border-r border-white/[0.06] cursor-pointer text-xs font-mono shrink-0 transition ${
                    isActive
                      ? 'bg-[#0b0d12] text-zinc-100 border-t-2 border-t-emerald-500'
                      : 'text-zinc-500 hover:bg-white/[0.03] hover:text-zinc-300'
                  }`}
                >
                  <FileCode2 className={`w-3.5 h-3.5 ${fileIconColor(tab.name)}`} />
                  <span>{tab.name}</span>
                  {tabDirty && <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      const rem = tabs.filter((t) => t.path !== tab.path);
                      setTabs(rem);
                      if (activeTabPath === tab.path) {
                        setActiveTabPath(rem[rem.length - 1]?.path || null);
                      }
                    }}
                    className="p-0.5 rounded hover:bg-white/[0.08] text-zinc-500 hover:text-zinc-100 opacity-70 group-hover:opacity-100"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              );
            })}
            {toast && (
              <div className="ml-auto px-3 text-[11px] text-emerald-400 font-medium truncate">
                {toast}
              </div>
            )}
          </div>

          {/* Breadcrumbs & File Actions Bar (h-7) */}
          {activeTab && (
            <div className="h-7 px-3 bg-[#0b0d12] border-b border-white/[0.05] flex items-center justify-between gap-2 text-[11px] shrink-0">
              <div className="flex items-center gap-1 font-mono text-zinc-500 truncate">
                <span className="hidden sm:inline">{workspace}</span>
                {activeTab.path.split('/').map((seg, i, arr) => (
                  <React.Fragment key={i}>
                    <span className="text-zinc-600">›</span>
                    <span className={i === arr.length - 1 ? 'text-zinc-200 font-medium' : ''}>{seg}</span>
                  </React.Fragment>
                ))}
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                {isDesktopRuntime() && (node?.is_local_desktop || nodeId === getLocalDaemonNodeId()) && (
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const res = await api.launchLocalEditor({
                          workspace,
                          file_path: activeTab.path,
                          line: cursorPos.line,
                        });
                        notify(res?.ok ? `Abierto en editor local (${activeTab.name}:${cursorPos.line})` : res?.message || 'Editor no encontrado');
                      } catch (err: any) {
                        notify(err.message || 'Error abriendo VS Code Desktop');
                      }
                    }}
                    className="h-5 px-2 rounded bg-sky-500/15 hover:bg-sky-500/25 border border-sky-500/30 text-sky-300 text-[11px] flex items-center gap-1 transition"
                    title="Abrir este archivo en tu VS Code / VSCodium Desktop en la línea actual"
                  >
                    <ExternalLink className="w-3 h-3" />
                    <span className="hidden md:inline">VS Code</span>
                  </button>
                )}

                {(activeTab.originalContent !== undefined || isDirty) && (
                  <button
                    type="button"
                    onClick={() => setDiffMode((d) => !d)}
                    className={`h-5 px-2 rounded text-[11px] flex items-center gap-1 transition ${
                      diffMode
                        ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                        : 'bg-white/[0.05] text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    <FileDiff className="w-3 h-3" />
                    <span>Diff</span>
                  </button>
                )}

                {isDirty ? (
                  <button
                    type="button"
                    onClick={handleSaveActiveFile}
                    disabled={saving}
                    className="h-5 px-2 rounded bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 text-[11px] font-medium flex items-center gap-1 transition"
                  >
                    {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                    <span>Guardar · Ctrl+S</span>
                  </button>
                ) : (
                  <span className="text-zinc-600 text-[11px] hidden sm:inline">Guardado</span>
                )}

                {confirmDelete ? (
                  <button
                    type="button"
                    onClick={async () => {
                      await api.deleteWorkspaceFile(nodeId, workspace, activeTab.path);
                      setTabs((prev) => prev.filter((t) => t.path !== activeTab.path));
                      setActiveTabPath(null);
                      setConfirmDelete(false);
                      await loadWorkspaceData();
                    }}
                    className="h-5 px-2 rounded bg-rose-500/20 text-rose-300 text-[11px] font-medium"
                  >
                    ¿Confirmar?
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(true)}
                    className="p-0.5 rounded text-zinc-500 hover:text-rose-400 transition"
                    title="Eliminar archivo"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Área de Monaco Editor / DiffEditor */}
          <div className="flex-1 min-h-0 relative overflow-hidden">
            {!activeTab ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-3">
                <div className="w-11 h-11 rounded-2xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center">
                  <Code2 className="w-5 h-5 text-emerald-400" />
                </div>
                <div className="space-y-1">
                  <div className="text-sm font-semibold text-zinc-200">
                    VS Code Workbench — {workspace === '.' ? node?.name || 'Local' : workspace}
                  </div>
                  <p className="text-xs text-zinc-500 max-w-sm">
                    Abrí un archivo del Explorador, buscá en el proyecto, revisá cambios Git o usá la terminal integrada con <kbd className="px-1.5 py-0.5 rounded bg-white/[0.06] text-zinc-300 font-mono text-[10px]">Ctrl+`</kbd>.
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setActiveActivity('explorer')}
                    className="h-8 px-3 rounded-lg bg-white/[0.06] hover:bg-white/[0.10] border border-white/[0.08] text-xs text-zinc-200 flex items-center gap-1.5"
                  >
                    <Files className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Explorar Archivos</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveActivity('search')}
                    className="h-8 px-3 rounded-lg bg-white/[0.06] hover:bg-white/[0.10] border border-white/[0.08] text-xs text-zinc-200 flex items-center gap-1.5"
                  >
                    <Search className="w-3.5 h-3.5 text-sky-400" />
                    <span>Buscar en Proyecto</span>
                  </button>
                </div>
              </div>
            ) : diffMode ? (
              <DiffEditor
                height="100%"
                theme="insanus-obsidian"
                beforeMount={defineInsanusTheme}
                loading={
                  <div className="h-full flex items-center justify-center bg-[#09090b] text-xs text-zinc-500">
                    Cargando Diff Editor...
                  </div>
                }
                language={activeTab.language}
                original={activeTab.originalContent ?? activeTab.savedContent}
                modified={activeTab.content}
                options={{
                  renderSideBySide: typeof window !== 'undefined' ? window.innerWidth >= 768 : true,
                  readOnly: false,
                  fontFamily: '"JetBrains Mono", monospace',
                  fontSize: 13,
                  lineHeight: 20,
                  automaticLayout: true,
                  scrollBeyondLastLine: false,
                  minimap: { enabled: false },
                }}
              />
            ) : (
              <Editor
                height="100%"
                theme="insanus-obsidian"
                beforeMount={defineInsanusTheme}
                loading={
                  <div className="h-full flex items-center justify-center bg-[#09090b] text-xs text-zinc-500">
                    Cargando Monaco Editor...
                  </div>
                }
                path={activeTab.path}
                language={activeTab.language}
                value={activeTab.content}
                onChange={(val) => {
                  const next = val ?? '';
                  setTabs((prev) =>
                    prev.map((t) => (t.path === activeTab.path ? { ...t, content: next } : t))
                  );
                }}
                onMount={(editor) => {
                  editorInstanceRef.current = editor;
                  editor.onDidChangeCursorPosition((ev) => {
                    setCursorPos({ line: ev.position.lineNumber, col: ev.position.column });
                  });
                }}
                options={{
                  fontFamily: '"JetBrains Mono", monospace',
                  fontSize: 13,
                  lineHeight: 20,
                  automaticLayout: true,
                  scrollBeyondLastLine: false,
                  smoothScrolling: true,
                  bracketPairColorization: { enabled: true },
                  padding: { top: 10, bottom: 10 },
                  minimap: { enabled: typeof window !== 'undefined' && window.innerWidth >= 1280 },
                  tabSize: 2,
                }}
              />
            )}
          </div>

          {/* BOTTOM PANEL: REAL XTERM.JS TERMINAL + PROCESOS BACKGROUND (HU-26) */}
          {terminalOpen && (
            <div
              className={`${
                terminalTall ? 'h-72 sm:h-80' : 'h-44 sm:h-52'
              } border-t border-white/[0.08] bg-[#09090b] flex flex-col shrink-0 transition-all`}
            >
              <div className="h-8 px-3 bg-[#0e1017] border-b border-white/[0.06] flex items-center justify-between text-[11px] shrink-0">
                <div className="flex items-center gap-4 h-full">
                  <button
                    type="button"
                    onClick={() => setTerminalTab('console')}
                    className={`h-full flex items-center gap-1.5 font-medium uppercase tracking-wider border-b-2 transition ${
                      terminalTab === 'console'
                        ? 'border-emerald-500 text-zinc-100'
                        : 'border-transparent text-zinc-500 hover:text-zinc-300'
                    }`}
                  >
                    <span>Terminal</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setTerminalTab('processes')}
                    className={`h-full flex items-center gap-1.5 font-medium uppercase tracking-wider border-b-2 transition ${
                      terminalTab === 'processes'
                        ? 'border-emerald-500 text-zinc-100'
                        : 'border-transparent text-zinc-500 hover:text-zinc-300'
                    }`}
                  >
                    <span>Procesos</span>
                    {bgProcesses.length > 0 && (
                      <span className="px-1.5 rounded-full bg-white/[0.08] text-zinc-300 font-mono text-[10px]">
                        {bgProcesses.length}
                      </span>
                    )}
                  </button>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setTerminalTall((t) => !t)}
                    className="px-1.5 py-0.5 rounded hover:bg-white/[0.06] text-zinc-500 hover:text-zinc-200 text-[10px]"
                    title="Expandir / contraer terminal"
                  >
                    {terminalTall ? '↓' : '↑'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setTerminalOpen(false)}
                    className="p-1 rounded hover:bg-white/[0.06] text-zinc-500 hover:text-zinc-200"
                    title="Cerrar panel de terminal"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {terminalTab === 'console' ? (
                <div className="flex-1 min-h-0 overflow-hidden">
                  <XtermTerminal
                    nodeId={nodeId}
                    nodeName={node?.name || nodeId}
                    nodeOs={node?.os}
                    defaultShell={node?.shell}
                    workspace={workspace}
                    onCommandComplete={loadWorkspaceData}
                  />
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto p-3 space-y-2.5 text-xs">
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      if (!newBgCommand.trim()) return;
                      try {
                        await api.startWorkspaceProcess(nodeId, workspace, newBgCommand.trim());
                        setNewBgCommand('');
                        await loadWorkspaceData();
                      } catch (err: any) {
                        notify(err.message);
                      }
                    }}
                    className="flex gap-2"
                  >
                    <input
                      value={newBgCommand}
                      onChange={(e) => setNewBgCommand(e.target.value)}
                      placeholder="Comando daemon (ej: python -m http.server 9000)..."
                      className="flex-1 h-8 px-2.5 rounded-lg bg-[#11131a] border border-white/[0.09] font-mono text-xs text-zinc-100 outline-none"
                    />
                    <button
                      type="submit"
                      className="h-8 px-3 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold text-xs flex items-center gap-1"
                    >
                      <Play className="w-3 h-3" />
                      <span>Iniciar</span>
                    </button>
                  </form>

                  <div className="space-y-1">
                    {bgProcesses.map((p) => (
                      <div
                        key={p.proc_id}
                        className="h-8 px-2.5 rounded-lg bg-[#11131a] border border-white/[0.06] flex items-center justify-between gap-2 font-mono text-[11px]"
                      >
                        <div className="flex items-center gap-2 truncate">
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              p.running ? 'bg-emerald-400' : 'bg-zinc-600'
                            }`}
                          />
                          <span className="text-zinc-200 truncate">{p.command}</span>
                          <span className="text-zinc-500">PID {p.pid}</span>
                        </div>
                        <button
                          type="button"
                          onClick={async () => {
                            await api.stopWorkspaceProcess(nodeId, p.proc_id);
                            await loadWorkspaceData();
                          }}
                          className="p-1 rounded hover:bg-rose-500/20 text-zinc-400 hover:text-rose-300"
                          title="Detener proceso"
                        >
                          <Square className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                    {bgProcesses.length === 0 && (
                      <div className="text-zinc-500 text-xs">No hay procesos en segundo plano activos.</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 4. DOCKED RIGHT AGENT DRAWER (Toggleable en Desktop lg:) */}
        {showAgentDock && agentDockSlot && (
          <div className="hidden lg:flex w-80 xl:w-96 bg-[#0e1017] border-l border-white/[0.07] flex-col shrink-0 overflow-hidden">
            {agentDockSlot}
          </div>
        )}
      </div>

      {/* 5. SLIM VS CODE STATUS BAR (h-6 / 24px) */}
      <footer className="h-6 bg-[#0e1017] border-t border-white/[0.07] px-2.5 flex items-center justify-between text-[11px] font-mono text-zinc-400 select-none shrink-0">
        <div className="flex items-center gap-3 min-w-0 h-full">
          <div className="-ml-2.5 px-2.5 h-full bg-emerald-500/15 text-emerald-300 flex items-center gap-1.5 shrink-0">
            <Code2 className="w-3 h-3" />
            <span className="truncate max-w-[140px]">{node?.name || 'Local'}</span>
          </div>
          {gitInfo?.branch && (
            <button
              type="button"
              onClick={() => setActiveActivity('git')}
              className="flex items-center gap-1 hover:text-zinc-200 transition truncate"
            >
              <GitBranch className="w-3 h-3" />
              <span>{gitInfo.branch}</span>
            </button>
          )}
        </div>

        <div className="flex items-center gap-3 tabular-nums shrink-0">
          {activeTab && (
            <>
              <span>
                Ln {cursorPos.line}, Col {cursorPos.col}
              </span>
              <span className="hidden sm:inline text-zinc-500">UTF-8</span>
              <span className="uppercase text-zinc-300">{activeTab.language}</span>
            </>
          )}
          {node?.is_builtin_host && onTogglePrivacy && (
            <button
              type="button"
              onClick={onTogglePrivacy}
              className={`flex items-center gap-1 hover:text-zinc-100 transition ${
                node.expose_to_cloud ? 'text-zinc-400' : 'text-amber-400'
              }`}
              title="Cambiar privacidad Solo Local / Nube"
            >
              {node.expose_to_cloud ? <Globe className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
              <span className="hidden sm:inline">{node.expose_to_cloud ? 'Nube' : 'Solo Local'}</span>
            </button>
          )}
        </div>
      </footer>
    </div>
  );
};
