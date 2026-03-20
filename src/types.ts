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
