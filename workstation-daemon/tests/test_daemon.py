"""
Suite de Tests Automatizados del Microservicio Local InsanusChat Workstation (HU-24..HU-27, HU-34, HU-37..HU-40).
Verifica:
1. Seguridad local: rechazo HTTP 401 sin X-Workstation-Token válido.
2. Configuración en directorio estándar del SO y modo 🔒 Solo Local por defecto.
3. Emparejamiento 1-clic (/local/bootstrap-sync) respetando seguridad física (no activa expose_to_cloud remotamente).
4. Filesystem quirúrgico, Unified Diffs, Grep Search y Terminal con Denylist custom estilo Antigravity.
5. Detección multiplataforma de editores VS Code y extensión insanuschat-harness.
6. Kill-Switch remoto vía RPC set_privacy y bloqueo de allow_remote_agent_tools=False.
"""
import os
from pathlib import Path
import sys
import tempfile

import pytest
from httpx import ASGITransport, AsyncClient

_TMP_CFG = tempfile.mkdtemp(prefix="insanus_ws_cfg_")
os.environ["INSANUS_WORKSTATION_CONFIG_DIR"] = _TMP_CFG
os.environ["INSANUS_LOCAL_SECRET"] = "test-ephemeral-secret-2026"

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import main as daemon_main  # noqa: E402


@pytest.mark.asyncio
async def test_daemon_security_ssot_fs_terminal_and_vscode():
    with tempfile.TemporaryDirectory() as tmpdir:
        daemon_main.cfg.expose_to_cloud = False
        daemon_main.cfg.allow_remote_terminal = True
        daemon_main.cfg.allow_remote_agent_tools = True
        daemon_main.cfg.terminal_blocked_patterns = ["drop table"]
        daemon_main.cfg.root_projects_dir = tmpdir
        daemon_main._apply_config_to_engines()

        transport = ASGITransport(app=daemon_main.app)
        auth_headers = {"X-Workstation-Token": "test-ephemeral-secret-2026"}

        async with AsyncClient(transport=transport, base_url="http://127.0.0.1") as client:
            # 1. /health abierto para Tauri probe, /local/* protegido con X-Workstation-Token (HU-38)
            r_health = await client.get("/health")
            assert r_health.status_code == 200
            assert r_health.json()["expose_to_cloud"] is False

            r_unauth = await client.get("/local/status")
            assert r_unauth.status_code == 401

            r_status = await client.get("/local/status", headers=auth_headers)
            assert r_status.status_code == 200
            assert r_status.json()["vscode"]["extension_ready"] is True
            assert Path(r_status.json()["config"]["config_dir"]).resolve() == Path(_TMP_CFG).resolve()

            # 2. Emparejamiento 1-clic (HU-35): no debe encender Control Remoto si estaba aislado
            r_boot = await client.post(
                "/local/bootstrap-sync",
                headers=auth_headers,
                json={
                    "cloud_backend_url": "http://localhost:8000",
                    "access_token": "jwt-demo-token",
                    "desired_policy": {
                        "expose_to_cloud": True,
                        "allow_remote_terminal": True,
                        "default_harness_mode": "auto_edit",
                        "config_version": 4,
                    },
                },
            )
            assert r_boot.status_code == 200
            assert r_boot.json()["config"]["expose_to_cloud"] is False
            assert r_boot.json()["config"]["default_harness_mode"] == "auto_edit"
            assert r_boot.json()["config"]["config_version"] == 4

            # 3. Filesystem quirúrgico, Unified Diffs y Grep Search (HU-25, HU-27)
            r_ws = await client.post("/local/workspaces", headers=auth_headers, json={"name": "demo-desktop"})
            assert r_ws.status_code == 200

            r_write = await client.post(
                "/local/files/write",
                headers=auth_headers,
                json={"workspace": "demo-desktop", "path": "app.py", "content": "val = 10\nprint(val)\n"},
            )
            assert r_write.status_code == 200
            assert "+val = 10" in r_write.json()["diff"]

            r_edit = await client.post(
                "/local/files/edit",
                headers=auth_headers,
                json={"workspace": "demo-desktop", "path": "app.py", "target": "val = 10", "replacement": "val = 42"},
            )
            assert r_edit.status_code == 200
            assert "+val = 42" in r_edit.json()["diff"]

            r_search = await client.get(
                "/local/files/search",
                headers=auth_headers,
                params={"workspace": "demo-desktop", "query": "42"},
            )
            assert r_search.status_code == 200
            assert len(r_search.json()["matches"]) == 1

            # 4. Terminal segura + Guardrail base + Denylist custom (HU-26, HU-40)
            r_term = await client.post(
                "/local/terminal/exec",
                headers=auth_headers,
                json={"workspace": "demo-desktop", "command": "python app.py"},
            )
            assert r_term.status_code == 200
            assert "42" in r_term.json()["stdout"]

            r_danger = await client.post(
                "/local/terminal/exec",
                headers=auth_headers,
                json={"workspace": "demo-desktop", "command": "rm -rf /"},
            )
            assert r_danger.status_code == 403

            r_custom_deny = await client.post(
                "/local/terminal/exec",
                headers=auth_headers,
                json={"workspace": "demo-desktop", "command": "echo DROP TABLE users"},
            )
            assert r_custom_deny.status_code == 403

            # 5. Bloqueo de allow_remote_agent_tools=False y Kill-Switch remoto set_privacy (HU-34)
            daemon_main.cfg.expose_to_cloud = True
            daemon_main.cfg.allow_remote_agent_tools = False
            with pytest.raises(PermissionError):
                daemon_main.dispatch_harness_rpc("read_file", {"workspace": "demo-desktop", "path": "app.py"}, is_remote=True)

            kill_res = daemon_main.dispatch_harness_rpc("set_privacy", {"expose_to_cloud": False}, is_remote=True)
            assert kill_res["ok"] is True
            assert daemon_main.cfg.expose_to_cloud is False

            # 6. Editores VS Code y Logs en vivo (HU-38, HU-39)
            r_editors = await client.get("/local/vscode/editors", headers=auth_headers)
            assert r_editors.status_code == 200
            assert r_editors.json()["data"]["extension_ready"] is True

            r_logs = await client.get("/local/logs", headers=auth_headers)
            assert r_logs.status_code == 200
            assert len(r_logs.json()["logs"]) >= 1


