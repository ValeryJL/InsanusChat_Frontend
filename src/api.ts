import {
  getCloudServerUrl,
  getLocalDaemonNodeId,
  getLocalTerminalWebSocketUrlSync,
  isDesktopRuntime,
  localDaemonRequest,
} from './platform/desktop';
import { DesktopReleaseInfo } from './types';

function getApiBase(): string {
  return getCloudServerUrl();
}

function shouldRouteDirectToLocalDaemon(nodeId?: string | null): boolean {
  if (!isDesktopRuntime() || !nodeId) return false;
  const localId = getLocalDaemonNodeId();
  return Boolean(localId && nodeId === localId);
}

export function getStoredToken(): string | null {
  return localStorage.getItem('insanus_jwt_token');
}

export function setStoredToken(token: string | null) {
  if (token) {
    localStorage.setItem('insanus_jwt_token', token);
  } else {
    localStorage.removeItem('insanus_jwt_token');
  }
}

function resolveWsHostAndProto(): { wsProto: string; baseHost: string } {
  const apiBase = getApiBase();
  if (apiBase) {
    const isHttps = apiBase.toLowerCase().startsWith('https://');
    const baseHost = apiBase.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
    return { wsProto: isHttps ? 'wss:' : 'ws:', baseHost };
  }
  const loc = window.location;
  const wsProto = loc.protocol === 'https:' ? 'wss:' : 'ws:';
  return { wsProto, baseHost: loc.host };
}

export function getWebSocketUrl(chatId?: string): string {
  const token = getStoredToken() || '';
  const { wsProto, baseHost } = resolveWsHostAndProto();
  const params = new URLSearchParams();
  if (chatId) params.set('chat_id', chatId);
  if (token) params.set('token', token);
  return `${wsProto}//${baseHost}/api/v1/chats/ws?${params.toString()}`;
}

export function getRemoteTerminalWebSocketUrl(
  nodeId: string,
  workspace = '.',
  opts?: { cols?: number; rows?: number; shell?: string }
): string {
  // HU-42: En App Desktop sobre el equipo local, conectar directo al PTY del sidecar (0ms, funciona en Solo Local)
  if (shouldRouteDirectToLocalDaemon(nodeId)) {
    const directUrl = getLocalTerminalWebSocketUrlSync(workspace, opts);
    if (directUrl) return directUrl;
  }

  const token = getStoredToken() || '';
  const { wsProto, baseHost } = resolveWsHostAndProto();
  const params = new URLSearchParams({ workspace, token });
  if (opts?.cols) params.set('cols', String(opts.cols));
  if (opts?.rows) params.set('rows', String(opts.rows));
  if (opts?.shell) params.set('shell', opts.shell);
  return `${wsProto}//${baseHost}/api/v1/nodes/${encodeURIComponent(nodeId)}/terminal/ws?${params.toString()}`;
}

