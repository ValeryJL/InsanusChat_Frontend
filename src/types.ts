export interface UserProfile {
  _id: string;
  email: string;
  display_name: string;
  roles: string[];
  active?: boolean;
  created_at?: string;
  last_login?: string;
  settings?: Record<string, any>;
}

export interface APIKeyItem {
  _id: string;
  provider: string;
  label?: string;
  masked_key: string;
  encrypted_key?: string;
  base_url?: string;
  created_at?: string;
  last_used?: string | null;
  active: boolean;
}

export interface MCPToolSchema {
  name: string;
  description?: string;
  inputSchema?: Record<string, any>;
}

export interface MCPServerItem {
  _id: string;
  name: string;
  transport: 'stdio' | 'sse' | 'http' | 'websocket';
  endpoint?: string;
  local_script_path?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  spec?: {
    tools?: MCPToolSchema[];
    description?: string;
    [key: string]: any;
  };
  status?: 'unknown' | 'available' | 'unreachable' | 'disabled';
  active: boolean;
  timeout_seconds?: number;
  registered_at?: string;
  last_connected_at?: string;
}

export interface CodeSnippetItem {
  _id: string;
  name: string;
  description?: string;
  language: 'python' | 'javascript' | 'text';
  type: 'runtime' | 'template';
  code: string;
  created_at?: string;
  public?: boolean;
  active?: boolean;
}

export interface AgentItem {
  _id: string;
  name: string;
  description?: string;
  system_prompt: string[];
  active_tools: string[];
  active_mcps: string[];
  provider?: string;
  model_selected?: string;
  api_key_id?: string | null;
  temperature?: number;
  active: boolean;
  created_at?: string;
}

export interface ToolCallTrace {
  tool: string;
  args: Record<string, any>;
  result: string;
}

export interface ChatMessage {
  _id: string;
  chat_id: string;
  parent_id: string | null;
  children_ids: string[];
  path: string[];
  branch_anchor?: string | null;
  cousin_left?: string | null;
  cousin_right?: string | null;
  sender_id: string;
  role: 'user' | 'agent' | 'system' | 'tool' | 'initializer';
  content: string;
  content_type?: string;
  status?: string;
  tokens_used?: number | null;
  tool_calls?: ToolCallTrace[];
  provider?: string;
  model?: string;
  created_at: string;
}

export interface TaskPlanStep {
  id: string;
  title: string;
  status: 'pending' | 'in_progress' | 'completed';
}

export interface WorkspaceItem {
  name: string;
  path: string;
  full_path?: string;
  is_git?: boolean;
  is_root?: boolean;
}

export interface WorkstationPolicy {
  expose_to_cloud: boolean;
  allow_remote_terminal: boolean;
  allow_remote_agent_tools: boolean;
  default_harness_mode: 'ask' | 'auto_edit' | 'autopilot';
  allowed_workspaces: string[] | null;
  terminal_auto_approve_patterns: string[];
  terminal_blocked_patterns: string[];
  preferred_editor: string;
  custom_editor_path?: string | null;
  sync_cli_extensions: boolean;
  default_shell: string;
  config_version: number;
}

export interface DetectedEditorItem {
  id: string;
  name: string;
  path: string;
  kind: 'cli' | 'flatpak' | 'custom';
}

export interface LocalDaemonLogEntry {
  ts: string;
  level: 'info' | 'success' | 'warn' | 'error' | string;
  message: string;
}

