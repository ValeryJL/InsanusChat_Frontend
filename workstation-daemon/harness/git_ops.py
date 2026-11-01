"""
Operaciones Git del Workspace Local vinculadas al Árbol 2D de InsanusChat (HU-26).
"""
from pathlib import Path
import re
from typing import Any, Dict, Optional
import uuid

from harness.terminal import WorkstationTerminal


def get_git_status(terminal: WorkstationTerminal, ws_dir: Path, workspace_name: str) -> Dict[str, Any]:
    res_branch = terminal.run_command(ws_dir, workspace_name, "git rev-parse --abbrev-ref HEAD", timeout_seconds=5)
    res_status = terminal.run_command(ws_dir, workspace_name, "git status --short", timeout_seconds=8)
    res_diff = terminal.run_command(ws_dir, workspace_name, "git diff --stat", timeout_seconds=8)
    res_diff_full = terminal.run_command(ws_dir, workspace_name, "git diff", timeout_seconds=10)
    return {
        "workspace": workspace_name,
        "path": str(ws_dir),
        "is_git": res_branch.get("ok", False),
        "branch": (res_branch.get("stdout") or "").strip() if res_branch.get("ok") else None,
        "status_short": (res_status.get("stdout") or "").strip(),
        "diff_stat": (res_diff.get("stdout") or "").strip(),
        "diff_full": (res_diff_full.get("stdout") or "")[:30000],
    }


def create_git_checkpoint(
    terminal: WorkstationTerminal,
    ws_dir: Path,
    workspace_name: str,
    label: str = "checkpoint",
    node_id: Optional[str] = None,
) -> Dict[str, Any]:
    st = get_git_status(terminal, ws_dir, workspace_name)
    if not st.get("is_git"):
        return {"ok": False, "message": "El workspace no tiene un repositorio Git inicializado."}
    short = str(node_id)[:8] if node_id else uuid.uuid4().hex[:6]
    safe = re.sub(r"[^a-zA-Z0-9_\- ]", "", label or "checkpoint").strip() or "checkpoint"
    return {
        "ok": True,
        "branch_suggested": f"insanus/node-{short}",
        "current_branch": st.get("branch"),
        "status_short": st.get("status_short"),
        "label": safe,
    }
