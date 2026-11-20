"""
Microservicio Local de InsanusChat Workstation (FastAPI en 127.0.0.1:<puerto>)
(HU-24..HU-27, HU-34..HU-40).
- Corre embebido como sidecar de la App Desktop Tauri v2 en Windows y Linux.
- Protegido por `X-Workstation-Token` (secreto efímero inyectado por Tauri en INSANUS_LOCAL_SECRET).
- Incluye Watchdog anti-zombie (`--watch-stdin` / `--parent-pid`) para garantizar cero procesos colgados.
- Mantiene a InsanusChat_Backend como Fuente de Verdad (SSOT) y ofrece acceso local 0ms para el Workbench.
"""
import argparse
import asyncio
from contextlib import asynccontextmanager
import os
from pathlib import Path
import platform
import secrets
import sys
import threading
import time
from typing import Any, Dict, Optional

from fastapi import Body, FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse
import httpx
import uvicorn

sys.path.insert(0, str(Path(__file__).resolve().parent))

from config import WorkstationConfig
from harness.filesystem import WorkstationFilesystem
from harness.git_ops import create_git_checkpoint, get_git_status
from harness.ide_proxy import IDEProxyHandler
from harness.ide_server import InsanusIDEServerManager
from harness.pty_session import WorkstationPtySession
from harness.terminal import WorkstationTerminal
from harness.vscode_engine import VSCodeManager
from ws_bridge import CloudWebSocketBridge

LOCAL_SECRET = os.environ.get("INSANUS_LOCAL_SECRET", "").strip()

cfg = WorkstationConfig.load()
fs_engine = WorkstationFilesystem(cfg.root_projects_dir, cfg.allowed_workspaces)
term_engine = WorkstationTerminal(
    allow_remote_terminal=cfg.allow_remote_terminal,
    custom_blocked_patterns=cfg.terminal_blocked_patterns,
)
vscode_mgr = VSCodeManager(
    preferred_editor=cfg.preferred_editor,
    custom_editor_path=cfg.custom_editor_path,
    sync_cli_extensions=cfg.sync_cli_extensions,
)
ide_mgr = InsanusIDEServerManager(cfg, vscode_mgr, fs_engine)
ide_proxy = IDEProxyHandler(ide_mgr, cfg)


def _apply_config_to_engines() -> None:
    fs_engine.set_root(cfg.root_projects_dir, cfg.allowed_workspaces)
    term_engine.allow_remote_terminal = cfg.allow_remote_terminal
    term_engine.custom_blocked_patterns = list(cfg.terminal_blocked_patterns)
    vscode_mgr.preferred_editor = cfg.preferred_editor
    vscode_mgr.custom_editor_path = cfg.custom_editor_path
    vscode_mgr.sync_cli_extensions = cfg.sync_cli_extensions


def _handle_policy_sync_from_backend(policy: Dict[str, Any], node_name: Optional[str] = None) -> None:
    cfg.apply_policy(policy, allow_enable_remote=False)
    if node_name:
        cfg.node_name = str(node_name).strip()
    _apply_config_to_engines()
    cfg.save()