@pytest.mark.asyncio
async def test_ide_profile_skin_proxy_bootstrap_and_lsp_diagnostics():
    from harness.ide_proxy import inject_obsidian_skin_html

    with tempfile.TemporaryDirectory() as tmpdir:
        daemon_main.cfg.root_projects_dir = tmpdir
        daemon_main.cfg.dressed_share_user_extensions = False
        daemon_main._apply_config_to_engines()

        # 1. Aprovisionamiento de perfil Obsidian + extensiones reales
        ext_dir = daemon_main.ide_mgr.provision_dressed_desktop_profile(force_reinstall=True)
        daemon_main.ide_mgr.provision_embedded_server_profile()
        settings_path = daemon_main.ide_mgr.dressed_user_data_dir / "User" / "settings.json"
        assert settings_path.exists()
        assert "Insanus Obsidian" in settings_path.read_text(encoding="utf-8")
        installed_names = [p.name for p in ext_dir.iterdir() if p.is_dir()]
        assert any(n.startswith("insanustech.insanus-obsidian-theme-") for n in installed_names)
        assert any(n.startswith("insanustech.insanuschat-harness-") for n in installed_names)

        # 2. Inyección de tema oscuro Obsidian + configurationDefaults + CSS puro (sin <script>) + reescritura de remoteAuthority
        raw_html = (
            b'<html><head>'
            b'<meta id="vscode-workbench-web-configuration" data-settings="{&quot;remoteAuthority&quot;:&quot;127.0.0.1:19100&quot;,&quot;enableWorkspaceTrust&quot;:true,&quot;productConfiguration&quot;:{&quot;resourceUrlTemplate&quot;:&quot;http://127.0.0.1:19100/ide/abc/res&quot;}}">'
            b'</head><body></body></html>'
        )
        skinned = inject_obsidian_skin_html(
            raw_html,
            hide_titlebar=True,
            upstream_host="127.0.0.1:19100",
            public_host="harnes.insanustech.com.ar",
            public_scheme="https",
        ).decode("utf-8")
        assert 'id="insanus-obsidian-skin"' in skinned
        assert "#09090b" in skinned
        assert "<script" not in skinned
        assert "https://harnes.insanustech.com.ar/ide/abc/res" in skinned
        assert "127.0.0.1:19100" not in skinned
        import html as html_mod
        import json as json_mod
        import re as re_mod

        meta_match = re_mod.search(r'id="vscode-workbench-web-configuration"\s+data-settings="([^"]+)"', skinned)
        assert meta_match is not None
        web_cfg = json_mod.loads(html_mod.unescape(meta_match.group(1)))
        assert web_cfg["enableWorkspaceTrust"] is False
        assert web_cfg["initialColorTheme"]["themeType"] == "dark"
        assert web_cfg["initialColorTheme"]["colors"]["editor.background"] == "#09090b"
        assert web_cfg["configurationDefaults"]["workbench.colorTheme"] == "Insanus Obsidian"
        assert web_cfg["configurationDefaults"]["window.autoDetectColorScheme"] is False
        assert web_cfg["configurationDefaults"]["workbench.startupEditor"] == "none"

        # 3. Seguridad del proxy /ide/{secret} + Bootstrap de carpeta + Diagnósticos LSP + Cola de comandos
        proj_dir = Path(tmpdir) / "InsanusChat_Backend"
        proj_dir.mkdir(parents=True, exist_ok=True)
        auth_headers = {"X-Workstation-Token": "test-ephemeral-secret-2026"}
        transport = ASGITransport(app=daemon_main.app)

        async with AsyncClient(transport=transport, base_url="http://127.0.0.1") as client:
            r_bad_ide = await client.get("/ide/invalid-secret-000/")
            assert r_bad_ide.status_code == 401

            r_status = await client.get("/local/ide/status", headers=auth_headers)
            assert r_status.status_code == 200
            assert "insanuschat-harness" in r_status.json()["bundled_extensions"]
            assert "insanus-obsidian-theme" in r_status.json()["bundled_extensions"]

            r_boot = await client.get(
                "/local/ide/bootstrap-context",
                headers=auth_headers,
                params={"folder": str(proj_dir)},
            )
            assert r_boot.status_code == 200
            assert r_boot.json()["workspace_path"] == "InsanusChat_Backend"
            assert r_boot.json()["workspace_name"] == "InsanusChat_Backend"

            r_diag_post = await client.post(
                "/local/ide/diagnostics",
                headers=auth_headers,
                json={
                    "workspace_path": "InsanusChat_Backend",
                    "active_file": "routers/chats.py",
                    "error_count": 1,
                    "warning_count": 0,
                    "diagnostics": [
                        {
                            "file": "routers/chats.py",
                            "line": 42,
                            "severity": "error",
                            "message": "Undefined variable 'foo'",
                            "source": "Pylance",
                        }
                    ],
                },
            )
            assert r_diag_post.status_code == 200
            assert r_diag_post.json()["error_count"] == 1

            rpc_diag = daemon_main.dispatch_harness_rpc(
                "get_ide_diagnostics",
                {"workspace": "InsanusChat_Backend", "path": "chats.py"},
                is_remote=False,
            )
            assert rpc_diag["error_count"] == 1
            assert rpc_diag["diagnostics"][0]["source"] == "Pylance"

            r_open = await client.post(
                "/local/ide/open-file",
                headers=auth_headers,
                json={"workspace": "InsanusChat_Backend", "path": "routers/chats.py", "line": 42},
            )
            assert r_open.status_code == 200
            r_poll = await client.get(
                "/local/ide/commands/poll",
                headers=auth_headers,
                params={"workspace": "InsanusChat_Backend"},
            )
            assert r_poll.status_code == 200
            cmds = r_poll.json()["commands"]
            assert len(cmds) == 1
            assert cmds[0]["action"] == "open_file"
            assert cmds[0]["line"] == 42

