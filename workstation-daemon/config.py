"""
Configuración local y caché SSOT de InsanusChat Workstation Daemon (HU-24, HU-34, HU-37).
- Persiste la configuración en el directorio de usuario estándar del SO:
  * Windows: %APPDATA%\\InsanusChatWorkstation\\config.json
  * Linux:   $XDG_CONFIG_HOME/insanuschat-workstation/config.json (~/.config/insanuschat-workstation)
- Por defecto arranca en modo `🔒 Solo Local (expose_to_cloud=False)` escuchando solo en 127.0.0.1.
- Sincroniza políticas autoritativas (desired_policy + config_version) teniendo a InsanusChat_Backend
  como Fuente de Verdad 100% (SSOT).
"""
from dataclasses import asdict, dataclass, field
import json
import os
from pathlib import Path
import platform
from typing import Any, Dict, List, Optional
import uuid


def get_config_dir() -> Path:
    override = os.environ.get("INSANUS_WORKSTATION_CONFIG_DIR")
    if override:
        p = Path(override).expanduser().resolve()
        p.mkdir(parents=True, exist_ok=True)
        return p

    sys_name = platform.system().lower()
    if sys_name.startswith("win"):
        base = Path(os.environ.get("APPDATA") or (Path.home() / "AppData" / "Roaming"))
        cfg_dir = base / "InsanusChatWorkstation"
    elif sys_name == "darwin":
        cfg_dir = Path.home() / "Library" / "Application Support" / "InsanusChatWorkstation"
    else:
        xdg = os.environ.get("XDG_CONFIG_HOME")
        base = Path(xdg) if xdg else (Path.home() / ".config")
        cfg_dir = base / "insanuschat-workstation"

    cfg_dir.mkdir(parents=True, exist_ok=True)
    return cfg_dir


def get_config_file() -> Path:
    return get_config_dir() / "config.json"


def _detect_default_projects_dir() -> str:
    env_dir = os.environ.get("WORKSTATION_PROJECTS_DIR")
    if env_dir and os.path.exists(env_dir):
        return str(Path(env_dir).resolve())
    home = Path.home()
    for candidate in (home / "Proyectos", home / "Projects", home / "workspace", home / "Documents"):
        if candidate.exists() and candidate.is_dir():
            return str(candidate.resolve())
    return str(home.resolve())


