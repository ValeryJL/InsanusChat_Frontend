"""
Motor Local de Filesystem Quirúrgico y Generador de Unified Diffs para InsanusChat Workstation
(HU-25, HU-27, HU-37).
"""
import difflib
import os
from pathlib import Path
import re
from typing import Any, Dict, List, Optional, Tuple

IGNORED_DIRS = {
    ".git",
    "node_modules",
    "__pycache__",
    ".venv",
    "venv",
    "dist",
    "build",
    "target",
    ".next",
    ".pytest_cache",
    ".mypy_cache",
    ".idea",
}

IGNORED_EXTENSIONS = {".pyc", ".pyo", ".pyd", ".so", ".dll", ".exe", ".bin"}


def compute_unified_diff(old_text: str, new_text: str, rel_path: str) -> str:
    old_lines = old_text.splitlines(keepends=True)
    new_lines = new_text.splitlines(keepends=True)
    return "".join(
        difflib.unified_diff(
            old_lines,
            new_lines,
            fromfile=f"a/{rel_path}",
            tofile=f"b/{rel_path}",
            lineterm="\n",
        )
    )


class WorkstationFilesystem:
    def __init__(self, root_dir: str, allowed_workspaces: Optional[List[str]] = None):
        self.root_dir = Path(root_dir).resolve()
        self.allowed_workspaces = allowed_workspaces

    def set_root(self, root_dir: str, allowed_workspaces: Optional[List[str]] = None):
        self.root_dir = Path(root_dir).resolve()
        self.allowed_workspaces = allowed_workspaces

    def resolve_workspace_dir(self, workspace: str) -> Path:
        if not workspace or workspace in (".", "/"):
            return self.root_dir
        clean = workspace.strip().lstrip("/\\")
        candidate = (self.root_dir / clean).resolve()
        if not str(candidate).startswith(str(self.root_dir)):
            raise PermissionError(f"Acceso denegado fuera de la raíz de proyectos: {workspace}")
        if self.allowed_workspaces is not None and clean not in self.allowed_workspaces:
            raise PermissionError(f"El workspace '{clean}' no está autorizado en allowed_workspaces")
        return candidate

    def resolve_file(self, workspace: str, rel_path: str) -> Tuple[Path, Path]:
        ws_dir = self.resolve_workspace_dir(workspace)
        clean_rel = (rel_path or ".").strip().lstrip("/\\")
        target = (ws_dir / clean_rel).resolve()
        if not str(target).startswith(str(ws_dir)):
            raise PermissionError(f"Path traversal bloqueado fuera del proyecto '{workspace}': {rel_path}")
        return ws_dir, target

    def list_workspaces(self, include_restricted: bool = False) -> List[Dict[str, Any]]:
        self.root_dir.mkdir(parents=True, exist_ok=True)
        items: List[Dict[str, Any]] = [
            {
                "name": self.root_dir.name,
                "path": ".",
                "full_path": str(self.root_dir),
                "is_git": (self.root_dir / ".git").exists(),
                "is_root": True,
            }
        ]
        for entry in sorted(self.root_dir.iterdir(), key=lambda x: x.name.lower()):
            if entry.is_dir() and not entry.name.startswith(".") and entry.name not in IGNORED_DIRS:
                if not include_restricted and self.allowed_workspaces is not None and entry.name not in self.allowed_workspaces:
                    continue
                items.append(
                    {
                        "name": entry.name,
                        "path": entry.name,
                        "full_path": str(entry),
                        "is_git": (entry / ".git").exists(),
                        "is_root": False,
                    }
                )
        return items

    def create_workspace(self, name: str, description: str = "") -> Dict[str, Any]:
        clean = re.sub(r"[^a-zA-Z0-9_\-\.]", "-", (name or "").strip()).strip("-")
        if not clean:
            raise ValueError("Nombre de proyecto inválido")
        target = (self.root_dir / clean).resolve()
        if not str(target).startswith(str(self.root_dir)):
            raise PermissionError("Ruta fuera del directorio de proyectos")
        target.mkdir(parents=True, exist_ok=True)
        readme = target / "README.md"
        if not readme.exists():
            readme.write_text(
                f"# {clean}\n\n{description or 'Proyecto creado desde InsanusChat Workstation.'}\n",
                encoding="utf-8",
            )
        return {
            "name": clean,
            "path": clean,
            "full_path": str(target),
            "is_git": (target / ".git").exists(),
        }

    @staticmethod
    def infer_language(filename: str) -> str:
        ext = Path(filename).suffix.lower()
        table = {
            ".py": "python",
            ".ts": "typescript",
            ".tsx": "typescript",
            ".js": "javascript",
            ".jsx": "javascript",
            ".json": "json",
            ".md": "markdown",
            ".html": "html",
            ".css": "css",
            ".yml": "yaml",
            ".yaml": "yaml",
            ".ps1": "powershell",
            ".sh": "shell",
            ".sql": "sql",
            ".rs": "rust",
            ".toml": "ini",
            ".dockerfile": "dockerfile",
        }
        return table.get(ext, "plaintext")

    def get_file_tree(self, workspace: str, rel_dir: str = ".", max_depth: int = 4) -> List[Dict[str, Any]]:
        ws_dir, start_dir = self.resolve_file(workspace, rel_dir)
        if not start_dir.exists() or not start_dir.is_dir():
            return []

        def _walk(curr: Path, depth: int) -> List[Dict[str, Any]]:
            if depth > max_depth:
                return []
            out: List[Dict[str, Any]] = []
            try:
                entries = sorted(curr.iterdir(), key=lambda e: (not e.is_dir(), e.name.lower()))
            except Exception:
                return []
            for entry in entries:
                if entry.name in IGNORED_DIRS:
                    continue
                if entry.name.startswith(".") and entry.name not in (".gitignore", ".env.example", ".github"):
                    continue
                rel = entry.relative_to(ws_dir).as_posix()
                if entry.is_dir():
                    out.append(
                        {
                            "name": entry.name,
                            "path": rel,
                            "type": "directory",
                            "children": _walk(entry, depth + 1),
                        }
                    )
                else:
                    if entry.suffix.lower() in IGNORED_EXTENSIONS:
                        continue
                    out.append(
                        {
                            "name": entry.name,
                            "path": rel,
                            "type": "file",
                            "size": entry.stat().st_size,
                            "language": self.infer_language(entry.name),
                        }
                    )
            return out

        return _walk(start_dir, 1)

    def read_file(
        self,
        workspace: str,
        rel_path: str,
        start_line: Optional[int] = None,
        end_line: Optional[int] = None,
        with_line_numbers: bool = False,
    ) -> Dict[str, Any]:
        ws_dir, target = self.resolve_file(workspace, rel_path)
        if not target.exists() or not target.is_file():
            raise FileNotFoundError(f"Archivo no encontrado: {rel_path}")
        raw = target.read_text(encoding="utf-8", errors="replace")
        lines = raw.splitlines()
        total = len(lines)
        s = max(1, int(start_line)) if start_line else 1
        e = min(total, int(end_line)) if end_line else total
        chunk = lines[s - 1 : e]
        formatted = "\n".join(f"{i}: {ln}" for i, ln in enumerate(chunk, start=s)) if with_line_numbers else "\n".join(chunk)
        return {
            "path": target.relative_to(ws_dir).as_posix(),
            "content": formatted if (start_line or end_line or with_line_numbers) else raw,
            "raw_content": raw,
            "total_lines": total,
            "start_line": s,
            "end_line": e,
            "language": self.infer_language(target.name),
        }

    def write_file(self, workspace: str, rel_path: str, content: str, overwrite: bool = True) -> Dict[str, Any]:
        ws_dir, target = self.resolve_file(workspace, rel_path)
        existed = target.exists()
        if existed and not overwrite:
            raise FileExistsError(f"Archivo ya existe: {rel_path}")
        old_text = target.read_text(encoding="utf-8", errors="replace") if existed else ""
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
        rel = target.relative_to(ws_dir).as_posix()
        return {
            "path": rel,
            "action": "updated" if existed else "created",
            "lines_count": len(content.splitlines()),
            "diff": compute_unified_diff(old_text, content, rel),
        }

    def edit_file(self, workspace: str, rel_path: str, target_block: str, replacement_block: str) -> Dict[str, Any]:
        ws_dir, target = self.resolve_file(workspace, rel_path)
        if not target.exists() or not target.is_file():
            raise FileNotFoundError(f"Archivo no encontrado: {rel_path}")
        old_text = target.read_text(encoding="utf-8", errors="replace")
        if target_block in old_text:
            new_text = old_text.replace(target_block, replacement_block, 1)
        else:
            norm_old = old_text.replace("\r\n", "\n")
            norm_t = target_block.replace("\r\n", "\n")
            norm_r = replacement_block.replace("\r\n", "\n")
            if norm_t not in norm_old:
                raise ValueError(f"El bloque target no coincide exactamente en {rel_path}")
            new_text = norm_old.replace(norm_t, norm_r, 1)
        target.write_text(new_text, encoding="utf-8")
        rel = target.relative_to(ws_dir).as_posix()
        return {
            "path": rel,
            "action": "edited",
            "diff": compute_unified_diff(old_text, new_text, rel),
        }

    def delete_file(self, workspace: str, rel_path: str) -> Dict[str, Any]:
        ws_dir, target = self.resolve_file(workspace, rel_path)
        if not target.exists():
            raise FileNotFoundError(f"No encontrado: {rel_path}")
        if target == ws_dir:
            raise ValueError("No se puede eliminar el directorio raíz del proyecto")
        rel = target.relative_to(ws_dir).as_posix()
        if target.is_dir():
            target.rmdir()
        else:
            target.unlink()
        return {"path": rel, "deleted": True}

    def grep_search(self, workspace: str, query: str, rel_dir: str = ".", max_results: int = 40) -> List[Dict[str, Any]]:
        ws_dir, start_dir = self.resolve_file(workspace, rel_dir)
        if not start_dir.exists():
            return []
        try:
            pat = re.compile(query, re.IGNORECASE)
        except re.error:
            pat = re.compile(re.escape(query), re.IGNORECASE)
        results: List[Dict[str, Any]] = []
        for root, dirs, files in os.walk(start_dir):
            dirs[:] = [d for d in dirs if d not in IGNORED_DIRS and not d.startswith(".")]
            for fn in files:
                if Path(fn).suffix.lower() in IGNORED_EXTENSIONS:
                    continue
                fp = Path(root) / fn
                try:
                    if fp.stat().st_size > 512_000:
                        continue
                    txt = fp.read_text(encoding="utf-8", errors="ignore")
                    for idx, ln in enumerate(txt.splitlines(), start=1):
                        if pat.search(ln):
                            results.append({"path": fp.relative_to(ws_dir).as_posix(), "line": idx, "content": ln.strip()[:200]})
                            if len(results) >= max_results:
                                return results
                except Exception:
                    continue
        return results