def dispatch_harness_rpc(action: str, params: Dict[str, Any], is_remote: bool = True) -> Any:
    if is_remote and not cfg.allow_remote_agent_tools and action not in (
        "list_workspaces",
        "set_privacy",
        "list_extensions",
    ):
        raise PermissionError(
            "Las herramientas de agente remoto están deshabilitadas en la configuración de este Workstation."
        )

    ws_name = params.get("workspace") or "."
    if action == "list_workspaces":
        return fs_engine.list_workspaces()
    if action == "create_workspace":
        return fs_engine.create_workspace(params.get("name", ""), params.get("description", ""))
    if action == "file_tree":
        return fs_engine.get_file_tree(ws_name, params.get("directory", "."), int(params.get("max_depth", 4)))
    if action == "read_file":
        return fs_engine.read_file(
            ws_name,
            params.get("path", ""),
            params.get("start_line"),
            params.get("end_line"),
            bool(params.get("with_line_numbers", False)),
        )
    if action == "write_file":
        return fs_engine.write_file(ws_name, params.get("path", ""), params.get("content", ""), bool(params.get("overwrite", True)))
    if action == "edit_file":
        return fs_engine.edit_file(ws_name, params.get("path", ""), params.get("target", ""), params.get("replacement", ""))
    if action == "delete_file":
        return fs_engine.delete_file(ws_name, params.get("path", ""))
    if action == "grep_search":
        return fs_engine.grep_search(ws_name, params.get("query", ""), params.get("directory", "."), int(params.get("max_results", 40)))
    if action == "run_command":
        ws_dir = fs_engine.resolve_workspace_dir(ws_name)
        return term_engine.run_command(
            ws_dir, ws_name, params.get("command_line", ""), int(params.get("timeout_seconds", 30)), is_remote=is_remote
        )
    if action == "start_bg_process":
        ws_dir = fs_engine.resolve_workspace_dir(ws_name)
        return term_engine.start_background_process(
            ws_dir, ws_name, params.get("command_line", ""), params.get("label", ""), is_remote=is_remote
        )
    if action == "list_bg_processes":
        return term_engine.list_processes(ws_name)
    if action == "stop_bg_process":
        return term_engine.stop_process(params.get("proc_id", ""))
    if action == "git_status":
        ws_dir = fs_engine.resolve_workspace_dir(ws_name)
        return get_git_status(term_engine, ws_dir, ws_name)
    if action == "git_checkpoint":
        ws_dir = fs_engine.resolve_workspace_dir(ws_name)
        return create_git_checkpoint(term_engine, ws_dir, ws_name, params.get("label", "checkpoint"), params.get("node_id"))
    if action == "list_extensions":
        return vscode_mgr.list_extensions()
    if action == "install_extension":
        return vscode_mgr.install_extension(params.get("extension") or params)
    if action == "uninstall_extension":
        return vscode_mgr.uninstall_extension(params.get("ext_id") or "")
    if action == "ide_status":
        return ide_mgr.get_status()
    if action == "get_ide_diagnostics":
        return ide_mgr.get_diagnostics(ws_name, params.get("path"))
    if action == "ide_open_file":
        ide_mgr.enqueue_command(
            ws_name,
            {"action": "open_file", "path": params.get("path", ""), "line": params.get("line")},
        )
        return {"ok": True}
    if action == "set_privacy":
        cfg.apply_policy(params, allow_enable_remote=not is_remote)
        _apply_config_to_engines()
        cfg.save()
        return {"ok": True, "expose_to_cloud": cfg.expose_to_cloud, "config_version": cfg.config_version}
    raise ValueError(f"Acción RPC desconocida: {action}")


bridge = CloudWebSocketBridge(
    cfg,
    lambda act, prm: dispatch_harness_rpc(act, prm, is_remote=True),
    workspace_resolver=fs_engine.resolve_workspace_dir,
    on_policy_sync=_handle_policy_sync_from_backend,
    on_extensions_sync=vscode_mgr.apply_synced_extensions,
    editors_provider=vscode_mgr.detect_editors,
    ide_mgr=ide_mgr,
    ide_proxy=ide_proxy,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    secret = os.environ.get("INSANUS_LOCAL_SECRET", "").strip() or LOCAL_SECRET
    ide_mgr.write_runtime_file(secret)
    await bridge.sync_state()
    yield
    await bridge.stop()
    await ide_proxy.close()
    ide_mgr.stop()


app = FastAPI(
    title="insanus-harnes Local Sidecar",
    description="Microservicio local 127.0.0.1 para VS Code Real Embebido, Editor Vestido, Terminal PTY y Control Remoto Opt-in.",
    version="1.5.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://tauri.localhost",
        "https://tauri.localhost",
        "tauri://localhost",
        "http://localhost:5173",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:3000",
    ],
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _is_valid_local_token(candidate: Optional[str]) -> bool:
    secret = os.environ.get("INSANUS_LOCAL_SECRET", "").strip() or LOCAL_SECRET
    if not secret:
        return True
    if not candidate:
        return False
    return secrets.compare_digest(candidate.strip(), secret)


@app.middleware("http")
async def verify_workstation_token(request: Request, call_next):
    """HU-38: Protege las rutas /local/* contra sitios externos mediante X-Workstation-Token."""
    if request.method == "OPTIONS" or request.url.path in ("/health", "/"):
        return await call_next(request)
    if request.url.path.startswith("/local/"):
        token = request.headers.get("X-Workstation-Token") or request.query_params.get("local_token")
        if not _is_valid_local_token(token):
            return JSONResponse(status_code=401, content={"detail": "X-Workstation-Token inválido o ausente"})
    return await call_next(request)


@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "version": cfg.app_version,
        "pid": os.getpid(),
        "port": cfg.bind_port,
        "node_id": cfg.node_id,
        "node_name": cfg.node_name,
        "expose_to_cloud": cfg.expose_to_cloud,
        "bridge_connected": bridge.connected,
    }


