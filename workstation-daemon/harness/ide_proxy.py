"""
Reverse Proxy Local HTTP + WebSocket para el Motor VS Code Real (/ide/{session_secret}/*)
en insanus-harnes-daemon (v1.5.0).
- Autenticación criptográfica en ruta (`/ide/{session_secret}/...`).
- Preserva múltiples headers `Content-Security-Policy` y `Set-Cookie` sin romper `nonce` de VS Code.
- Reescribe `remoteAuthority` y `resourceUrlTemplate` desde `127.0.0.1:<upstream_port>` hacia el
  host/esquema público real (`127.0.0.1:8765` en Desktop o `https://harnes.insanustech.com.ar` en Web).
- Inyecta `initialColorTheme` oscuro y `configurationDefaults` (Obsidian) directamente en
  `<meta id="vscode-workbench-web-configuration">` para que VS Code Web nunca arranque en Light Mode,
  además de skin CSS Obsidian puro (CERO `<script>` inline para respetar la CSP de VS Code).
"""
import asyncio
import html as html_mod
import json
import re
import secrets
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

from fastapi import Request, Response, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
import httpx
import websockets

OBSIDIAN_WEB_COLORS: Dict[str, str] = {
    "focusBorder": "#10b98180",
    "foreground": "#e4e4e7",
    "disabledForeground": "#71717a",
    "descriptionForeground": "#a1a1aa",
    "icon.foreground": "#a1a1aa",
    "errorForeground": "#fb7185",
    "selection.background": "#10b98133",
    "textLink.foreground": "#34d399",
    "textLink.activeForeground": "#6ee7b7",
    "button.background": "#10b981",
    "button.foreground": "#09090b",
    "button.hoverBackground": "#34d399",
    "button.secondaryBackground": "#161922",
    "button.secondaryForeground": "#e4e4e7",
    "input.background": "#11131a",
    "input.border": "#ffffff14",
    "input.foreground": "#f4f4f5",
    "input.placeholderForeground": "#71717a",
    "dropdown.background": "#11131a",
    "dropdown.border": "#ffffff14",
    "dropdown.foreground": "#e4e4e7",
    "list.activeSelectionBackground": "#10b98122",
    "list.activeSelectionForeground": "#f4f4f5",
    "list.inactiveSelectionBackground": "#ffffff0d",
    "list.inactiveSelectionForeground": "#e4e4e7",
    "list.hoverBackground": "#ffffff08",
    "list.hoverForeground": "#f4f4f5",
    "activityBar.background": "#0b0d12",
    "activityBar.foreground": "#f4f4f5",
    "activityBar.inactiveForeground": "#71717a",
    "activityBar.border": "#ffffff12",
    "activityBar.activeBorder": "#10b981",
    "activityBarBadge.background": "#10b981",
    "activityBarBadge.foreground": "#09090b",
    "sideBar.background": "#0e1017",
    "sideBar.foreground": "#d4d4d8",
    "sideBar.border": "#ffffff12",
    "sideBarTitle.foreground": "#a1a1aa",
    "sideBarSectionHeader.background": "#0e1017",
    "sideBarSectionHeader.foreground": "#a1a1aa",
    "sideBarSectionHeader.border": "#ffffff0d",
    "editorGroup.border": "#ffffff12",
    "editorGroupHeader.tabsBackground": "#0e1017",
    "editorGroupHeader.tabsBorder": "#ffffff12",
    "editorGroupHeader.noTabsBackground": "#0e1017",
    "tab.activeBackground": "#09090b",
    "tab.activeForeground": "#f4f4f5",
    "tab.activeBorderTop": "#10b981",
    "tab.inactiveBackground": "#0e1017",
    "tab.inactiveForeground": "#71717a",
    "tab.hoverBackground": "#14171f",
    "tab.hoverForeground": "#e4e4e7",
    "tab.border": "#ffffff0d",
    "editor.background": "#09090b",
    "editor.foreground": "#e4e4e7",
    "editorLineNumber.foreground": "#52525b",
    "editorLineNumber.activeForeground": "#a1a1aa",
    "editorCursor.foreground": "#10b981",
    "editor.lineHighlightBackground": "#14171f",
    "editorWidget.background": "#11131a",
    "editorWidget.border": "#ffffff14",
    "panel.background": "#09090b",
    "panel.border": "#ffffff12",
    "panelTitle.activeBorder": "#10b981",
    "panelTitle.activeForeground": "#f4f4f5",
    "panelTitle.inactiveForeground": "#71717a",
    "terminal.background": "#09090b",
    "terminal.foreground": "#e4e4e7",
    "terminalCursor.foreground": "#10b981",
    "statusBar.background": "#0e1017",
    "statusBar.foreground": "#a1a1aa",
    "statusBar.border": "#ffffff12",
    "statusBar.noFolderBackground": "#0e1017",
    "titleBar.activeBackground": "#0e1017",
    "titleBar.activeForeground": "#e4e4e7",
    "titleBar.inactiveBackground": "#0b0d12",
    "titleBar.inactiveForeground": "#71717a",
    "titleBar.border": "#ffffff12",
    "breadcrumb.background": "#09090b",
    "breadcrumb.foreground": "#71717a",
    "breadcrumb.focusForeground": "#e4e4e7",
    "menu.background": "#11131a",
    "menu.foreground": "#e4e4e7",
    "menu.selectionBackground": "#10b98124",
    "menu.border": "#ffffff14",
    "notifications.background": "#11131a",
    "notifications.foreground": "#e4e4e7",
    "notifications.border": "#ffffff14",
    "quickInput.background": "#11131a",
    "quickInput.foreground": "#e4e4e7",
    "welcomePage.background": "#09090b",
    "welcomePage.tileBackground": "#11131a",
    "welcomePage.tileHoverBackground": "#161922",
    "welcomePage.tileBorder": "#ffffff12",
    "welcomePage.progress.background": "#161922",
    "welcomePage.progress.foreground": "#10b981",
}

