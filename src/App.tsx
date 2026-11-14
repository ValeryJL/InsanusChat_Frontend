import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot,
  ChevronLeft,
  ChevronRight,
  Cloud,
  Code2,
  Columns,
  CornerDownRight,
  Edit3,
  GitBranch,
  Globe,
  Laptop,
  Layers,
  Loader2,
  Lock,
  LogOut,
  Menu,
  MessageSquare,
  MessageSquarePlus,
  Network,
  PanelLeft,
  PanelRight,
  Server,
  Settings,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  User,
  WifiOff,
  Wrench,
  X,
} from 'lucide-react';
import { api, getStoredToken, getWebSocketUrl, setStoredToken } from './api';
import {
  getCloudServerUrl,
  getDaemonBootstrap,
  isDesktopRuntime,
  setCloudServerUrl,
  setDesktopMinimizeToTray,
  setLocalDaemonNodeId,
  subscribeTrayEvents,
  syncTrayRemoteStatus,
} from './platform/desktop';
import {
  AgentItem,
  APIKeyItem,
  ChatItem,
  ChatMessage,
  CodeSnippetItem,
  ExecutionNodeItem,
  LocalDaemonStatus,
  MCPServerItem,
  PendingToolApproval,
  UserProfile,
} from './types';
import { MarkdownRenderer } from './components/MarkdownRenderer';
import { TreeGraphView } from './components/TreeGraphView';
import { StudioView } from './components/StudioView';
import { AdminView } from './components/AdminView';
import { SettingsView } from './components/SettingsView';
import { EnvironmentPopover } from './components/EnvironmentPopover';
import { ChatComposer } from './components/ChatComposer';
import { AgentTaskPlan } from './components/AgentTaskPlan';
import { VSCodeEditorView } from './components/VSCodeEditorView';

