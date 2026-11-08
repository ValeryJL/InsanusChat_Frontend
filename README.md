# InsanusChat Frontend — Web SPA & Workstation Desktop App (Windows & Linux)

**InsanusChat_Frontend** es la interfaz unificada inspirada en **Google Antigravity** que se compila en dos targets desde el mismo código fuente:

1. **Target Web / Móvil (`Docker + Nginx`)**: Chat ramificado en árbol 2D táctil, Agent & Tool Studio, Panel Admin, VS Code Workbench embebido (Monaco Editor + DiffEditor + Xterm.js PTY + Marketplace Oficial) y descarga directa de instaladores Desktop.
2. **Target Desktop Workstation (`Tauri v2` · Windows `.exe`/`.msi` & Linux `.AppImage`/`.deb`)**: Aplicación nativa con **microservicio local sidecar (`workstation-daemon`)** autocontenido (sin requerir Python instalado), **System Tray** con switch de Control Remoto, acceso local a 0 ms (`127.0.0.1`) y **Panel de Configuración estilo Antigravity (`Ctrl+,`)**.

---

## Estructura del Repositorio

```text
InsanusChat_Frontend/
├── src/
│   ├── platform/desktop.ts           # Puente Dual-Mode (Web vs Tauri v2 IPC, Server URL, Tray, Folder Picker)
│   ├── api.ts                        # Cliente REST/WS con ruteo Local-First 0ms en Desktop y Cloud SSOT
│   ├── components/
│   │   ├── SettingsView.tsx          # Panel de Configuración estilo Antigravity (5 categorías + Releases)
│   │   ├── VSCodeEditorView.tsx      # Monaco Editor/DiffEditor + Xterm.js PTY + Git + Marketplace + Abrir VS Code
│   │   ├── EnvironmentPopover.tsx    # Selector Nube vs Workstation + Switch Control Remoto
│   │   ├── TreeGraphView.tsx         # Grafo 2D SVG interactivo (Detallado / Compacto / Colapsado)
│   │   ├── StudioView.tsx            # Agentes, MCPs, Snippets Python y Bóveda API Keys
│   │   └── AdminView.tsx             # Panel Admin y Políticas Globales
├── workstation-daemon/               # Microservicio Local Python (PyInstaller Sidecar)
│   ├── config.py                     # Rutas estándar SO (%APPDATA% / ~/.config) + caché SSOT
│   ├── main.py                       # FastAPI 127.0.0.1 + X-Workstation-Token + Watchdog anti-zombie
│   ├── ws_bridge.py                  # Túnel WS saliente opt-in + policy_sync + Kill-Switch
│   ├── harness/                      # Filesystem/Diffs, Terminal segura + Denylist, ConPTY/PTY, Git, VS Code Mgr
│   ├── vscode_extension/             # Extensión nativa insanuschat-harness para VS Code / VSCodium / InsanusCode
│   └── build_sidecar.py              # Compilador PyInstaller multiplataforma (Windows & Linux)
├── src-tauri/                        # Shell Nativo Desktop (Rust / Tauri v2)
│   ├── tauri.conf.json               # externalBin, resources, CSP offline Monaco, bundles NSIS/MSI/DEB/AppImage
│   └── src/                          # sidecar.rs (puerto libre + token efímero), tray.rs (System Tray)
├── scripts/
│   ├── copy-monaco.mjs               # Bundle offline de Monaco (/vs) dentro de dist/
│   └── generate-icons.py             # Generador de íconos Obsidian + Emerald
└── .github/workflows/
    └── release-desktop.yml           # CI/CD automático Windows + Linux -> GitHub Releases
```

---

## Compilación y Desarrollo

### Modo Web (Desarrollo / Docker)
```bash
npm install
npm run dev
# Build producción Web (incluye dist/vs offline para Monaco)
npm run build
```

### Modo Desktop Workstation (Windows & Linux)
```bash
# 1. Compilar microservicio local sidecar (PyInstaller standalone)
cd workstation-daemon
pip install -r requirements.txt
pytest -v tests/test_daemon.py
cd ..
python workstation-daemon/build_sidecar.py

# 2. Compilar instaladores nativos Tauri v2 (.exe/.msi en Windows · .AppImage/.deb en Linux)
npm install
npm run tauri:build
```

### Releases Oficiales (CI/CD)
Al publicar un tag `v*.*.*` (por ejemplo `git tag v1.4.0 && git push origin v1.4.0`), `.github/workflows/release-desktop.yml` compila en paralelo en `windows-latest` y `ubuntu-22.04` y publica en **GitHub Releases** los 4 instaladores + `SHA256SUMS.txt`.