@app.get("/local/status")
async def get_local_status():
    vscode_st = await vscode_mgr.check_status()
    return {
        "config": cfg.to_public_dict(),
        "policy": cfg.to_policy_dict(),
        "bridge": {
            "connected": bridge.connected,
            "connected_since": bridge.connected_since,
            "last_error": bridge.last_error,
        },
        "workspaces": fs_engine.list_workspaces(include_restricted=False),
        "all_workspaces": fs_engine.list_workspaces(include_restricted=True),
        "vscode": vscode_st,
        "ide": ide_mgr.get_status(),
        "pid": os.getpid(),
        "port": cfg.bind_port,
    }


@app.get("/local/logs")
async def get_local_logs():
    return {"logs": bridge.get_logs()}


@app.post("/local/bootstrap-sync")
async def bootstrap_sync_with_cloud(body: Dict[str, Any] = Body(...)):
    """
    HU-35: Emparejamiento 1-clic desde la App Desktop ya autenticada.
    Recibe cloud_backend_url, access_token y la política autoritativa SSOT del Backend.
    """
    if body.get("cloud_backend_url"):
        cfg.cloud_backend_url = str(body["cloud_backend_url"]).strip().rstrip("/")
    if body.get("access_token"):
        cfg.cloud_jwt_token = str(body["access_token"]).strip()
    if isinstance(body.get("desired_policy"), dict):
        # Respetamos seguridad física: si el usuario local tenía expose_to_cloud=False, no encenderlo sin click explícito
        cfg.apply_policy(body["desired_policy"], allow_enable_remote=False)
    if isinstance(body.get("synced_extensions"), list):
        vscode_mgr.apply_synced_extensions(body["synced_extensions"])

    _apply_config_to_engines()
    cfg.save()
    ide_mgr.write_runtime_file(os.environ.get("INSANUS_LOCAL_SECRET", "").strip() or LOCAL_SECRET)
    bridge.log("info", f"Sesión sincronizada en 1 clic con {cfg.cloud_backend_url}")
    await bridge.sync_state()
    return {
        "ok": True,
        "config": cfg.to_public_dict(),
        "policy": cfg.to_policy_dict(),
        "bridge_connected": bridge.connected,
    }


@app.patch("/local/settings")
@app.patch("/local/privacy")
async def update_local_settings(body: Dict[str, Any] = Body(...)):
    """HU-24 / HU-34 / HU-43: Actualiza configuración local y sincroniza el túnel en caliente."""
    cfg.apply_policy(body, allow_enable_remote=True)
    if "root_projects_dir" in body and body["root_projects_dir"]:
        cfg.root_projects_dir = str(Path(body["root_projects_dir"]).expanduser().resolve())
    if "cloud_backend_url" in body and body["cloud_backend_url"]:
        cfg.cloud_backend_url = str(body["cloud_backend_url"]).strip().rstrip("/")
    if "node_name" in body and body["node_name"]:
        cfg.node_name = str(body["node_name"]).strip()
    if "minimize_to_tray" in body:
        cfg.minimize_to_tray = bool(body["minimize_to_tray"])
    if "launch_at_startup" in body:
        cfg.launch_at_startup = bool(body["launch_at_startup"])

    _apply_config_to_engines()
    cfg.save()
    ide_mgr.write_runtime_file(os.environ.get("INSANUS_LOCAL_SECRET", "").strip() or LOCAL_SECRET)
    bridge.log(
        "info",
        f"Ajustes actualizados (Control Remoto={'ON' if cfg.expose_to_cloud else 'OFF'}, TerminalRemota={'ON' if cfg.allow_remote_terminal else 'OFF'})",
    )
    await bridge.sync_state()
    return {
        "message": "Configuración actualizada",
        "config": cfg.to_public_dict(),
        "policy": cfg.to_policy_dict(),
        "bridge_connected": bridge.connected,
    }


