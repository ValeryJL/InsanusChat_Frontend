"""
Gestor del Motor VS Code Real Embebido (`code serve-web` / OpenVSCode Server),
Perfil "Editor Vestido" (VS Code Desktop con tema Insanus Obsidian + Extensión Chat),
descubrimiento runtime.json, almacén de diagnósticos LSP y cola de comandos IDE (v1.5.0).
"""
import asyncio
from collections import deque
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import platform
import shutil
import socket
import subprocess
import sys
import tarfile
import time
from typing import Any, Deque, Dict, List, Optional
import zipfile

import httpx

from config import WorkstationConfig, get_config_dir

IS_WINDOWS = platform.system().lower().startswith("win")
IS_LINUX = platform.system().lower() == "linux"
EXT_BUNDLE_VERSION = "1.5.0"

OBSIDIAN_COLOR_CUSTOMIZATIONS: Dict[str, str] = {
    "editor.background": "#09090b",
    "sideBar.background": "#0e1017",
    "activityBar.background": "#0b0d12",
    "panel.background": "#09090b",
    "terminal.background": "#09090b",
    "statusBar.background": "#0e1017",
    "titleBar.activeBackground": "#0e1017",
    "editorGroupHeader.tabsBackground": "#0e1017",
    "tab.activeBackground": "#09090b",
    "tab.activeBorderTop": "#10b981",
    "tab.inactiveBackground": "#0e1017",
    "sideBar.border": "#ffffff12",
    "panel.border": "#ffffff12",
    "statusBar.border": "#ffffff12",
    "focusBorder": "#10b98180",
}


def _resolve_extensions_root() -> Path:
    env_dir = os.environ.get("INSANUS_EXTENSION_DIR")
    if env_dir:
        p = Path(env_dir).resolve()
        if p.name == "insanuschat-harness" and p.parent.exists():
            return p.parent
        if p.exists():
            return p
    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        cand = Path(meipass) / "vscode_extension"
        if cand.exists():
            return cand
    return Path(__file__).resolve().parent.parent / "vscode_extension"


def _pick_free_port(start: int = 19100, span: int = 80) -> int:
    for port in range(start, start + span):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            try:
                sock.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _kill_process_tree(proc: Optional[subprocess.Popen]) -> None:
    if proc is None:
        return
    try:
        if proc.poll() is not None:
            return
        if IS_WINDOWS:
            subprocess.run(
                ["taskkill", "/F", "/T", "/PID", str(proc.pid)],
                capture_output=True,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                timeout=5,
            )
        else:
            import signal

            try:
                os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
            except Exception:
                proc.terminate()
            try:
                proc.wait(timeout=3)
            except Exception:
                proc.kill()
    except Exception:
        try:
            proc.kill()
        except Exception:
            pass


