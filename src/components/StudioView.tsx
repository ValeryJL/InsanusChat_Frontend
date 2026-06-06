import React, { useEffect, useRef, useState } from 'react';
import {
  Bot,
  Code2,
  KeyRound,
  Plug,
  Plus,
  Play,
  Trash2,
  CheckCircle2,
  XCircle,
  Loader2,
  Sparkles,
  RefreshCw,
} from 'lucide-react';
import { api } from '../api';
import { AgentItem, APIKeyItem, CodeSnippetItem, MCPServerItem, ModelOption } from '../types';

interface StudioViewProps {
  agents: AgentItem[];
  mcps: MCPServerItem[];
  snippets: CodeSnippetItem[];
  apiKeys: APIKeyItem[];
  onRefreshAll: () => Promise<void>;
}

export const StudioView: React.FC<StudioViewProps> = ({
  agents,
  mcps,
  snippets,
  apiKeys,
  onRefreshAll,
}) => {
  const [activeTab, setActiveTab] = useState<'agents' | 'mcps' | 'snippets' | 'apikeys'>('agents');
  const [modelsByProvider, setModelsByProvider] = useState<Record<string, ModelOption[]>>({});
  const [modelSources, setModelSources] = useState<Record<string, string>>({});
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelSearchQuery, setModelSearchQuery] = useState('');
  const [statusMsg, setStatusMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const topContainerRef = useRef<HTMLDivElement | null>(null);

  // Estado formulario Agente
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);
  const [agentName, setAgentName] = useState('');
  const [agentDesc, setAgentDesc] = useState('');
  const [agentProvider, setAgentProvider] = useState('gemini');
  const [agentModel, setAgentModel] = useState('gemini-2.5-flash');
  const [agentApiKeyId, setAgentApiKeyId] = useState('');
  const [agentTemp, setAgentTemp] = useState(0.7);
  const [agentPrompt, setAgentPrompt] = useState('Eres un agente especialista de InsanusChat. Responde siempre con precisión en Markdown.');
  const [selectedMcps, setSelectedMcps] = useState<string[]>([]);
  const [selectedTools, setSelectedTools] = useState<string[]>([]);

  // Estado formulario MCP
  const [mcpName, setMcpName] = useState('');
  const [mcpTransport, setMcpTransport] = useState<'stdio' | 'sse' | 'http'>('stdio');
  const [mcpEndpoint, setMcpEndpoint] = useState('');
  const [mcpTestingId, setMcpTestingId] = useState<string | null>(null);
  const [mcpTestResult, setMcpTestResult] = useState<Record<string, any> | null>(null);

  // Estado formulario Snippet & Sandbox
  const [snipName, setSnipName] = useState('');
  const [snipDesc, setSnipDesc] = useState('');
  const [snipLang, setSnipLang] = useState<'python' | 'javascript' | 'text'>('python');
  const [snipType, setSnipType] = useState<'runtime' | 'template'>('runtime');
  const [snipCode, setSnipCode] = useState(
    "import datetime\nreturn {'mensaje': f'Procesado: {inp}', 'timestamp': datetime.datetime.utcnow().isoformat()}"
  );
  const [sandboxInput, setSandboxInput] = useState('Hola desde el Sandbox de InsanusChat');
  const [sandboxResult, setSandboxResult] = useState<Record<string, any> | null>(null);
  const [sandboxRunning, setSandboxRunning] = useState(false);

  // Estado formulario API Key
  const [keyProvider, setKeyProvider] = useState('gemini');
  const [keyLabel, setKeyLabel] = useState('');
  const [keyValue, setKeyValue] = useState('');
  const [keyBaseUrl, setKeyBaseUrl] = useState('');

  const fetchLiveModels = async (forceRefresh = false, keyId?: string) => {
    setModelsLoading(true);
    try {
      const res = await api.getModelsCatalog(undefined, keyId || agentApiKeyId || undefined, forceRefresh);
      if (res?.data?.providers) {
        setModelsByProvider(res.data.providers);
      }
      if (res?.data?.sources) {
        setModelSources(res.data.sources);
      }
      if (forceRefresh) {
        notify('ok', `Catálogo actualizado en vivo (${res?.data?.total_models || 0} modelos disponibles)`);
      }
    } catch {
      // ignore
    } finally {
      setModelsLoading(false);
    }
  };

  useEffect(() => {
    fetchLiveModels(false, agentApiKeyId);
  }, [apiKeys.length, agentApiKeyId]);

  const notify = (type: 'ok' | 'err', text: string) => {
    setStatusMsg({ type, text });
    setTimeout(() => setStatusMsg(null), 4500);
  };

  const resetAgentForm = () => {
    setEditingAgentId(null);
    setAgentName('');
    setAgentDesc('');
    setAgentProvider('gemini');
    setAgentModel('gemini-2.5-flash');
    setAgentApiKeyId('');
    setAgentTemp(0.7);
    setAgentPrompt('Eres un agente especialista de InsanusChat. Responde siempre con precisión en Markdown.');
    setSelectedMcps([]);
    setSelectedTools([]);
  };

  const loadAgentForEdit = (a: AgentItem) => {
    setEditingAgentId(a._id);
    setAgentName(a.name);
    setAgentDesc(a.description || '');
    setAgentProvider(a.provider || 'gemini');
    setAgentModel(a.model_selected || 'gemini-2.5-flash');
    setAgentApiKeyId(a.api_key_id || '');
    setAgentTemp(a.temperature ?? 0.7);
    setAgentPrompt((a.system_prompt || []).join('\n'));
    setSelectedMcps(a.active_mcps || []);
    setSelectedTools(a.active_tools || []);
    topContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSaveAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload = {
        name: agentName,
        description: agentDesc,
        provider: agentProvider,
        model_selected: agentModel,
        api_key_id: agentApiKeyId || null,
        temperature: agentTemp,
        system_prompt: agentPrompt.split('\n').filter((l) => l.trim().length > 0),
        active_mcps: selectedMcps,
        active_tools: selectedTools,
      };
      if (editingAgentId) {
        await api.updateAgent(editingAgentId, payload);
        notify('ok', 'Agente actualizado correctamente');
      } else {
        await api.createAgent(payload);
        notify('ok', 'Agente creado correctamente');
      }
      resetAgentForm();
      await onRefreshAll();
    } catch (err: any) {
      notify('err', err.message || 'Error guardando agente');
    }
  };

  const handleCreateMcp = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.createMcp({
        name: mcpName,
        transport: mcpTransport,
        endpoint: mcpEndpoint,
        local_script_path: mcpTransport === 'stdio' ? mcpEndpoint : undefined,
      });
      setMcpName('');
      setMcpEndpoint('');
      notify('ok', 'Servidor MCP registrado');
      await onRefreshAll();
    } catch (err: any) {
      notify('err', err.message || 'Error creando MCP');
    }
  };

  const handleTestMcp = async (mcpId: string) => {
    setMcpTestingId(mcpId);
    setMcpTestResult(null);
    try {
      const res = await api.testMcp(mcpId);
      setMcpTestResult(res.data);
      if (res.data?.status === 'available') {
        notify('ok', `MCP disponible (${res.data.tools_count} tools en ${res.data.latency_ms}ms)`);
      } else {
        notify('err', `MCP inalcanzable: ${res.data?.error}`);
      }
      await onRefreshAll();
    } catch (err: any) {
      notify('err', err.message || 'Error probando MCP');
    } finally {
      setMcpTestingId(null);
    }
  };

  const handleCreateSnippet = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.createSnippet({
        name: snipName,
        description: snipDesc,
        language: snipLang,
        type: snipType,
        code: snipCode,
      });
      setSnipName('');
      setSnipDesc('');
      notify('ok', 'Snippet guardado correctamente');
      await onRefreshAll();
    } catch (err: any) {
      notify('err', err.message || 'Error creando snippet');
    }
  };

  const handleRunSandbox = async () => {
    setSandboxRunning(true);
    setSandboxResult(null);
    try {
      const res = await api.executeSnippet({
        language: snipLang,
        code: snipCode,
        input_data: sandboxInput,
      });
      setSandboxResult(res.data);
    } catch (err: any) {
      notify('err', err.message || 'Error ejecutando sandbox');
    } finally {
      setSandboxRunning(false);
    }
  };

  const handleCreateApiKey = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.createApiKey({
        provider: keyProvider,
        api_key: keyValue,
        label: keyLabel || `Clave ${keyProvider.toUpperCase()}`,
        base_url: keyBaseUrl || undefined,
      });
      setKeyValue('');
      setKeyLabel('');
      setKeyBaseUrl('');
      notify('ok', 'API Key cifrada con Fernet (AES) y guardada');
      await onRefreshAll();
    } catch (err: any) {
      notify('err', err.message || 'Error guardando API Key');
    }
  };

  const rawProviderModels = modelsByProvider[agentProvider] || [
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', description: 'Rápido y eficiente' },
  ];
  const availableModels = modelSearchQuery.trim()
    ? rawProviderModels.filter(
        (m) =>
          m.id.toLowerCase().includes(modelSearchQuery.toLowerCase()) ||
          m.name.toLowerCase().includes(modelSearchQuery.toLowerCase()) ||
          (m.description || '').toLowerCase().includes(modelSearchQuery.toLowerCase())
      )
    : rawProviderModels;

  return (
    <div ref={topContainerRef} className="flex-1 h-full overflow-y-auto bg-slate-950 p-3 sm:p-6">
      <div className="max-w-6xl mx-auto space-y-4 sm:space-y-6 pb-8">
        {/* Cabecera Studio */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 sm:gap-4 pb-4 border-b border-slate-800">
          <div>
            <h1 className="text-lg sm:text-2xl font-bold text-white flex items-center gap-2">
              <Sparkles className="w-5 h-5 sm:w-6 sm:h-6 text-emerald-400 shrink-0" />
              <span>Agent & Tool Studio</span>
            </h1>
            <p className="text-xs sm:text-sm text-slate-400 mt-1">
              Configurá agentes multi-proveedor, conectá servidores MCP, probá snippets en sandbox aislado y gestioná tus API Keys cifradas.
            </p>
          </div>

          {/* Navegación por pestañas (grilla 2x2 en móvil, fila en desktop) */}
          <div className="grid grid-cols-2 sm:flex sm:items-center gap-1.5 p-1 rounded-xl bg-slate-900 border border-slate-800 w-full lg:w-auto">
            <button
              onClick={() => setActiveTab('agents')}
              className={`flex items-center justify-center sm:justify-start gap-1.5 px-2.5 sm:px-3 py-2 sm:py-1.5 rounded-lg text-xs font-medium transition ${
                activeTab === 'agents' ? 'bg-emerald-500 text-slate-950 font-semibold' : 'text-slate-300 hover:bg-slate-800'
              }`}
            >
              <Bot className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">Agentes ({agents.length})</span>
            </button>
            <button
              onClick={() => setActiveTab('mcps')}
              className={`flex items-center justify-center sm:justify-start gap-1.5 px-2.5 sm:px-3 py-2 sm:py-1.5 rounded-lg text-xs font-medium transition ${
                activeTab === 'mcps' ? 'bg-emerald-500 text-slate-950 font-semibold' : 'text-slate-300 hover:bg-slate-800'
              }`}
            >
              <Plug className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">MCP Servers ({mcps.length})</span>
            </button>
            <button
              onClick={() => setActiveTab('snippets')}
              className={`flex items-center justify-center sm:justify-start gap-1.5 px-2.5 sm:px-3 py-2 sm:py-1.5 rounded-lg text-xs font-medium transition ${
                activeTab === 'snippets' ? 'bg-emerald-500 text-slate-950 font-semibold' : 'text-slate-300 hover:bg-slate-800'
              }`}
            >
              <Code2 className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">Snippets ({snippets.length})</span>
            </button>
            <button
              onClick={() => setActiveTab('apikeys')}
              className={`flex items-center justify-center sm:justify-start gap-1.5 px-2.5 sm:px-3 py-2 sm:py-1.5 rounded-lg text-xs font-medium transition ${
                activeTab === 'apikeys' ? 'bg-emerald-500 text-slate-950 font-semibold' : 'text-slate-300 hover:bg-slate-800'
              }`}
            >
              <KeyRound className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">API Keys ({apiKeys.length})</span>
            </button>
          </div>
        </div>

        {statusMsg && (
          <div
            className={`px-4 py-3 rounded-xl border text-sm flex items-center gap-2 ${
              statusMsg.type === 'ok'
                ? 'bg-emerald-950/50 border-emerald-500/40 text-emerald-200'
                : 'bg-rose-950/50 border-rose-500/40 text-rose-200'
            }`}
          >
            {statusMsg.type === 'ok' ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <XCircle className="w-4 h-4 text-rose-400" />}
            <span>{statusMsg.text}</span>
          </div>
        )}

        {/* TAB 1: AGENTES */}
        {activeTab === 'agents' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <form onSubmit={handleSaveAgent} className="lg:col-span-7 p-5 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-bold text-white">
                  {editingAgentId ? '✏️ Editar Agente' : '➕ Crear Nuevo Agente'}
                </h2>
                {editingAgentId && (
                  <button
                    type="button"
                    onClick={resetAgentForm}
                    className="text-xs text-slate-400 hover:text-white underline"
                  >
                    Cancelar edición
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Nombre del Agente *</label>
                  <input
                    required
                    value={agentName}
                    onChange={(e) => setAgentName(e.target.value)}
                    placeholder="Ej: Arquitecto Python + MCP"
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-sm text-white focus:border-emerald-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Descripción</label>
                  <input
                    value={agentDesc}
                    onChange={(e) => setAgentDesc(e.target.value)}
                    placeholder="Breve propósito del agente"
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-sm text-white focus:border-emerald-500 outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Proveedor (HU-09)</label>
                  <select
                    value={agentProvider}
                    onChange={(e) => {
                      const p = e.target.value;
                      setAgentProvider(p);
                      setModelSearchQuery('');
                      const firstModel = modelsByProvider[p]?.[0]?.id;
                      if (firstModel) setAgentModel(firstModel);
                    }}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-sm text-white focus:border-emerald-500 outline-none"
                  >
                    <option value="gemini">Google Gemini ({modelsByProvider['gemini']?.length || 0} modelos)</option>
                    <option value="openai">OpenAI ({modelsByProvider['openai']?.length || 0} modelos)</option>
                    <option value="anthropic">Anthropic Claude ({modelsByProvider['anthropic']?.length || 0} modelos)</option>
                    <option value="ollama">Ollama / Open-Weights ({modelsByProvider['ollama']?.length || 0} modelos)</option>
                    <option value="openrouter">OpenRouter Global ({modelsByProvider['openrouter']?.length || 0} modelos)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs text-slate-400 mb-1">API Key Específica</label>
                  <select
                    value={agentApiKeyId}
                    onChange={(e) => {
                      const kid = e.target.value;
                      setAgentApiKeyId(kid);
                      const foundKey = apiKeys.find((k) => k._id === kid);
                      if (foundKey && foundKey.provider) {
                        setAgentProvider(foundKey.provider);
                      }
                    }}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-sm text-white focus:border-emerald-500 outline-none"
                  >
                    <option value="">Automática por proveedor / Modo Local</option>
                    {apiKeys.map((k) => (
                      <option key={k._id} value={k._id}>
                        {k.label} ({k.provider} - {k.masked_key})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="text-xs font-semibold text-emerald-400 flex items-center gap-1.5">
                    <span>Modelo Disponible en el Agente ({availableModels.length} activos)</span>
                  </label>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-slate-400 font-mono">
                      Fuente: {modelSources[agentProvider] || 'Consultando API...'}
                    </span>
                    <button
                      type="button"
                      onClick={() => fetchLiveModels(true)}
                      disabled={modelsLoading}
                      className="flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] text-cyan-300 border border-slate-700 transition"
                      title="Consultar las APIs y el repositorio público en tiempo real"
                    >
                      <RefreshCw className={`w-3 h-3 ${modelsLoading ? 'animate-spin' : ''}`} />
                      <span>Actualizar de API</span>
                    </button>
                  </div>
                </div>

                {rawProviderModels.length > 10 && (
                  <input
                    type="text"
                    value={modelSearchQuery}
                    onChange={(e) => setModelSearchQuery(e.target.value)}
                    placeholder={`Filtrar entre los ${rawProviderModels.length} modelos disponibles de ${agentProvider}...`}
                    className="w-full px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs text-white focus:border-emerald-500 outline-none"
                  />
                )}

                <select
                  value={agentModel}
                  onChange={(e) => setAgentModel(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg bg-slate-900 border border-emerald-500/40 text-sm text-white font-medium focus:border-emerald-400 outline-none"
                >
                  {!availableModels.some((m) => m.id === agentModel) && agentModel && (
                    <option value={agentModel}>{agentModel} (Actual)</option>
                  )}
                  {availableModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} — [{m.id}]{m.context_length ? ` (${Math.round(m.context_length / 1000)}k ctx)` : ''}
                    </option>
                  ))}
                </select>

                {availableModels.find((m) => m.id === agentModel)?.description && (
                  <p className="text-[11px] text-slate-400">
                    {availableModels.find((m) => m.id === agentModel)?.description}
                  </p>
                )}
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs text-slate-400">
                    System Prompt (Soporta referencias <code className="text-emerald-400">{'{{nombre_snippet}}'}</code> o <code className="text-emerald-400">SNIPPET:id</code>)
                  </label>
                  <span className="text-xs text-slate-400">Temp: {agentTemp}</span>
                </div>
                <textarea
                  rows={4}
                  value={agentPrompt}
                  onChange={(e) => setAgentPrompt(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-sm font-mono text-slate-200 focus:border-emerald-500 outline-none"
                />
                {snippets.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                    <span className="text-[11px] text-slate-500">Insertar snippet en prompt:</span>
                    {snippets.map((s) => (
                      <button
                        key={s._id}
                        type="button"
                        onClick={() => setAgentPrompt((prev) => `${prev}\n{{${s.name}}}`)}
                        className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[11px] font-mono text-emerald-300 border border-slate-700"
                      >
                        + {`{{${s.name}}}`}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                  <span className="block text-xs font-semibold text-cyan-400 mb-2">
                    🔌 Servidores MCP Permitidos ({selectedMcps.length})
                  </span>
                  <div className="space-y-1.5 max-h-36 overflow-y-auto">
                    {mcps.map((m) => (
                      <label key={m._id} className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedMcps.includes(m._id)}
                          onChange={(e) =>
                            setSelectedMcps((prev) =>
                              e.target.checked ? [...prev, m._id] : prev.filter((id) => id !== m._id)
                            )
                          }
                          className="accent-emerald-500"
                        />
                        <span>{m.name}</span>
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 font-mono">
                          {m.transport}
                        </span>
                      </label>
                    ))}
                    {mcps.length === 0 && <p className="text-xs text-slate-500">No hay MCPs registrados</p>}
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                  <span className="block text-xs font-semibold text-emerald-400 mb-2">
                    💻 Code Snippets como Tools ({selectedTools.length})
                  </span>
                  <div className="space-y-1.5 max-h-36 overflow-y-auto">
                    {snippets.map((s) => (
                      <label key={s._id} className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedTools.includes(s._id)}
                          onChange={(e) =>
                            setSelectedTools((prev) =>
                              e.target.checked ? [...prev, s._id] : prev.filter((id) => id !== s._id)
                            )
                          }
                          className="accent-emerald-500"
                        />
                        <span>{s.name}</span>
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 font-mono">
                          {s.language}
                        </span>
                      </label>
                    ))}
                    {snippets.length === 0 && <p className="text-xs text-slate-500">No hay Snippets creados</p>}
                  </div>
                </div>
              </div>

              <button
                type="submit"
                className="w-full py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm transition shadow-lg shadow-emerald-950/50"
              >
                {editingAgentId ? 'Guardar Cambios del Agente' : 'Crear Agente IA'}
              </button>
            </form>

            {/* Lista de Agentes */}
            <div className="lg:col-span-5 space-y-3">
              <h2 className="text-base font-bold text-white">Agentes Configurados ({agents.length})</h2>
              {agents.map((a) => (
                <div
                  key={a._id}
                  className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800 hover:border-slate-700 transition space-y-2.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="font-bold text-white flex items-center gap-2">
                        <Bot className="w-4 h-4 text-emerald-400" />
                        <span>{a.name}</span>
                      </h3>
                      <p className="text-xs text-slate-400 mt-0.5">{a.description || 'Sin descripción'}</p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => loadAgentForEdit(a)}
                        className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-200"
                      >
                        Editar
                      </button>
                      <button
                        onClick={async () => {
                          await api.deleteAgent(a._id);
                          notify('ok', 'Agente eliminado');
                          await onRefreshAll();
                        }}
                        className="p-1.5 rounded-lg bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-500/20"
                        title="Eliminar agente"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                    <span className="px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-mono uppercase">
                      {a.provider || 'gemini'}
                    </span>
                    <select
                      value={a.model_selected || 'gemini-2.5-flash'}
                      onChange={async (e) => {
                        const newModel = e.target.value;
                        await api.updateAgent(a._id, { model_selected: newModel });
                        notify('ok', `Modelo de ${a.name} cambiado a ${newModel}`);
                        await onRefreshAll();
                      }}
                      className="px-2 py-0.5 rounded-md bg-slate-950 text-emerald-300 border border-emerald-500/30 font-mono text-[11px] outline-none cursor-pointer hover:border-emerald-400 max-w-[230px]"
                      title="Cambiar el modelo activo de este agente (consultado en vivo de la API)"
                    >
                      {!(modelsByProvider[a.provider || 'gemini'] || []).some((m) => m.id === a.model_selected) &&
                        a.model_selected && <option value={a.model_selected}>{a.model_selected}</option>}
                      {(modelsByProvider[a.provider || 'gemini'] || []).map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name} ({m.id})
                        </option>
                      ))}
                    </select>
                    <span className="px-2 py-0.5 rounded-md bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                      {(a.active_mcps || []).length} MCPs
                    </span>
                    <span className="px-2 py-0.5 rounded-md bg-purple-500/15 text-purple-300 border border-purple-500/30">
                      {(a.active_tools || []).length} Snippets
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 2: SERVIDORES MCP */}
        {activeTab === 'mcps' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <form onSubmit={handleCreateMcp} className="lg:col-span-5 p-5 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-4">
              <h2 className="text-base font-bold text-white">🔌 Registrar Servidor MCP</h2>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Nombre del Servidor MCP *</label>
                <input
                  required
                  value={mcpName}
                  onChange={(e) => setMcpName(e.target.value)}
                  placeholder="Ej: Calculadora-Local o MCP-Remoto"
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-sm text-white focus:border-emerald-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">Transporte (HU-10)</label>
                <select
                  value={mcpTransport}
                  onChange={(e) => setMcpTransport(e.target.value as any)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-sm text-white focus:border-emerald-500 outline-none"
                >
                  <option value="stdio">STDIO (Script Python / Node en servidor)</option>
                  <option value="sse">SSE (Server-Sent Events Remoto)</option>
                  <option value="http">Streamable HTTP / JSON-RPC Remoto</option>
                </select>
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  {mcpTransport === 'stdio' ? 'Ruta del Script Local (.py / .js) *' : 'Endpoint URL (http/https) *'}
                </label>
                <input
                  required
                  value={mcpEndpoint}
                  onChange={(e) => setMcpEndpoint(e.target.value)}
                  placeholder={
                    mcpTransport === 'stdio'
                      ? '/app/examples/mcp_servers/calculator_server.py'
                      : 'https://mcp.ejemplo.com/sse'
                  }
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-sm font-mono text-white focus:border-emerald-500 outline-none"
                />
              </div>

              <button
                type="submit"
                className="w-full py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm transition"
              >
                Registrar MCP Server
              </button>
            </form>

            <div className="lg:col-span-7 space-y-4">
              <h2 className="text-base font-bold text-white">Servidores MCP Registrados ({mcps.length})</h2>
              {mcps.map((m) => (
                <div key={m._id} className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold text-white">{m.name}</span>
                        <span className="px-2 py-0.5 rounded bg-slate-800 text-cyan-300 font-mono text-[11px]">
                          {m.transport}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded text-[11px] font-medium ${
                            m.status === 'available'
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                              : m.status === 'unreachable'
                              ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                              : 'bg-slate-800 text-slate-400'
                          }`}
                        >
                          {m.status || 'unknown'}
                        </span>
                      </div>
                      <p className="text-xs font-mono text-slate-400 mt-1 break-all">
                        {m.local_script_path || m.endpoint}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => handleTestMcp(m._id)}
                        disabled={mcpTestingId === m._id}
                        className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200 border border-cyan-500/30 text-xs font-medium transition"
                      >
                        {mcpTestingId === m._id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="w-3.5 h-3.5" />
                        )}
                        <span>Probar Conexión</span>
                      </button>
                      <button
                        onClick={async () => {
                          await api.deleteMcp(m._id);
                          notify('ok', 'MCP eliminado');
                          await onRefreshAll();
                        }}
                        className="p-1.5 rounded-lg bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-500/20"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {m.spec?.tools && m.spec.tools.length > 0 && (
                    <div className="pt-2 border-t border-slate-800">
                      <span className="block text-[11px] text-slate-400 mb-1.5">
                        Herramientas descubiertas ({m.spec.tools.length}):
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {m.spec.tools.map((t, idx) => (
                          <span
                            key={idx}
                            title={t.description}
                            className="px-2 py-1 rounded-md bg-slate-950 border border-slate-800 text-xs font-mono text-emerald-300"
                          >
                            ⚡ {t.name}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}

              {mcpTestResult && (
                <div className="p-4 rounded-2xl bg-slate-900 border border-cyan-500/40 space-y-2 text-xs">
                  <div className="font-bold text-cyan-300">
                    Resultado del Test MCP ({mcpTestResult.latency_ms} ms) — Estado: {mcpTestResult.status}
                  </div>
                  {mcpTestResult.tools && (
                    <pre className="p-3 rounded-lg bg-slate-950 text-slate-300 font-mono overflow-x-auto">
                      {JSON.stringify(mcpTestResult.tools, null, 2)}
                    </pre>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 3: CODE SNIPPETS & SANDBOX */}
        {activeTab === 'snippets' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-7 p-5 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-4">
              <h2 className="text-base font-bold text-white">💻 Editor de Code Snippets & Sandbox Aislado (HU-06)</h2>
              <form onSubmit={handleCreateSnippet} className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Nombre (ID variable) *</label>
                    <input
                      required
                      value={snipName}
                      onChange={(e) => setSnipName(e.target.value)}
                      placeholder="ej: calcular_metricas"
                      className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-sm font-mono text-white outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Lenguaje</label>
                    <select
                      value={snipLang}
                      onChange={(e) => setSnipLang(e.target.value as any)}
                      className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-sm text-white outline-none"
                    >
                      <option value="python">Python 3 (Sandbox)</option>
                      <option value="javascript">JavaScript (Node.js)</option>
                      <option value="text">Plantilla de Texto</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Modo de Uso</label>
                    <select
                      value={snipType}
                      onChange={(e) => setSnipType(e.target.value as any)}
                      className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-sm text-white outline-none"
                    >
                      <option value="runtime">Tool Ejecutable & Prompt</option>
                      <option value="template">Solo Plantilla de Prompt</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs text-slate-400 mb-1">Descripción para el Agente</label>
                  <input
                    value={snipDesc}
                    onChange={(e) => setSnipDesc(e.target.value)}
                    placeholder="Explica qué hace este snippet cuando el agente lo invoca"
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-sm text-white outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    Código Fuente (la entrada está disponible en la variable <code className="text-emerald-400">inp</code>; usá <code className="text-emerald-400">return</code> para devolver datos)
                  </label>
                  <textarea
                    rows={6}
                    value={snipCode}
                    onChange={(e) => setSnipCode(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-lg bg-slate-950 border border-slate-800 text-xs font-mono text-emerald-200 outline-none"
                  />
                </div>

                <div className="flex items-center gap-3">
                  <button
                    type="submit"
                    className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs transition"
                  >
                    Guardar Snippet
                  </button>
                </div>
              </form>

              {/* Probador Sandbox en Vivo */}
              <div className="pt-4 border-t border-slate-800 space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-cyan-400">
                  🧪 Probar Ejecución en Sandbox Aislado
                </h3>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    value={sandboxInput}
                    onChange={(e) => setSandboxInput(e.target.value)}
                    placeholder="Datos de entrada (inp) para probar..."
                    className="flex-1 px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs font-mono text-white outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleRunSandbox}
                    disabled={sandboxRunning}
                    className="flex items-center justify-center gap-1.5 px-4 py-2.5 sm:py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs transition shrink-0"
                  >
                    {sandboxRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                    <span>Ejecutar Prueba</span>
                  </button>
                </div>

                {sandboxResult && (
                  <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className={sandboxResult.success ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                        {sandboxResult.success ? '✓ Ejecución Exitosa' : `✗ Error: ${sandboxResult.error}`}
                      </span>
                      <span className="text-slate-500">{sandboxResult.execution_time_ms} ms</span>
                    </div>
                    {sandboxResult.result !== undefined && (
                      <div className="text-emerald-200 break-all">
                        <span className="text-slate-500">Return: </span>
                        {typeof sandboxResult.result === 'object'
                          ? JSON.stringify(sandboxResult.result, null, 2)
                          : String(sandboxResult.result)}
                      </div>
                    )}
                    {sandboxResult.stderr && (
                      <div className="text-rose-300">
                        <span className="text-slate-500">Stderr: </span>
                        {sandboxResult.stderr}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="lg:col-span-5 space-y-3">
              <h2 className="text-base font-bold text-white">Biblioteca de Snippets ({snippets.length})</h2>
              {snippets.map((s) => {
                const isSnipActive = s.active !== false;
                return (
                  <div
                    key={s._id}
                    className={`p-4 rounded-2xl bg-slate-900/90 border transition space-y-2 ${
                      isSnipActive ? 'border-slate-800' : 'border-slate-800/50 opacity-60'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-bold text-white font-mono truncate">{s.name}</span>
                        <span className="px-2 py-0.5 rounded bg-slate-800 text-emerald-300 font-mono text-[10px] shrink-0">
                          {s.language}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-semibold shrink-0 ${
                            isSnipActive ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'
                          }`}
                        >
                          {isSnipActive ? 'Activo' : 'Deshabilitado'}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          onClick={async () => {
                            await api.updateSnippet(s._id, { active: !isSnipActive });
                            notify('ok', `Snippet ${s.name} ${!isSnipActive ? 'habilitado' : 'deshabilitado'}`);
                            await onRefreshAll();
                          }}
                          className={`px-2 py-1 rounded text-xs font-medium transition ${
                            isSnipActive
                              ? 'bg-amber-950/50 hover:bg-amber-900/60 text-amber-300 border border-amber-500/20'
                              : 'bg-emerald-950/50 hover:bg-emerald-900/60 text-emerald-300 border border-emerald-500/20'
                          }`}
                        >
                          {isSnipActive ? 'Deshabilitar' : 'Habilitar'}
                        </button>
                        <button
                          onClick={() => {
                            setSnipName(s.name);
                            setSnipDesc(s.description || '');
                            setSnipLang(s.language);
                            setSnipCode(s.code);
                            topContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
                          }}
                          className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs text-slate-300"
                        >
                          Editar
                        </button>
                        <button
                          onClick={async () => {
                            await api.deleteSnippet(s._id);
                            notify('ok', 'Snippet eliminado');
                            await onRefreshAll();
                          }}
                          className="p-1.5 rounded bg-rose-950/40 hover:bg-rose-900/60 text-rose-300"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    {s.description && <p className="text-xs text-slate-400">{s.description}</p>}
                    <pre className="p-2 rounded bg-slate-950 border border-slate-800/80 text-[11px] font-mono text-slate-300 overflow-x-auto max-h-28">
                      {s.code}
                    </pre>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* TAB 4: API KEYS CIFRADAS */}
        {activeTab === 'apikeys' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <form onSubmit={handleCreateApiKey} className="lg:col-span-5 p-5 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-4">
              <h2 className="text-base font-bold text-white">🔑 Agregar API Key (Cifrado Fernet AES en Reposo)</h2>
              <p className="text-xs text-slate-400">
                Tu clave se cifra inmediatamente con <code className="text-emerald-400">Fernet (AES-128-CBC + HMAC)</code> en el backend antes de guardarse en MongoDB y jamás se expone en texto plano (HU-05).
              </p>

              <div>
                <label className="block text-xs text-slate-400 mb-1">Proveedor de IA</label>
                <select
                  value={keyProvider}
                  onChange={(e) => setKeyProvider(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-sm text-white outline-none"
                >
                  <option value="gemini">Google Gemini (AI Studio)</option>
                  <option value="openai">OpenAI</option>
                  <option value="anthropic">Anthropic Claude</option>
                  <option value="openrouter">OpenRouter</option>
                  <option value="ollama">Ollama (Endpoint Local/Remoto)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">Etiqueta identificatoria</label>
                <input
                  value={keyLabel}
                  onChange={(e) => setKeyLabel(e.target.value)}
                  placeholder="Ej: Mi Gemini Personal"
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-sm text-white outline-none"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">API Key Secreta *</label>
                <input
                  required
                  type="password"
                  value={keyValue}
                  onChange={(e) => setKeyValue(e.target.value)}
                  placeholder="AIzaSy... / sk-..."
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-sm font-mono text-white outline-none"
                />
              </div>

              {(keyProvider === 'ollama' || keyProvider === 'openrouter' || keyProvider === 'openai') && (
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Base URL (Opcional)</label>
                  <input
                    value={keyBaseUrl}
                    onChange={(e) => setKeyBaseUrl(e.target.value)}
                    placeholder="http://host.docker.internal:11434/v1"
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs font-mono text-white outline-none"
                  />
                </div>
              )}

              <button
                type="submit"
                className="w-full py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm transition"
              >
                Cifrar y Guardar API Key
              </button>
            </form>

            <div className="lg:col-span-7 space-y-3">
              <h2 className="text-base font-bold text-white">Claves Almacenadas ({apiKeys.length})</h2>
              {apiKeys.map((k) => (
                <div
                  key={k._id}
                  className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-white truncate">{k.label || k.provider}</span>
                      <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-xs font-mono uppercase">
                        {k.provider}
                      </span>
                    </div>
                    <div className="text-xs font-mono text-slate-400 mt-1 break-all">
                      Clave enmascarada: <span className="text-amber-300">{k.masked_key || k.encrypted_key}</span>
                    </div>
                  </div>

                  <button
                    onClick={async () => {
                      await api.deleteApiKey(k._id);
                      notify('ok', 'API Key eliminada');
                      await onRefreshAll();
                    }}
                    className="p-2 rounded-lg bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-500/20 shrink-0"
                    title="Eliminar API Key"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
              {apiKeys.length === 0 && (
                <div className="p-6 rounded-2xl bg-slate-900/50 border border-slate-800 text-center text-sm text-slate-400">
                  Aún no cargaste API Keys externas. El agente funcionará en <strong>Modo Asistente Local Inteligente</strong> (con soporte completo de Calculadora MCP, Snippets y Árbol de Ramas) hasta que agregues una clave.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