@dataclass
class WorkstationConfig:
    node_id: str = field(default_factory=lambda: f"ws-{platform.node().lower() or 'pc'}-{uuid.uuid4().hex[:6]}")
    node_name: str = field(default_factory=lambda: os.environ.get("WORKSTATION_NAME") or f"PC-{platform.node() or 'Local'}")
    bind_host: str = "127.0.0.1"
    bind_port: int = field(default_factory=lambda: int(os.environ.get("INSANUS_BIND_PORT") or 8765))
    root_projects_dir: str = field(default_factory=_detect_default_projects_dir)

    # HU-24 / HU-34: Control Remoto & Privacidad (Aislado por defecto)
    expose_to_cloud: bool = False
    allow_remote_terminal: bool = True
    allow_remote_agent_tools: bool = True
    allowed_workspaces: Optional[List[str]] = None

    # HU-43: Políticas de Agente & Guardrails estilo Google Antigravity
    default_harness_mode: str = "ask"  # ask | auto_edit | autopilot
    terminal_auto_approve_patterns: List[str] = field(
        default_factory=lambda: ["git status", "git diff", "pytest", "npm test"]
    )
    terminal_blocked_patterns: List[str] = field(default_factory=list)
    default_shell: str = "auto"  # auto | powershell | pwsh | cmd | bash | zsh

    # HU-39: Integración adaptada de VS Code / VSCodium / InsanusCode
    preferred_editor: str = "auto"  # auto | insanus-code | code | codium | code-insiders | cursor | custom
    custom_editor_path: Optional[str] = None
    sync_cli_extensions: bool = True

    # Conexión Cloud & SSOT Sync
    cloud_backend_url: str = field(default_factory=lambda: os.environ.get("CLOUD_BACKEND_URL", "https://harnes.insanustech.com.ar"))
    cloud_jwt_token: Optional[str] = None
    config_version: int = 1
    app_version: str = "1.4.1"

    # Preferencias Desktop (Tauri)
    minimize_to_tray: bool = True
    launch_at_startup: bool = False

    def to_public_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["has_cloud_token"] = bool(self.cloud_jwt_token)
        d.pop("cloud_jwt_token", None)
        d["os"] = platform.system().lower()
        d["arch"] = platform.machine().lower() or "x86_64"
        d["shell"] = (
            self.default_shell
            if self.default_shell and self.default_shell != "auto"
            else ("powershell" if platform.system().lower().startswith("win") else "bash")
        )
        d["config_dir"] = str(get_config_dir())
        return d

    def to_policy_dict(self) -> Dict[str, Any]:
        return {
            "expose_to_cloud": self.expose_to_cloud,
            "allow_remote_terminal": self.allow_remote_terminal,
            "allow_remote_agent_tools": self.allow_remote_agent_tools,
            "default_harness_mode": self.default_harness_mode,
            "allowed_workspaces": self.allowed_workspaces,
            "terminal_auto_approve_patterns": list(self.terminal_auto_approve_patterns),
            "terminal_blocked_patterns": list(self.terminal_blocked_patterns),
            "preferred_editor": self.preferred_editor,
            "custom_editor_path": self.custom_editor_path,
            "sync_cli_extensions": self.sync_cli_extensions,
            "default_shell": self.default_shell,
            "config_version": self.config_version,
        }

    def apply_policy(self, policy: Dict[str, Any], allow_enable_remote: bool = True) -> None:
        if not isinstance(policy, dict):
            return
        if "expose_to_cloud" in policy:
            requested = bool(policy["expose_to_cloud"])
            if requested and not allow_enable_remote and not self.expose_to_cloud:
                # Seguridad física: no encender remotamente si ya estaba aislado
                pass
            else:
                self.expose_to_cloud = requested
        if "allow_remote_terminal" in policy:
            self.allow_remote_terminal = bool(policy["allow_remote_terminal"])
        if "allow_remote_agent_tools" in policy:
            self.allow_remote_agent_tools = bool(policy["allow_remote_agent_tools"])
        if "default_harness_mode" in policy and policy["default_harness_mode"] in ("ask", "auto_edit", "autopilot"):
            self.default_harness_mode = str(policy["default_harness_mode"])
        if "allowed_workspaces" in policy:
            aw = policy["allowed_workspaces"]
            self.allowed_workspaces = [str(x) for x in aw if str(x).strip()] if isinstance(aw, list) and len(aw) > 0 else None
        if "terminal_auto_approve_patterns" in policy and isinstance(policy["terminal_auto_approve_patterns"], list):
            self.terminal_auto_approve_patterns = [str(x).strip() for x in policy["terminal_auto_approve_patterns"] if str(x).strip()]
        if "terminal_blocked_patterns" in policy and isinstance(policy["terminal_blocked_patterns"], list):
            self.terminal_blocked_patterns = [str(x).strip() for x in policy["terminal_blocked_patterns"] if str(x).strip()]
        if "preferred_editor" in policy and policy["preferred_editor"]:
            self.preferred_editor = str(policy["preferred_editor"]).strip()
        if "custom_editor_path" in policy:
            cep = policy["custom_editor_path"]
            self.custom_editor_path = str(cep).strip() if cep else None
        if "sync_cli_extensions" in policy:
            self.sync_cli_extensions = bool(policy["sync_cli_extensions"])
        if "default_shell" in policy and policy["default_shell"]:
            self.default_shell = str(policy["default_shell"]).strip()
        if "config_version" in policy:
            try:
                self.config_version = max(self.config_version, int(policy["config_version"]))
            except Exception:
                pass

    def save(self) -> None:
        cfg_file = get_config_file()
        cfg_file.parent.mkdir(parents=True, exist_ok=True)
        cfg_file.write_text(json.dumps(asdict(self), indent=2, ensure_ascii=False), encoding="utf-8")

    @classmethod
    def load(cls) -> "WorkstationConfig":
        cfg_file = get_config_file()
        if cfg_file.exists():
            try:
                raw = json.loads(cfg_file.read_text(encoding="utf-8"))
                valid_keys = {f.name for f in cls.__dataclass_fields__.values()}
                filtered = {k: v for k, v in raw.items() if k in valid_keys}
                cfg = cls(**filtered)
                if os.environ.get("INSANUS_BIND_PORT"):
                    cfg.bind_port = int(os.environ["INSANUS_BIND_PORT"])
                return cfg
            except Exception:
                pass
        cfg = cls()
        cfg.save()
        return cfg