OBSIDIAN_WEB_CONFIG_DEFAULTS: Dict[str, Any] = {
    "workbench.colorTheme": "Insanus Obsidian",
    "workbench.preferredDarkColorTheme": "Insanus Obsidian",
    "workbench.preferredLightColorTheme": "Insanus Obsidian",
    "window.autoDetectColorScheme": False,
    "workbench.colorCustomizations": OBSIDIAN_WEB_COLORS,
    "workbench.startupEditor": "none",
    "workbench.tips.enabled": False,
    "workbench.welcomePage.walkthroughs.openOnInstall": False,
    "workbench.secondarySideBar.defaultVisibility": "hidden",
    "chat.disableAIFeatures": True,
    "chat.commandCenter.enabled": False,
    "window.commandCenter": False,
    "window.menuBarVisibility": "compact",
    "workbench.layoutControl.enabled": False,
    "editor.minimap.enabled": False,
    "editor.fontFamily": "'JetBrains Mono', 'Cascadia Code', Consolas, monospace",
    "editor.fontSize": 13,
    "editor.lineHeight": 20,
    "editor.smoothScrolling": True,
    "editor.bracketPairColorization.enabled": True,
    "terminal.integrated.fontFamily": "'JetBrains Mono', Consolas, monospace",
    "security.workspace.trust.enabled": False,
}

