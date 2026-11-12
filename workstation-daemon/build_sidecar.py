"""
Script multiplataforma (Windows + Linux) para compilar el microservicio local
`workstation-daemon` como binario sidecar autocontenido para Tauri v2 (HU-40).

Genera:
  - Windows x64: src-tauri/binaries/insanus-workstation-daemon-x86_64-pc-windows-msvc.exe
  - Linux x64:   src-tauri/binaries/insanus-workstation-daemon-x86_64-unknown-linux-gnu
"""
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys

DAEMON_DIR = Path(__file__).resolve().parent
FRONTEND_DIR = DAEMON_DIR.parent
TAURI_BIN_DIR = FRONTEND_DIR / "src-tauri" / "binaries"
TAURI_RES_EXT_DIR = FRONTEND_DIR / "src-tauri" / "resources" / "insanuschat-harness"


def detect_target_triple() -> str:
    env_triple = os.environ.get("TAURI_TARGET_TRIPLE")
    if env_triple:
        return env_triple.strip()
    try:
        out = subprocess.check_output(["rustc", "-vV"], text=True)
        for line in out.splitlines():
            if line.startswith("host:"):
                return line.split(":", 1)[1].strip()
    except Exception:
        pass
    sys_name = platform.system().lower()
    machine = platform.machine().lower()
    arch = "aarch64" if machine in ("arm64", "aarch64") else "x86_64"
    if sys_name.startswith("win"):
        return f"{arch}-pc-windows-msvc"
    if sys_name == "darwin":
        return f"{arch}-apple-darwin"
    return f"{arch}-unknown-linux-gnu"


def main():
    triple = detect_target_triple()
    is_win = platform.system().lower().startswith("win")
    ext = ".exe" if is_win else ""
    bin_name = f"insanus-harnes-daemon-{triple}"

    TAURI_BIN_DIR.mkdir(parents=True, exist_ok=True)
    if TAURI_RES_EXT_DIR.exists():
        shutil.rmtree(TAURI_RES_EXT_DIR)
    shutil.copytree(DAEMON_DIR / "vscode_extension" / "insanuschat-harness", TAURI_RES_EXT_DIR)

    sep = ";" if is_win else ":"
    add_data = f"{DAEMON_DIR / 'vscode_extension'}{sep}vscode_extension"

    cmd = [
        sys.executable,
        "-m",
        "PyInstaller",
        "--noconfirm",
        "--clean",
        "--onefile",
        "--name",
        bin_name,
        "--distpath",
        str(TAURI_BIN_DIR),
        "--workpath",
        str(DAEMON_DIR / "build_pyinstaller"),
        "--specpath",
        str(DAEMON_DIR / "build_pyinstaller"),
        "--paths",
        str(DAEMON_DIR),
        "--add-data",
        add_data,
        "--hidden-import",
        "uvicorn.logging",
        "--hidden-import",
        "uvicorn.loops",
        "--hidden-import",
        "uvicorn.loops.auto",
        "--hidden-import",
        "uvicorn.protocols",
        "--hidden-import",
        "uvicorn.protocols.http",
        "--hidden-import",
        "uvicorn.protocols.http.auto",
        "--hidden-import",
        "uvicorn.protocols.websockets",
        "--hidden-import",
        "uvicorn.protocols.websockets.auto",
        "--hidden-import",
        "uvicorn.lifespan",
        "--hidden-import",
        "uvicorn.lifespan.on",
        "--hidden-import",
        "websockets.legacy",
        "--hidden-import",
        "websockets.legacy.client",
    ]
    if is_win:
        cmd.extend(["--noconsole", "--collect-all", "winpty"])
    cmd.append(str(DAEMON_DIR / "main.py"))

    print(f"[build_sidecar] Compilando {bin_name}{ext} ...")
    subprocess.run(cmd, cwd=str(DAEMON_DIR), check=True)

    output_bin = TAURI_BIN_DIR / f"{bin_name}{ext}"
    if not output_bin.exists():
        raise FileNotFoundError(f"No se generó el binario esperado: {output_bin}")

    size_mb = output_bin.stat().st_size / (1024 * 1024)
    print(f"[build_sidecar] OK -> {output_bin} ({size_mb:.1f} MB)")


if __name__ == "__main__":
    main()