class InsanusIDEServerManager:
    """Gestiona el ciclo de vida del motor VS Code real, perfil Obsidian, OpenVSCode fallback y bridge RPC."""

    def __init__(self, cfg: WorkstationConfig, vscode_mgr: Any, fs_engine: Any):
        self.cfg = cfg
        self.vscode_mgr = vscode_mgr
        self.fs_engine = fs_engine

        self.config_dir = get_config_dir()
        self.extensions_src_root = _resolve_extensions_root()
        self.server_data_dir = self.config_dir / "ide-server-data"
        self.dressed_user_data_dir = self.config_dir / "vscode-dressed-profile"
        self.dressed_isolated_ext_dir = self.config_dir / "vscode-dressed-extensions"
        self.openvscode_dir = self.config_dir / "ide-runtime" / "openvscode-server"

        self._proc: Optional[subprocess.Popen] = None
        self._port: Optional[int] = None
        self._engine: Optional[str] = None
        self._started_at: Optional[str] = None
        self._last_error: Optional[str] = None
        self._start_lock = asyncio.Lock()
        self.session_secret: str = os.urandom(12).hex()

        # Progreso de descarga bajo demanda de OpenVSCode Server
        self.openvscode_install_state: Dict[str, Any] = {
            "status": "idle",  # idle | downloading | extracting | ready | error
            "progress": 0,
            "message": "",
            "version": None,
        }

        # Almacén en memoria de diagnósticos LSP reportados por insanuschat-harness
        self._diagnostics_by_workspace: Dict[str, Dict[str, Any]] = {}
        # Cola de comandos salientes hacia la extensión (open_file, focus_chat, switch_chat)
        self._command_queues: Dict[str, Deque[Dict[str, Any]]] = {}

    # ------------------------------------------------------------------
    # Descubrimiento runtime.json (para que extension.js encuentre el daemon)
    # ------------------------------------------------------------------
    def write_runtime_file(self, local_token: str) -> Path:
        rt_path = self.config_dir / "runtime.json"
        payload = {
            "daemon_url": f"http://{self.cfg.bind_host}:{self.cfg.bind_port}",
            "local_token": local_token or "",
            "node_id": self.cfg.node_id,
            "node_name": self.cfg.node_name,
            "cloud_backend_url": self.cfg.cloud_backend_url,
            "pid": os.getpid(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        rt_path.parent.mkdir(parents=True, exist_ok=True)
        rt_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
        if not IS_WINDOWS:
            try:
                os.chmod(rt_path, 0o600)
            except Exception:
                pass
        return rt_path

    # ------------------------------------------------------------------
    # Detección de motores: `code serve-web` vs OpenVSCode Server
    # ------------------------------------------------------------------
    def _find_vscode_cli_for_serve_web(self) -> Optional[str]:
        editors = self.vscode_mgr.detect_editors()
        for ed in editors:
            if ed.get("id") in ("code", "code-insiders") and ed.get("kind") != "flatpak":
                return ed.get("path")
        return shutil.which("code") or shutil.which("code-insiders")

    def _find_openvscode_binary(self) -> Optional[Path]:
        if not self.openvscode_dir.exists():
            return None
        bin_name = "openvscode-server.cmd" if IS_WINDOWS else "openvscode-server"
        direct = self.openvscode_dir / "bin" / bin_name
        if direct.exists():
            return direct
        # Buscar un nivel anidado (tras descomprimir carpeta raíz del archive)
        for child in self.openvscode_dir.iterdir():
            if child.is_dir():
                cand = child / "bin" / bin_name
                if cand.exists():
                    return cand
        return None

    def is_running(self) -> bool:
        return bool(self._proc is not None and self._proc.poll() is None and self._port is not None)

    def get_upstream_base_url(self) -> Optional[str]:
        if not self.is_running() or not self._port:
            return None
        return f"http://127.0.0.1:{self._port}"

    # ------------------------------------------------------------------
    # Aprovisionamiento de tema Insanus Obsidian + extensión Chat real
    # ------------------------------------------------------------------
    def _bundled_extension_dirs(self) -> List[Path]:
        found: List[Path] = []
        for folder_name in ("insanus-obsidian-theme", "insanuschat-harness"):
            cand = self.extensions_src_root / folder_name
            if (cand / "package.json").exists():
                found.append(cand)
        return found

    def _bundled_vsix_files(self) -> List[Path]:
        dist_dir = self.extensions_src_root / "dist"
        if not dist_dir.exists():
            return []
        return sorted(dist_dir.glob("insanustech.*.vsix"))

    def _sync_unpacked_extensions(self, target_ext_dir: Path) -> None:
        """Instala/actualiza ambas extensiones en un directorio `extensions/` de VS Code Server."""
        target_ext_dir.mkdir(parents=True, exist_ok=True)
        marker = target_ext_dir / ".insanus-bundled-version"
        bundled_dirs = self._bundled_extension_dirs()
        if not bundled_dirs:
            return

        need_sync = True
        if marker.exists() and marker.read_text(encoding="utf-8").strip() == EXT_BUNDLE_VERSION:
            # Verificar que ambas carpetas existan
            all_present = True
            for src in bundled_dirs:
                pkg = json.loads((src / "package.json").read_text(encoding="utf-8"))
                dst = target_ext_dir / f"{pkg['publisher']}.{pkg['name']}-{pkg['version']}"
                if not (dst / "package.json").exists():
                    all_present = False
                    break
            if all_present:
                need_sync = False

        if not need_sync:
            return

        # Limpiar versiones anteriores de insanustech.* y copiar nuevas
        for existing in list(target_ext_dir.iterdir()):
            if existing.is_dir() and existing.name.lower().startswith("insanustech."):
                shutil.rmtree(existing, ignore_errors=True)

        installed_entries: List[Dict[str, Any]] = []
        for src in bundled_dirs:
            pkg = json.loads((src / "package.json").read_text(encoding="utf-8"))
            folder_id = f"{pkg['publisher']}.{pkg['name']}-{pkg['version']}"
            dst = (target_ext_dir / folder_id).resolve()
            shutil.copytree(src, dst)
            posix_path = dst.as_posix()
            if IS_WINDOWS and len(posix_path) >= 2 and posix_path[1] == ":":
                uri_path = "/" + posix_path[0].lower() + posix_path[1:]
                ext_uri = f"file:///{posix_path[0].lower()}%3A{posix_path[2:]}"
                loc_obj: Dict[str, Any] = {
                    "$mid": 1,
                    "fsPath": str(dst),
                    "_sep": 1,
                    "external": ext_uri,
                    "path": uri_path,
                    "scheme": "file",
                }
            else:
                loc_obj = {
                    "$mid": 1,
                    "fsPath": str(dst),
                    "external": f"file://{posix_path}",
                    "path": posix_path,
                    "scheme": "file",
                }
            installed_entries.append(
                {
                    "identifier": {"id": f"{pkg['publisher']}.{pkg['name']}"},
                    "version": pkg["version"],
                    "location": loc_obj,
                    "relativeLocation": folder_id,
                }
            )

        # Actualizar extensions.json si existe para evitar caché obsoleta
        ext_json = target_ext_dir / "extensions.json"
        if ext_json.exists():
            try:
                current = json.loads(ext_json.read_text(encoding="utf-8"))
                if isinstance(current, list):
                    filtered = [
                        e
                        for e in current
                        if not str((e.get("identifier") or {}).get("id", "")).lower().startswith("insanustech.")
                    ]
                    filtered.extend(installed_entries)
                    ext_json.write_text(json.dumps(filtered, indent=2), encoding="utf-8")
            except Exception:
                pass

        marker.write_text(EXT_BUNDLE_VERSION, encoding="utf-8")

    def _build_obsidian_settings(self, embedded: bool = False) -> Dict[str, Any]:
        settings: Dict[str, Any] = {
            "workbench.colorTheme": "Insanus Obsidian",
            "workbench.preferredDarkColorTheme": "Insanus Obsidian",
            "workbench.preferredLightColorTheme": "Insanus Obsidian",
            "window.autoDetectColorScheme": False,
            "workbench.colorCustomizations": OBSIDIAN_COLOR_CUSTOMIZATIONS,
            "workbench.startupEditor": "none",
            "workbench.tips.enabled": False,
            "workbench.welcomePage.walkthroughs.openOnInstall": False,
            "editor.fontFamily": "'JetBrains Mono', 'Cascadia Code', Consolas, monospace",
            "editor.fontSize": 13,
            "editor.lineHeight": 20,
            "editor.minimap.enabled": False,
            "editor.cursorBlinking": "smooth",
            "editor.smoothScrolling": True,
            "editor.bracketPairColorization.enabled": True,
            "terminal.integrated.fontFamily": "'JetBrains Mono', Consolas, monospace",
            "telemetry.telemetryLevel": "off",
            "security.workspace.trust.enabled": False,
            "window.commandCenter": False,
            "insanuschat.localDaemonUrl": f"http://{self.cfg.bind_host}:{self.cfg.bind_port}",
            "insanuschat.webAppUrl": self.cfg.cloud_backend_url,
            "insanuschat.autoFocusSidebar": not embedded,
        }
        if embedded:
            settings["window.menuBarVisibility"] = "compact"
            settings["workbench.layoutControl.enabled"] = False
            settings["workbench.activityBar.location"] = "side"
            settings["workbench.secondarySideBar.defaultVisibility"] = "hidden"
            settings["chat.disableAIFeatures"] = True
            settings["chat.commandCenter.enabled"] = False
        else:
            settings["window.title"] = "insanus-harnes — ${activeEditorShort}${separator}${rootName}"
            settings["chat.disableAIFeatures"] = True
            settings["chat.commandCenter.enabled"] = False
        return settings

    @staticmethod
    def to_vscode_folder_uri_path(ws_dir: Path) -> str:
        """Convierte una ruta Windows/Linux a path URI POSIX con `/` inicial exigido por `code serve-web` (?folder=)."""
        posix = Path(ws_dir).resolve().as_posix()
        return posix if posix.startswith("/") else f"/{posix}"

    def _merge_settings_file(self, path: Path, defaults: Dict[str, Any]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        existing: Dict[str, Any] = {}
        if path.exists():
            try:
                loaded = json.loads(path.read_text(encoding="utf-8"))
                if isinstance(loaded, dict):
                    existing = loaded
            except Exception:
                existing = {}
        # Siempre mantener sincronizados tema/URLs base sin pisar ajustes personalizados de otros lenguajes
        merged = dict(existing)
        for key, val in defaults.items():
            if key in (
                "workbench.colorTheme",
                "workbench.preferredDarkColorTheme",
                "workbench.preferredLightColorTheme",
                "window.autoDetectColorScheme",
                "workbench.colorCustomizations",
                "workbench.secondarySideBar.defaultVisibility",
                "chat.disableAIFeatures",
                "chat.commandCenter.enabled",
                "security.workspace.trust.enabled",
                "insanuschat.localDaemonUrl",
                "insanuschat.webAppUrl",
                "insanuschat.autoFocusSidebar",
                "window.title",
            ) or key not in merged:
                merged[key] = val
        path.write_text(json.dumps(merged, indent=2, ensure_ascii=False), encoding="utf-8")

    def provision_embedded_server_profile(self) -> None:
        self.server_data_dir.mkdir(parents=True, exist_ok=True)
        settings = self._build_obsidian_settings(embedded=True)
        self._merge_settings_file(self.server_data_dir / "data" / "Machine" / "settings.json", settings)
        self._merge_settings_file(self.server_data_dir / "data" / "User" / "settings.json", settings)
        self._sync_unpacked_extensions(self.server_data_dir / "extensions")

    def provision_dressed_desktop_profile(self, force_reinstall: bool = False) -> Path:
        self.dressed_user_data_dir.mkdir(parents=True, exist_ok=True)
        settings = self._build_obsidian_settings(embedded=False)
        self._merge_settings_file(self.dressed_user_data_dir / "User" / "settings.json", settings)

        ext_dir = (
            (Path.home() / ".vscode" / "extensions")
            if self.cfg.dressed_share_user_extensions
            else self.dressed_isolated_ext_dir
        )
        if force_reinstall:
            marker = ext_dir / ".insanus-bundled-version"
            if marker.exists():
                marker.unlink(missing_ok=True)
        self._sync_unpacked_extensions(ext_dir)
        return ext_dir

    # ------------------------------------------------------------------
    # Arranque / Parada del Servidor VS Code Real
    # ------------------------------------------------------------------
    async def ensure_started(self) -> Dict[str, Any]:
        async with self._start_lock:
            if self.is_running():
                return self.get_status()

            self.provision_embedded_server_profile()

            preferred = (self.cfg.ide_engine or "auto").lower()
            cmd: Optional[List[str]] = None
            engine_name: Optional[str] = None
            port = _pick_free_port(19100)

            vscode_cli = self._find_vscode_cli_for_serve_web()
            openvscode_bin = self._find_openvscode_binary()

            base_path = f"/ide/{self.session_secret}"
            if preferred in ("auto", "vscode") and vscode_cli:
                engine_name = "vscode-serve-web"
                cmd = [
                    vscode_cli,
                    "serve-web",
                    "--host",
                    "127.0.0.1",
                    "--port",
                    str(port),
                    "--without-connection-token",
                    "--accept-server-license-terms",
                    "--server-base-path",
                    base_path,
                    "--server-data-dir",
                    str(self.server_data_dir),
                    "--disable-telemetry",
                ]
            elif preferred in ("auto", "openvscode") and openvscode_bin:
                engine_name = "openvscode-server"
                cmd = [
                    str(openvscode_bin),
                    "--host",
                    "127.0.0.1",
                    "--port",
                    str(port),
                    "--without-connection-token",
                    "--server-base-path",
                    base_path,
                    "--server-data-dir",
                    str(self.server_data_dir),
                    "--telemetry-level",
                    "off",
                ]
            elif preferred == "vscode" and not vscode_cli:
                self._last_error = "VS Code no está instalado en este equipo. Cambiá el motor a OpenVSCode Server o Automático."
                raise RuntimeError(self._last_error)
            else:
                self._last_error = "No hay motor VS Code disponible. Instalá OpenVSCode Server en 1 clic o instalá VS Code."
                raise RuntimeError(self._last_error)

            popen_kwargs: Dict[str, Any] = {
                "stdout": subprocess.DEVNULL,
                "stderr": subprocess.DEVNULL,
                "stdin": subprocess.DEVNULL,
            }
            if IS_WINDOWS:
                popen_kwargs["creationflags"] = getattr(subprocess, "CREATE_NO_WINDOW", 0)
            else:
                popen_kwargs["start_new_session"] = True

            self._proc = subprocess.Popen(cmd, **popen_kwargs)
            self._port = port
            self._engine = engine_name
            self._last_error = None

            # Esperar a que el servidor acepte conexiones TCP y devuelva HTTP 200 OK real (evita recarga en frío)
            ready = False
            deadline = time.monotonic() + 35.0
            probe_url = f"http://127.0.0.1:{port}{base_path}/"
            async with httpx.AsyncClient(timeout=httpx.Timeout(3.0, connect=1.0), follow_redirects=False) as probe_client:
                while time.monotonic() < deadline:
                    if self._proc.poll() is not None:
                        self._last_error = f"El motor {engine_name} terminó prematuramente (exit={self._proc.returncode})"
                        self._proc = None
                        self._port = None
                        raise RuntimeError(self._last_error)
                    try:
                        r = await probe_client.get(
                            probe_url,
                            headers={"Accept-Language": "en-US,en;q=0.9"},
                        )
                        if r.status_code == 200:
                            ready = True
                            break
                    except Exception:
                        pass
                    await asyncio.sleep(0.35)

            if not ready:
                self.stop()
                self._last_error = f"Tiempo de espera agotado iniciando {engine_name} en puerto {port}"
                raise RuntimeError(self._last_error)

            self._started_at = datetime.now(timezone.utc).isoformat()
            return self.get_status()

    def stop(self) -> None:
        _kill_process_tree(self._proc)
        self._proc = None
        self._port = None
        self._engine = None
        self._started_at = None

    # ------------------------------------------------------------------
    # Descarga bajo demanda de OpenVSCode Server (Windows & Linux)
    # ------------------------------------------------------------------
    async def install_openvscode_server(self) -> Dict[str, Any]:
        if self.openvscode_install_state.get("status") in ("downloading", "extracting"):
            return self.openvscode_install_state

        self.openvscode_install_state = {
            "status": "downloading",
            "progress": 5,
            "message": "Consultando último release de OpenVSCode Server...",
            "version": None,
        }
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=20.0), follow_redirects=True) as client:
                rel_resp = await client.get(
                    "https://api.github.com/repos/gitpod-io/openvscode-server/releases/latest",
                    headers={"Accept": "application/vnd.github+json", "User-Agent": "insanus-harnes"},
                )
                rel_resp.raise_for_status()
                rel = rel_resp.json()
                tag = rel.get("tag_name", "latest")
                assets = rel.get("assets") or []

                machine = platform.machine().lower()
                arch = "arm64" if machine in ("arm64", "aarch64") else "x64"
                wanted_suffix = f"win32-{arch}.zip" if IS_WINDOWS else f"linux-{arch}.tar.gz"
                asset = next(
                    (a for a in assets if str(a.get("name", "")).lower().endswith(wanted_suffix)),
                    None,
                )
                if not asset:
                    raise RuntimeError(f"No se encontró paquete OpenVSCode Server para {wanted_suffix}")

                download_url = asset["browser_download_url"]
                tmp_archive = self.config_dir / "ide-runtime" / asset["name"]
                tmp_archive.parent.mkdir(parents=True, exist_ok=True)

                self.openvscode_install_state.update(
                    {
                        "progress": 10,
                        "version": tag,
                        "message": f"Descargando {asset['name']}...",
                    }
                )

                async with client.stream("GET", download_url) as stream:
                    stream.raise_for_status()
                    total = int(stream.headers.get("content-length") or 0)
                    done = 0
                    with open(tmp_archive, "wb") as fh:
                        async for chunk in stream.aiter_bytes(chunk_size=131072):
                            fh.write(chunk)
                            done += len(chunk)
                            if total > 0:
                                pct = min(85, 10 + int((done / total) * 75))
                                self.openvscode_install_state["progress"] = pct

            self.openvscode_install_state.update(
                {"status": "extracting", "progress": 88, "message": "Descomprimiendo OpenVSCode Server..."}
            )

            def _extract():
                if self.openvscode_dir.exists():
                    shutil.rmtree(self.openvscode_dir, ignore_errors=True)
                self.openvscode_dir.mkdir(parents=True, exist_ok=True)
                if str(tmp_archive).endswith(".zip"):
                    with zipfile.ZipFile(tmp_archive, "r") as zf:
                        zf.extractall(self.openvscode_dir)
                else:
                    with tarfile.open(tmp_archive, "r:gz") as tf:
                        tf.extractall(self.openvscode_dir)
                tmp_archive.unlink(missing_ok=True)

            await asyncio.to_thread(_extract)

            self.openvscode_install_state = {
                "status": "ready",
                "progress": 100,
                "message": f"OpenVSCode Server {tag} instalado correctamente.",
                "version": tag,
            }
            return self.openvscode_install_state
        except Exception as exc:
            self.openvscode_install_state = {
                "status": "error",
                "progress": 0,
                "message": str(exc),
                "version": None,
            }
            raise

    # ------------------------------------------------------------------
    # Lanzador "Editor Vestido" (VS Code Desktop con tema Obsidian + Chat)
    # ------------------------------------------------------------------
    def launch_dressed_desktop(
        self,
        workspace_full_path: str,
        file_path: Optional[str] = None,
        line: Optional[int] = None,
        editor_id: Optional[str] = None,
        force_reinstall: bool = False,
    ) -> Dict[str, Any]:
        cmd = self.vscode_mgr.resolve_editor_command(editor_id)
        if not cmd:
            return {
                "ok": False,
                "message": "No se encontró Visual Studio Code / VSCodium instalado en este equipo.",
            }

        ext_dir = self.provision_dressed_desktop_profile(force_reinstall=force_reinstall)
        args = list(cmd) + [
            "--user-data-dir",
            str(self.dressed_user_data_dir),
            "--extensions-dir",
            str(ext_dir),
            workspace_full_path,
        ]

        if file_path:
            target = Path(file_path)
            if not target.is_absolute():
                target = (Path(workspace_full_path) / file_path).resolve()
            goto_arg = f"{target}:{int(line)}" if line else str(target)
            args.extend(["--goto", goto_arg])

        creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0) if IS_WINDOWS else 0
        subprocess.Popen(args, creationflags=creationflags)
        return {
            "ok": True,
            "mode": "dressed_desktop",
            "binary": " ".join(cmd),
            "workspace": workspace_full_path,
            "user_data_dir": str(self.dressed_user_data_dir),
            "extensions_dir": str(ext_dir),
            "file": file_path,
            "line": line,
        }

    # ------------------------------------------------------------------
    # Bootstrap de contexto para la extensión + LSP Diagnostics + Command Queue
    # ------------------------------------------------------------------
    def resolve_workspace_for_folder(self, folder_path: str) -> Dict[str, Any]:
        root = Path(self.cfg.root_projects_dir).resolve()
        ws_rel = "."
        ws_name = root.name
        if folder_path:
            try:
                cand = Path(folder_path).resolve()
                ws_name = cand.name or ws_name
                if cand == root:
                    ws_rel = "."
                elif str(cand).lower().startswith(str(root).lower() + os.sep):
                    rel = cand.relative_to(root).as_posix()
                    # Si abrió una subcarpeta dentro de un workspace hijo, usar el workspace top-level
                    ws_rel = rel.split("/")[0] if "/" in rel else rel
                else:
                    ws_rel = cand.name
            except Exception:
                pass
        return {
            "workspace_path": ws_rel,
            "workspace_name": ws_name,
            "folder_path": folder_path,
            "node_id": self.cfg.node_id,
            "node_name": self.cfg.node_name,
            "cloud_backend_url": self.cfg.cloud_backend_url,
            "access_token": self.cfg.cloud_jwt_token,
        }

    def update_diagnostics(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        ws = str(payload.get("workspace_path") or ".").strip() or "."
        record = {
            "workspace_path": ws,
            "folder": payload.get("folder") or "",
            "active_file": payload.get("active_file"),
            "error_count": int(payload.get("error_count") or 0),
            "warning_count": int(payload.get("warning_count") or 0),
            "diagnostics": payload.get("diagnostics") or [],
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        self._diagnostics_by_workspace[ws] = record
        return record

    def get_diagnostics(self, workspace: str = ".", file_filter: Optional[str] = None) -> Dict[str, Any]:
        ws = (workspace or ".").strip() or "."
        rec = self._diagnostics_by_workspace.get(ws)
        if not rec and self._diagnostics_by_workspace:
            # Fallback al último workspace con diagnósticos reportados
            rec = next(iter(self._diagnostics_by_workspace.values()))
        if not rec:
            return {
                "workspace_path": ws,
                "active_file": None,
                "error_count": 0,
                "warning_count": 0,
                "diagnostics": [],
                "note": "No hay diagnósticos LSP reportados todavía (abrí el proyecto en VS Code Real o Editor Vestido).",
            }
        items = list(rec.get("diagnostics") or [])
        if file_filter:
            low = file_filter.lower().replace("\\", "/")
            items = [d for d in items if low in str(d.get("file", "")).lower().replace("\\", "/")]
        return {
            "workspace_path": rec["workspace_path"],
            "active_file": rec.get("active_file"),
            "error_count": sum(1 for d in items if d.get("severity") == "error"),
            "warning_count": sum(1 for d in items if d.get("severity") == "warning"),
            "diagnostics": items[:80],
            "updated_at": rec.get("updated_at"),
        }

    def enqueue_command(self, workspace: str, command: Dict[str, Any]) -> None:
        ws = (workspace or ".").strip() or "."
        q = self._command_queues.setdefault(ws, deque(maxlen=50))
        q.append(command)

    def poll_commands(self, workspace: str = ".") -> List[Dict[str, Any]]:
        ws = (workspace or ".").strip() or "."
        q = self._command_queues.get(ws)
        if not q:
            return []
        out = list(q)
        q.clear()
        return out

    def get_status(self) -> Dict[str, Any]:
        vscode_cli = self._find_vscode_cli_for_serve_web()
        openvscode_bin = self._find_openvscode_binary()
        return {
            "running": self.is_running(),
            "engine": self._engine,
            "port": self._port,
            "pid": self._proc.pid if self.is_running() and self._proc else None,
            "started_at": self._started_at,
            "last_error": self._last_error,
            "configured_engine": self.cfg.ide_engine,
            "vscode_cli_available": bool(vscode_cli),
            "vscode_cli_path": vscode_cli,
            "openvscode_installed": bool(openvscode_bin),
            "openvscode_install": self.openvscode_install_state,
            "dressed_share_user_extensions": self.cfg.dressed_share_user_extensions,
            "bundled_extensions": [p.name for p in self._bundled_extension_dirs()],
            "bundled_vsix": [p.name for p in self._bundled_vsix_files()],
            "session_secret": self.session_secret,
            "base_path": f"/ide/{self.session_secret}",
        }