INSANUS_EMBED_SKIN_CSS = """
html, body {
  background-color: #09090b;
  color: #e4e4e7;
}
.monaco-workbench.vs-dark {
  background-color: #09090b !important;
}
.monaco-workbench.vs-dark .part.titlebar {
  background-color: #0e1017 !important;
  border-bottom: 1px solid rgba(255, 255, 255, 0.07) !important;
}
.monaco-workbench.vs-dark .part.activitybar {
  background-color: #0b0d12 !important;
  border-right: 1px solid rgba(255, 255, 255, 0.07) !important;
}
.monaco-workbench.vs-dark .part.sidebar {
  background-color: #0e1017 !important;
  border-right: 1px solid rgba(255, 255, 255, 0.07) !important;
}
.monaco-workbench.vs-dark .part.statusbar {
  background-color: #0e1017 !important;
  border-top: 1px solid rgba(255, 255, 255, 0.07) !important;
}
::-webkit-scrollbar {
  width: 6px !important;
  height: 6px !important;
}
::-webkit-scrollbar-thumb {
  background: rgba(148, 163, 184, 0.22) !important;
  border-radius: 9999px !important;
}
::-webkit-scrollbar-thumb:hover {
  background: rgba(16, 185, 129, 0.55) !important;
}
""".strip()

_WEB_CONFIG_META_RE = re.compile(
    r'(<meta\s+id="vscode-workbench-web-configuration"\s+data-settings=")([^"]*)(")',
    re.IGNORECASE,
)

HIDE_TITLEBAR_CSS = """
.monaco-workbench .part.titlebar {
  display: none !important;
  height: 0 !important;
  min-height: 0 !important;
}
""".strip()

HOP_BY_HOP_HEADERS = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
    "content-length",
    "content-encoding",
    "x-frame-options",
    "content-security-policy",
    "content-security-policy-report-only",
    "set-cookie",
}

ALLOWED_FRAME_ANCESTORS = (
    "'self' http://tauri.localhost https://tauri.localhost tauri://localhost "
    "http://localhost:* http://127.0.0.1:* https://harnes.insanustech.com.ar"
)


def _merge_and_rewrite_csp(
    csp_list: List[str],
    upstream_origin: str,
    public_origin: Optional[str],
) -> str:
    """Combina los headers CSP de VS Code preservando nonces y ajustando frame-ancestors y origen público."""
    directives: List[str] = []
    has_frame_ancestors = False
    for raw in csp_list:
        for part in raw.split(";"):
            p = part.strip()
            if not p:
                continue
            low = p.lower()
            if low.startswith("frame-ancestors"):
                if not has_frame_ancestors:
                    directives.append(f"frame-ancestors {ALLOWED_FRAME_ANCESTORS}")
                    has_frame_ancestors = True
                continue
            if public_origin and upstream_origin in p:
                p = p.replace(upstream_origin, public_origin)
            elif public_origin and (low.startswith("script-src") or low.startswith("connect-src")):
                if public_origin not in p:
                    p = f"{p} {public_origin}"
            directives.append(p)
    if not has_frame_ancestors:
        directives.append(f"frame-ancestors {ALLOWED_FRAME_ANCESTORS}")
    return "; ".join(directives) + ";"


def _inject_web_workbench_config(text: str) -> str:
    """
    Inyecta `initialColorTheme` oscuro y `configurationDefaults` Obsidian dentro del
    `<meta id="vscode-workbench-web-configuration" data-settings="...">` para que VS Code Web
    arranque siempre en modo Obsidian oscuro con alto contraste (evitando el fallback Light 2026
    que VS Code Web usa por defecto en navegadores y WebView2 de Windows).
    """
    def _repl(match: re.Match) -> str:
        prefix, raw_escaped, suffix = match.group(1), match.group(2), match.group(3)
        try:
            cfg = json.loads(html_mod.unescape(raw_escaped))
            if not isinstance(cfg, dict):
                return match.group(0)
        except Exception:
            return match.group(0)

        cfg["enableWorkspaceTrust"] = False
        cfg["initialColorTheme"] = {
            "themeType": "dark",
            "colors": OBSIDIAN_WEB_COLORS,
        }
        existing_defaults = cfg.get("configurationDefaults")
        merged_defaults = dict(OBSIDIAN_WEB_CONFIG_DEFAULTS)
        if isinstance(existing_defaults, dict):
            merged_defaults.update(existing_defaults)
        cfg["configurationDefaults"] = merged_defaults

        encoded = html_mod.escape(json.dumps(cfg, separators=(",", ":"), ensure_ascii=False), quote=True)
        return f"{prefix}{encoded}{suffix}"

    return _WEB_CONFIG_META_RE.sub(_repl, text, count=1)


