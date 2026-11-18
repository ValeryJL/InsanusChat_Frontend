import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  ChevronLeft,
  ChevronRight,
  Code2,
  ExternalLink,
  FolderGit2,
  GitBranch,
  Loader2,
  Plus,
  RefreshCw,
  Sparkles,
  Wrench,
} from 'lucide-react';
import { AgentTaskPlan } from '../components/AgentTaskPlan';
import { ChatComposer } from '../components/ChatComposer';
import { MarkdownRenderer } from '../components/MarkdownRenderer';
import {
  AgentItem,
  ChatItem,
  ChatMessage,
  PendingToolApproval,
  TaskPlanStep,
} from '../types';

declare global {
  interface Window {
    acquireVsCodeApi?: () => {
      postMessage: (msg: any) => void;
      getState: () => any;
      setState: (state: any) => void;
    };
  }
}

interface BootstrapPayload {
  backendUrl: string;
  jwtToken?: string | null;
  daemonUrl?: string;
  localToken?: string;
  nodeId?: string | null;
  workspacePath?: string;
  workspaceName?: string;
  folderPath?: string;
  initialChatId?: string | null;
  isEmbedded?: boolean;
}

interface EditorDiagnosticItem {
  file: string;
  line: number;
  col?: number;
  severity: 'error' | 'warning' | 'info' | 'hint';
  message: string;
  source?: string;
}

interface EditorContextPayload {
  activeFile?: string | null;
  line?: number;
  selection?: string;
  diagnostics?: EditorDiagnosticItem[];
  errorCount?: number;
  warningCount?: number;
}

const vscodeApi = typeof window !== 'undefined' && window.acquireVsCodeApi ? window.acquireVsCodeApi() : null;

function buildThreadFromMessages(
  messages: ChatMessage[],
  selectedChildByParent: Record<string, string>
): {
  byId: Map<string, ChatMessage>;
  roots: ChatMessage[];
  thread: ChatMessage[];
} {
  const byId = new Map<string, ChatMessage>();
  messages.forEach((m) => byId.set(m._id, m));

  const roots = messages.filter((m) => !m.parent_id || !byId.has(m.parent_id));
  const thread: ChatMessage[] = [];
  if (roots.length === 0) return { byId, roots, thread };

  const chosenRootId = selectedChildByParent['__ROOT__'];
  let curr: ChatMessage | undefined =
    roots.find((r) => r._id === chosenRootId) || roots[roots.length - 1];

  const visited = new Set<string>();
  while (curr && !visited.has(curr._id)) {
    visited.add(curr._id);
    thread.push(curr);
    const children = (curr.children_ids || [])
      .map((cid) => byId.get(cid))
      .filter((x): x is ChatMessage => Boolean(x));
    if (children.length === 0) break;
    const chosen = selectedChildByParent[curr._id];
    curr = children.find((c) => c._id === chosen) || children[children.length - 1];
  }
  return { byId, roots, thread };
}

