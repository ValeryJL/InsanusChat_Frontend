"""
Motor Seguro de Terminal Remota y Local + Guardrails personalizables (Allowlist/Denylist estilo Antigravity)
+ Gestor de Procesos en Background (HU-26, HU-40).
"""
from datetime import datetime
from pathlib import Path
import platform
import re
import subprocess
import time
from typing import Any, Dict, List, Optional
import uuid

BLOCKED_PATTERNS = [
    r"\brm\s+-rf\s+/\s*$",
    r"\brm\s+-rf\s+/\*",
    r"\bformat\s+[a-zA-Z]:",
    r"\bmkfs\.",
    r"\bshutdown\b",
    r"\breboot\b",
    r":\(\)\{\s*:\|:&\s*\};:",
]


def validate_safe_command(command_line: str, extra_blocked: Optional[List[str]] = None) -> None:
    cmd = (command_line or "").strip()
    if not cmd:
        raise ValueError("El comando no puede estar vacío")
    for pat in BLOCKED_PATTERNS:
        if re.search(pat, cmd, re.IGNORECASE):
            raise PermissionError(f"Comando bloqueado por Guardrail de Terminal Segura: '{cmd}'")
    for custom in extra_blocked or []:
        c = (custom or "").strip()
        if not c:
            continue
        try:
            if re.search(c, cmd, re.IGNORECASE):
                raise PermissionError(f"Comando bloqueado por regla Denylist de usuario ('{c}'): '{cmd}'")
        except re.error:
            if c.lower() in cmd.lower():
                raise PermissionError(f"Comando bloqueado por regla Denylist de usuario ('{c}'): '{cmd}'")


class WorkstationTerminal:
    def __init__(self, allow_remote_terminal: bool = True, custom_blocked_patterns: Optional[List[str]] = None):
        self.allow_remote_terminal = allow_remote_terminal
        self.custom_blocked_patterns: List[str] = list(custom_blocked_patterns or [])
        self.processes: Dict[str, Dict[str, Any]] = {}

    def run_command(
        self,
        ws_dir: Path,
        workspace_name: str,
        command_line: str,
        timeout_seconds: int = 30,
        is_remote: bool = False,
    ) -> Dict[str, Any]:
        if is_remote and not self.allow_remote_terminal:
            raise PermissionError("La ejecución de terminal remota está deshabilitada en este equipo.")
        validate_safe_command(command_line, self.custom_blocked_patterns)
        start = time.perf_counter()
        try:
            proc = subprocess.run(
                command_line,
                cwd=str(ws_dir),
                shell=True,
                capture_output=True,
                text=True,
                timeout=max(1, min(120, int(timeout_seconds))),
            )
            ms = round((time.perf_counter() - start) * 1000, 1)
            return {
                "command": command_line,
                "cwd": str(ws_dir),
                "workspace": workspace_name,
                "hostname": platform.node(),
                "os": platform.system().lower(),
                "exit_code": proc.returncode,
                "stdout": (proc.stdout or "")[-8000:],
                "stderr": (proc.stderr or "")[-4000:],
                "duration_ms": ms,
                "ok": proc.returncode == 0,
            }
        except subprocess.TimeoutExpired as te:
            ms = round((time.perf_counter() - start) * 1000, 1)
            return {
                "command": command_line,
                "cwd": str(ws_dir),
                "workspace": workspace_name,
                "hostname": platform.node(),
                "os": platform.system().lower(),
                "exit_code": -1,
                "stdout": (te.stdout or "")[-4000:] if isinstance(te.stdout, str) else "",
                "stderr": f"Command timed out after {timeout_seconds}s",
                "duration_ms": ms,
                "ok": False,
            }

    def start_background_process(
        self,
        ws_dir: Path,
        workspace_name: str,
        command_line: str,
        label: str = "",
        is_remote: bool = False,
    ) -> Dict[str, Any]:
        if is_remote and not self.allow_remote_terminal:
            raise PermissionError("La ejecución de procesos remotos está deshabilitada en este equipo.")
        validate_safe_command(command_line, self.custom_blocked_patterns)
        proc_id = f"proc-{uuid.uuid4().hex[:8]}"
        proc = subprocess.Popen(
            command_line,
            cwd=str(ws_dir),
            shell=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )
        self.processes[proc_id] = {
            "proc_id": proc_id,
            "pid": proc.pid,
            "workspace": workspace_name,
            "cwd": str(ws_dir),
            "command": command_line,
            "label": label or command_line[:40],
            "started_at": datetime.utcnow().isoformat(),
            "process": proc,
        }
        return self._serialize(proc_id)

    def _serialize(self, proc_id: str) -> Dict[str, Any]:
        info = self.processes[proc_id]
        code = info["process"].poll()
        return {
            "proc_id": proc_id,
            "pid": info["pid"],
            "workspace": info["workspace"],
            "cwd": info["cwd"],
            "command": info["command"],
            "label": info["label"],
            "started_at": info["started_at"],
            "running": code is None,
            "exit_code": code,
        }

    def list_processes(self, workspace_name: Optional[str] = None) -> List[Dict[str, Any]]:
        out: List[Dict[str, Any]] = []
        for pid, info in list(self.processes.items()):
            if workspace_name and workspace_name != "." and info.get("workspace") != workspace_name:
                continue
            out.append(self._serialize(pid))
        return out

    def stop_process(self, proc_id: str) -> Dict[str, Any]:
        info = self.processes.get(proc_id)
        if not info:
            raise KeyError(f"Proceso no encontrado: {proc_id}")
        proc = info["process"]
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=3)
            except Exception:
                proc.kill()
        res = self._serialize(proc_id)
        self.processes.pop(proc_id, None)
        return res