export const App: React.FC = () => {
  const isDesktop = isDesktopRuntime();
  // Autenticación
  const [token, setToken] = useState<string | null>(getStoredToken());
  const [user, setUser] = useState<UserProfile | null>(null);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [desktopServerUrl, setDesktopServerUrl] = useState<string>(() => getCloudServerUrl());
  const [authError, setAuthError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);

  // Navegación principal y layout
  const [mainSection, setMainSection] = useState<'chat' | 'studio' | 'admin' | 'settings'>('chat');
  const [chatViewMode, setChatViewMode] = useState<'thread' | 'tree' | 'split'>(() =>
    typeof window !== 'undefined' && window.innerWidth < 1024 ? 'thread' : 'split'
  );
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(true);
  const [workspaceViewMode, setWorkspaceViewMode] = useState<'agent' | 'vscode'>('agent');
  const [showAgentDock, setShowAgentDock] = useState(true);

  // Estado Workstation Desktop (Sidecar local 127.0.0.1 + Conectividad SSOT)
  const [localStatus, setLocalStatus] = useState<LocalDaemonStatus | null>(null);
  const [cloudConnected, setCloudConnected] = useState(true);
  const [offlineEditorMode, setOfflineEditorMode] = useState(false);

  // Datos de usuario y recursos
  const [chats, setChats] = useState<ChatItem[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [agents, setAgents] = useState<AgentItem[]>([]);
  const [mcps, setMcps] = useState<MCPServerItem[]>([]);
  const [snippets, setSnippets] = useState<CodeSnippetItem[]>([]);
  const [apiKeys, setApiKeys] = useState<APIKeyItem[]>([]);
  const [modelsByProvider, setModelsByProvider] = useState<Record<string, { id: string; name: string }[]>>({});
  const [nodes, setNodes] = useState<ExecutionNodeItem[]>([]);
  const [pendingApproval, setPendingApproval] = useState<PendingToolApproval | null>(null);
  const [editorTargetFile, setEditorTargetFile] = useState<{ path: string; diff?: string } | null>(null);

  // Estado del Árbol de Ramas en el Chat Activo (HU-14)
  const [selectedChildByParent, setSelectedChildByParent] = useState<Record<string, string>>({});
  const [branchTarget, setBranchTarget] = useState<{ parentId: string | null; refMsg: ChatMessage } | null>(null);
  const [focusedMsgId, setFocusedMsgId] = useState<string | null>(null);
  const [inputText, setInputText] = useState('');

  // Estado WebSocket y Streaming en tiempo real (HU-08)
  const wsRef = useRef<WebSocket | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [chatLocked, setChatLocked] = useState(false);
  const [streamingContent, setStreamingContent] = useState<string>('');
  const [activeToolCall, setActiveToolCall] = useState<{ tool: string; args: any } | null>(null);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // Asegurar que en pantallas móviles (<1024px) nunca quede activo el split 50/50
  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth < 1024) {
        setChatViewMode((prev) => (prev === 'split' ? 'thread' : prev));
      }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const buildLocalDesktopNode = (st: LocalDaemonStatus): ExecutionNodeItem => ({
    node_id: st.config.node_id,
    name: st.config.node_name,
    os: st.config.os,
    arch: st.config.arch,
    shell: st.config.shell,
    app_version: st.config.app_version,
    status: st.bridge.connected
      ? 'online'
      : st.config.expose_to_cloud
      ? 'online'
      : 'private_local_only',
    connected: st.bridge.connected,
    expose_to_cloud: st.config.expose_to_cloud,
    allow_remote_terminal: st.config.allow_remote_terminal,
    allow_remote_agent_tools: st.config.allow_remote_agent_tools,
    allowed_workspaces: st.config.allowed_workspaces,
    root_dir: st.config.root_projects_dir,
    workspaces: st.workspaces || [],
    reported_editors: st.vscode?.detected_editors || [],
    desired_policy: st.policy,
    config_version: st.config.config_version,
    is_builtin_host: false,
    is_local_desktop: true,
  });

  const mergeLocalNodeIntoList = (
    cloudNodes: ExecutionNodeItem[],
    localSt: LocalDaemonStatus | null
  ): ExecutionNodeItem[] => {
    if (!localSt) return cloudNodes;
    const localNode = buildLocalDesktopNode(localSt);
    const others = cloudNodes.filter((n) => n.node_id !== localNode.node_id);
    return [localNode, ...others];
  };

  const refreshLocalStatus = useCallback(async (): Promise<LocalDaemonStatus | null> => {
    if (!isDesktop) return null;
    try {
      const boot = await getDaemonBootstrap();
      if (!boot) return null;
      const st = (await api.getLocalDaemonStatus()) as LocalDaemonStatus;
      setLocalStatus(st);
      setLocalDaemonNodeId(st.config.node_id);
      await setDesktopMinimizeToTray(st.config.minimize_to_tray);
      await syncTrayRemoteStatus(st.config.expose_to_cloud, st.bridge.connected);
      return st;
    } catch {
      return null;
    }
  }, [isDesktop]);

  const syncLocalDeviceWithBackend = useCallback(
    async (localSt: LocalDaemonStatus | null) => {
      if (!isDesktop || !localSt || !getStoredToken()) return;
      try {
        const regRes = await api.registerWorkstationDevice({
          node_id: localSt.config.node_id,
          name: localSt.config.node_name,
          os: localSt.config.os,
          arch: localSt.config.arch,
          shell: localSt.config.shell,
          app_version: localSt.config.app_version,
          root_dir: localSt.config.root_projects_dir,
          workspaces: localSt.workspaces || [],
          reported_editors: localSt.vscode?.detected_editors || [],
          local_policy: localSt.policy,
        });
        const ssotDevice = regRes?.data;
        const jwt = getStoredToken();
        if (jwt) {
          await api.bootstrapLocalDaemonSync({
            cloud_backend_url: getCloudServerUrl(),
            access_token: jwt,
            desired_policy: ssotDevice?.desired_policy,
            synced_extensions: ssotDevice?.synced_extensions || [],
          });
        }
        await refreshLocalStatus();
      } catch {
        // Si el backend no responde temporalmente, el Workbench local sigue operativo
      }
    },
    [isDesktop, refreshLocalStatus]
  );

  const syncLocalAndBackendPolicy = useCallback(
    async (patch: Record<string, any>) => {
      if (!isDesktop) return;
      const st = localStatus || (await refreshLocalStatus());
      await api.updateLocalDaemonSettings(patch);
      if (st && getStoredToken()) {
        try {
          await api.updateWorkstationPolicy(st.config.node_id, patch, true);
        } catch {}
      }
      const nextSt = await refreshLocalStatus();
      setNodes((prev) => mergeLocalNodeIntoList(prev, nextSt));
    },
    [isDesktop, localStatus, refreshLocalStatus]
  );

  const refreshNodes = useCallback(async () => {
    const localSt = isDesktop ? await refreshLocalStatus() : null;
    if (!getStoredToken()) {
      if (localSt) setNodes([buildLocalDesktopNode(localSt)]);
      return;
    }
    try {
      const nRes = await api.listNodes();
      const cloudNodes: ExecutionNodeItem[] = nRes?.data?.nodes || [];
      setNodes(mergeLocalNodeIntoList(cloudNodes, localSt));
      setCloudConnected(true);
    } catch {
      if (localSt) setNodes([buildLocalDesktopNode(localSt)]);
    }
  }, [isDesktop, refreshLocalStatus]);

  const loadAllUserData = useCallback(async () => {
    const localSt = isDesktop ? await refreshLocalStatus() : null;
    if (!getStoredToken()) {
      if (localSt) setNodes([buildLocalDesktopNode(localSt)]);
      return;
    }
    try {
      const [pRes, cRes, aRes, rRes, kRes, mRes, nRes] = await Promise.all([
        api.getProfile(),
        api.listChats(),
        api.listAgents(),
        api.listResources(),
        api.listApiKeys(),
        api.getModelsCatalog().catch(() => null),
        api.listNodes().catch(() => null),
      ]);
      setCloudConnected(true);
      setOfflineEditorMode(false);
      if (pRes?.data) setUser(pRes.data);
      if (cRes?.data) {
        setChats(cRes.data);
        if (!activeChatId && cRes.data.length > 0) {
          setActiveChatId(cRes.data[0]._id);
        }
      }
      if (aRes?.data) setAgents(aRes.data);
      if (rRes?.data) {
        setMcps(rRes.data.mcps || []);
        setSnippets(rRes.data.code_snippets || []);
      }
      if (kRes?.data) setApiKeys(kRes.data);
      if (mRes?.data?.providers) setModelsByProvider(mRes.data.providers);
      const cloudNodes: ExecutionNodeItem[] = nRes?.data?.nodes || [];
      setNodes(mergeLocalNodeIntoList(cloudNodes, localSt));

      if (isDesktop && localSt) {
        await syncLocalDeviceWithBackend(localSt);
      }
    } catch (e: any) {
      if (String(e.message).includes('401') || String(e.message).includes('Token')) {
        handleLogout();
      } else {
        setCloudConnected(false);
        if (localSt) setNodes([buildLocalDesktopNode(localSt)]);
      }
    }
  }, [activeChatId, isDesktop, refreshLocalStatus, syncLocalDeviceWithBackend]);

  useEffect(() => {
    if (isDesktop) {
      refreshLocalStatus();
    }
  }, [isDesktop, refreshLocalStatus]);

  useEffect(() => {
    if (token) {
      loadAllUserData();
    }
  }, [token]);

  // Atajo global Ctrl+, estilo VS Code / Antigravity para abrir Configuración
  useEffect(() => {
    const onShortcut = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault();
        setMainSection((prev) => (prev === 'settings' ? 'chat' : 'settings'));
      }
    };
    window.addEventListener('keydown', onShortcut);
    return () => window.removeEventListener('keydown', onShortcut);
  }, []);

  // Listeners del System Tray Nativo (Tauri v2)
  useEffect(() => {
    if (!isDesktop) return;
    let cleanup: (() => void) | null = null;
    subscribeTrayEvents({
      onToggleRemote: async () => {
        const current = await refreshLocalStatus();
        if (!current) return;
        await syncLocalAndBackendPolicy({ expose_to_cloud: !current.config.expose_to_cloud });
      },
      onOpenVSCode: async () => {
        try {
          await api.launchLocalEditor({ workspace: '.' });
        } catch {}
      },
      onDaemonRestarted: async () => {
        const st = await refreshLocalStatus();
        if (st) await syncLocalDeviceWithBackend(st);
      },
    }).then((unsub) => {
      cleanup = unsub;
    });
    return () => {
      cleanup?.();
    };
  }, [isDesktop, refreshLocalStatus, syncLocalAndBackendPolicy, syncLocalDeviceWithBackend]);

  const selectNodePathInTree = useCallback(
    (targetId: string, msgList: ChatMessage[] = messages, scrollThread = false) => {
      const byId = new Map<string, ChatMessage>();
      msgList.forEach((m) => byId.set(m._id, m));

      const target = byId.get(targetId);
      if (!target) return;

      const updates: Record<string, string> = {};
      let curr: ChatMessage | undefined = target;
      while (curr && curr.parent_id) {
        updates[curr.parent_id] = curr._id;
        curr = byId.get(curr.parent_id);
      }
      if (curr && !curr.parent_id) {
        updates['__ROOT__'] = curr._id;
      }
      setSelectedChildByParent((prev) => ({ ...prev, ...updates }));
      setFocusedMsgId(targetId);

      if (scrollThread) {
        setTimeout(() => {
          const el = document.getElementById(`thread-msg-${targetId}`);
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }, 80);
      }
    },
    [messages]
  );

  const loadChatMessages = useCallback(async (chatId: string) => {
    try {
      const res = await api.listMessages(chatId);
      const list: ChatMessage[] = res?.data || [];
      setMessages(list);
      if (list.length > 0) {
        const latest = list[list.length - 1];
        const byId = new Map<string, ChatMessage>();
        list.forEach((m) => byId.set(m._id, m));
        const updates: Record<string, string> = {};
        let curr: ChatMessage | undefined = latest;
        while (curr && curr.parent_id) {
          updates[curr.parent_id] = curr._id;
          curr = byId.get(curr.parent_id);
        }
        if (curr && !curr.parent_id) {
          updates['__ROOT__'] = curr._id;
        }
        setSelectedChildByParent(updates);
        setFocusedMsgId(latest._id);
      }
    } catch {
      setMessages([]);
    }
  }, []);

  const triggerBranchFromMessage = (msg: ChatMessage, prefillWithContent = false) => {
    selectNodePathInTree(msg._id, messages, true);
    const effectiveParentId = msg.role === 'user' ? msg.parent_id || null : msg._id;
    setBranchTarget({ parentId: effectiveParentId, refMsg: msg });
    if (prefillWithContent) {
      setInputText(msg.content);
    }
  };

  // Conexión WebSocket al chat activo
  useEffect(() => {
    if (!token || !activeChatId) {
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch {}
        wsRef.current = null;
      }
      setWsConnected(false);
      setMessages([]);
      setSelectedChildByParent({});
      setBranchTarget(null);
      setFocusedMsgId(null);
      setStreamingContent('');
      setActiveToolCall(null);
      setChatLocked(false);
      return;
    }

    setMessages([]);
    setSelectedChildByParent({});
    loadChatMessages(activeChatId);
    setBranchTarget(null);
    setFocusedMsgId(null);
    setStreamingContent('');
    setActiveToolCall(null);
    setPendingApproval(null);

    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {}
    }

    const wsUrl = getWebSocketUrl(activeChatId);
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => setWsConnected(true);

    ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        if (data.init) {
          setChatLocked(Boolean(data.init.locked));
          return;
        }

        const cmd = data.cmd;
        const msg = data.message;

        if (cmd === 'chat_locked') {
          setChatLocked(true);
        } else if (cmd === 'chat_unlocked') {
          setChatLocked(false);
          setStreamingContent('');
          setActiveToolCall(null);
          loadChatMessages(activeChatId);
        } else if (cmd === 'error') {
          setChatLocked(false);
          setStreamingContent('');
          setActiveToolCall(null);
        } else if (cmd === 'agent_stream_start') {
          setStreamingContent('');
        } else if (cmd === 'agent_token') {
          setStreamingContent((prev) => prev + (msg?.delta || ''));
        } else if (cmd === 'agent_tool_start') {
          setActiveToolCall({ tool: msg?.tool, args: msg?.args });
        } else if (cmd === 'agent_tool_end') {
          setActiveToolCall(null);
        } else if (cmd === 'agent_plan_updated' && msg?.task_plan) {
          setChats((prev) =>
            prev.map((c) => (c._id === activeChatId ? { ...c, task_plan: msg.task_plan } : c))
          );
        } else if (cmd === 'agent_tool_approval_needed' && msg?.approval_id) {
          setPendingApproval(msg);
        } else if (cmd === 'agent_tool_approval_resolved') {
          setPendingApproval(null);
        } else if (cmd === 'user_message' || cmd === 'agent_message' || cmd === 'system_message') {
          if (msg && msg._id) {
            if (cmd === 'agent_message') {
              setStreamingContent('');
              setActiveToolCall(null);
            }
            setMessages((prev) => {
              const exists = prev.some((m) => m._id === msg._id);
              let updated = exists ? prev.map((m) => (m._id === msg._id ? msg : m)) : [...prev, msg];
              if (msg.parent_id) {
                updated = updated.map((m) => {
                  if (m._id === msg.parent_id) {
                    const cids = m.children_ids || [];
                    if (!cids.includes(msg._id)) {
                      return { ...m, children_ids: [...cids, msg._id] };
                    }
                  }
                  return m;
                });
              }
              return updated;
            });
            if (msg.parent_id) {
              setSelectedChildByParent((prev) => ({ ...prev, [msg.parent_id]: msg._id }));
            }
          }
        } else if (cmd === 'chat_updated' && msg?.chat_id) {
          setChats((prev) =>
            prev.map((c) => (c._id === msg.chat_id ? { ...c, title: msg.title || c.title } : c))
          );
        }
      } catch {}
    };

    ws.onclose = () => setWsConnected(false);

    return () => {
      try {
        ws.close();
      } catch {}
    };
  }, [token, activeChatId, loadChatMessages]);

  // Calcular la rama activa para el hilo
  const { activeThread, byIdMap, rootsList } = useMemo(() => {
    const map = new Map<string, ChatMessage>();
    messages.forEach((m) => map.set(m._id, m));

    const childrenByParent = new Map<string, ChatMessage[]>();
    const roots: ChatMessage[] = [];

    messages.forEach((m) => {
      if (!m.parent_id || !map.has(m.parent_id)) {
        roots.push(m);
      } else {
        const arr = childrenByParent.get(m.parent_id) || [];
        arr.push(m);
        childrenByParent.set(m.parent_id, arr);
      }
    });

    const thread: ChatMessage[] = [];
    if (roots.length > 0) {
      const chosenRootId = selectedChildByParent['__ROOT__'] || roots[roots.length - 1]._id;
      let curr = map.get(chosenRootId) || roots[roots.length - 1];
      const visited = new Set<string>();

      while (curr && !visited.has(curr._id)) {
        visited.add(curr._id);
        thread.push(curr);
        const kids = childrenByParent.get(curr._id) || [];
        if (kids.length === 0) break;
        const preferredChildId = selectedChildByParent[curr._id];
        const nextChild = kids.find((k) => k._id === preferredChildId) || kids[kids.length - 1];
        curr = nextChild;
      }
    }

    return { activeThread: thread, byIdMap: map, rootsList: roots };
  }, [messages, selectedChildByParent]);

  const activePathIds = useMemo(() => new Set(activeThread.map((m) => m._id)), [activeThread]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeThread.length, streamingContent]);

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthLoading(true);
    try {
      if (authMode === 'login') {
        const res = await api.login(email, password);
        const jwt = res?.data?.access_token;
        if (jwt) {
          setStoredToken(jwt);
          setToken(jwt);
        }
      } else {
        const res = await api.register(email, password, displayName || email.split('@')[0]);
        const jwt = res?.data?.access_token;
        if (jwt) {
          setStoredToken(jwt);
          setToken(jwt);
        } else {
          const loginRes = await api.login(email, password);
          setStoredToken(loginRes.data.access_token);
          setToken(loginRes.data.access_token);
        }
      }
    } catch (err: any) {
      setAuthError(err.message || 'Error de autenticación');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = () => {
    setStoredToken(null);
    setToken(null);
    setUser(null);
    setChats([]);
    setActiveChatId(null);
    setMessages([]);
  };

  const handleCreateNewChat = async () => {
    try {
      const defaultAgent = agents.find((a) => a.active) || agents[0];
      const res = await api.createChat({
        title: 'Nueva conversación',
        agent_id: defaultAgent?._id || null,
      });
      if (res?.data) {
        setMessages([]);
        setSelectedChildByParent({});
        setBranchTarget(null);
        setFocusedMsgId(null);
        setChats((prev) => [res.data, ...prev]);
        setActiveChatId(res.data._id);
        setMainSection('chat');
        setWorkspaceViewMode('agent');
        setMobileSidebarOpen(false);
      }
    } catch {}
  };

  const handleDeleteChat = async (chatIdToDelete: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const wasActive = activeChatId === chatIdToDelete;
    if (wasActive) {
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch {}
        wsRef.current = null;
      }
      setWsConnected(false);
      setMessages([]);
      setSelectedChildByParent({});
      setBranchTarget(null);
      setFocusedMsgId(null);
      setStreamingContent('');
      setActiveToolCall(null);
      setChatLocked(false);
    }
    try {
      await api.deleteChat(chatIdToDelete);
    } catch {}
    setChats((prev) => {
      const remaining = prev.filter((x) => x._id !== chatIdToDelete);
      if (wasActive) {
        setActiveChatId(remaining[0]?._id || null);
      }
      return remaining;
    });
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = inputText.trim();
    if (!text || chatLocked) return;

    const existingChat = chats.find((c) => c._id === activeChatId);
    let chatId = existingChat ? existingChat._id : null;
    const isCreatingNewChat = !chatId;

    if (isCreatingNewChat) {
      setMessages([]);
      setSelectedChildByParent({});
      setBranchTarget(null);
      setFocusedMsgId(null);
      const defaultAgent = agents.find((a) => a.active) || agents[0];
      const created = await api.createChat({
        title: text.slice(0, 40),
        agent_id: defaultAgent?._id || null,
      });
      chatId = created?.data?._id;
      if (chatId) {
        setChats((prev) => [created.data, ...prev]);
        setActiveChatId(chatId);
      }
    }
    if (!chatId) return;

    const lastInThread =
      !isCreatingNewChat && activeThread.length > 0 ? activeThread[activeThread.length - 1] : null;
    const defaultParentId = lastInThread
      ? lastInThread.role === 'user'
        ? lastInThread.parent_id
        : lastInThread._id
      : null;
    const parentId = isCreatingNewChat ? null : branchTarget ? branchTarget.parentId : defaultParentId;

    setInputText('');
    setBranchTarget(null);

    if (
      !isCreatingNewChat &&
      wsRef.current &&
      wsRef.current.readyState === WebSocket.OPEN &&
      activeChatId === chatId
    ) {
      wsRef.current.send(
        JSON.stringify({
          cmd: 'send',
          text,
          parent_id: parentId,
        })
      );
    } else {
      setChatLocked(true);
      try {
        await api.postMessage(chatId, text, parentId);
        await loadChatMessages(chatId);
        for (let i = 0; i < 15; i++) {
          await new Promise((r) => setTimeout(r, 1000));
          await loadChatMessages(chatId);
          const chatRes = await api.listChats();
          const found = (chatRes?.data || []).find((c: any) => c._id === chatId);
          if (found) {
            setChats(chatRes.data);
            if (!found.locked) {
              setChatLocked(false);
              break;
            }
          }
        }
      } finally {
        setChatLocked(false);
      }
    }
  };

  const handleStopGeneration = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ cmd: 'stop_generation' }));
    } else if (activeChatId) {
      api.unlockChat(activeChatId).then(() => setChatLocked(false));
    }
  };

  const activeChat = chats.find((c) => c._id === activeChatId) || null;
  const isAdmin = Boolean(user?.roles?.includes('admin'));
  const isWorkstationChat = activeChat?.execution_target === 'workstation';
  const isEditorMode = isWorkstationChat && workspaceViewMode === 'vscode';
  const activeNode =
    nodes.find((n) => n.node_id === activeChat?.node_id) || nodes[0] || null;

  const updateActiveChatConfig = async (updates: Partial<ChatItem>) => {
    if (!activeChat) return;
    const res = await api.updateChat(activeChat._id, updates);
    if (res?.data) {
      setChats((prev) => prev.map((c) => (c._id === activeChat._id ? { ...c, ...res.data } : c)));
    }
  };

  const handleSwitchWorkspaceViewMode = (mode: 'agent' | 'vscode') => {
    setWorkspaceViewMode(mode);
    if (mode === 'vscode') {
      // Dar máxima amplitud al VS Code Workbench colapsando el sidebar de chats en desktop
      setDesktopSidebarOpen(false);
    } else {
      setDesktopSidebarOpen(true);
    }
  };

  const handleResolveApproval = async (
    approvalId: string,
    approved: boolean,
    feedback?: string
  ) => {
    if (!activeChatId) return;
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          cmd: 'tool_approval',
          approval_id: approvalId,
          approved,
          feedback: feedback || '',
        })
      );
    } else {
      await api.approveChatTool(activeChatId, approvalId, approved, feedback || '');
    }
    setPendingApproval(null);
  };

  // Modo Editor Local Offline en Desktop (Épica 12 HU-45: permite abrir el Workbench local aunque el servidor Cloud esté caído)
  if (!token && isDesktop && offlineEditorMode && localStatus) {
    const localNode = buildLocalDesktopNode(localStatus);
    return (
      <div className="h-[100dvh] w-screen overflow-hidden flex flex-col bg-[#09090b] text-zinc-100">
        <header className="h-11 px-3.5 bg-[#0e1017] border-b border-white/[0.07] flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2 text-xs">
            <WifiOff className="w-3.5 h-3.5 text-amber-400" />
            <span className="font-semibold text-zinc-100">InsanusChat Workstation — Editor Local (Offline)</span>
            <span className="text-[10.5px] font-mono text-zinc-500">{localNode.root_dir}</span>
          </div>
          <button
            type="button"
            onClick={() => setOfflineEditorMode(false)}
            className="h-7 px-3 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold text-xs transition"
          >
            Conectar a InsanusChat Cloud
          </button>
        </header>
        <VSCodeEditorView
          node={localNode}
          workspace="."
          showAgentDock={false}
          onToggleAgentDock={() => {}}
        />
      </div>
    );
  }

  // Pantalla Login / Registro (Obsidian Minimal)
  if (!token) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-[#09090b] p-4">
        <div className="max-w-sm w-full p-6 sm:p-8 rounded-2xl bg-[#11131a] border border-white/[0.08] shadow-2xl shadow-black/70 space-y-5">
          <div className="text-center space-y-2">
            <div className="w-11 h-11 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center mx-auto">
              <GitBranch className="w-5 h-5 text-emerald-400" />
            </div>
            <h1 className="text-xl font-bold text-zinc-50 tracking-tight">
              insanus-harnes
            </h1>
            <p className="text-xs text-zinc-400">
              Agent Harness · Árbol Conversacional 2D · VS Code Workbench
            </p>
          </div>

          {isDesktop && (
            <div className="p-3 rounded-xl bg-[#09090b] border border-white/[0.07] space-y-1.5">
              <label className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-400">
                <Server className="w-3 h-3 text-emerald-400" />
                <span>Servidor insanus-harnes (SSOT)</span>
              </label>
              <input
                value={desktopServerUrl}
                onChange={(e) => {
                  setDesktopServerUrl(e.target.value);
                  setCloudServerUrl(e.target.value);
                }}
                placeholder="https://harnes.insanustech.com.ar"
                className="w-full h-8 px-2.5 rounded-lg bg-[#11131a] border border-white/[0.09] text-xs font-mono text-zinc-200 focus:border-emerald-500/70 outline-none"
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-[#09090b] border border-white/[0.07]">
            <button
              type="button"
              onClick={() => {
                setAuthMode('login');
                setAuthError(null);
              }}
              className={`h-8 rounded-lg text-xs font-semibold transition ${
                authMode === 'login'
                  ? 'bg-emerald-500 text-zinc-950'
                  : 'text-zinc-400 hover:text-zinc-100'
              }`}
            >
              Iniciar Sesión
            </button>
            <button
              type="button"
              onClick={() => {
                setAuthMode('register');
                setAuthError(null);
              }}
              className={`h-8 rounded-lg text-xs font-semibold transition ${
                authMode === 'register'
                  ? 'bg-emerald-500 text-zinc-950'
                  : 'text-zinc-400 hover:text-zinc-100'
              }`}
            >
              Crear Cuenta
            </button>
          </div>

          {authError && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-300">
              {authError}
            </div>
          )}

          <form onSubmit={handleAuthSubmit} className="space-y-3.5">
            {authMode === 'register' && (
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Nombre</label>
                <input
                  required
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Valeria"
                  className="w-full h-10 px-3 rounded-xl bg-[#09090b] border border-white/[0.09] text-sm text-zinc-100 focus:border-emerald-500/70 outline-none"
                />
              </div>
            )}

            <div>
              <label className="block text-xs text-zinc-400 mb-1">Correo electrónico</label>
              <input
                required
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="valeria@insanustech.com.ar"
                className="w-full h-10 px-3 rounded-xl bg-[#09090b] border border-white/[0.09] text-sm text-zinc-100 focus:border-emerald-500/70 outline-none"
              />
            </div>

            <div>
              <label className="block text-xs text-zinc-400 mb-1">Contraseña</label>
              <input
                required
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full h-10 px-3 rounded-xl bg-[#09090b] border border-white/[0.09] text-sm text-zinc-100 focus:border-emerald-500/70 outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={authLoading}
              className="w-full h-10 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold text-sm transition"
            >
              {authLoading
                ? 'Ingresando...'
                : authMode === 'login'
                ? 'Entrar a InsanusChat'
                : 'Registrarme'}
            </button>
          </form>

          {isDesktop && localStatus && (
            <button
              type="button"
              onClick={() => setOfflineEditorMode(true)}
              className="w-full h-9 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-xs text-zinc-300 flex items-center justify-center gap-1.5 transition"
            >
              <Code2 className="w-3.5 h-3.5 text-emerald-400" />
              <span>Abrir Editor Local (Modo Offline)</span>
            </button>
          )}
        </div>
      </div>
    );
  }

  // Renderizador reutilizable del hilo de conversación + plan + compositor (sirve para Vista Agente Y para Right Agent Dock en VS Code)
  const renderChatPanel = (compact = false) => (
    <div className="flex-1 flex flex-col min-h-0 bg-[#09090b]">
      {/* Header mini cuando está acoplado como Right Drawer dentro del VS Code Editor */}
      {compact && (
        <div className="h-9 px-3 bg-[#0e1017] border-b border-white/[0.07] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <Sparkles className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-300 truncate">
              Agente Harness
            </span>
          </div>
          <button
            type="button"
            onClick={() => setShowAgentDock(false)}
            className="p-1 rounded hover:bg-white/[0.06] text-zinc-500 hover:text-zinc-200 transition"
            title="Ocultar panel de agente"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Plan de tareas del agente (colapsado por defecto en h-9) + HITL approval */}
      <AgentTaskPlan
        steps={activeChat?.task_plan || []}
        pendingApproval={pendingApproval}
        onResolveApproval={handleResolveApproval}
        compact={compact}
      />

      {/* Hilo de mensajes estilo editorial */}
      <div
        className={`flex-1 overflow-y-auto ${
          compact ? 'px-3 py-3 space-y-4' : 'px-3 sm:px-6 py-4 sm:py-6'
        }`}
      >
        <div className={compact ? 'space-y-4' : 'max-w-3xl mx-auto space-y-5'}>
          {activeThread.length === 0 && (
            <div className="py-12 sm:py-16 flex flex-col items-center justify-center text-center max-w-md mx-auto px-3 space-y-4">
              <div className="w-11 h-11 rounded-2xl bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center">
                {isWorkstationChat ? (
                  <Code2 className="w-5 h-5 text-emerald-400" />
                ) : (
                  <GitBranch className="w-5 h-5 text-emerald-400" />
                )}
              </div>
              <div className="space-y-1.5">
                <h3 className="text-sm sm:text-base font-semibold text-zinc-100">
                  {isWorkstationChat
                    ? `Listo en ${activeChat?.workspace_path || 'tu equipo'}`
                    : 'Iniciá una conversación ramificada'}
                </h3>
                <p className="text-xs text-zinc-500 leading-relaxed">
                  {isWorkstationChat
                    ? 'El agente puede leer archivos, editar con diffs en vivo, ejecutar comandos y abrir el proyecto en tu VS Code Workbench.'
                    : 'Explorá ideas, ejecutá herramientas MCP o bifurcá cualquier respuesta en un árbol 2D.'}
                </p>
              </div>
              {!compact && (
                <div className="flex flex-wrap items-center justify-center gap-1.5 pt-1">
                  {(isWorkstationChat
                    ? [
                        'Analizá la estructura de este proyecto',
                        'Revisá git status y tests pendientes',
                      ]
                    : [
                        'Usá la Calculadora MCP: 48 * 125',
                        'Ayudame a diseñar una arquitectura',
                      ]
                  ).map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => setInputText(suggestion)}
                      className="px-3 py-1.5 rounded-full bg-[#11131a] hover:bg-[#161922] border border-white/[0.08] text-[11.5px] text-zinc-300 hover:text-zinc-100 transition"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeThread.map((msg, idx) => {
            const isUser = msg.role === 'user';
            const parentMsg = msg.parent_id ? byIdMap.get(msg.parent_id) : null;
            const siblingIds = parentMsg
              ? parentMsg.children_ids || []
              : rootsList.map((r) => r._id);
            const hasSiblings = siblingIds.length > 1;
            const currentSiblingIdx = siblingIds.indexOf(msg._id);
            const isBranchTarget = branchTarget?.refMsg._id === msg._id;
            const isFocused = focusedMsgId === msg._id;
            const isLeafTip = (msg.children_ids?.length || 0) === 0 && idx === activeThread.length - 1;

            const switchBranch = (newChildId: string) => {
              const key = msg.parent_id || '__ROOT__';
              setSelectedChildByParent((prev) => ({ ...prev, [key]: newChildId }));
            };

            return (
              <div key={msg._id} id={`thread-msg-${msg._id}`} className="space-y-1.5">
                {/* Selector de Ramas Hermanas (< Rama 1 de N >) */}
                {hasSiblings && (
                  <div className="flex items-center">
                    <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/25 text-amber-300 text-[10.5px] font-mono">
                      <GitBranch className="w-3 h-3" />
                      <button
                        type="button"
                        disabled={currentSiblingIdx <= 0}
                        onClick={() => switchBranch(siblingIds[currentSiblingIdx - 1])}
                        className="hover:text-white disabled:opacity-30 p-0.5"
                      >
                        <ChevronLeft className="w-3 h-3" />
                      </button>
                      <span>
                        Rama {currentSiblingIdx + 1}/{siblingIds.length}
                      </span>
                      <button
                        type="button"
                        disabled={currentSiblingIdx >= siblingIds.length - 1}
                        onClick={() => switchBranch(siblingIds[currentSiblingIdx + 1])}
                        className="hover:text-white disabled:opacity-30 p-0.5"
                      >
                        <ChevronRight className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                )}

                {isUser ? (
                  /* Mensaje de Usuario: burbuja sutil alineada */
                  <div
                    onClick={() => setFocusedMsgId(msg._id)}
                    className={`group rounded-2xl border transition ${
                      compact ? 'px-3 py-2.5' : 'px-4 py-3 ml-6 sm:ml-14'
                    } ${
                      isBranchTarget
                        ? 'bg-[#161922] border-amber-400/70 ring-1 ring-amber-400/30'
                        : isFocused
                        ? 'bg-[#161922] border-emerald-500/40'
                        : 'bg-[#161922] border-white/[0.07] hover:border-white/[0.12]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-400">
                        <User className="w-3 h-3 text-emerald-400" />
                        <span>Vos</span>
                      </span>

                      {!isLeafTip && (
                        <div className="flex items-center gap-1 opacity-80 sm:opacity-0 sm:group-hover:opacity-100 transition">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              triggerBranchFromMessage(msg, true);
                            }}
                            className="flex items-center gap-1 px-1.5 py-0.5 rounded-md hover:bg-white/[0.08] text-zinc-400 hover:text-zinc-100 text-[10.5px] transition"
                            title="Editar y crear rama alternativa"
                          >
                            <Edit3 className="w-3 h-3" />
                            <span className="hidden sm:inline">Editar</span>
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              triggerBranchFromMessage(msg, false);
                            }}
                            className="flex items-center gap-1 px-1.5 py-0.5 rounded-md hover:bg-emerald-500/15 text-zinc-400 hover:text-emerald-300 text-[10.5px] transition"
                            title="Ramificar desde este punto"
                          >
                            <CornerDownRight className="w-3 h-3" />
                            <span>Ramificar</span>
                          </button>
                        </div>
                      )}
                    </div>

                    <MarkdownRenderer content={msg.content} />
                  </div>
                ) : (
                  /* Mensaje de Agente: estilo editorial sin caja pesada */
                  <div
                    onClick={() => setFocusedMsgId(msg._id)}
                    className={`group rounded-2xl transition ${
                      isBranchTarget
                        ? 'p-3 bg-[#11131a] border border-amber-400/60'
                        : isFocused && !compact
                        ? 'px-1 py-1'
                        : 'px-0.5 py-0.5'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="w-5 h-5 rounded-lg bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center shrink-0">
                          <Bot className="w-3 h-3 text-emerald-400" />
                        </span>
                        <span className="text-xs font-medium text-zinc-200">Agente</span>
                        {msg.model && !compact && (
                          <span className="text-[10.5px] font-mono text-zinc-500 truncate max-w-[160px]">
                            {msg.model}
                          </span>
                        )}
                      </div>

                      {!isLeafTip && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            triggerBranchFromMessage(msg, false);
                          }}
                          className="opacity-80 sm:opacity-0 sm:group-hover:opacity-100 flex items-center gap-1 px-2 py-0.5 rounded-md hover:bg-white/[0.07] text-zinc-400 hover:text-emerald-300 text-[11px] transition shrink-0"
                          title="Abrir una nueva rama respondiendo a este mensaje"
                        >
                          <CornerDownRight className="w-3 h-3" />
                          <span>Ramificar</span>
                        </button>
                      )}
                    </div>

                    <div className={compact ? '' : 'pl-7'}>
                      <MarkdownRenderer
                        content={msg.content}
                        toolCalls={msg.tool_calls}
                        onOpenFileInEditor={
                          isWorkstationChat
                            ? (filePath, diff) => {
                                setEditorTargetFile({ path: filePath, diff });
                                if (workspaceViewMode !== 'vscode') {
                                  handleSwitchWorkspaceViewMode('vscode');
                                }
                              }
                            : undefined
                        }
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {/* Streaming en Vivo del Agente (limpio, sin parpadeo animate-pulse) */}
          {(streamingContent || activeToolCall) && (
            <div className="space-y-2 py-1">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="flex items-center gap-2 text-zinc-300 font-medium">
                  <Loader2 className="w-3.5 h-3.5 text-emerald-400 animate-spin shrink-0" />
                  <span>{activeToolCall ? 'Ejecutando herramienta...' : 'Pensando...'}</span>
                </span>
                <button
                  type="button"
                  onClick={handleStopGeneration}
                  className="h-6 px-2 rounded-md bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 text-[11px] flex items-center gap-1 transition"
                >
                  <Square className="w-2.5 h-2.5 fill-current" />
                  <span>Detener</span>
                </button>
              </div>

              {activeToolCall && (
                <div className="ml-5 px-2.5 py-1.5 rounded-lg bg-[#11131a] border border-white/[0.08] text-[11.5px] font-mono text-zinc-300 flex items-center gap-2 truncate">
                  <Wrench className="w-3 h-3 text-sky-400 shrink-0" />
                  <span className="text-sky-300 font-medium">{activeToolCall.tool}</span>
                  <span className="text-zinc-500 truncate">
                    {activeToolCall.args?.path ||
                      activeToolCall.args?.command_line ||
                      activeToolCall.args?.query ||
                      activeToolCall.args?.directory ||
                      ''}
                  </span>
                </div>
              )}

              {streamingContent && (
                <div className={compact ? '' : 'pl-5'}>
                  <MarkdownRenderer content={streamingContent} />
                </div>
              )}
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Compositor unificado estilo Antigravity / Linear */}
      <ChatComposer
        inputText={inputText}
        onChangeInput={setInputText}
        onSubmit={handleSendMessage}
        onStop={handleStopGeneration}
        chatLocked={chatLocked}
        branchTarget={branchTarget}
        onCancelBranch={() => setBranchTarget(null)}
        activeChat={activeChat}
        agents={agents}
        modelsByProvider={modelsByProvider}
        onSelectAgent={async (newAgentId) => {
          await updateActiveChatConfig({ agent_id: newAgentId });
        }}
        onSelectModel={async (agentId, newModel) => {
          await api.updateAgent(agentId, { model_selected: newModel });
          setAgents((prev) =>
            prev.map((a) => (a._id === agentId ? { ...a, model_selected: newModel } : a))
          );
        }}
        onChangeHarnessMode={async (mode) => {
          await updateActiveChatConfig({ harness_mode: mode });
        }}
        compact={compact}
      />
    </div>
  );

  return (
    <div className="h-[100dvh] w-screen overflow-hidden flex bg-[#09090b] text-zinc-100 relative">
      {/* OVERLAY MÓVIL PARA CERRAR EL SIDEBAR */}
      {mobileSidebarOpen && (
        <div
          onClick={() => setMobileSidebarOpen(false)}
          className="fixed inset-0 z-30 bg-black/65 backdrop-blur-sm md:hidden"
        />
      )}

      {/* SIDEBAR IZQUIERDO (Drawer en Móvil, Colapsable en Desktop) */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 max-w-[82vw] bg-[#11131a] border-r border-white/[0.07] flex flex-col justify-between shrink-0 transition-transform duration-200 ease-out md:static ${
          mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'
        } ${desktopSidebarOpen ? 'md:translate-x-0 md:flex' : 'md:hidden'}`}
      >
        {/* Logo + Nuevo Chat + Navegación */}
        <div className="p-3.5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
                <GitBranch className="w-3.5 h-3.5 text-emerald-400" />
              </div>
              <div className="leading-none">
                <div className="font-semibold text-[13.5px] text-zinc-100">insanus-harnes</div>
                <div className="text-[10px] text-zinc-500 font-mono mt-0.5">
                  {isDesktop ? 'v1.4.2 · Desktop' : 'v1.4.2 · harnes.insanustech.com.ar'}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setMobileSidebarOpen(false)}
              className="md:hidden p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.06]"
              title="Cerrar menú"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <button
            type="button"
            onClick={handleCreateNewChat}
            className="w-full h-9 flex items-center justify-center gap-2 px-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold text-xs transition"
          >
            <MessageSquarePlus className="w-3.5 h-3.5" />
            <span>Nueva Conversación</span>
          </button>

          <nav className="space-y-0.5 pt-0.5">
            <button
              type="button"
              onClick={() => {
                setMainSection('chat');
                setMobileSidebarOpen(false);
              }}
              className={`w-full h-8 flex items-center justify-between px-2.5 rounded-lg text-xs font-medium transition ${
                mainSection === 'chat'
                  ? 'bg-white/[0.08] text-zinc-100'
                  : 'text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200'
              }`}
            >
              <span className="flex items-center gap-2">
                <MessageSquare className="w-3.5 h-3.5 text-emerald-400" />
                <span>Conversaciones</span>
              </span>
              <span className="text-[10.5px] font-mono text-zinc-500">{chats.length}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setMainSection('studio');
                setMobileSidebarOpen(false);
              }}
              className={`w-full h-8 flex items-center gap-2 px-2.5 rounded-lg text-xs font-medium transition ${
                mainSection === 'studio'
                  ? 'bg-white/[0.08] text-zinc-100'
                  : 'text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5 text-sky-400" />
              <span>Agent & Tool Studio</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setMainSection('admin');
                setMobileSidebarOpen(false);
              }}
              className={`w-full h-8 flex items-center justify-between px-2.5 rounded-lg text-xs font-medium transition ${
                mainSection === 'admin'
                  ? 'bg-white/[0.08] text-zinc-100'
                  : 'text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200'
              }`}
            >
              <span className="flex items-center gap-2">
                <ShieldCheck className="w-3.5 h-3.5 text-amber-400" />
                <span>Administración</span>
              </span>
              {isAdmin && (
                <span className="px-1.5 rounded bg-amber-500/15 text-amber-300 text-[9.5px] font-mono">
                  ADMIN
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                setMainSection('settings');
                setMobileSidebarOpen(false);
              }}
              className={`w-full h-8 flex items-center justify-between px-2.5 rounded-lg text-xs font-medium transition ${
                mainSection === 'settings'
                  ? 'bg-white/[0.08] text-zinc-100'
                  : 'text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200'
              }`}
            >
              <span className="flex items-center gap-2">
                <Settings className="w-3.5 h-3.5 text-zinc-400" />
                <span>Configuración</span>
              </span>
              {isDesktop && localStatus && (
                <span
                  className={`px-1.5 rounded text-[9.5px] font-mono ${
                    localStatus.config.expose_to_cloud
                      ? 'bg-emerald-500/15 text-emerald-300'
                      : 'bg-amber-500/15 text-amber-300'
                  }`}
                >
                  {localStatus.config.expose_to_cloud ? 'REMOTO' : 'LOCAL'}
                </span>
              )}
            </button>
          </nav>
        </div>

        {/* Lista de Conversaciones */}
        <div className="flex-1 overflow-y-auto px-2.5 space-y-0.5">
          <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Recientes
          </div>
          {chats.map((c) => {
            const active = activeChatId === c._id && mainSection === 'chat';
            return (
              <div
                key={c._id}
                onClick={() => {
                  setActiveChatId(c._id);
                  setMainSection('chat');
                  if (c.execution_target !== 'workstation') {
                    setWorkspaceViewMode('agent');
                  }
                  setMobileSidebarOpen(false);
                }}
                className={`group h-8 flex items-center justify-between px-2.5 rounded-lg cursor-pointer text-xs transition ${
                  active
                    ? 'bg-white/[0.09] text-zinc-50 font-medium'
                    : 'text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200'
                }`}
              >
                <div
                  className="truncate pr-1.5 flex items-center gap-2 min-w-0"
                  title={
                    c.execution_target === 'workstation'
                      ? `Equipo local: ${c.workspace_path || '.'}`
                      : 'Chat en la Nube'
                  }
                >
                  {c.execution_target === 'workstation' ? (
                    <Laptop className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  ) : (
                    <Cloud className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                  )}
                  <span className="truncate">{c.title || 'Nueva conversación'}</span>
                </div>
                <button
                  type="button"
                  onClick={(e) => handleDeleteChat(c._id, e)}
                  className="opacity-70 md:opacity-0 md:group-hover:opacity-100 p-1 rounded hover:bg-rose-500/15 text-zinc-500 hover:text-rose-400 transition shrink-0"
                  title="Eliminar chat"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            );
          })}
        </div>

        {/* Footer Usuario */}
        <div className="p-3 border-t border-white/[0.07] flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-semibold flex items-center justify-center shrink-0">
              {(user?.display_name || user?.email || 'U')[0].toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="text-xs font-medium text-zinc-200 truncate">
                {user?.display_name || 'Usuario'}
              </div>
              <div className="text-[10.5px] text-zinc-500 truncate font-mono">{user?.email}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="p-1.5 rounded-lg hover:bg-white/[0.06] text-zinc-500 hover:text-rose-400 transition shrink-0"
            title="Cerrar sesión"
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </aside>

      {/* CONTENIDO PRINCIPAL */}
      <main className="flex-1 h-full min-w-0 flex flex-col overflow-hidden bg-[#09090b]">
        {/* Header móvil minimal para Studio y Admin */}
        {mainSection !== 'chat' && (
          <div className="h-12 px-3 sm:px-4 border-b border-white/[0.07] bg-[#0e1017] flex items-center justify-between gap-2 shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <button
                type="button"
                onClick={() => setMobileSidebarOpen(true)}
                className="md:hidden w-8 h-8 rounded-lg hover:bg-white/[0.06] text-zinc-300 flex items-center justify-center"
                title="Abrir menú"
              >
                <Menu className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setDesktopSidebarOpen((o) => !o)}
                className="hidden md:flex w-8 h-8 rounded-lg hover:bg-white/[0.06] text-zinc-400 hover:text-zinc-100 items-center justify-center"
                title="Alternar barra lateral"
              >
                <PanelLeft className="w-4 h-4" />
              </button>
              <span className="font-semibold text-[13.5px] text-zinc-100 truncate">
                {mainSection === 'studio'
                  ? 'Agent & Tool Studio'
                  : mainSection === 'admin'
                  ? 'Panel de Administración'
                  : 'Configuración Workstation'}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setMainSection('chat')}
              className="h-7 px-2.5 rounded-lg bg-white/[0.07] hover:bg-white/[0.11] text-zinc-200 text-xs font-medium flex items-center gap-1.5 shrink-0 transition"
            >
              <MessageSquare className="w-3.5 h-3.5 text-emerald-400" />
              <span>Volver al Chat</span>
            </button>
          </div>
        )}

        {mainSection === 'studio' && (
          <StudioView
            agents={agents}
            mcps={mcps}
            snippets={snippets}
            apiKeys={apiKeys}
            onRefreshAll={loadAllUserData}
          />
        )}

        {mainSection === 'admin' && (
          <AdminView isAdmin={isAdmin} onPromotedToAdmin={loadAllUserData} />
        )}

        {mainSection === 'settings' && (
          <SettingsView
            nodes={nodes}
            localStatus={localStatus}
            cloudConnected={cloudConnected}
            onRefreshAll={refreshNodes}
            onRefreshLocalStatus={refreshLocalStatus}
            onSyncLocalToBackend={syncLocalAndBackendPolicy}
          />
        )}

        {mainSection === 'chat' && (
          <>
            {/* HEADER ÚNICO UNIFICADO (h-12 / 48px) ESTILO ANTIGRAVITY */}
            <header className="h-12 px-2.5 sm:px-3.5 border-b border-white/[0.07] bg-[#0e1017]/95 flex items-center justify-between gap-2 shrink-0">
              {/* Izquierda: Toggle Sidebar + Título + Status Dot */}
              <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => setMobileSidebarOpen(true)}
                  className="md:hidden w-8 h-8 rounded-lg hover:bg-white/[0.06] text-zinc-300 flex items-center justify-center shrink-0"
                  title="Abrir conversaciones"
                >
                  <Menu className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setDesktopSidebarOpen((o) => !o)}
                  className="hidden md:flex w-8 h-8 rounded-lg hover:bg-white/[0.06] text-zinc-400 hover:text-zinc-100 items-center justify-center shrink-0 transition"
                  title={desktopSidebarOpen ? 'Ocultar panel lateral' : 'Mostrar panel lateral'}
                >
                  <PanelLeft className="w-4 h-4" />
                </button>

                <h2 className="text-[13px] sm:text-[13.5px] font-medium text-zinc-100 truncate">
                  {activeChat?.title || 'InsanusChat'}
                </h2>

                <span
                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                    wsConnected ? 'bg-emerald-400' : 'bg-zinc-600'
                  }`}
                  title={wsConnected ? 'WebSocket conectado en vivo' : 'Modo REST'}
                />

                {chatLocked && (
                  <button
                    type="button"
                    onClick={() =>
                      activeChatId && api.unlockChat(activeChatId).then(() => setChatLocked(false))
                    }
                    className="h-6 px-2 rounded-md bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 text-[10.5px] font-medium flex items-center gap-1 shrink-0 transition"
                    title="Desbloquear conversación si quedó trabada"
                  >
                    <Lock className="w-2.5 h-2.5" />
                    <span className="hidden sm:inline">Unlock</span>
                  </button>
                )}
              </div>

              {/* Centro: Conmutador Segmented [Agente | Editor] (solo cuando hay equipo local conectado) */}
              {isWorkstationChat && (
                <div className="flex items-center p-0.5 rounded-lg bg-[#161922] border border-white/[0.08] shrink-0">
                  <button
                    type="button"
                    onClick={() => handleSwitchWorkspaceViewMode('agent')}
                    className={`h-7 px-2 sm:px-3 rounded-md text-xs font-medium flex items-center gap-1.5 transition ${
                      workspaceViewMode === 'agent'
                        ? 'bg-white/[0.11] text-zinc-50 shadow-sm'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Agente</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSwitchWorkspaceViewMode('vscode')}
                    className={`h-7 px-2 sm:px-3 rounded-md text-xs font-medium flex items-center gap-1.5 transition ${
                      workspaceViewMode === 'vscode'
                        ? 'bg-white/[0.11] text-zinc-50 shadow-sm'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    <Code2 className="w-3.5 h-3.5 text-sky-400" />
                    <span className="hidden sm:inline">Editor</span>
                    <span className="sm:hidden">IDE</span>
                  </button>
                </div>
              )}

              {/* Derecha: Pill Control Remoto (Desktop) + Popover de Entorno + Toggle de Vista Contextual */}
              <div className="flex items-center justify-end gap-1.5 shrink-0">
                {isDesktop && localStatus && (
                  <button
                    type="button"
                    onClick={() => setMainSection('settings')}
                    className={`hidden xl:flex h-7 px-2 rounded-lg border text-[11px] font-medium items-center gap-1.5 whitespace-nowrap transition shrink-0 ${
                      localStatus.config.expose_to_cloud
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/20'
                        : 'bg-amber-500/10 border-amber-500/30 text-amber-300 hover:bg-amber-500/20'
                    }`}
                    title="Abrir Configuración de Control Remoto (Ctrl+,)"
                  >
                    {localStatus.config.expose_to_cloud ? (
                      <>
                        <Globe className="w-3 h-3 shrink-0" />
                        <span>{localStatus.bridge.connected ? 'Remoto ON' : 'Conectando...'}</span>
                      </>
                    ) : (
                      <>
                        <Lock className="w-3 h-3 shrink-0" />
                        <span>Solo Local</span>
                      </>
                    )}
                  </button>
                )}

                <EnvironmentPopover
                  activeChat={activeChat}
                  nodes={nodes}
                  onUpdateChatConfig={updateActiveChatConfig}
                  onRefreshNodes={refreshNodes}
                  onSwitchToAgentMode={() => handleSwitchWorkspaceViewMode('agent')}
                  onOpenSettings={() => setMainSection('settings')}
                  onToggleRemoteControl={async (targetNode) => {
                    if (isDesktop && targetNode.is_local_desktop) {
                      await syncLocalAndBackendPolicy({
                        expose_to_cloud: !targetNode.expose_to_cloud,
                      });
                    } else if (targetNode.is_builtin_host) {
                      await api.updateLocalNodePrivacy({
                        expose_to_cloud: !targetNode.expose_to_cloud,
                        allow_remote_terminal: targetNode.allow_remote_terminal ?? true,
                      });
                    } else {
                      await api.updateWorkstationPolicy(
                        targetNode.node_id,
                        { expose_to_cloud: !targetNode.expose_to_cloud },
                        false
                      );
                    }
                  }}
                />

                {isEditorMode ? (
                  <button
                    type="button"
                    onClick={() => setShowAgentDock((s) => !s)}
                    className={`hidden lg:flex h-7 px-2.5 rounded-lg border text-xs font-medium items-center gap-1.5 transition ${
                      showAgentDock
                        ? 'bg-emerald-500/15 border-emerald-500/35 text-emerald-300'
                        : 'bg-[#161922] border-white/[0.08] text-zinc-400 hover:text-zinc-200'
                    }`}
                    title="Mostrar u ocultar panel lateral del Agente"
                  >
                    <PanelRight className="w-3.5 h-3.5" />
                    <span>Agente</span>
                  </button>
                ) : (
                  <>
                    {/* Desktop: Segmented [Hilo | Split | Árbol] */}
                    <div className="hidden lg:flex items-center p-0.5 rounded-lg bg-[#161922] border border-white/[0.08]">
                      <button
                        type="button"
                        onClick={() => setChatViewMode('thread')}
                        className={`h-6 px-2 rounded-md text-[11px] font-medium flex items-center gap-1 transition ${
                          chatViewMode === 'thread'
                            ? 'bg-white/[0.11] text-zinc-50'
                            : 'text-zinc-400 hover:text-zinc-200'
                        }`}
                        title="Solo Hilo"
                      >
                        <Layers className="w-3 h-3" />
                        <span>Hilo</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setChatViewMode('split')}
                        className={`h-6 px-2 rounded-md text-[11px] font-medium flex items-center gap-1 transition ${
                          chatViewMode === 'split'
                            ? 'bg-white/[0.11] text-zinc-50'
                            : 'text-zinc-400 hover:text-zinc-200'
                        }`}
                        title="Hilo + Árbol 2D"
                      >
                        <Columns className="w-3 h-3" />
                        <span>Split</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setChatViewMode('tree')}
                        className={`h-6 px-2 rounded-md text-[11px] font-medium flex items-center gap-1 transition ${
                          chatViewMode === 'tree'
                            ? 'bg-white/[0.11] text-zinc-50'
                            : 'text-zinc-400 hover:text-zinc-200'
                        }`}
                        title="Mapa de Árbol 2D"
                      >
                        <Network className="w-3 h-3" />
                        <span>Árbol</span>
                      </button>
                    </div>

                    {/* Móvil / Tablet (<1024px): Un único botón limpio Hilo <-> Árbol */}
                    <button
                      type="button"
                      onClick={() => setChatViewMode((m) => (m === 'tree' ? 'thread' : 'tree'))}
                      className={`lg:hidden h-7 px-2 rounded-lg border text-xs font-medium flex items-center gap-1 transition ${
                        chatViewMode === 'tree'
                          ? 'bg-emerald-500/15 border-emerald-500/35 text-emerald-300'
                          : 'bg-[#161922] border-white/[0.08] text-zinc-300'
                      }`}
                      title={chatViewMode === 'tree' ? 'Volver al hilo' : 'Ver mapa de árbol 2D'}
                    >
                      {chatViewMode === 'tree' ? (
                        <>
                          <Layers className="w-3.5 h-3.5" />
                          <span className="hidden xs:inline">Hilo</span>
                        </>
                      ) : (
                        <>
                          <Network className="w-3.5 h-3.5" />
                          <span className="hidden xs:inline">Árbol</span>
                        </>
                      )}
                    </button>
                  </>
                )}
              </div>
            </header>

            {/* ÁREA PRINCIPAL: VS CODE WORKBENCH NATIVO O VISTA AGENTE */}
            {isEditorMode ? (
              <VSCodeEditorView
                node={activeNode}
                workspace={activeChat?.workspace_path || '.'}
                initialFilePath={editorTargetFile?.path || null}
                initialDiff={editorTargetFile?.diff || null}
                showAgentDock={showAgentDock}
                onToggleAgentDock={() => setShowAgentDock((s) => !s)}
                agentDockSlot={renderChatPanel(true)}
                onTogglePrivacy={async () => {
                  if (!activeNode) return;
                  await api.updateLocalNodePrivacy({
                    expose_to_cloud: !activeNode.expose_to_cloud,
                    allow_remote_terminal: activeNode.allow_remote_terminal ?? true,
                  });
                  await refreshNodes();
                }}
              />
            ) : (
              <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
                {(chatViewMode === 'thread' || chatViewMode === 'split') && (
                  <div
                    className={`flex flex-col min-h-0 ${
                      chatViewMode === 'split'
                        ? 'w-full lg:w-[56%] h-full lg:border-r border-white/[0.07]'
                        : 'w-full h-full'
                    }`}
                  >
                    {renderChatPanel(false)}
                  </div>
                )}

                {(chatViewMode === 'tree' || chatViewMode === 'split') && (
                  <div
                    className={
                      chatViewMode === 'split'
                        ? 'hidden lg:block lg:w-[44%] h-full'
                        : 'w-full h-full'
                    }
                  >
                    <TreeGraphView
                      messages={messages}
                      activePathIds={activePathIds}
                      selectedNodeId={
                        branchTarget?.refMsg._id ||
                        focusedMsgId ||
                        activeThread[activeThread.length - 1]?._id ||
                        null
                      }
                      onSelectNode={(msgId) => selectNodePathInTree(msgId, messages, true)}
                      onBranchFromNode={(msg) => {
                        triggerBranchFromMessage(msg, false);
                        if (chatViewMode === 'tree') {
                          setChatViewMode(
                            typeof window !== 'undefined' && window.innerWidth < 1024
                              ? 'thread'
                              : 'split'
                          );
                        }
                      }}
                    />
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
};
