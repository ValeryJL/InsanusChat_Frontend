"""
Gestor Multiplataforma (Windows + Linux) de VS Code / VSCodium / InsanusCode
y sincronización de Complementos Oficiales para InsanusChat Workstation (HU-30, HU-31, HU-39).
"""
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
from typing import Any, Dict, List, Optional

from config import get_config_dir

IS_WINDOWS = platform.system().lower().startswith("win")
IS_LINUX = platform.system().lower() == "linux"


def _resolve_extension_dir() -> Path:
    env_dir = os.environ.get("INSANUS_EXTENSION_DIR")
    if env_dir and Path(env_dir).exists():
        return Path(env_dir).resolve()
    # Soporte PyInstaller (_MEIPASS) o modo desarrollo directo
    meipass = getattr(__import__("sys"), "_MEIPASS", None)
    if meipass:
        cand = Path(meipass) / "vscode_extension" / "insanuschat-harness"
        if cand.exists():
            return cand
    return Path(__file__).resolve().parent.parent / "vscode_extension" / "insanuschat-harness"


class VSCodeManager:
    def __init__(
        self,
        preferred_editor: str = "auto",
        custom_editor_path: Optional[str] = None,
        sync_cli_extensions: bool = True,
    ):
        self.preferred_editor = preferred_editor or "auto"
        self.custom_editor_path = custom_editor_path
        self.sync_cli_extensions = sync_cli_extensions
        self.extension_dir = _resolve_extension_dir()
        self.extensions_state_file = get_config_dir() / "extensions.json"

    def detect_editors(self) -> List[Dict[str, Any]]:
        """HU-39: Detecta todos los editores compatibles con VS Code instalados en Windows o Linux."""
        found: List[Dict[str, Any]] = []
        seen_ids = set()

        def _add(ed_id: str, name: str, path: Optional[str], kind: str = "cli"):
            if not path or ed_id in seen_ids:
                return
            seen_ids.add(ed_id)
            found.append({"id": ed_id, "name": name, "path": path, "kind": kind})

        candidates = [
            ("insanus-code", "InsanusCode (Fork)", ["insanus-code"]),
            ("code", "Visual Studio Code", ["code"]),
            ("code-insiders", "VS Code Insiders", ["code-insiders"]),
            ("codium", "VSCodium", ["codium"]),
            ("cursor", "Cursor", ["cursor"]),
        ]
        for ed_id, name, bins in candidates:
            for b in bins:
                resolved = shutil.which(b)
                if resolved:
                    _add(ed_id, name, resolved, "cli")
                    break

        if IS_WINDOWS:
            local_app = Path(os.environ.get("LOCALAPPDATA") or (Path.home() / "AppData" / "Local"))
            prog_files = Path(os.environ.get("ProgramFiles") or r"C:\Program Files")
            win_extra = [
                ("code", "Visual Studio Code", local_app / "Programs" / "Microsoft VS Code" / "bin" / "code.cmd"),
                ("code", "Visual Studio Code", prog_files / "Microsoft VS Code" / "bin" / "code.cmd"),
                ("code-insiders", "VS Code Insiders", local_app / "Programs" / "Microsoft VS Code Insiders" / "bin" / "code-insiders.cmd"),
                ("codium", "VSCodium", local_app / "Programs" / "VSCodium" / "bin" / "codium.cmd"),
                ("cursor", "Cursor", local_app / "Programs" / "cursor" / "resources" / "app" / "bin" / "cursor.cmd"),
            ]
            for ed_id, name, cand_path in win_extra:
                if cand_path.exists():
                    _add(ed_id, name, str(cand_path), "cli")

        elif IS_LINUX:
            linux_extra = [
                ("code", "Visual Studio Code", Path("/usr/bin/code")),
                ("code", "Visual Studio Code", Path("/snap/bin/code")),
                ("codium", "VSCodium", Path("/usr/bin/codium")),
                ("code-insiders", "VS Code Insiders", Path("/usr/bin/code-insiders")),
            ]
            for ed_id, name, cand_path in linux_extra:
                if cand_path.exists():
                    _add(ed_id, name, str(cand_path), "cli")
            # Detección Flatpak en Linux
            flatpak = shutil.which("flatpak")
            if flatpak:
                try:
                    proc = subprocess.run(
                        [flatpak, "list", "--app", "--columns=application"],
                        capture_output=True,
                        text=True,
                        timeout=4,
                    )
                    apps = set((proc.stdout or "").splitlines())
                    if "com.visualstudio.code" in apps:
                        _add("code-flatpak", "VS Code (Flatpak)", "flatpak:com.visualstudio.code", "flatpak")
                    if "com.vscodium.codium" in apps:
                        _add("codium-flatpak", "VSCodium (Flatpak)", "flatpak:com.vscodium.codium", "flatpak")
                except Exception:
                    pass

        if self.custom_editor_path and Path(self.custom_editor_path).exists():
            _add("custom", "Editor Personalizado", self.custom_editor_path, "custom")

        return found

    def resolve_editor_command(self, requested_id: Optional[str] = None) -> Optional[List[str]]:
        target = (requested_id or self.preferred_editor or "auto").strip()
        if target == "custom" and self.custom_editor_path:
            return [self.custom_editor_path]

        editors = self.detect_editors()
        if target != "auto":
            for ed in editors:
                if ed["id"] == target:
                    if ed["kind"] == "flatpak":
                        app_id = ed["path"].split(":", 1)[1]
                        return ["flatpak", "run", app_id]
                    return [ed["path"]]

        if editors:
            ed = editors[0]
            if ed["kind"] == "flatpak":
                return ["flatpak", "run", ed["path"].split(":", 1)[1]]
            return [ed["path"]]
        return None

    async def check_status(self) -> Dict[str, Any]:
        editors = self.detect_editors()
        resolved = self.resolve_editor_command()
        return {
            "desktop_binary": " ".join(resolved) if resolved else None,
            "preferred_editor": self.preferred_editor,
            "detected_editors": editors,
            "extension_path": str(self.extension_dir),
            "extension_ready": (self.extension_dir / "package.json").exists(),
            "sync_cli_extensions": self.sync_cli_extensions,
            "installed_extensions_count": len(self.list_extensions()),
        }

    def launch_editor(
        self,
        workspace_full_path: str,
        file_path: Optional[str] = None,
        line: Optional[int] = None,
        editor_id: Optional[str] = None,
        attach_extension: bool = True,
    ) -> Dict[str, Any]:
        cmd = self.resolve_editor_command(editor_id)
        if not cmd:
            return {
                "ok": False,
                "message": "No se encontró VS Code, VSCodium ni InsanusCode instalado en este equipo. Podés usar el Workbench integrado o indicar una ruta manual en Configuración.",
            }

        args = list(cmd) + [workspace_full_path]
        if attach_extension and (self.extension_dir / "package.json").exists():
            args.append(f"--extensionDevelopmentPath={self.extension_dir}")

        if file_path:
            target_file = Path(file_path)
            if not target_file.is_absolute():
                target_file = (Path(workspace_full_path) / file_path).resolve()
            goto_arg = f"{target_file}:{int(line)}" if line else str(target_file)
            args.extend(["--goto", goto_arg])

        creationflags = 0
        if IS_WINDOWS:
            creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)

        subprocess.Popen(args, creationflags=creationflags)
        return {
            "ok": True,
            "binary": " ".join(cmd),
            "workspace": workspace_full_path,
            "file": file_path,
            "line": line,
        }

    def _load_extensions_manifest(self) -> List[Dict[str, Any]]:
        builtin = {
            "id": "insanustech.insanuschat-harness",
            "display_name": "InsanusChat Agent Harness",
            "publisher": "insanustech",
            "version": "1.4.0",
            "description": "Integración nativa de agentes IA, diffs, diagnósticos LSP y árbol 2D dentro del editor.",
            "icon_url": None,
            "builtin": True,
            "installed_at": "2026-11-22T12:00:00Z",
        }
        items: List[Dict[str, Any]] = []
        if self.extensions_state_file.exists():
            try:
                loaded = json.loads(self.extensions_state_file.read_text(encoding="utf-8"))
                if isinstance(loaded, list):
                    items = loaded
            except Exception:
                items = []
        if not any(i.get("id") == builtin["id"] for i in items):
            items.insert(0, builtin)
        return items

    def _save_extensions_manifest(self, items: List[Dict[str, Any]]) -> None:
        self.extensions_state_file.parent.mkdir(parents=True, exist_ok=True)
        self.extensions_state_file.write_text(
            json.dumps(items, indent=2, ensure_ascii=False), encoding="utf-8"
        )

    def list_extensions(self) -> List[Dict[str, Any]]:
        return self._load_extensions_manifest()

    def apply_synced_extensions(self, remote_extensions: List[Dict[str, Any]]) -> None:
        """HU-35: Sincroniza el manifiesto local con la lista autoritativa recibida desde InsanusChat_Backend."""
        if not remote_extensions:
            return
        local_items = self._load_extensions_manifest()
        local_ids = {i.get("id") for i in local_items}
        changed = False
        for ext in remote_extensions:
            eid = ext.get("id")
            if eid and eid not in local_ids:
                local_items.append(ext)
                local_ids.add(eid)
                changed = True
        if changed:
            self._save_extensions_manifest(local_items)

    def install_extension(self, ext_meta: Dict[str, Any]) -> Dict[str, Any]:
        ext_id = str(ext_meta.get("id") or "").strip()
        if not ext_id or not re.match(r"^[a-zA-Z0-9_\-]+\.[a-zA-Z0-9_\-\.]+$", ext_id):
            raise ValueError("ID de extensión inválido (formato esperado: publisher.extension)")

        cli_synced = False
        cli_output = ""
        cmd = self.resolve_editor_command() if self.sync_cli_extensions else None
        if cmd:
            try:
                proc = subprocess.run(
                    cmd + ["--install-extension", ext_id],
                    capture_output=True,
                    text=True,
                    timeout=60,
                )
                cli_synced = proc.returncode == 0
                cli_output = (proc.stdout or proc.stderr or "").strip()[:500]
            except Exception as exc:
                cli_output = str(exc)

        items = self._load_extensions_manifest()
        record = {
            "id": ext_id,
            "display_name": ext_meta.get("display_name") or ext_id.split(".", 1)[-1],
            "publisher": ext_meta.get("publisher") or ext_id.split(".", 1)[0],
            "version": ext_meta.get("version") or "latest",
            "description": ext_meta.get("description") or "",
            "icon_url": ext_meta.get("icon_url"),
            "marketplace_url": ext_meta.get("marketplace_url")
            or f"https://marketplace.visualstudio.com/items?itemName={ext_id}",
            "builtin": False,
            "cli_synced": cli_synced,
            "installed_at": datetime.now(timezone.utc).isoformat(),
        }
        items = [i for i in items if i.get("id") != ext_id]
        items.append(record)
        self._save_extensions_manifest(items)
        return {"ok": True, "extension": record, "cli_synced": cli_synced, "cli_output": cli_output}

    def uninstall_extension(self, ext_id: str) -> Dict[str, Any]:
        ext_id = str(ext_id or "").strip()
        if ext_id == "insanustech.insanuschat-harness":
            raise ValueError("La extensión integrada InsanusChat Agent Harness no puede desinstalarse.")

        cli_synced = False
        cmd = self.resolve_editor_command() if self.sync_cli_extensions else None
        if cmd:
            try:
                proc = subprocess.run(
                    cmd + ["--uninstall-extension", ext_id],
                    capture_output=True,
                    text=True,
                    timeout=30,
                )
                cli_synced = proc.returncode == 0
            except Exception:
                cli_synced = False

        items = [i for i in self._load_extensions_manifest() if i.get("id") != ext_id]
        self._save_extensions_manifest(items)
        return {"ok": True, "uninstalled": ext_id, "cli_synced": cli_synced}