def inject_obsidian_skin_html(
    html_bytes: bytes,
    hide_titlebar: bool = True,
    upstream_host: Optional[str] = None,
    public_host: Optional[str] = None,
    public_scheme: Optional[str] = None,
) -> bytes:
    """
    Inyecta `initialColorTheme` oscuro + `configurationDefaults` Obsidian en la configuración
    de arranque de VS Code Web, aplica CSS puro Obsidian (cero <script> inline para respetar
    el nonce CSP de VS Code) y reescribe `remoteAuthority` / `resourceUrlTemplate` hacia el
    host y esquema públicos reales.
    """
    try:
        text = html_bytes.decode("utf-8")
    except Exception:
        return html_bytes

    if upstream_host and public_host:
        scheme = (public_scheme or "http").rstrip(":/")
        text = text.replace(f"http://{upstream_host}", f"{scheme}://{public_host}")
        text = text.replace(f"ws://{upstream_host}", f"{'wss' if scheme == 'https' else 'ws'}://{public_host}")
        text = text.replace(upstream_host, public_host)

    # Forzar tema oscuro Insanus Obsidian + configurationDefaults + sin Workspace Trust modal
    text = _inject_web_workbench_config(text)
    text = text.replace("&quot;enableWorkspaceTrust&quot;:true", "&quot;enableWorkspaceTrust&quot;:false")

    css = INSANUS_EMBED_SKIN_CSS + ("\n" + HIDE_TITLEBAR_CSS if hide_titlebar else "")
    injection = f'<style id="insanus-obsidian-skin">{css}</style>'
    if "</head>" in text:
        text = text.replace("</head>", f"{injection}</head>", 1)
    else:
        text = injection + text
    return text.encode("utf-8")