async function request<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getStoredToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${getApiBase()}${path}`, {
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
    const detail = payload?.detail || payload?.message || `HTTP Error ${res.status}`;
    throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
  }

  return payload as T;
}

export const api = {
  // Health (soporta probar una URL custom desde Desktop Login/Settings)
  health: (customBaseUrl?: string) => {
    if (customBaseUrl) {
      const clean = customBaseUrl.trim().replace(/\/+$/, '');
      return fetch(`${clean}/health`).then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      });
    }
    return request('/health');
  },

  // Auth
  login: (email: string, password: string) =>
    request('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  register: (email: string, password: string, display_name: string) =>
    request('/api/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, display_name }),
    }),
  getProfile: () => request('/api/v1/auth/'),
  updateProfile: (data: Record<string, any>) =>
    request('/api/v1/auth/', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  // Chats
  listChats: () => request('/api/v1/chats/'),
  createChat: (data: {
    title?: string;
    message?: string;
    agent_id?: string | null;
    execution_target?: 'cloud' | 'workstation';
    node_id?: string | null;
    workspace_path?: string;
    harness_mode?: 'ask' | 'auto_edit' | 'autopilot';
  }) =>
    request('/api/v1/chats/', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateChat: (chatId: string, data: Record<string, any>) =>
    request(`/api/v1/chats/${chatId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  approveChatTool: (chatId: string, approvalId: string, approved: boolean, feedback = '') =>
    request(`/api/v1/chats/${chatId}/approve_tool`, {
      method: 'POST',
      body: JSON.stringify({ approval_id: approvalId, approved, feedback }),
    }),
  deleteChat: (chatId: string) =>
    request(`/api/v1/chats/${chatId}`, {
      method: 'DELETE',
    }),
  unlockChat: (chatId: string) =>
    request(`/api/v1/chats/${chatId}/unlock`, {
      method: 'POST',
    }),
  listMessages: (chatId: string) => request(`/api/v1/chats/${chatId}/messages`),
  postMessage: (chatId: string, text: string, parent_id?: string | null) =>
    request(`/api/v1/chats/${chatId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ text, parent_id }),
    }),

  // Agents
  listAgents: () => request('/api/v1/agents/'),
  getModelsCatalog: (provider?: string, apiKeyId?: string, refresh?: boolean) => {
    const qs = new URLSearchParams();
    if (provider) qs.set('provider', provider);
    if (apiKeyId) qs.set('api_key_id', apiKeyId);
    if (refresh) qs.set('refresh', 'true');
    const qStr = qs.toString() ? `?${qs.toString()}` : '';
    return request(`/api/v1/agents/models${qStr}`);
  },
  createAgent: (data: Record<string, any>) =>
    request('/api/v1/agents/', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateAgent: (agentId: string, data: Record<string, any>) =>
    request(`/api/v1/agents/?agent_id=${encodeURIComponent(agentId)}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  deleteAgent: (agentId: string) =>
    request(`/api/v1/agents/?agent_id=${encodeURIComponent(agentId)}`, {
      method: 'DELETE',
    }),

  // API Keys
  listApiKeys: () => request('/api/v1/apikeys/'),
  createApiKey: (data: { provider: string; api_key: string; label?: string; base_url?: string }) =>
    request('/api/v1/apikeys/', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateApiKey: (keyId: string, data: Record<string, any>) =>
    request(`/api/v1/apikeys/?api_key_id=${encodeURIComponent(keyId)}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  deleteApiKey: (keyId: string) =>
    request(`/api/v1/apikeys/?api_key_id=${encodeURIComponent(keyId)}`, {
      method: 'DELETE',
    }),

  // Resources (MCPs & Snippets)
  listResources: () => request('/api/v1/resources/'),
  createMcp: (data: Record<string, any>) =>
    request('/api/v1/resources/mcps', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateMcp: (mcpId: string, data: Record<string, any>) =>
    request(`/api/v1/resources/mcps?mcp_id=${encodeURIComponent(mcpId)}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  deleteMcp: (mcpId: string) =>
    request(`/api/v1/resources/mcps?mcp_id=${encodeURIComponent(mcpId)}`, {
      method: 'DELETE',
    }),
  testMcp: (mcpId: string) =>
    request(`/api/v1/resources/mcps/${encodeURIComponent(mcpId)}/test`, {
      method: 'POST',
    }),

  createSnippet: (data: Record<string, any>) =>
    request('/api/v1/resources/snippets', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateSnippet: (snippetId: string, data: Record<string, any>) =>
    request(`/api/v1/resources/snippets?snippet_id=${encodeURIComponent(snippetId)}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  deleteSnippet: (snippetId: string) =>
    request(`/api/v1/resources/snippets?snippet_id=${encodeURIComponent(snippetId)}`, {
      method: 'DELETE',
    }),
  executeSnippet: (data: { language: string; code: string; input_data?: any }) =>
    request('/api/v1/resources/snippets/execute', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // Admin Panel
  bootstrapAdmin: () =>
    request('/api/v1/admin/bootstrap', {
      method: 'POST',
    }),
  getAdminStats: () => request('/api/v1/admin/stats'),
  listAdminUsers: (search?: string) =>
    request(`/api/v1/admin/users${search ? `?search=${encodeURIComponent(search)}` : ''}`),
  updateAdminUser: (userId: string, data: Record<string, any>) =>
    request(`/api/v1/admin/users/${encodeURIComponent(userId)}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  deleteAdminUser: (userId: string) =>
    request(`/api/v1/admin/users/${encodeURIComponent(userId)}`, {
      method: 'DELETE',
    }),
  getAdminSettings: () => request('/api/v1/admin/settings'),
  updateAdminSettings: (data: Record<string, any>) =>
    request('/api/v1/admin/settings', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  listAdminChats: () => request('/api/v1/admin/chats'),

  // Execution Nodes SSOT (Épica 9: HU-33, HU-34, HU-35)
  listNodes: () => request('/api/v1/nodes/'),
  registerWorkstationDevice: (data: Record<string, any>) =>
    request('/api/v1/nodes/register-device', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  getWorkstationSyncState: (nodeId: string) =>
    request(`/api/v1/nodes/${encodeURIComponent(nodeId)}/sync`),
  updateWorkstationPolicy: (nodeId: string, data: Record<string, any>, fromDevice = false) =>
    request(`/api/v1/nodes/${encodeURIComponent(nodeId)}/policy`, {
      method: 'PATCH',
      headers: fromDevice ? { 'X-Workstation-Origin': 'desktop' } : {},
      body: JSON.stringify({ ...data, from_device: fromDevice }),
    }),
  revokeWorkstationDevice: (nodeId: string) =>
    request(`/api/v1/nodes/${encodeURIComponent(nodeId)}`, {
      method: 'DELETE',
    }),
  updateLocalNodePrivacy: (data: {
    expose_to_cloud: boolean;
    allow_remote_terminal?: boolean;
    allowed_workspaces?: string[];
    vscode_server_url?: string;
  }) =>
    request('/api/v1/nodes/local/privacy', {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  // Microservicio Local Sidecar (Desktop 127.0.0.1 — HU-37..HU-42)
  getLocalDaemonStatus: () => localDaemonRequest('/local/status'),
  getLocalDaemonLogs: () => localDaemonRequest('/local/logs'),
  bootstrapLocalDaemonSync: (data: {
    cloud_backend_url: string;
    access_token: string;
    desired_policy?: Record<string, any>;
    synced_extensions?: any[];
  }) =>
    localDaemonRequest('/local/bootstrap-sync', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateLocalDaemonSettings: (data: Record<string, any>) =>
    localDaemonRequest('/local/settings', {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  listLocalEditors: () => localDaemonRequest('/local/vscode/editors'),
  launchLocalEditor: (data: { workspace?: string; file_path?: string; line?: number; editor_id?: string }) =>
    localDaemonRequest('/local/vscode/launch', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // Dual-Mode Workbench APIs (Local-First 0ms en Desktop cuando opera en el equipo propio; Cloud Tunnel en Web/Móvil)
  listNodeWorkspaces: (nodeId: string) =>
    shouldRouteDirectToLocalDaemon(nodeId)
      ? localDaemonRequest('/local/workspaces')
      : request(`/api/v1/nodes/${encodeURIComponent(nodeId)}/workspaces`),
  createNodeWorkspace: (nodeId: string, name: string, description = '') =>
    shouldRouteDirectToLocalDaemon(nodeId)
      ? localDaemonRequest('/local/workspaces', {
          method: 'POST',
          body: JSON.stringify({ name, description }),
        })
      : request(`/api/v1/nodes/${encodeURIComponent(nodeId)}/workspaces`, {
          method: 'POST',
          body: JSON.stringify({ name, description }),
        }),
  getWorkspaceFileTree: (nodeId: string, workspace = '.', directory = '.', maxDepth = 4) => {
    const qs = new URLSearchParams({ workspace, directory, max_depth: String(maxDepth) });
    return shouldRouteDirectToLocalDaemon(nodeId)
      ? localDaemonRequest(`/local/files/tree?${qs.toString()}`)
      : request(`/api/v1/nodes/${encodeURIComponent(nodeId)}/files/tree?${qs.toString()}`);
  },
  searchWorkspaceFiles: (nodeId: string, workspace: string, query: string, directory = '.') => {
    const qs = new URLSearchParams({ workspace, query, directory });
    return shouldRouteDirectToLocalDaemon(nodeId)
      ? localDaemonRequest(`/local/files/search?${qs.toString()}`)
      : request(`/api/v1/nodes/${encodeURIComponent(nodeId)}/files/search?${qs.toString()}`);
  },
  readWorkspaceFile: (nodeId: string, workspace: string, path: string) => {
    const qs = new URLSearchParams({ workspace, path });
    return shouldRouteDirectToLocalDaemon(nodeId)
      ? localDaemonRequest(`/local/files/read?${qs.toString()}`)
      : request(`/api/v1/nodes/${encodeURIComponent(nodeId)}/files/read?${qs.toString()}`);
  },
  writeWorkspaceFile: (nodeId: string, workspace: string, path: string, content: string) =>
    shouldRouteDirectToLocalDaemon(nodeId)
      ? localDaemonRequest('/local/files/write', {
          method: 'POST',
          body: JSON.stringify({ workspace, path, content }),
        })
      : request(`/api/v1/nodes/${encodeURIComponent(nodeId)}/files/write`, {
          method: 'POST',
          body: JSON.stringify({ workspace, path, content }),
        }),
  editWorkspaceFile: (nodeId: string, workspace: string, path: string, target: string, replacement: string) =>
    shouldRouteDirectToLocalDaemon(nodeId)
      ? localDaemonRequest('/local/files/edit', {
          method: 'POST',
          body: JSON.stringify({ workspace, path, target, replacement }),
        })
      : request(`/api/v1/nodes/${encodeURIComponent(nodeId)}/files/edit`, {
          method: 'POST',
          body: JSON.stringify({ workspace, path, target, replacement }),
        }),
  deleteWorkspaceFile: (nodeId: string, workspace: string, path: string) => {
    const qs = new URLSearchParams({ workspace, path });
    return shouldRouteDirectToLocalDaemon(nodeId)
      ? localDaemonRequest(`/local/files?${qs.toString()}`, { method: 'DELETE' })
      : request(`/api/v1/nodes/${encodeURIComponent(nodeId)}/files?${qs.toString()}`, {
          method: 'DELETE',
        });
  },
  execWorkspaceCommand: (nodeId: string, workspace: string, command: string, timeoutSeconds = 35) =>
    shouldRouteDirectToLocalDaemon(nodeId)
      ? localDaemonRequest('/local/terminal/exec', {
          method: 'POST',
          body: JSON.stringify({ workspace, command, timeout_seconds: timeoutSeconds }),
        })
      : request(`/api/v1/nodes/${encodeURIComponent(nodeId)}/terminal/exec`, {
          method: 'POST',
          body: JSON.stringify({ workspace, command, timeout_seconds: timeoutSeconds }),
        }),
  listWorkspaceProcesses: (nodeId: string, workspace = '.') => {
    const qs = new URLSearchParams({ workspace });
    return shouldRouteDirectToLocalDaemon(nodeId)
      ? localDaemonRequest(`/local/terminal/processes?${qs.toString()}`)
      : request(`/api/v1/nodes/${encodeURIComponent(nodeId)}/terminal/processes?${qs.toString()}`);
  },
  startWorkspaceProcess: (nodeId: string, workspace: string, command: string, label = '') =>
    shouldRouteDirectToLocalDaemon(nodeId)
      ? localDaemonRequest('/local/terminal/processes', {
          method: 'POST',
          body: JSON.stringify({ workspace, command, label }),
        })
      : request(`/api/v1/nodes/${encodeURIComponent(nodeId)}/terminal/processes`, {
          method: 'POST',
          body: JSON.stringify({ workspace, command, label }),
        }),
  stopWorkspaceProcess: (nodeId: string, procId: string) =>
    shouldRouteDirectToLocalDaemon(nodeId)
      ? localDaemonRequest(`/local/terminal/processes/${encodeURIComponent(procId)}`, {
          method: 'DELETE',
        })
      : request(`/api/v1/nodes/${encodeURIComponent(nodeId)}/terminal/processes/${encodeURIComponent(procId)}`, {
          method: 'DELETE',
        }),
  getWorkspaceGitStatus: (nodeId: string, workspace = '.') => {
    const qs = new URLSearchParams({ workspace });
    return shouldRouteDirectToLocalDaemon(nodeId)
      ? localDaemonRequest(`/local/git/status?${qs.toString()}`)
      : request(`/api/v1/nodes/${encodeURIComponent(nodeId)}/git/status?${qs.toString()}`);
  },
  searchVSCodeExtensions: (nodeId: string, query = '', pageSize = 20) => {
    const qs = new URLSearchParams({ query, page_size: String(pageSize) });
    return request(`/api/v1/nodes/${encodeURIComponent(nodeId)}/vscode/extensions/search?${qs.toString()}`);
  },
  listInstalledVSCodeExtensions: (nodeId: string) =>
    shouldRouteDirectToLocalDaemon(nodeId)
      ? localDaemonRequest('/local/vscode/extensions/installed')
      : request(`/api/v1/nodes/${encodeURIComponent(nodeId)}/vscode/extensions/installed`),
  installVSCodeExtension: (nodeId: string, extension: Record<string, any>) =>
    shouldRouteDirectToLocalDaemon(nodeId)
      ? localDaemonRequest('/local/vscode/extensions/install', {
          method: 'POST',
          body: JSON.stringify(extension),
        })
      : request(`/api/v1/nodes/${encodeURIComponent(nodeId)}/vscode/extensions/install`, {
          method: 'POST',
          body: JSON.stringify(extension),
        }),
  uninstallVSCodeExtension: (nodeId: string, extId: string) =>
    shouldRouteDirectToLocalDaemon(nodeId)
      ? localDaemonRequest(`/local/vscode/extensions/${encodeURIComponent(extId)}`, {
          method: 'DELETE',
        })
      : request(`/api/v1/nodes/${encodeURIComponent(nodeId)}/vscode/extensions/${encodeURIComponent(extId)}`, {
          method: 'DELETE',
        }),

  // GitHub Releases del Instalador Desktop (HU-44)
  fetchLatestDesktopRelease: async (): Promise<DesktopReleaseInfo | null> => {
    try {
      const r = await fetch(
        'https://api.github.com/repos/ValeryJL/InsanusChat_Frontend/releases/latest',
        { headers: { Accept: 'application/vnd.github+json' } }
      );
      if (!r.ok) return null;
      return (await r.json()) as DesktopReleaseInfo;
    } catch {
      return null;
    }
  },
};