export const VSCodeChatApp: React.FC = () => {
  const [bootstrap, setBootstrap] = useState<BootstrapPayload | null>(null);
  const [jwtToken, setJwtToken] = useState<string | null>(null);
  const [editorCtx, setEditorCtx] = useState<EditorContextPayload>({});

  // Login inline si el usuario todavía no inició sesión en insanus-harnes
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPass, setLoginPass] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  // Estado del Workspace & Chat
  const [workspaceChats, setWorkspaceChats] = useState<ChatItem[]>([]);
  const [activeChat, setActiveChat] = useState<ChatItem | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [selectedChildByParent, setSelectedChildByParent] = useState<Record<string, string>>({});
  const [agents, setAgents] = useState<AgentItem[]>([]);
  const [modelsByProvider, setModelsByProvider] = useState<Record<string, { id: string; name: string }[]>>({});

  // Streaming, tools y compositor
  const [inputText, setInputText] = useState('');
  const [chatLocked, setChatLocked] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const [streamingContent, setStreamingContent] = useState<string | null>(null);
  const [activeToolName, setActiveToolName] = useState<string | null>(null);
  const [pendingApproval, setPendingApproval] = useState<PendingToolApproval | null>(null);
  const [branchTarget, setBranchTarget] = useState<{ parentId: string | null; refMsg: ChatMessage } | null>(null);
  const [loadingChat, setLoadingChat] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const scrollEndRef = useRef<HTMLDivElement | null>(null);
  const backendBase = (bootstrap?.backendUrl || 'https://harnes.insanustech.com.ar').replace(/\/+$/, '');

  const apiFetch = useCallback(
    async (path: string, opts: RequestInit = {}, overrideToken?: string | null) => {
      const tok = overrideToken !== undefined ? overrideToken : jwtToken;
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...((opts.headers as Record<string, string>) || {}),
      };
      if (tok) headers['Authorization'] = `Bearer ${tok}`;
      const res = await fetch(`${backendBase}${path}`, { ...opts, headers });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.detail || data?.message || `HTTP ${res.status}`);
      }
      return data;
    },
    [backendBase, jwtToken]
  );

  // Escuchar mensajes del Extension Host de VS Code
  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      const msg = ev.data;
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'bootstrap') {
        const p = msg.payload as BootstrapPayload;
        setBootstrap(p);
        if (p.jwtToken) setJwtToken(p.jwtToken);
      } else if (msg.type === 'editorContext') {
        setEditorCtx(msg.payload || {});
      } else if (msg.type === 'prefillPrompt' && typeof msg.text === 'string') {
        setInputText((prev) => (prev ? `${prev}\n\n${msg.text}` : msg.text));
      } else if (msg.type === 'switchChat' && msg.chatId) {
        setActiveChat((prev) => {
          if (prev && prev._id === msg.chatId) return prev;
          return prev;
        });
        setWorkspaceChats((prev) => {
          const found = prev.find((c) => c._id === msg.chatId);
          if (found) setActiveChat(found);
          return prev;
        });
      }
    };
    window.addEventListener('message', onMessage);
    vscodeApi?.postMessage({ type: 'ready' });
    return () => window.removeEventListener('message', onMessage);
  }, []);

  // Resolver el chat del workspace actual + cargar agentes y modelos
  const resolveWorkspaceSession = useCallback(
    async (overrideToken?: string | null) => {
      const tok = overrideToken !== undefined ? overrideToken : jwtToken;
      if (!bootstrap || !tok) return;
      setLoadingChat(true);
      setErrorBanner(null);
      try {
        const [resolvedRes, agentsRes, modelsRes] = await Promise.all([
          apiFetch(
            '/api/v1/chats/resolve-workspace',
            {
              method: 'POST',
              body: JSON.stringify({
                node_id: bootstrap.nodeId || null,
                workspace_path: bootstrap.workspacePath || '.',
                title: `${bootstrap.workspaceName || bootstrap.workspacePath || 'Workspace'} · VS Code`,
                create_if_missing: true,
              }),
            },
            tok
          ),
          apiFetch('/api/v1/agents/', {}, tok).catch(() => ({ data: [] })),
          apiFetch('/api/v1/agents/models', {}, tok).catch(() => ({ data: {} })),
        ]);

        const payload = resolvedRes?.data || resolvedRes;
        const list: ChatItem[] = payload?.workspace_chats || [];
        const chosen: ChatItem | null =
          (bootstrap.initialChatId && list.find((c) => c._id === bootstrap.initialChatId)) ||
          payload?.active_chat ||
          list[0] ||
          null;

        setWorkspaceChats(list);
        setActiveChat(chosen);
        setAgents(Array.isArray(agentsRes?.data) ? agentsRes.data : []);
        setModelsByProvider(modelsRes?.data || {});
      } catch (err: any) {
        setErrorBanner(err?.message || 'No se pudo resolver el chat de este workspace');
      } finally {
        setLoadingChat(false);
      }
    },
    [apiFetch, bootstrap, jwtToken]
  );

  useEffect(() => {
    if (bootstrap && jwtToken) {
      resolveWorkspaceSession();
    }
  }, [bootstrap, jwtToken, resolveWorkspaceSession]);

  // Cargar mensajes + abrir WebSocket en vivo del chat activo (sincronización 3-vías)
  const loadMessages = useCallback(
    async (chatId: string) => {
      try {
        const res = await apiFetch(`/api/v1/chats/${chatId}/messages`);
        const msgs: ChatMessage[] = Array.isArray(res?.data) ? res.data : [];
        setMessages(msgs);
      } catch (err: any) {
        setErrorBanner(err?.message || 'Error cargando mensajes');
      }
    },
    [apiFetch]
  );

  useEffect(() => {
    if (!activeChat?._id || !jwtToken) return;
    const chatId = activeChat._id;
    setChatLocked(Boolean(activeChat.locked));
    setStreamingContent(null);
    setActiveToolName(null);
    setPendingApproval(null);
    setBranchTarget(null);
    loadMessages(chatId);

    const wsProto = backendBase.toLowerCase().startsWith('https://') ? 'wss:' : 'ws:';
    const host = backendBase.replace(/^https?:\/\//i, '');
    const wsUrl = `${wsProto}//${host}/api/v1/chats/ws?chat_id=${encodeURIComponent(chatId)}&token=${encodeURIComponent(jwtToken)}`;

    let closed = false;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!closed) setWsConnected(true);
    };
    ws.onclose = () => {
      if (!closed) setWsConnected(false);
    };
    ws.onerror = () => {
      if (!closed) setWsConnected(false);
    };
    ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        const cmd = data.cmd;
        if (cmd === 'agent_stream_start') {
          setChatLocked(true);
          setStreamingContent('');
        } else if (cmd === 'agent_token') {
          const chunk = data.token ?? data.message?.token ?? '';
          if (chunk) setStreamingContent((prev) => (prev ?? '') + chunk);
        } else if (cmd === 'agent_tool_start') {
          setActiveToolName(data.tool || data.message?.tool || 'herramienta');
        } else if (cmd === 'agent_tool_end') {
          setActiveToolName(null);
        } else if (cmd === 'agent_tool_approval_needed') {
          const info = data.message || data;
          setPendingApproval({
            approval_id: info.approval_id,
            chat_id: info.chat_id || chatId,
            tool: info.tool,
            args: info.args || {},
            diff: info.diff,
          });
        } else if (cmd === 'agent_tool_approval_resolved') {
          setPendingApproval(null);
        } else if (cmd === 'task_plan_updated') {
          const steps: TaskPlanStep[] = data.task_plan || data.message?.task_plan || [];
          setActiveChat((prev) => (prev ? { ...prev, task_plan: steps } : prev));
        } else if (cmd === 'message_created' || cmd === 'chat_unlocked') {
          if (cmd === 'chat_unlocked') {
            setChatLocked(false);
            setStreamingContent(null);
            setActiveToolName(null);
          }
          loadMessages(chatId);
        } else if (cmd === 'chat_locked') {
          setChatLocked(true);
        }
      } catch {}
    };

    return () => {
      closed = true;
      try {
        ws.close();
      } catch {}
      if (wsRef.current === ws) wsRef.current = null;
    };
  }, [activeChat?._id, backendBase, jwtToken, loadMessages]);

  const { byId, roots, thread } = useMemo(
    () => buildThreadFromMessages(messages, selectedChildByParent),
    [messages, selectedChildByParent]
  );

  useEffect(() => {
    scrollEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [thread.length, streamingContent, activeToolName]);

  const handleCreateWorkspaceChat = async () => {
    if (!bootstrap || !jwtToken) return;
    try {
      const res = await apiFetch('/api/v1/chats/', {
        method: 'POST',
        body: JSON.stringify({
          title: `${bootstrap.workspaceName || bootstrap.workspacePath || 'Proyecto'} #${workspaceChats.length + 1}`,
          execution_target: bootstrap.nodeId ? 'workstation' : 'cloud',
          node_id: bootstrap.nodeId || null,
          workspace_path: bootstrap.workspacePath || '.',
          harness_mode: 'auto_edit',
        }),
      });
      const created: ChatItem = res?.data;
      if (created?._id) {
        setWorkspaceChats((prev) => [created, ...prev]);
        setActiveChat(created);
        setMessages([]);
      }
    } catch (err: any) {
      setErrorBanner(err?.message || 'Error creando chat');
    }
  };

  const handleSubmitMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeChat?._id || !inputText.trim() || chatLocked) return;
    const text = inputText.trim();
    const parentId = branchTarget
      ? branchTarget.parentId
      : thread.length > 0
      ? thread[thread.length - 1]._id
      : null;

    setInputText('');
    setBranchTarget(null);
    setChatLocked(true);
    setErrorBanner(null);

    try {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            cmd: 'send_message',
            chat_id: activeChat._id,
            content: text,
            parent_id: parentId,
          })
        );
      } else {
        await apiFetch(`/api/v1/chats/${activeChat._id}/messages`, {
          method: 'POST',
          body: JSON.stringify({ content: text, parent_id: parentId }),
        });
        await loadMessages(activeChat._id);
        setChatLocked(false);
      }
    } catch (err: any) {
      setChatLocked(false);
      setErrorBanner(err?.message || 'No se pudo enviar el mensaje');
    }
  };

  const handleStop = async () => {
    if (!activeChat?._id) return;
    try {
      await apiFetch(`/api/v1/chats/${activeChat._id}/unlock`, { method: 'POST' });
    } catch {}
    setChatLocked(false);
    setStreamingContent(null);
    setActiveToolName(null);
  };

  const handleResolveApproval = async (approvalId: string, approved: boolean, feedback?: string) => {
    if (!activeChat?._id) return;
    await apiFetch(`/api/v1/chats/${activeChat._id}/approve_tool`, {
      method: 'POST',
      body: JSON.stringify({ approval_id: approvalId, approved, feedback: feedback || '' }),
    });
    setPendingApproval(null);
  };

  const handleAttachSelection = () => {
    if (!editorCtx.activeFile) return;
    const snippet = editorCtx.selection
      ? `Contexto de \`${editorCtx.activeFile}:${editorCtx.line || 1}\`:\n\`\`\`\n${editorCtx.selection}\n\`\`\``
      : `Revisá \`${editorCtx.activeFile}:${editorCtx.line || 1}\``;
    setInputText((prev) => (prev ? `${prev}\n\n${snippet}` : snippet));
  };

  const handleFixLspErrors = () => {
    const errs = (editorCtx.diagnostics || []).filter((d) => d.severity === 'error').slice(0, 12);
    if (errs.length === 0) return;
    const summary = errs
      .map((d) => `- \`${d.file}:${d.line}\` [${d.source || 'LSP'}]: ${d.message}`)
      .join('\n');
    const prompt = `Corregí los siguientes ${errs.length} errores LSP detectados en el workspace:\n${summary}`;
    setInputText(prompt);
  };

  const handleInlineLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginBusy(true);
    setLoginError(null);
    try {
      const res = await fetch(`${backendBase}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: loginEmail.trim(), password: loginPass }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.detail || 'Credenciales inválidas');
      const tok = payload?.data?.access_token;
      if (!tok) throw new Error('No se recibió access_token');
      setJwtToken(tok);
      vscodeApi?.postMessage({ type: 'saveLoginToken', token: tok, backendUrl: backendBase });
    } catch (err: any) {
      setLoginError(err?.message || 'Error iniciando sesión');
    } finally {
      setLoginBusy(false);
    }
  };

  if (!bootstrap) {
    return (
      <div className="h-screen w-full bg-[#09090b] text-zinc-400 flex flex-col items-center justify-center gap-2 text-xs">
        <Loader2 className="w-4 h-4 text-emerald-400 animate-spin" />
        <span>Conectando con insanus-harnes...</span>
      </div>
    );
  }

  if (!jwtToken) {
    return (
      <div className="h-screen w-full bg-[#09090b] text-zinc-100 p-4 flex flex-col justify-center">
        <div className="rounded-xl bg-[#0e1017] border border-white/[0.08] p-4 space-y-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
              <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
            </div>
            <div>
              <div className="text-xs font-semibold">insanus-harnes Chat</div>
              <div className="text-[10.5px] text-zinc-500 font-mono truncate">{backendBase}</div>
            </div>
          </div>
          <p className="text-[11.5px] text-zinc-400 leading-relaxed">
            Iniciá sesión para sincronizar el chat en vivo de{' '}
            <strong className="text-zinc-200">{bootstrap.workspaceName || 'este proyecto'}</strong>.
          </p>
          {loginError && (
            <div className="p-2 rounded-lg bg-rose-500/10 border border-rose-500/25 text-rose-300 text-[11px]">
              {loginError}
            </div>
          )}
          <form onSubmit={handleInlineLogin} className="space-y-2">
            <input
              type="email"
              required
              value={loginEmail}
              onChange={(e) => setLoginEmail(e.target.value)}
              placeholder="Correo electrónico"
              className="w-full h-8 px-2.5 rounded-lg bg-[#09090b] border border-white/[0.1] text-xs text-zinc-100 outline-none focus:border-emerald-500/60"
            />
            <input
              type="password"
              required
              value={loginPass}
              onChange={(e) => setLoginPass(e.target.value)}
              placeholder="Contraseña"
              className="w-full h-8 px-2.5 rounded-lg bg-[#09090b] border border-white/[0.1] text-xs text-zinc-100 outline-none focus:border-emerald-500/60"
            />
            <button
              type="submit"
              disabled={loginBusy}
              className="w-full h-8 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold text-xs transition"
            >
              {loginBusy ? 'Conectando...' : 'Conectar Workspace'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-full flex flex-col bg-[#09090b] text-zinc-100 overflow-hidden">
      {/* Header compacto vinculado al Proyecto actual */}
      <header className="px-2.5 py-2 bg-[#0e1017] border-b border-white/[0.08] space-y-1.5 shrink-0">
        <div className="flex items-center justify-between gap-1.5">
          <div className="flex items-center gap-1.5 min-w-0">
            <FolderGit2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span className="text-[11px] font-semibold text-zinc-200 truncate">
              {bootstrap.workspaceName || bootstrap.workspacePath || 'Workspace'}
            </span>
            <span
              className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                wsConnected ? 'bg-emerald-400' : 'bg-zinc-600'
              }`}
              title={wsConnected ? 'WebSocket sincronizado en vivo' : 'Reconectando...'}
            />
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={handleCreateWorkspaceChat}
              className="h-6 px-1.5 rounded-md bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-300 text-[10.5px] font-medium flex items-center gap-1 transition"
              title="Nuevo chat en este proyecto"
            >
              <Plus className="w-3 h-3" />
              <span>Nuevo</span>
            </button>
            <button
              type="button"
              onClick={() => resolveWorkspaceSession()}
              className="w-6 h-6 rounded-md hover:bg-white/[0.06] text-zinc-400 hover:text-zinc-200 flex items-center justify-center transition"
              title="Recargar conversaciones"
            >
              <RefreshCw className={`w-3 h-3 ${loadingChat ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={() =>
                vscodeApi?.postMessage({ type: 'openExternalApp', chatId: activeChat?._id || null })
              }
              className="w-6 h-6 rounded-md hover:bg-white/[0.06] text-zinc-400 hover:text-zinc-200 flex items-center justify-center transition"
              title="Abrir en insanus-harnes"
            >
              <ExternalLink className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* Selector de conversaciones de este mismo proyecto */}
        {workspaceChats.length > 0 && (
          <select
            aria-label="Conversaciones del proyecto"
            value={activeChat?._id || ''}
            onChange={(e) => {
              const found = workspaceChats.find((c) => c._id === e.target.value);
              if (found) setActiveChat(found);
            }}
            className="w-full h-7 px-2 rounded-lg bg-[#11131a] border border-white/[0.08] text-[11.5px] text-zinc-200 outline-none focus:border-emerald-500/50 truncate"
          >
            {workspaceChats.map((c) => (
              <option key={c._id} value={c._id} className="bg-[#11131a] text-zinc-100">
                {c.title}
              </option>
            ))}
          </select>
        )}
      </header>

      {errorBanner && (
        <div className="px-2.5 py-1.5 bg-rose-500/10 border-b border-rose-500/25 text-rose-300 text-[11px] flex items-center justify-between gap-2 shrink-0">
          <span className="truncate">{errorBanner}</span>
          <button
            type="button"
            onClick={() => setErrorBanner(null)}
            className="text-rose-200 hover:text-white text-[10px]"
          >
            Cerrar
          </button>
        </div>
      )}

      {/* Plan de Tareas + Aprobaciones HITL */}
      <AgentTaskPlan
        steps={activeChat?.task_plan || []}
        pendingApproval={pendingApproval}
        onResolveApproval={handleResolveApproval}
        compact
      />

      {/* Hilo de Mensajes */}
      <div className="flex-1 overflow-y-auto px-2.5 py-3 space-y-3.5">
        {thread.length === 0 && !streamingContent && (
          <div className="py-10 text-center space-y-2 px-3">
            <div className="w-9 h-9 mx-auto rounded-xl bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center">
              <Bot className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="text-xs font-semibold text-zinc-200">
              Agente listo en {bootstrap.workspaceName || 'este workspace'}
            </div>
            <p className="text-[11px] text-zinc-500 leading-relaxed">
              Sincronizado en tiempo real con <span className="text-zinc-300">insanus-harnes</span>.
              Podés adjuntar tu archivo activo o enviar errores LSP con un clic.
            </p>
          </div>
        )}

        {thread.map((msg) => {
          const isUser = msg.role === 'user';
          const parentMsg = msg.parent_id ? byId.get(msg.parent_id) : null;
          const siblingIds = parentMsg ? parentMsg.children_ids || [] : roots.map((r) => r._id);
          const hasSiblings = siblingIds.length > 1;
          const siblingIdx = siblingIds.indexOf(msg._id);

          const switchBranch = (targetId: string) => {
            const key = msg.parent_id || '__ROOT__';
            setSelectedChildByParent((prev) => ({ ...prev, [key]: targetId }));
          };

          return (
            <div key={msg._id} className="space-y-1">
              {hasSiblings && (
                <div className="flex items-center gap-1 text-[10px] text-zinc-500 font-mono">
                  <button
                    type="button"
                    disabled={siblingIdx <= 0}
                    onClick={() => switchBranch(siblingIds[siblingIdx - 1])}
                    className="p-0.5 rounded hover:bg-white/[0.06] disabled:opacity-30"
                  >
                    <ChevronLeft className="w-3 h-3" />
                  </button>
                  <span>
                    Rama {siblingIdx + 1}/{siblingIds.length}
                  </span>
                  <button
                    type="button"
                    disabled={siblingIdx >= siblingIds.length - 1}
                    onClick={() => switchBranch(siblingIds[siblingIdx + 1])}
                    className="p-0.5 rounded hover:bg-white/[0.06] disabled:opacity-30"
                  >
                    <ChevronRight className="w-3 h-3" />
                  </button>
                </div>
              )}

              {isUser ? (
                <div className="flex justify-end">
                  <div className="max-w-[92%] rounded-xl rounded-br-sm px-3 py-2 bg-[#161922] border border-white/[0.08] text-xs text-zinc-100 whitespace-pre-wrap break-words">
                    {msg.content}
                  </div>
                </div>
              ) : (
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[10.5px] text-zinc-500">
                    <span className="flex items-center gap-1 font-medium text-emerald-400">
                      <Sparkles className="w-3 h-3" />
                      <span>Agente</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setBranchTarget({ parentId: msg._id, refMsg: msg })}
                      className="flex items-center gap-0.5 hover:text-zinc-200 transition"
                      title="Ramificar desde esta respuesta"
                    >
                      <GitBranch className="w-2.5 h-2.5" />
                      <span>Ramificar</span>
                    </button>
                  </div>
                  <MarkdownRenderer
                    content={msg.content}
                    toolCalls={msg.tool_calls}
                    onOpenFileInEditor={(filePath, diff) => {
                      vscodeApi?.postMessage({
                        type: diff ? 'openDiff' : 'openFile',
                        path: filePath,
                        diff,
                      });
                    }}
                  />
                </div>
              )}
            </div>
          );
        })}

        {(streamingContent !== null || activeToolName) && (
          <div className="space-y-1.5">
            {activeToolName && (
              <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-[#11131a] border border-emerald-500/25 text-[11px] text-emerald-300 font-mono">
                <Wrench className="w-3 h-3 animate-pulse" />
                <span>Ejecutando {activeToolName}...</span>
              </div>
            )}
            {streamingContent && <MarkdownRenderer content={streamingContent} />}
          </div>
        )}
        <div ref={scrollEndRef} />
      </div>

      {/* Chips vivos de Contexto del Editor & Diagnósticos LSP */}
      {(editorCtx.activeFile || (editorCtx.errorCount || 0) > 0) && (
        <div className="px-2.5 pt-1.5 flex flex-wrap items-center gap-1.5 border-t border-white/[0.06] bg-[#0b0d12] shrink-0">
          {editorCtx.activeFile && (
            <button
              type="button"
              onClick={handleAttachSelection}
              className="h-6 px-2 rounded-md bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] text-[10.5px] font-mono text-zinc-300 flex items-center gap-1 max-w-full truncate transition"
              title="Adjuntar archivo/selección activa al mensaje"
            >
              <Code2 className="w-3 h-3 text-sky-400 shrink-0" />
              <span className="truncate">
                {editorCtx.activeFile}
                {editorCtx.line ? `:${editorCtx.line}` : ''}
                {editorCtx.selection ? ' (sel)' : ''}
              </span>
            </button>
          )}
          {(editorCtx.errorCount || 0) > 0 && (
            <button
              type="button"
              onClick={handleFixLspErrors}
              className="h-6 px-2 rounded-md bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-[10.5px] text-rose-300 font-medium flex items-center gap-1 transition"
              title="Enviar errores LSP al Agente para corregir"
            >
              <AlertTriangle className="w-3 h-3 shrink-0" />
              <span>{editorCtx.errorCount} LSP · Arreglar</span>
            </button>
          )}
        </div>
      )}

      {/* Compositor reutilizado de insanus-harnes */}
      <ChatComposer
        inputText={inputText}
        onChangeInput={setInputText}
        onSubmit={handleSubmitMessage}
        onStop={handleStop}
        chatLocked={chatLocked}
        branchTarget={branchTarget}
        onCancelBranch={() => setBranchTarget(null)}
        activeChat={activeChat}
        agents={agents}
        modelsByProvider={modelsByProvider}
        onSelectAgent={async (agentId) => {
          if (!activeChat?._id) return;
          const res = await apiFetch(`/api/v1/chats/${activeChat._id}`, {
            method: 'PATCH',
            body: JSON.stringify({ agent_id: agentId }),
          });
          if (res?.data) setActiveChat(res.data);
        }}
        onSelectModel={async (agentId, modelId) => {
          await apiFetch(`/api/v1/agents/${agentId}`, {
            method: 'PATCH',
            body: JSON.stringify({ model_selected: modelId }),
          });
          setAgents((prev) =>
            prev.map((a) => (a._id === agentId ? { ...a, model_selected: modelId } : a))
          );
        }}
        onChangeHarnessMode={async (mode) => {
          if (!activeChat?._id) return;
          const res = await apiFetch(`/api/v1/chats/${activeChat._id}`, {
            method: 'PATCH',
            body: JSON.stringify({ harness_mode: mode }),
          });
          if (res?.data) setActiveChat(res.data);
        }}
        compact
      />
    </div>
  );
};
