import React, { useEffect, useState } from 'react';
import {
  ShieldAlert,
  Users,
  Activity,
  Settings,
  MessageSquare,
  Database,
  GitBranch,
  Unlock,
  Trash2,
  ShieldCheck,
  UserCheck,
  UserX,
  RefreshCw,
} from 'lucide-react';
import { api } from '../api';
import { AdminStats, AdminUserRecord, SystemSettings } from '../types';

interface AdminViewProps {
  isAdmin: boolean;
  onPromotedToAdmin: () => Promise<void>;
}

export const AdminView: React.FC<AdminViewProps> = ({ isAdmin, onPromotedToAdmin }) => {
  const [subTab, setSubTab] = useState<'stats' | 'users' | 'settings' | 'chats'>('stats');
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<AdminUserRecord[]>([]);
  const [userSearch, setUserSearch] = useState('');
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [platformChats, setPlatformChats] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);

  const loadAdminData = async () => {
    setLoading(true);
    try {
      const [sRes, uRes, cRes] = await Promise.all([
        api.getAdminStats(),
        api.listAdminUsers(userSearch),
        api.listAdminChats(),
      ]);
      if (sRes?.data) {
        setStats(sRes.data);
        setSettings(sRes.data.settings);
      }
      if (uRes?.data?.users) setUsers(uRes.data.users);
      if (cRes?.data?.chats) setPlatformChats(cRes.data.chats);
    } catch (e: any) {
      setBanner(e.message || 'Error cargando datos de administración');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAdmin) {
      loadAdminData();
    }
  }, [isAdmin]);

  const handleBootstrap = async () => {
    try {
      await api.bootstrapAdmin();
      await onPromotedToAdmin();
      await loadAdminData();
    } catch (e: any) {
      setBanner(e.message);
    }
  };

  if (!isAdmin) {
    return (
      <div className="flex-1 h-full flex items-center justify-center bg-slate-950 p-6">
        <div className="max-w-md w-full p-6 rounded-2xl bg-slate-900 border border-slate-800 text-center space-y-4">
          <ShieldAlert className="w-12 h-12 text-amber-400 mx-auto" />
          <h2 className="text-xl font-bold text-white">Panel de Administración de InsanusChat</h2>
          <p className="text-sm text-slate-400">
            Tu cuenta actual no tiene el rol <code className="text-emerald-400">admin</code> activo. En entorno local podés elevar tu cuenta con un clic para administrar usuarios, políticas MCP y métricas globales.
          </p>
          <button
            onClick={handleBootstrap}
            className="w-full py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm transition"
          >
            Activar Rol Administrador (Bootstrap Local)
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 h-full overflow-y-auto bg-slate-950 p-3 sm:p-6">
      <div className="max-w-6xl mx-auto space-y-4 sm:space-y-6 pb-8">
        {/* Header Admin */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 sm:gap-4 pb-4 border-b border-slate-800">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h1 className="text-lg sm:text-2xl font-bold text-white flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 sm:w-6 sm:h-6 text-emerald-400 shrink-0" />
                <span>Panel de Administración & Gobernanza</span>
              </h1>
              <p className="text-xs sm:text-sm text-slate-400 mt-1">
                Monitoreo de MongoDB, métricas globales de tokens y ramas, control de cuentas de usuario y políticas de seguridad MCP.
              </p>
            </div>
            <button
              onClick={loadAdminData}
              className="lg:hidden p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 hover:text-white shrink-0"
              title="Refrescar datos"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          <div className="grid grid-cols-2 sm:flex sm:items-center gap-1.5 p-1 rounded-xl bg-slate-900 border border-slate-800 w-full lg:w-auto">
            <button
              onClick={() => setSubTab('stats')}
              className={`flex items-center justify-center sm:justify-start gap-1.5 px-2.5 sm:px-3 py-2 sm:py-1.5 rounded-lg text-xs font-medium transition ${
                subTab === 'stats' ? 'bg-emerald-500 text-slate-950 font-semibold' : 'text-slate-300 hover:bg-slate-800'
              }`}
            >
              <Activity className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">Métricas & Salud</span>
            </button>
            <button
              onClick={() => setSubTab('users')}
              className={`flex items-center justify-center sm:justify-start gap-1.5 px-2.5 sm:px-3 py-2 sm:py-1.5 rounded-lg text-xs font-medium transition ${
                subTab === 'users' ? 'bg-emerald-500 text-slate-950 font-semibold' : 'text-slate-300 hover:bg-slate-800'
              }`}
            >
              <Users className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">Usuarios ({users.length})</span>
            </button>
            <button
              onClick={() => setSubTab('settings')}
              className={`flex items-center justify-center sm:justify-start gap-1.5 px-2.5 sm:px-3 py-2 sm:py-1.5 rounded-lg text-xs font-medium transition ${
                subTab === 'settings' ? 'bg-emerald-500 text-slate-950 font-semibold' : 'text-slate-300 hover:bg-slate-800'
              }`}
            >
              <Settings className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">Políticas Globales</span>
            </button>
            <button
              onClick={() => setSubTab('chats')}
              className={`flex items-center justify-center sm:justify-start gap-1.5 px-2.5 sm:px-3 py-2 sm:py-1.5 rounded-lg text-xs font-medium transition ${
                subTab === 'chats' ? 'bg-emerald-500 text-slate-950 font-semibold' : 'text-slate-300 hover:bg-slate-800'
              }`}
            >
              <MessageSquare className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">Auditoría Chats</span>
            </button>
            <button
              onClick={loadAdminData}
              className="hidden lg:inline-flex p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              title="Refrescar datos"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {banner && (
          <div className="px-4 py-2.5 rounded-xl bg-emerald-950/60 border border-emerald-500/40 text-xs text-emerald-200 flex justify-between">
            <span>{banner}</span>
            <button onClick={() => setBanner(null)} className="underline">
              Cerrar
            </button>
          </div>
        )}

        {/* SUBTAB 1: MÉTRICAS Y SALUD */}
        {subTab === 'stats' && stats && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>Estado MongoDB</span>
                  <Database className="w-4 h-4 text-emerald-400" />
                </div>
                <div className="text-2xl font-bold text-emerald-400 mt-2">
                  {stats.database.ok ? 'ONLINE' : 'OFFLINE'}
                </div>
                <div className="text-xs text-slate-400 mt-1">
                  Latencia ping: <span className="font-mono text-white">{stats.database.latency_ms} ms</span>
                </div>
              </div>

              <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>Usuarios Registrados</span>
                  <Users className="w-4 h-4 text-cyan-400" />
                </div>
                <div className="text-2xl font-bold text-white mt-2">{stats.users.total}</div>
                <div className="text-xs text-slate-400 mt-1">
                  {stats.users.active} activos · {stats.users.admins} admins
                </div>
              </div>

              <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>Mensajes & Bifurcaciones</span>
                  <GitBranch className="w-4 h-4 text-purple-400" />
                </div>
                <div className="text-2xl font-bold text-white mt-2">{stats.chats.total_messages}</div>
                <div className="text-xs text-slate-400 mt-1">
                  En {stats.chats.total} chats · <span className="text-purple-300">{stats.chats.branched_nodes} nodos bifurcados</span>
                </div>
              </div>

              <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>Tokens Consumidos (HU-11)</span>
                  <Activity className="w-4 h-4 text-amber-400" />
                </div>
                <div className="text-2xl font-bold text-amber-300 mt-2">
                  {stats.chats.total_tokens_used.toLocaleString()}
                </div>
                <div className="text-xs text-slate-400 mt-1">
                  {stats.resources.agents} agentes · {stats.resources.mcps} MCPs · {stats.resources.code_snippets} snippets
                </div>
              </div>
            </div>
          </div>
        )}

        {/* SUBTAB 2: GESTIÓN DE USUARIOS */}
        {subTab === 'users' && (
          <div className="space-y-4">
            <div className="flex gap-2">
              <input
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                placeholder="Buscar usuario por email o nombre..."
                className="flex-1 px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 text-sm text-white outline-none"
              />
              <button
                onClick={loadAdminData}
                className="px-4 py-2 rounded-xl bg-emerald-500 text-slate-950 font-bold text-xs"
              >
                Buscar
              </button>
            </div>

            {/* Vista de Tarjetas en Móvil */}
            <div className="md:hidden space-y-3">
              {users.map((u) => {
                const uIsAdmin = u.roles.includes('admin');
                return (
                  <div key={u._id} className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-3 text-xs">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-bold text-white truncate">{u.display_name}</div>
                        <div className="text-slate-400 font-mono truncate">{u.email}</div>
                      </div>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-semibold shrink-0 ${
                          u.active ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'
                        }`}
                      >
                        {u.active ? 'ACTIVO' : 'SUSPENDIDO'}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      {u.roles.map((r) => (
                        <span
                          key={r}
                          className={`px-2 py-0.5 rounded font-mono uppercase text-[10px] ${
                            r === 'admin'
                              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                              : 'bg-slate-800 text-slate-300'
                          }`}
                        >
                          {r}
                        </span>
                      ))}
                      <span className="text-slate-400 font-mono ml-auto">
                        {u.counts.chats} chats · {u.counts.agents} ag · {u.counts.mcps} mcp
                      </span>
                    </div>

                    <div className="flex items-center gap-2 pt-2 border-t border-slate-800">
                      <button
                        onClick={async () => {
                          const newRoles = uIsAdmin ? ['user'] : ['admin', 'user'];
                          await api.updateAdminUser(u._id, { roles: newRoles });
                          setBanner(`Roles de ${u.email} actualizados`);
                          await loadAdminData();
                        }}
                        className="flex-1 py-1.5 px-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium text-center"
                      >
                        {uIsAdmin ? 'Quitar Admin' : 'Hacer Admin'}
                      </button>
                      <button
                        onClick={async () => {
                          try {
                            await api.updateAdminUser(u._id, { active: !u.active });
                            setBanner(`Estado de ${u.email} actualizado`);
                            await loadAdminData();
                          } catch (err: any) {
                            setBanner(err.message);
                          }
                        }}
                        className="flex-1 py-1.5 px-2.5 rounded-lg bg-amber-950/50 hover:bg-amber-900/60 text-amber-300 border border-amber-500/20 font-medium text-center"
                      >
                        {u.active ? 'Suspender' : 'Reactivar'}
                      </button>
                      <button
                        onClick={async () => {
                          try {
                            await api.deleteAdminUser(u._id);
                            setBanner(`Usuario ${u.email} eliminado`);
                            await loadAdminData();
                          } catch (err: any) {
                            setBanner(err.message);
                          }
                        }}
                        className="p-2 rounded-lg bg-rose-950/50 hover:bg-rose-900/70 text-rose-300 border border-rose-500/20"
                        title="Eliminar usuario y sus chats"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Tabla en Desktop */}
            <div className="hidden md:block rounded-2xl border border-slate-800 overflow-x-auto bg-slate-900/80">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-900 text-slate-400 border-b border-slate-800">
                  <tr>
                    <th className="p-3">Usuario</th>
                    <th className="p-3">Roles</th>
                    <th className="p-3">Estado</th>
                    <th className="p-3">Recursos (Chats / Agentes / MCPs)</th>
                    <th className="p-3 text-right">Acciones Administrativas</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {users.map((u) => {
                    const uIsAdmin = u.roles.includes('admin');
                    return (
                      <tr key={u._id} className="hover:bg-slate-800/40">
                        <td className="p-3">
                          <div className="font-bold text-white">{u.display_name}</div>
                          <div className="text-slate-400 font-mono">{u.email}</div>
                        </td>
                        <td className="p-3">
                          <div className="flex gap-1">
                            {u.roles.map((r) => (
                              <span
                                key={r}
                                className={`px-2 py-0.5 rounded font-mono uppercase text-[10px] ${
                                  r === 'admin'
                                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                    : 'bg-slate-800 text-slate-300'
                                }`}
                              >
                                {r}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="p-3">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                              u.active
                                ? 'bg-emerald-500/20 text-emerald-300'
                                : 'bg-rose-500/20 text-rose-300'
                            }`}
                          >
                            {u.active ? 'ACTIVO' : 'SUSPENDIDO'}
                          </span>
                        </td>
                        <td className="p-3 font-mono text-slate-300">
                          {u.counts.chats} chats · {u.counts.agents} ag · {u.counts.mcps} mcp · {u.counts.api_keys} keys
                        </td>
                        <td className="p-3 text-right space-x-1.5">
                          <button
                            onClick={async () => {
                              const newRoles = uIsAdmin ? ['user'] : ['admin', 'user'];
                              await api.updateAdminUser(u._id, { roles: newRoles });
                              setBanner(`Roles de ${u.email} actualizados`);
                              await loadAdminData();
                            }}
                            className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200"
                          >
                            {uIsAdmin ? 'Quitar Admin' : 'Hacer Admin'}
                          </button>
                          <button
                            onClick={async () => {
                              try {
                                await api.updateAdminUser(u._id, { active: !u.active });
                                setBanner(`Estado de ${u.email} actualizado`);
                                await loadAdminData();
                              } catch (err: any) {
                                setBanner(err.message);
                              }
                            }}
                            className="px-2.5 py-1 rounded bg-amber-950/50 hover:bg-amber-900/60 text-amber-300 border border-amber-500/20"
                          >
                            {u.active ? 'Suspender' : 'Reactivar'}
                          </button>
                          <button
                            onClick={async () => {
                              try {
                                await api.deleteAdminUser(u._id);
                                setBanner(`Usuario ${u.email} eliminado`);
                                await loadAdminData();
                              } catch (err: any) {
                                setBanner(err.message);
                              }
                            }}
                            className="p-1.5 rounded bg-rose-950/50 hover:bg-rose-900/70 text-rose-300 border border-rose-500/20 inline-flex items-center"
                            title="Eliminar usuario y sus chats"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* SUBTAB 3: POLÍTICAS GLOBALES DEL SERVIDOR */}
        {subTab === 'settings' && settings && (
          <div className="max-w-2xl p-4 sm:p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-5">
            <h2 className="text-sm sm:text-base font-bold text-white">⚙️ Políticas de Seguridad y Gobernanza Global (HU-07)</h2>

            <label className="flex items-center justify-between gap-4 p-3 rounded-xl bg-slate-950 border border-slate-800 cursor-pointer">
              <div>
                <div className="text-xs sm:text-sm font-semibold text-white">Permitir Registro Público de Nuevos Usuarios</div>
                <div className="text-xs text-slate-400">
                  Si se desactiva, solo los usuarios ya existentes podrán iniciar sesión en el servidor.
                </div>
              </div>
              <input
                type="checkbox"
                checked={settings.allow_registration}
                onChange={(e) => setSettings({ ...settings, allow_registration: e.target.checked })}
                className="w-4 h-4 shrink-0 accent-emerald-500"
              />
            </label>

            <label className="flex items-center justify-between gap-4 p-3 rounded-xl bg-slate-950 border border-slate-800 cursor-pointer">
              <div>
                <div className="text-xs sm:text-sm font-semibold text-white">Permitir Servidores MCP por STDIO a Usuarios Estándar</div>
                <div className="text-xs text-slate-400">
                  Si se desactiva, solo cuentas con rol <code className="text-amber-300">admin</code> podrán registrar scripts locales STDIO.
                </div>
              </div>
              <input
                type="checkbox"
                checked={settings.allow_stdio_mcp}
                onChange={(e) => setSettings({ ...settings, allow_stdio_mcp: e.target.checked })}
                className="w-4 h-4 shrink-0 accent-emerald-500"
              />
            </label>

            <label className="flex items-center justify-between gap-4 p-3 rounded-xl bg-slate-950 border border-slate-800 cursor-pointer">
              <div>
                <div className="text-xs sm:text-sm font-semibold text-white">Permitir Endpoints MCP en Red Local (localhost / LAN)</div>
                <div className="text-xs text-slate-400">
                  Habilita la conexión a contenedores o servicios MCP dentro de la misma red privada (la protección Anti-SSRF contra Cloud Metadata 169.254.169.254 permanece siempre activa).
                </div>
              </div>
              <input
                type="checkbox"
                checked={settings.allow_local_mcp_endpoints}
                onChange={(e) => setSettings({ ...settings, allow_local_mcp_endpoints: e.target.checked })}
                className="w-4 h-4 shrink-0 accent-emerald-500"
              />
            </label>

            <label className="flex items-center justify-between gap-4 p-3 rounded-xl bg-slate-950 border border-slate-800 cursor-pointer">
              <div>
                <div className="text-xs sm:text-sm font-semibold text-white">Permitir Ejecución de Code Snippets (Python / JavaScript)</div>
                <div className="text-xs text-slate-400">
                  Si se desactiva, ningún agente ni usuario podrá crear ni ejecutar snippets de código en el sandbox del servidor.
                </div>
              </div>
              <input
                type="checkbox"
                checked={settings.allow_code_snippets !== false}
                onChange={(e) => setSettings({ ...settings, allow_code_snippets: e.target.checked })}
                className="w-4 h-4 shrink-0 accent-emerald-500"
              />
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Rate Limit Login (intentos/min por IP)</label>
                <input
                  type="number"
                  value={settings.rate_limit_login_per_min}
                  onChange={(e) => setSettings({ ...settings, rate_limit_login_per_min: Number(e.target.value) })}
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-sm text-white"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Modelo por Defecto Global</label>
                <input
                  value={settings.default_model}
                  onChange={(e) => setSettings({ ...settings, default_model: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-sm font-mono text-white"
                />
              </div>
            </div>

            <button
              onClick={async () => {
                await api.updateAdminSettings(settings);
                setBanner('Políticas globales guardadas correctamente');
              }}
              className="w-full py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm transition"
            >
              Guardar Políticas Globales
            </button>
          </div>
        )}

        {/* SUBTAB 4: AUDITORÍA DE CHATS */}
        {subTab === 'chats' && (
          <>
            {/* Vista de Tarjetas en Móvil */}
            <div className="md:hidden space-y-3">
              {platformChats.map((c) => (
                <div key={c._id} className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-2.5 text-xs">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-bold text-white truncate">{c.title}</div>
                      <div className="text-slate-400 truncate mt-0.5">{c.user_label}</div>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-semibold shrink-0 ${
                        c.locked ? 'bg-amber-500/20 text-amber-300' : 'bg-emerald-500/20 text-emerald-300'
                      }`}
                    >
                      {c.locked ? 'BLOQUEADO' : 'LIBRE'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between pt-2 border-t border-slate-800">
                    <span className="font-mono text-slate-400">{c.message_count} mensajes</span>
                    {c.locked && (
                      <button
                        onClick={async () => {
                          await api.unlockChat(c._id);
                          setBanner(`Chat ${c.title} desbloqueado`);
                          await loadAdminData();
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 font-medium"
                      >
                        <Unlock className="w-3 h-3" />
                        <span>Forzar Unlock</span>
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="hidden md:block rounded-2xl border border-slate-800 overflow-x-auto bg-slate-900/80">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-900 text-slate-400 border-b border-slate-800">
                  <tr>
                    <th className="p-3">Título del Chat</th>
                    <th className="p-3">Propietario</th>
                    <th className="p-3">Mensajes</th>
                    <th className="p-3">Estado Lock (HU-03)</th>
                    <th className="p-3 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {platformChats.map((c) => (
                    <tr key={c._id} className="hover:bg-slate-800/40">
                      <td className="p-3 font-semibold text-white">{c.title}</td>
                      <td className="p-3 text-slate-300">{c.user_label}</td>
                      <td className="p-3 font-mono text-slate-300">{c.message_count}</td>
                      <td className="p-3">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                            c.locked ? 'bg-amber-500/20 text-amber-300' : 'bg-emerald-500/20 text-emerald-300'
                          }`}
                        >
                          {c.locked ? 'BLOQUEADO' : 'LIBRE'}
                        </span>
                      </td>
                      <td className="p-3 text-right">
                        {c.locked && (
                          <button
                            onClick={async () => {
                              await api.unlockChat(c._id);
                              setBanner(`Chat ${c.title} desbloqueado`);
                              await loadAdminData();
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-amber-500/20 text-amber-300 hover:bg-amber-500/30"
                          >
                            <Unlock className="w-3 h-3" />
                            <span>Forzar Unlock</span>
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