class IDEProxyHandler:
    def __init__(self, ide_mgr: Any, cfg: Any):
        self.ide_mgr = ide_mgr
        self.cfg = cfg
        self._client: Optional[httpx.AsyncClient] = None

    def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                timeout=httpx.Timeout(60.0, connect=10.0),
                follow_redirects=False,
            )
        return self._client

    async def close(self) -> None:
        if self._client and not self._client.is_closed:
            await self._client.aclose()
            self._client = None

    def is_valid_session_secret(self, candidate: str) -> bool:
        expected = getattr(self.ide_mgr, "session_secret", "") or ""
        if not expected or not candidate:
            return False
        return secrets.compare_digest(candidate.strip(), expected)

    @staticmethod
    def _extract_public_host_and_scheme(headers: Dict[str, str], default_host: str) -> tuple[str, str]:
        lower_map = {k.lower(): v for k, v in headers.items()}
        host = (lower_map.get("x-forwarded-host") or lower_map.get("host") or default_host).split(",")[0].strip()
        scheme = (lower_map.get("x-forwarded-proto") or "").split(",")[0].strip().lower()
        if scheme not in ("http", "https"):
            scheme = "https" if (host and not host.startswith("127.0.0.1") and not host.startswith("localhost")) else "http"
        return host or default_host, scheme

    async def proxy_http_raw(
        self,
        method: str,
        session_secret: str,
        subpath: str,
        query_string: str,
        headers: Dict[str, str],
        body: bytes,
    ) -> Dict[str, Any]:
        if not self.is_valid_session_secret(session_secret):
            return {
                "status": 401,
                "headers": {"content-type": "application/json"},
                "set_cookies": [],
                "body": b'{"detail":"Session secret de IDE invalido"}',
            }

        if not self.ide_mgr.is_running():
            await self.ide_mgr.ensure_started()
        upstream_base = self.ide_mgr.get_upstream_base_url()
        if not upstream_base:
            return {
                "status": 503,
                "headers": {"content-type": "application/json"},
                "set_cookies": [],
                "body": b'{"detail":"IDE server offline"}',
            }

        parsed_up = urlparse(upstream_base)
        upstream_host = parsed_up.netloc  # ej. 127.0.0.1:19100
        default_local_host = f"{getattr(self.cfg, 'bind_host', '127.0.0.1')}:{getattr(self.cfg, 'bind_port', 8765)}"
        public_host, public_scheme = self._extract_public_host_and_scheme(headers, default_local_host)
        public_origin = f"{public_scheme}://{public_host}"

        clean_sub = subpath.lstrip("/")
        base_prefix = f"/ide/{session_secret}"
        target_url = f"{upstream_base}{base_prefix}/{clean_sub}" if clean_sub else f"{upstream_base}{base_prefix}/"
        if query_string:
            target_url = f"{target_url}?{query_string}"

        fwd_headers = {
            k: v
            for k, v in headers.items()
            if k.lower() not in ("host", "content-length", "accept-encoding", "accept-language", "x-workstation-token")
        }
        fwd_headers["Accept-Encoding"] = "identity"
        # Evitar que code serve-web cargue un pack NLS externo desfasado desde vscode-unpkg.net que desordena etiquetas
        fwd_headers["Accept-Language"] = "en-US,en;q=0.9"

        client = self._get_client()
        resp = await client.request(method=method, url=target_url, headers=fwd_headers, content=body)
        resp_body = resp.content
        resp_headers: Dict[str, str] = {}
        for k, v in resp.headers.items():
            kl = k.lower()
            if kl in HOP_BY_HOP_HEADERS:
                continue
            resp_headers[k] = v

        csp_values = resp.headers.get_list("content-security-policy")
        resp_headers["Content-Security-Policy"] = _merge_and_rewrite_csp(
            csp_values,
            upstream_origin=upstream_base,
            public_origin=public_origin,
        )

        is_embedded = "insanus_embedded=1" in (query_string or "")
        hide_tb = bool(getattr(self.cfg, "ide_embedded_hide_titlebar", True)) and is_embedded

        is_root_workbench_html = clean_sub == ""
        ctype = resp.headers.get("content-type", "").lower()
        if is_root_workbench_html and "text/html" in ctype and resp.status_code == 202:
            raw_msg = resp_body.decode("utf-8", errors="replace")
            if "downloading" in raw_msg.lower() or "please wait" in raw_msg.lower():
                resp_body = (
                    '<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"/>'
                    '<meta http-equiv="refresh" content="2"/>'
                    '<style id="insanus-obsidian-skin">html,body{margin:0;height:100vh;background:#09090b;color:#e4e4e7;'
                    'font-family:Inter,system-ui,sans-serif;display:flex;align-items:center;justify-content:center;}'
                    '.box{background:#0e1017;border:1px solid rgba(255,255,255,0.08);border-radius:14px;padding:20px 26px;'
                    'text-align:center;max-width:420px;box-shadow:0 20px 40px rgba(0,0,0,0.45);}'
                    '.dot{width:10px;height:10px;border-radius:999px;background:#10b981;display:inline-block;margin-right:8px;}'
                    'p{color:#a1a1aa;font-size:12px;margin:8px 0 0;}</style></head><body>'
                    '<div class="box"><div style="font-size:13px;font-weight:600;"><span class="dot"></span>'
                    'Preparando Visual Studio Code Server (primera vez)...</div>'
                    '<p>Descargando motor oficial de VS Code con soporte completo de extensiones .vsix. '
                    'Esta pantalla se actualizará automáticamente en unos segundos.</p></div></body></html>'
                ).encode("utf-8")
            else:
                resp_body = inject_obsidian_skin_html(
                    resp_body,
                    hide_titlebar=hide_tb,
                    upstream_host=upstream_host,
                    public_host=public_host,
                    public_scheme=public_scheme,
                )
        elif is_root_workbench_html and "text/html" in ctype and resp.status_code == 200:
            resp_body = inject_obsidian_skin_html(
                resp_body,
                hide_titlebar=hide_tb,
                upstream_host=upstream_host,
                public_host=public_host,
                public_scheme=public_scheme,
            )

        raw_cookies = resp.headers.get_list("set-cookie")
        set_cookies = [re.sub(r"SameSite\s*=\s*Strict", "SameSite=Lax", c, flags=re.IGNORECASE) for c in raw_cookies]

        return {"status": resp.status_code, "headers": resp_headers, "set_cookies": set_cookies, "body": resp_body}

    async def handle_local_http(self, request: Request, session_secret: str, subpath: str) -> Response:
        if not self.is_valid_session_secret(session_secret):
            return JSONResponse(status_code=401, content={"detail": "Sesión IDE local no autorizada"})

        body = await request.body()
        res = await self.proxy_http_raw(
            method=request.method,
            session_secret=session_secret,
            subpath=subpath,
            query_string=request.url.query,
            headers=dict(request.headers),
            body=body,
        )
        out = Response(content=res["body"], status_code=res["status"], headers=res["headers"])
        for ck in res.get("set_cookies") or []:
            out.headers.append("set-cookie", ck)
        return out

    def build_upstream_ws_url(self, session_secret: str, subpath: str, query_string: str) -> Optional[str]:
        upstream_base = self.ide_mgr.get_upstream_base_url()
        if not upstream_base:
            return None
        ws_base = upstream_base.replace("http://", "ws://", 1)
        clean_sub = subpath.lstrip("/")
        base_prefix = f"/ide/{session_secret}"
        ws_url = f"{ws_base}{base_prefix}/{clean_sub}" if clean_sub else f"{ws_base}{base_prefix}/"
        if query_string:
            ws_url = f"{ws_url}?{query_string}"
        return ws_url

    async def handle_local_ws(self, websocket: WebSocket, session_secret: str, subpath: str) -> None:
        if not self.is_valid_session_secret(session_secret):
            await websocket.close(code=1008)
            return

        if not self.ide_mgr.is_running():
            try:
                await self.ide_mgr.ensure_started()
            except Exception:
                await websocket.close(code=1011)
                return

        ws_url = self.build_upstream_ws_url(session_secret, subpath, websocket.url.query)
        if not ws_url:
            await websocket.close(code=1011)
            return

        subprotocols_hdr = websocket.headers.get("sec-websocket-protocol")
        subprotocols = [s.strip() for s in subprotocols_hdr.split(",") if s.strip()] if subprotocols_hdr else None

        try:
            async with websockets.connect(
                ws_url,
                subprotocols=subprotocols,
                max_size=32 * 1024 * 1024,
                ping_interval=25,
                ping_timeout=25,
            ) as upstream_ws:
                chosen_proto = upstream_ws.subprotocol
                await websocket.accept(subprotocol=chosen_proto)

                async def client_to_upstream():
                    try:
                        while True:
                            msg = await websocket.receive()
                            if msg.get("type") == "websocket.disconnect":
                                break
                            if msg.get("text") is not None:
                                await upstream_ws.send(msg["text"])
                            elif msg.get("bytes") is not None:
                                await upstream_ws.send(msg["bytes"])
                    except (WebSocketDisconnect, Exception):
                        pass

                async def upstream_to_client():
                    try:
                        async for frame in upstream_ws:
                            if isinstance(frame, bytes):
                                await websocket.send_bytes(frame)
                            else:
                                await websocket.send_text(frame)
                    except Exception:
                        pass

                t1 = asyncio.create_task(client_to_upstream())
                t2 = asyncio.create_task(upstream_to_client())
                _, pending = await asyncio.wait({t1, t2}, return_when=asyncio.FIRST_COMPLETED)
                for p in pending:
                    p.cancel()
        except Exception:
            try:
                await websocket.close(code=1011)
            except Exception:
                pass