@app.post("/local/cloud-login")
async def login_to_cloud_backend(body: Dict[str, Any] = Body(...)):
    email = (body.get("email") or "").strip()
    password = body.get("password") or ""
    cloud_url = (body.get("cloud_backend_url") or cfg.cloud_backend_url).rstrip("/")
    if not email or not password:
        raise HTTPException(status_code=400, detail="email y password requeridos")
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.post(f"{cloud_url}/api/v1/auth/login", json={"email": email, "password": password})
            if r.status_code != 200:
                raise HTTPException(status_code=r.status_code, detail=r.text)
            token = r.json().get("data", {}).get("access_token")
            if not token:
                raise HTTPException(status_code=400, detail="No se recibió access_token")
            cfg.cloud_backend_url = cloud_url
            cfg.cloud_jwt_token = token
            cfg.save()
            await bridge.sync_state()
            return {"message": "Sesión vinculada", "expose_to_cloud": cfg.expose_to_cloud, "bridge_connected": bridge.connected}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"No se pudo conectar con {cloud_url}: {e}")


# ---------------------------------------------------------------------------
# API Local-First del Workbench VS Code (0ms — funciona incluso en 🔒 Solo Local)
# ---------------------------------------------------------------------------
@app.get("/local/workspaces")
async def local_list_workspaces():
    return {"data": {"workspaces": fs_engine.list_workspaces()}, "workspaces": fs_engine.list_workspaces()}


@app.post("/local/workspaces")
async def local_create_workspace(body: Dict[str, Any] = Body(...)):
    try:
        ws = fs_engine.create_workspace(body.get("name", ""), body.get("description", ""))
        return {"data": ws, **ws}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/local/files/tree")
async def local_file_tree(workspace: str = Query("."), directory: str = Query("."), max_depth: int = Query(4)):
    try:
        tree = fs_engine.get_file_tree(workspace, directory, max_depth)
        return {"data": {"tree": tree, "workspace": workspace}, "tree": tree}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/local/files/search")
async def local_file_search(
    workspace: str = Query("."),
    query: str = Query(..., min_length=1),
    directory: str = Query("."),
    max_results: int = Query(50),
):
    try:
        matches = fs_engine.grep_search(workspace, query, directory, max_results)
        return {"data": {"query": query, "matches": matches}, "matches": matches}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/local/files/read")
async def local_read_file(workspace: str = Query("."), path: str = Query(...)):
    try:
        res = fs_engine.read_file(workspace, path)
        return {"data": res, **res}
    except FileNotFoundError as fnf:
        raise HTTPException(status_code=404, detail=str(fnf))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/local/files/write")
async def local_write_file(body: Dict[str, Any] = Body(...)):
    try:
        res = fs_engine.write_file(body.get("workspace", "."), body.get("path", ""), body.get("content", ""))
        return {"data": res, **res}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/local/files/edit")
async def local_edit_file(body: Dict[str, Any] = Body(...)):
    try:
        res = fs_engine.edit_file(
            body.get("workspace", "."), body.get("path", ""), body.get("target", ""), body.get("replacement", "")
        )
        return {"data": res, **res}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.delete("/local/files")
async def local_delete_file(workspace: str = Query("."), path: str = Query(...)):
    try:
        res = fs_engine.delete_file(workspace, path)
        return {"data": res, **res}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/local/terminal/exec")