export interface LocalDaemonStatus {
  config: {
    node_id: string;
    node_name: string;
    bind_host: string;
    bind_port: number;
    root_projects_dir: string;
    expose_to_cloud: boolean;
    allow_remote_terminal: boolean;
    allow_remote_agent_tools: boolean;
    allowed_workspaces: string[] | null;
    default_harness_mode: 'ask' | 'auto_edit' | 'autopilot';
    terminal_auto_approve_patterns: string[];
    terminal_blocked_patterns: string[];
    default_shell: string;
    preferred_editor: string;
    custom_editor_path?: string | null;
    sync_cli_extensions: boolean;
    cloud_backend_url: string;
    has_cloud_token: boolean;
    config_version: number;
    app_version: string;
    minimize_to_tray: boolean;
    launch_at_startup: boolean;
    os: string;
    arch: string;
    shell: string;
    config_dir?: string;
  };
  policy: WorkstationPolicy;
  bridge: {
    connected: boolean;
    connected_since?: string | null;
    last_error?: string | null;
  };
  workspaces: WorkspaceItem[];
  all_workspaces?: WorkspaceItem[];
  vscode: {
    desktop_binary?: string | null;
    preferred_editor: string;
    detected_editors: DetectedEditorItem[];
    extension_path: string;
    extension_ready: boolean;
    sync_cli_extensions: boolean;
    installed_extensions_count: number;
  };
  pid: number;
  port: number;
}

export interface DesktopReleaseAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

export interface DesktopReleaseInfo {
  tag_name: string;
  name: string;
  html_url: string;
  published_at?: string;
  assets: DesktopReleaseAsset[];
}

export interface ExecutionNodeItem {
  node_id: string;
  name: string;
  os: string;
  arch?: string;
  shell: string;
  app_version?: string;
  status: 'online' | 'offline' | 'private_local_only' | 'revoked';
  connected?: boolean;
  revoked?: boolean;
  expose_to_cloud: boolean;
  allow_remote_terminal?: boolean;
  allow_remote_agent_tools?: boolean;
  allowed_workspaces?: string[] | null;
  root_dir: string;
  workspaces: WorkspaceItem[];
  reported_editors?: DetectedEditorItem[];
  desired_policy?: WorkstationPolicy;
  config_version?: number;
  synced_extensions?: VSCodeExtensionItem[];
  vscode_server_url?: string | null;
  is_builtin_host?: boolean;
  is_local_desktop?: boolean;
  last_seen?: string;
}

export interface FileTreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  language?: string;
  children?: FileTreeNode[];
}

export interface PendingToolApproval {
  approval_id: string;
  chat_id: string;
  tool: string;
  args: Record<string, any>;
  diff?: string | null;
}

export interface VSCodeExtensionItem {
  id: string;
  display_name: string;
  publisher: string;
  publisher_id?: string;
  verified?: boolean;
  version: string;
  description: string;
  icon_url?: string | null;
  install_count?: number;
  rating?: number;
  categories?: string[];
  marketplace_url?: string;
  builtin?: boolean;
  enabled?: boolean;
  source?: string;
}

export interface ChatItem {
  _id: string;
  user_id: string;
  agent_id?: string | null;
  title: string;
  message_count?: number;
  locked: boolean;
  execution_target?: 'cloud' | 'workstation';
  node_id?: string | null;
  workspace_path?: string;
  harness_mode?: 'ask' | 'auto_edit' | 'autopilot';
  task_plan?: TaskPlanStep[];
  created_at: string;
  last_updated?: string;
}

export interface ModelOption {
  id: string;
  name: string;
  description: string;
  context_length?: number;
  source?: string;
}

export interface AdminStats {
  users: {
    total: number;
    active: number;
    suspended: number;
    admins: number;
  };
  chats: {
    total: number;
    locked: number;
    total_messages: number;
    branched_nodes: number;
    total_tokens_used: number;
  };
  resources: {
    agents: number;
    mcps: number;
    code_snippets: number;
    api_keys: number;
  };
  database: {
    ok: boolean;
    latency_ms: number;
    database?: string;
  };
  settings: SystemSettings;
}

export interface SystemSettings {
  allow_registration: boolean;
  allow_stdio_mcp: boolean;
  allow_local_mcp_endpoints: boolean;
  allow_code_snippets?: boolean;
  default_provider: string;
  default_model: string;
  rate_limit_login_per_min: number;
  maintenance_mode: boolean;
  updated_at?: string;
}

export interface AdminUserRecord {
  _id: string;
  email: string;
  display_name: string;
  roles: string[];
  active: boolean;
  created_at?: string;
  last_login?: string;
  counts: {
    chats: number;
    agents: number;
    mcps: number;
    snippets: number;
    api_keys: number;
  };
}
