"""
Túnel WebSocket Saliente (Opt-in) desde InsanusChat Workstation hacia InsanusChat_Backend (/api/v1/nodes/ws)
(HU-20, HU-24, HU-26, HU-34, HU-40).
- Solo se activa cuando `expose_to_cloud=True` y existe `cloud_jwt_token`.
- Sincroniza políticas autoritativas (`policy_sync`) recibidas desde el Backend SSOT.
- Soporta Kill-Switch remoto (`expose_to_cloud=False`) y revocación (`device_revoked`) cerrando
  el túnel y todas las sesiones PTY remotas de forma inmediata.
"""
import asyncio
from collections import deque
from datetime import datetime, timezone
import json
import logging
from pathlib import Path
import platform
from typing import Any, Callable, Deque, Dict, List, Optional
from urllib.parse import urlencode

import websockets

from config import WorkstationConfig
from harness.pty_session import WorkstationPtySession

logger = logging.getLogger(__name__)


class CloudWebSocketBridge:
    def __init__(
        self,
        config: WorkstationConfig,
        rpc_dispatcher: Callable[[str, Dict[str, Any]], Any],
        workspace_resolver: Optional[Callable[[str], Path]] = None,
        on_policy_sync: Optional[Callable[[Dict[str, Any], Optional[str]], None]] = None,
        on_extensions_sync: Optional[Callable[[List[Dict[str, Any]]], None]] = None,
        editors_provider: Optional[Callable[[], List[Dict[str, Any]]]] = None,
    ):
        self.config = config
        self.rpc_dispatcher = rpc_dispatcher
        self.workspace_resolver = workspace_resolver
        self.on_policy_sync = on_policy_sync
        self.on_extensions_sync = on_extensions_sync
        self.editors_provider = editors_provider

        self._task: Optional[asyncio.Task] = None
        self._stop_event = asyncio.Event()
        self.connected: bool = False
        self.last_error: Optional[str] = None
        self.connected_since: Optional[str] = None
        self._pty_sessions: Dict[str, WorkstationPtySession] = {}
        self._pty_tasks: Dict[str, asyncio.Task] = {}
        self._logs: Deque[Dict[str, str]] = deque(maxlen=200)
        self.log("info", "Microservicio Workstation inicializado (modo Solo Local por defecto)")

    def log(self, level: str, message: str) -> None:
        self._logs.append(
            {
                "ts": datetime.now(timezone.utc).isoformat(),
                "level": level,
                "message": message,
            }
        )

    def get_logs(self) -> List[Dict[str, str]]:
        return list(self._logs)

    def _build_ws_url(self) -> str:
        base = self.config.cloud_backend_url.rstrip("/")
        if base.startswith("https://"):
            ws_base = "wss://" + base[len("https://") :]
        elif base.startswith("http://"):
            ws_base = "ws://" + base[len("http://") :]
        else:
            ws_base = "ws://" + base
        qs = urlencode({"token": self.config.cloud_jwt_token or "", "node_id": self.config.node_id})
        return f"{ws_base}/api/v1/nodes/ws?{qs}"

    def _close_all_ptys(self) -> None:
        for _, task in list(self._pty_tasks.items()):
            task.cancel()
        self._pty_tasks.clear()
        for _, sess in list(self._pty_sessions.items()):
            try:
                sess.close()
            except Exception:
                pass
        self._pty_sessions.clear()

    async def start(self):
        if not self.config.expose_to_cloud or not self.config.cloud_jwt_token:
            await self.stop()
            return
        if self._task and not self._task.done():
            return
        self._stop_event.clear()
        self.log("info", f"Iniciando túnel saliente hacia {self.config.cloud_backend_url}...")
        self._task = asyncio.create_task(self._run_loop())

    async def stop(self):
        was_running = bool(self._task and not self._task.done()) or self.connected
        self._stop_event.set()
        self.connected = False
        self.connected_since = None
        self._close_all_ptys()
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except Exception:
                pass
        self._task = None
        if was_running:
            self.log("info", "Túnel remoto cerrado — equipo aislado en 🔒 Solo Local (127.0.0.1)")

    async def sync_state(self):
        if self.config.expose_to_cloud and self.config.cloud_jwt_token:
            await self.start()
        else:
            await self.stop()

    async def _pump_pty(self, ws, session_id: str, sess: WorkstationPtySession):
        try:
            while True:
                ev = await sess.output_queue.get()
                ev["session_id"] = session_id
                await ws.send(json.dumps(ev, ensure_ascii=False))
                if ev.get("cmd") == "pty_exit":
                    break
        except asyncio.CancelledError:
            pass
        except Exception:
            pass
        finally:
            self._pty_sessions.pop(session_id, None)
            self._pty_tasks.pop(session_id, None)
            sess.close()

    async def _heartbeat_loop(self, ws):
        try:
            while not self._stop_event.is_set() and self.config.expose_to_cloud:
                await asyncio.sleep(25)
                workspaces = await asyncio.to_thread(self.rpc_dispatcher, "list_workspaces", {})
                editors = await asyncio.to_thread(self.editors_provider) if self.editors_provider else []
                await ws.send(
                    json.dumps(
                        {
                            "cmd": "heartbeat",
                            "workspaces": workspaces,
                            "reported_editors": editors,
                            "allow_remote_terminal": self.config.allow_remote_terminal,
                            "allow_remote_agent_tools": self.config.allow_remote_agent_tools,
                        },
                        ensure_ascii=False,
                    )
                )
        except asyncio.CancelledError:
            pass
        except Exception:
            pass

    async def _run_loop(self):
        while not self._stop_event.is_set() and self.config.expose_to_cloud and self.config.cloud_jwt_token:
            ws_url = self._build_ws_url()
            hb_task: Optional[asyncio.Task] = None
            try:
                async with websockets.connect(ws_url, ping_interval=20, ping_timeout=20) as ws:
                    self.connected = True
                    self.last_error = None
                    self.connected_since = datetime.now(timezone.utc).isoformat()
                    self.log("success", f"Túnel Cloud conectado ({self.config.node_name})")

                    workspaces = await asyncio.to_thread(self.rpc_dispatcher, "list_workspaces", {})
                    editors = await asyncio.to_thread(self.editors_provider) if self.editors_provider else []
                    await ws.send(
                        json.dumps(
                            {
                                "cmd": "node_register",
                                "node_id": self.config.node_id,
                                "name": self.config.node_name,
                                "os": platform.system().lower(),
                                "arch": platform.machine().lower() or "x86_64",
                                "shell": self.config.to_public_dict()["shell"],
                                "app_version": self.config.app_version,
                                "root_dir": self.config.root_projects_dir,
                                "workspaces": workspaces,
                                "reported_editors": editors,
                                "allow_remote_terminal": self.config.allow_remote_terminal,
                                "allow_remote_agent_tools": self.config.allow_remote_agent_tools,
                            },
                            ensure_ascii=False,
                        )
                    )

                    hb_task = asyncio.create_task(self._heartbeat_loop(ws))
                    loop = asyncio.get_running_loop()

                    async for raw in ws:
                        if self._stop_event.is_set() or not self.config.expose_to_cloud:
                            break
                        payload = json.loads(raw)
                        cmd = payload.get("cmd")

                        if cmd == "node_registered":
                            if payload.get("policy") and self.on_policy_sync:
                                self.on_policy_sync(payload["policy"], None)
                            if payload.get("synced_extensions") and self.on_extensions_sync:
                                self.on_extensions_sync(payload["synced_extensions"])

                        elif cmd == "policy_sync":
                            pol = payload.get("policy") or {}
                            self.log("info", f"Política SSOT sincronizada (v{payload.get('config_version', '?')})")
                            if self.on_policy_sync:
                                self.on_policy_sync(pol, payload.get("node_name"))
                            if pol.get("expose_to_cloud") is False:
                                self.log("warn", "Kill-Switch remoto recibido desde Backend — cerrando túnel...")
                                self._close_all_ptys()
                                break

                        elif cmd == "device_revoked":
                            self.log("warn", "Dispositivo revocado desde InsanusChat Cloud — desconectando.")
                            self.config.expose_to_cloud = False
                            self.config.cloud_jwt_token = None
                            self.config.save()
                            self._close_all_ptys()
                            break

                        elif cmd == "rpc_request":
                            call_id = payload.get("call_id")
                            action = payload.get("action")
                            params = payload.get("params") or {}
                            try:
                                result = await asyncio.to_thread(self.rpc_dispatcher, action, params)
                                await ws.send(
                                    json.dumps(
                                        {"cmd": "rpc_response", "call_id": call_id, "data": result},
                                        default=str,
                                        ensure_ascii=False,
                                    )
                                )
                                if action == "set_privacy" and not self.config.expose_to_cloud:
                                    await asyncio.sleep(0.15)
                                    break
                            except Exception as exc:
                                await ws.send(
                                    json.dumps(
                                        {"cmd": "rpc_response", "call_id": call_id, "error": str(exc)},
                                        ensure_ascii=False,
                                    )
                                )

                        elif cmd == "pty_open":
                            sid = payload.get("session_id")
                            if not sid or not self.config.allow_remote_terminal:
                                continue
                            ws_name = payload.get("workspace") or "."
                            cwd = (
                                self.workspace_resolver(ws_name)
                                if self.workspace_resolver
                                else Path(self.config.root_projects_dir)
                            )
                            req_sh = payload.get("shell") or (
                                None if self.config.default_shell == "auto" else self.config.default_shell
                            )
                            sess = WorkstationPtySession(
                                cwd=cwd,
                                cols=int(payload.get("cols") or 100),
                                rows=int(payload.get("rows") or 24),
                                requested_shell=req_sh,
                            )
                            sess.start(loop)
                            self._pty_sessions[sid] = sess
                            self._pty_tasks[sid] = asyncio.create_task(self._pump_pty(ws, sid, sess))
                            self.log("info", f"Terminal remota PTY abierta ({sess.shell_name} en {ws_name})")

                        elif cmd == "pty_input":
                            sid = payload.get("session_id")
                            sess = self._pty_sessions.get(sid)
                            if sess:
                                sess.write(payload.get("data") or "")

                        elif cmd == "pty_resize":
                            sid = payload.get("session_id")
                            sess = self._pty_sessions.get(sid)
                            if sess:
                                sess.resize(int(payload.get("cols") or 100), int(payload.get("rows") or 24))

                        elif cmd == "pty_close":
                            sid = payload.get("session_id")
                            t = self._pty_tasks.pop(sid, None)
                            if t:
                                t.cancel()
                            sess = self._pty_sessions.pop(sid, None)
                            if sess:
                                sess.close()
            except asyncio.CancelledError:
                break
            except Exception as e:
                self.connected = False
                self.connected_since = None
                self._close_all_ptys()
                self.last_error = str(e)
                self.log("error", f"Túnel Cloud desconectado: {e}")
                logger.warning("CloudWebSocketBridge reconectando en 4s tras error: %s", e)
                try:
                    await asyncio.wait_for(self._stop_event.wait(), timeout=4.0)
                except asyncio.TimeoutError:
                    pass
            finally:
                if hb_task:
                    hb_task.cancel()
        self.connected = False
        self.connected_since = None
        self._close_all_ptys()