async def local_terminal_exec(body: Dict[str, Any] = Body(...)):
    try:
        ws = body.get("workspace", ".")
        ws_dir = fs_engine.resolve_workspace_dir(ws)
        res = term_engine.run_command(
            ws_dir, ws, body.get("command") or body.get("command_line") or "", int(body.get("timeout_seconds", 30)), is_remote=False
        )
        return {"data": res, **res}
    except PermissionError as pe:
        raise HTTPException(status_code=403, detail=str(pe))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/local/terminal/processes")
async def local_list_processes(workspace: str = Query(".")):
    procs = term_engine.list_processes(workspace)
    return {"data": {"processes": procs}, "processes": procs}


@app.post("/local/terminal/processes")
async def local_start_process(body: Dict[str, Any] = Body(...)):
    try:
        ws = body.get("workspace", ".")
        ws_dir = fs_engine.resolve_workspace_dir(ws)
        res = term_engine.start_background_process(
            ws_dir, ws, body.get("command") or body.get("command_line") or "", body.get("label", ""), is_remote=False
        )
        return {"data": res, **res}
    except PermissionError as pe:
        raise HTTPException(status_code=403, detail=str(pe))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.delete("/local/terminal/processes/{proc_id}")
async def local_stop_process(proc_id: str):
    try:
        res = term_engine.stop_process(proc_id)
        return {"data": res, **res}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/local/git/status")
async def local_git_status(workspace: str = Query(".")):
    try:
        ws_dir = fs_engine.resolve_workspace_dir(workspace)
        res = get_git_status(term_engine, ws_dir, workspace)
        return {"data": res, **res}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.websocket("/local/terminal/ws")
async def local_interactive_pty_ws(websocket: WebSocket):
    """HU-26 / HU-38: Terminal PTY local real protegida por local_token."""
    token = websocket.query_params.get("local_token") or websocket.headers.get("X-Workstation-Token")
    if not _is_valid_local_token(token):
        await websocket.close(code=1008)
        return

    await websocket.accept()
    workspace = websocket.query_params.get("workspace") or "."
    requested_shell = (websocket.query_params.get("shell") or "").strip() or (
        None if cfg.default_shell == "auto" else cfg.default_shell
    )
    cols = int(websocket.query_params.get("cols") or 100)
    rows = int(websocket.query_params.get("rows") or 24)

    ws_dir = fs_engine.resolve_workspace_dir(workspace)
    sess = WorkstationPtySession(cwd=ws_dir, cols=cols, rows=rows, requested_shell=requested_shell)
    sess.start(asyncio.get_running_loop())

    await websocket.send_json(
        {
            "cmd": "terminal_ready",
            "workspace": workspace,
            "shell": sess.shell_name,
            "os": platform.system().lower(),
        }
    )

    async def pump_out():
        try:
            while True:
                ev = await sess.output_queue.get()
                await websocket.send_json(ev)
                if ev.get("cmd") == "pty_exit":
                    break
        except Exception:
            pass

    reader_task = asyncio.create_task(pump_out())
    try:
        while True:
            payload = await websocket.receive_json()
            cmd = payload.get("cmd")
            if cmd == "input":
                sess.write(payload.get("data") or "")
            elif cmd == "resize":
                sess.resize(int(payload.get("cols") or cols), int(payload.get("rows") or rows))
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        reader_task.cancel()
        sess.close()


# ---------------------------------------------------------------------------
# Gestión Adaptada de VS Code / VSCodium / InsanusCode (HU-39)
# ---------------------------------------------------------------------------
@app.get("/local/vscode/editors")
async def local_list_editors():
    return {
        "data": {
            "editors": vscode_mgr.detect_editors(),
            "preferred_editor": cfg.preferred_editor,
            "custom_editor_path": cfg.custom_editor_path,
            "extension_ready": (vscode_mgr.extension_dir / "package.json").exists(),
        }
    }


@app.post("/local/vscode/launch")
@app.post("/local/vscode/launch-desktop")
async def launch_desktop_editor(body: Dict[str, Any] = Body(default_factory=dict)):
    ws = body.get("workspace", ".")
    ws_dir = fs_engine.resolve_workspace_dir(ws)
    res = vscode_mgr.launch_editor(
        workspace_full_path=str(ws_dir),
        file_path=body.get("file_path") or None,
        line=body.get("line"),
        editor_id=body.get("editor_id") or None,
        attach_extension=bool(body.get("attach_extension", True)),
    )
    if res.get("ok"):
        bridge.log("info", f"Editor lanzado: {res.get('binary')} en {ws}")
    return {"data": res, **res}


