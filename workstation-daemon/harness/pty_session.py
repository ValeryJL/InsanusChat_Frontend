"""
Sesión PTY Interactiva Real para InsanusChat Workstation (HU-26, HU-40).
- En Windows: usa ConPTY real (`pywinpty`) ejecutando PowerShell (`pwsh` / `powershell.exe`), `cmd.exe` o Git Bash.
- En Linux / macOS: usa `pty.openpty()` nativo ejecutando `bash -i`, `zsh -i` o `sh -i`.
"""
import asyncio
import logging
import os
from pathlib import Path
import platform
import shutil
import signal
import struct
import subprocess
import threading
from typing import Optional

logger = logging.getLogger(__name__)
IS_WINDOWS = platform.system().lower().startswith("win")

if not IS_WINDOWS:
    import fcntl
    import pty
    import select
    import termios


def resolve_local_shell(requested_shell: Optional[str] = None) -> tuple[str, list[str]]:
    req = (requested_shell or "").strip().lower()
    if req == "auto":
        req = ""
    if IS_WINDOWS:
        if req == "cmd":
            return "cmd", ["cmd.exe"]
        if req == "bash" and shutil.which("bash"):
            return "bash", [shutil.which("bash") or "bash", "-i"]
        if req == "pwsh" and shutil.which("pwsh"):
            return "pwsh", ["pwsh.exe", "-NoLogo"]
        ps = shutil.which("pwsh") or shutil.which("powershell") or "powershell.exe"
        return ("pwsh" if "pwsh" in ps.lower() else "powershell"), [ps, "-NoLogo"]

    if req == "sh":
        return "sh", ["/bin/sh", "-i"]
    if req == "zsh" and shutil.which("zsh"):
        return "zsh", [shutil.which("zsh") or "/bin/zsh", "-i"]
    bash_bin = shutil.which("bash") or "/bin/bash"
    return "bash", [bash_bin, "-i"]


class WorkstationPtySession:
    def __init__(
        self,
        cwd: Path,
        cols: int = 100,
        rows: int = 24,
        requested_shell: Optional[str] = None,
    ):
        self.cwd = str(cwd)
        self.cols = max(20, min(400, int(cols or 100)))
        self.rows = max(5, min(150, int(rows or 24)))
        self.shell_name, self.shell_argv = resolve_local_shell(requested_shell)

        self._closed = False
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self.output_queue: asyncio.Queue = asyncio.Queue()

        self._master_fd: Optional[int] = None
        self._proc: Optional[subprocess.Popen] = None
        self._win_pty = None
        self._reader_thread: Optional[threading.Thread] = None

    def start(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop
        if IS_WINDOWS:
            from winpty import PtyProcess

            self._win_pty = PtyProcess.spawn(
                " ".join(self.shell_argv),
                cwd=self.cwd,
                dimensions=(self.rows, self.cols),
            )
        else:
            master_fd, slave_fd = pty.openpty()
            env = os.environ.copy()
            env["TERM"] = "xterm-256color"
            env["COLORTERM"] = "truecolor"
            self._master_fd = master_fd
            self._set_posix_winsize(self.cols, self.rows)
            self._proc = subprocess.Popen(
                self.shell_argv,
                stdin=slave_fd,
                stdout=slave_fd,
                stderr=slave_fd,
                cwd=self.cwd,
                env=env,
                preexec_fn=os.setsid,
                close_fds=True,
            )
            os.close(slave_fd)

        self._reader_thread = threading.Thread(target=self._read_loop, daemon=True)
        self._reader_thread.start()

    def _set_posix_winsize(self, cols: int, rows: int) -> None:
        if self._master_fd is None or IS_WINDOWS:
            return
        try:
            fcntl.ioctl(self._master_fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
        except Exception:
            pass

    def _push(self, event: dict) -> None:
        if self._loop and not self._loop.is_closed():
            self._loop.call_soon_threadsafe(self.output_queue.put_nowait, event)

    def _read_loop(self) -> None:
        try:
            if IS_WINDOWS:
                while not self._closed and self._win_pty is not None:
                    try:
                        chunk = self._win_pty.read(4096)
                        if not chunk:
                            break
                        self._push({"cmd": "pty_output", "data": chunk})
                    except EOFError:
                        break
                    except Exception:
                        if self._win_pty is None or not self._win_pty.isalive():
                            break
            else:
                fd = self._master_fd
                while not self._closed and fd is not None:
                    try:
                        rlist, _, _ = select.select([fd], [], [], 0.25)
                    except Exception:
                        break
                    if fd in rlist:
                        try:
                            raw = os.read(fd, 4096)
                            if not raw:
                                break
                            self._push({"cmd": "pty_output", "data": raw.decode("utf-8", errors="replace")})
                        except OSError:
                            break
                    elif self._proc and self._proc.poll() is not None:
                        break
        finally:
            exit_code = 0
            try:
                if IS_WINDOWS and self._win_pty is not None:
                    exit_code = getattr(self._win_pty, "exitstatus", 0) or 0
                elif self._proc is not None:
                    exit_code = self._proc.poll() if self._proc.poll() is not None else 0
            except Exception:
                exit_code = 0
            self._push({"cmd": "pty_exit", "exit_code": exit_code})

    def write(self, data: str) -> None:
        if self._closed or not data:
            return
        try:
            if IS_WINDOWS and self._win_pty is not None:
                self._win_pty.write(data)
            elif self._master_fd is not None:
                os.write(self._master_fd, data.encode("utf-8", errors="replace"))
        except Exception as exc:
            logger.debug("Workstation PTY write error: %s", exc)

    def resize(self, cols: int, rows: int) -> None:
        if self._closed:
            return
        self.cols = max(20, min(400, int(cols or self.cols)))
        self.rows = max(5, min(150, int(rows or self.rows)))
        try:
            if IS_WINDOWS and self._win_pty is not None:
                self._win_pty.setwinsize(self.rows, self.cols)
            elif self._master_fd is not None:
                self._set_posix_winsize(self.cols, self.rows)
                if self._proc and self._proc.poll() is None:
                    try:
                        os.killpg(os.getpgid(self._proc.pid), signal.SIGWINCH)
                    except Exception:
                        pass
        except Exception:
            pass

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        if IS_WINDOWS:
            if self._win_pty is not None:
                try:
                    self._win_pty.terminate(force=True)
                except Exception:
                    pass
                self._win_pty = None
        else:
            if self._proc is not None and self._proc.poll() is None:
                try:
                    os.killpg(os.getpgid(self._proc.pid), signal.SIGTERM)
                except Exception:
                    try:
                        self._proc.terminate()
                    except Exception:
                        pass
            if self._master_fd is not None:
                try:
                    os.close(self._master_fd)
                except Exception:
                    pass
                self._master_fd = None