@app.get("/local/vscode/extensions/installed")
async def local_list_extensions():
    exts = vscode_mgr.list_extensions()
    return {"data": {"extensions": exts}, "extensions": exts}


@app.post("/local/vscode/extensions/install")
async def local_install_extension(body: Dict[str, Any] = Body(...)):
    try:
        res = vscode_mgr.install_extension(body)
        return {"data": res, **res}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.delete("/local/vscode/extensions/{ext_id}")
async def local_uninstall_extension(ext_id: str):
    try:
        res = vscode_mgr.uninstall_extension(ext_id)
        return {"data": res, **res}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# ---------------------------------------------------------------------------
# Motor VS Code Real Embebido + Editor Vestido + Proxy /ide/{secret}/* (v1.5.0)
# ---------------------------------------------------------------------------
@app.get("/local/ide/status")
async def local_ide_status():
    st = ide_mgr.get_status()
    return {"data": st, **st}


@app.post("/local/ide/start")
async def local_ide_start(body: Dict[str, Any] = Body(default_factory=dict)):
    try:
        ws = str(body.get("workspace") or ".")
        ws_dir = fs_engine.resolve_workspace_dir(ws)
        st = await ide_mgr.ensure_started()
        from urllib.parse import quote

        folder_uri_path = ide_mgr.to_vscode_folder_uri_path(ws_dir)
        ide_url = (
            f"http://{cfg.bind_host}:{cfg.bind_port}/ide/{ide_mgr.session_secret}/"
            f"?folder={quote(folder_uri_path, safe='/:')}&insanus_embedded=1"
        )
        payload = {**st, "ide_url": ide_url, "folder_path": folder_uri_path, "workspace": ws}
        return {"data": payload, **payload}
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))


@app.post("/local/ide/stop")
async def local_ide_stop():
    ide_mgr.stop()
    st = ide_mgr.get_status()
    return {"data": st, **st}


@app.post("/local/ide/install-openvscode")
async def local_ide_install_openvscode():
    try:
        res = await ide_mgr.install_openvscode_server()
        return {"data": res, **res}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/local/ide/launch-dressed")
async def local_ide_launch_dressed(body: Dict[str, Any] = Body(default_factory=dict)):
    ws = str(body.get("workspace") or ".")
    ws_dir = fs_engine.resolve_workspace_dir(ws)
    res = ide_mgr.launch_dressed_desktop(
        workspace_full_path=str(ws_dir),
        file_path=body.get("file_path") or None,
        line=body.get("line"),
        editor_id=body.get("editor_id") or None,
        force_reinstall=bool(body.get("force_reinstall", False)),
    )
    if res.get("ok"):
        bridge.log("info", f"Editor Vestido lanzado en {ws} (Obsidian + insanuschat-harness)")
    return {"data": res, **res}


@app.post("/local/ide/reinstall-profile")
async def local_ide_reinstall_profile():
    ext_dir = ide_mgr.provision_dressed_desktop_profile(force_reinstall=True)
    ide_mgr.provision_embedded_server_profile()
    return {"ok": True, "extensions_dir": str(ext_dir), "bundled_extensions": ide_mgr.get_status()["bundled_extensions"]}


@app.get("/local/ide/bootstrap-context")
async def local_ide_bootstrap_context(folder: str = Query("")):
    return ide_mgr.resolve_workspace_for_folder(folder)


@app.post("/local/ide/diagnostics")
async def local_ide_push_diagnostics(body: Dict[str, Any] = Body(...)):
    rec = ide_mgr.update_diagnostics(body)
    return {"ok": True, "error_count": rec["error_count"], "warning_count": rec["warning_count"]}


@app.get("/local/ide/diagnostics")
async def local_ide_get_diagnostics(workspace: str = Query("."), path: Optional[str] = Query(None)):
    res = ide_mgr.get_diagnostics(workspace, path)
    return {"data": res, **res}


@app.post("/local/ide/open-file")
async def local_ide_open_file(body: Dict[str, Any] = Body(...)):
    ws = str(body.get("workspace") or ".")
    ide_mgr.enqueue_command(
        ws,
        {
            "action": "open_file",
            "path": str(body.get("path") or ""),
            "line": body.get("line"),
        },
    )
    return {"ok": True}


@app.get("/local/ide/commands/poll")
async def local_ide_poll_commands(workspace: str = Query(".")):
    return {"commands": ide_mgr.poll_commands(workspace)}


@app.api_route("/ide/{session_secret}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"])
async def local_ide_proxy_root(request: Request, session_secret: str):
    if not request.url.path.endswith("/"):
        qs = f"?{request.url.query}" if request.url.query else ""
        return RedirectResponse(url=f"/ide/{session_secret}/{qs}", status_code=307)
    return await ide_proxy.handle_local_http(request, session_secret, "")


@app.api_route(
    "/ide/{session_secret}/{subpath:path}",
    methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"],
)
async def local_ide_proxy_subpath(request: Request, session_secret: str, subpath: str):
    return await ide_proxy.handle_local_http(request, session_secret, subpath)


@app.websocket("/ide/{session_secret}/{subpath:path}")
async def local_ide_proxy_ws(websocket: WebSocket, session_secret: str, subpath: str):
    await ide_proxy.handle_local_ws(websocket, session_secret, subpath)


@app.websocket("/ide/{session_secret}")
async def local_ide_proxy_ws_root(websocket: WebSocket, session_secret: str):
    await ide_proxy.handle_local_ws(websocket, session_secret, "")


# ---------------------------------------------------------------------------
# Watchdog Anti-Zombie (HU-38): mata el daemon + IDE server si Tauri muere
# ---------------------------------------------------------------------------
def _start_parent_watchdog(watch_stdin: bool, parent_pid: Optional[int]) -> None:
    def _shutdown_now():
        try:
            ide_mgr.stop()
        except Exception:
            pass
        os._exit(0)

    if watch_stdin:
        def _stdin_monitor():
            try:
                while True:
                    chunk = sys.stdin.buffer.read(1)
                    if not chunk:
                        break
            except Exception:
                pass
            _shutdown_now()

        threading.Thread(target=_stdin_monitor, daemon=True).start()

    if parent_pid and parent_pid > 0:
        def _pid_monitor():
            is_win = platform.system().lower().startswith("win")
            while True:
                time.sleep(2.0)
                alive = True
                try:
                    if is_win:
                        import ctypes

                        PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
                        handle = ctypes.windll.kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, int(parent_pid))
                        if not handle:
                            alive = False
                        else:
                            code = ctypes.c_ulong()
                            ctypes.windll.kernel32.GetExitCodeProcess(handle, ctypes.byref(code))
                            ctypes.windll.kernel32.CloseHandle(handle)
                            if code.value != 259:  # STILL_ACTIVE
                                alive = False
                    else:
                        os.kill(int(parent_pid), 0)
                except Exception:
                    alive = False
                if not alive:
                    _shutdown_now()

        threading.Thread(target=_pid_monitor, daemon=True).start()


def main():
    # En Windows con PyInstaller --noconsole (runw.exe), sys.stdout/stderr pueden ser None
    if sys.stdout is None:
        sys.stdout = open(os.devnull, "w", encoding="utf-8")
    if sys.stderr is None:
        sys.stderr = open(os.devnull, "w", encoding="utf-8")

    parser = argparse.ArgumentParser(description="InsanusChat Workstation Local Sidecar Daemon")
    parser.add_argument("--port", type=int, default=cfg.bind_port)
    parser.add_argument("--host", type=str, default="127.0.0.1")
    parser.add_argument("--parent-pid", type=int, default=None)
    parser.add_argument("--watch-stdin", action="store_true")
    args = parser.parse_args()

    cfg.bind_port = args.port
    cfg.bind_host = args.host
    _start_parent_watchdog(args.watch_stdin, args.parent_pid)
    uvicorn.run(app, host=args.host, port=args.port, reload=False, log_config=None)


if __name__ == "__main__":
    main()
