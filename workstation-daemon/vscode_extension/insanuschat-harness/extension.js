const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const vscode = require('vscode');

function getRuntimeFilePath() {
  if (process.env.INSANUS_WORKSTATION_CONFIG_DIR) {
    return path.join(process.env.INSANUS_WORKSTATION_CONFIG_DIR, 'runtime.json');
  }
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'InsanusChatWorkstation', 'runtime.json');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'InsanusChatWorkstation', 'runtime.json');
  }
  const xdg = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(xdg, 'insanuschat-workstation', 'runtime.json');
}

function readLocalRuntimeInfo() {
  const cfg = vscode.workspace.getConfiguration('insanuschat');
  const fallbackDaemon = (cfg.get('localDaemonUrl') || 'http://127.0.0.1:8765').replace(/\/+$/, '');
  const fallbackWeb = (cfg.get('webAppUrl') || 'https://harnes.insanustech.com.ar').replace(/\/+$/, '');
  try {
    const rtPath = getRuntimeFilePath();
    if (fs.existsSync(rtPath)) {
      const parsed = JSON.parse(fs.readFileSync(rtPath, 'utf8'));
      return {
        daemonUrl: String(parsed.daemon_url || fallbackDaemon).replace(/\/+$/, ''),
        localToken: String(parsed.local_token || ''),
        webAppUrl: String(parsed.cloud_backend_url || fallbackWeb).replace(/\/+$/, ''),
        nodeId: parsed.node_id || null,
      };
    }
  } catch {}
  return {
    daemonUrl: fallbackDaemon,
    localToken: '',
    webAppUrl: fallbackWeb,
    nodeId: null,
  };
}

function getWorkspaceRootPath() {
  const folders = vscode.workspace.workspaceFolders;
  if (folders && folders.length > 0) {
    return folders[0].uri.fsPath;
  }
  return '';
}

function collectDiagnosticsSummary(maxItems = 80) {
  const all = vscode.languages.getDiagnostics();
  const items = [];
  let errorCount = 0;
  let warningCount = 0;

  for (const [uri, diags] of all) {
    const rel = vscode.workspace.asRelativePath(uri, false);
    for (const d of diags) {
      let sev = 'info';
      if (d.severity === vscode.DiagnosticSeverity.Error) {
        sev = 'error';
        errorCount += 1;
      } else if (d.severity === vscode.DiagnosticSeverity.Warning) {
        sev = 'warning';
        warningCount += 1;
      } else if (d.severity === vscode.DiagnosticSeverity.Hint) {
        sev = 'hint';
      }
      if (items.length < maxItems && (sev === 'error' || sev === 'warning')) {
        items.push({
          file: rel,
          line: (d.range?.start?.line ?? 0) + 1,
          col: (d.range?.start?.character ?? 0) + 1,
          severity: sev,
          message: String(d.message || '').slice(0, 400),
          source: d.source || 'LSP',
        });
      }
    }
  }
  return { items, errorCount, warningCount };
}

async function fetchDaemonBootstrap(context) {
  const rt = readLocalRuntimeInfo();
  const folderPath = getWorkspaceRootPath();
  const workspaceName = folderPath ? path.basename(folderPath) : 'Workspace';
  const savedToken = context.globalState.get('insanus_jwt_token') || null;

  const result = {
    backendUrl: rt.webAppUrl,
    jwtToken: savedToken,
    daemonUrl: rt.daemonUrl,
    localToken: rt.localToken,
    nodeId: rt.nodeId,
    workspacePath: '.',
    workspaceName,
    folderPath,
    initialChatId: null,
    isEmbedded: vscode.env.uiKind === vscode.UIKind.Web,
  };

  try {
    const headers = {};
    if (rt.localToken) headers['X-Workstation-Token'] = rt.localToken;
    const url = `${rt.daemonUrl}/local/ide/bootstrap-context?folder=${encodeURIComponent(folderPath)}`;
    const res = await fetch(url, { headers });
    if (res.ok) {
      const data = await res.json();
      if (data.cloud_backend_url) result.backendUrl = String(data.cloud_backend_url).replace(/\/+$/, '');
      if (data.access_token) result.jwtToken = data.access_token;
      if (data.node_id) result.nodeId = data.node_id;
      if (data.workspace_path) result.workspacePath = data.workspace_path;
      if (data.workspace_name) result.workspaceName = data.workspace_name;
      if (data.active_chat_id) result.initialChatId = data.active_chat_id;
    }
  } catch {}

  return result;
}

function getNonce() {
  return crypto.randomBytes(16).toString('hex');
}

function buildWebviewHtml(webview, extensionUri) {
  const nonce = getNonce();
  const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'webview', 'webview.js'));
  const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'webview', 'webview.css'));

  return `<!DOCTYPE html>
<html lang="es" class="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} https: http: data: blob:; font-src ${webview.cspSource} https: data:; connect-src https: http: ws: wss:;" />
  <link rel="stylesheet" href="${cssUri}" />
  <title>insanus-harnes Chat</title>
</head>
<body style="margin:0;padding:0;background:#09090b;color:#e4e4e7;">
  <div id="root"></div>
  <script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
}

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  let activeWebviews = new Set();
  let lastBootstrap = null;
  let pollTimer = null;
  let diagTimer = null;

  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBar.text = '$(sparkle) insanus-harnes';
  statusBar.tooltip = 'insanus-harnes — Abrir Chat del Workspace (Ctrl+Shift+I)';
  statusBar.command = 'insanuschat.focusChat';
  statusBar.show();
  context.subscriptions.push(statusBar);

  function broadcastToWebviews(msg) {
    for (const wv of activeWebviews) {
      try {
        wv.postMessage(msg);
      } catch {}
    }
  }

  function pushEditorContext() {
    const editor = vscode.window.activeTextEditor;
    const activeFile = editor ? vscode.workspace.asRelativePath(editor.document.uri, false) : null;
    const line = editor ? editor.selection.active.line + 1 : undefined;
    const selection = editor && !editor.selection.isEmpty ? editor.document.getText(editor.selection).slice(0, 4000) : '';
    const { items, errorCount, warningCount } = collectDiagnosticsSummary(60);

    broadcastToWebviews({
      type: 'editorContext',
      payload: {
        activeFile,
        line,
        selection,
        diagnostics: items,
        errorCount,
        warningCount,
      },
    });
  }

  async function syncDiagnosticsToDaemon() {
    const rt = readLocalRuntimeInfo();
    const folderPath = getWorkspaceRootPath();
    if (!rt.daemonUrl) return;
    const { items, errorCount, warningCount } = collectDiagnosticsSummary(120);
    const editor = vscode.window.activeTextEditor;
    const activeFile = editor ? vscode.workspace.asRelativePath(editor.document.uri, false) : null;
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (rt.localToken) headers['X-Workstation-Token'] = rt.localToken;
      await fetch(`${rt.daemonUrl}/local/ide/diagnostics`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          folder: folderPath,
          workspace_path: lastBootstrap?.workspacePath || '.',
          active_file: activeFile,
          error_count: errorCount,
          warning_count: warningCount,
          diagnostics: items,
        }),
      });
    } catch {}
  }

  function scheduleDiagnosticsSync() {
    if (diagTimer) clearTimeout(diagTimer);
    diagTimer = setTimeout(() => {
      pushEditorContext();
      syncDiagnosticsToDaemon();
    }, 350);
  }

  async function openWorkspaceFile(relOrAbsPath, line) {
    if (!relOrAbsPath) return;
    const root = getWorkspaceRootPath();
    const targetPath = path.isAbsolute(relOrAbsPath)
      ? relOrAbsPath
      : root
      ? path.join(root, relOrAbsPath)
      : relOrAbsPath;
    if (!fs.existsSync(targetPath)) {
      vscode.window.showWarningMessage(`insanus-harnes: Archivo no encontrado (${relOrAbsPath})`);
      return;
    }
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(targetPath));
    const editor = await vscode.window.showTextDocument(doc, { preview: false });
    if (line && Number(line) > 0) {
      const pos = new vscode.Position(Math.max(0, Number(line) - 1), 0);
      editor.selection = new vscode.Selection(pos, pos);
      editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
    }
  }

  async function handleIncomingDaemonCommand(cmd) {
    if (!cmd || typeof cmd !== 'object') return;
    if (cmd.action === 'open_file') {
      await openWorkspaceFile(cmd.path, cmd.line);
    } else if (cmd.action === 'focus_chat') {
      await vscode.commands.executeCommand('insanuschat.focusChat');
    } else if (cmd.action === 'switch_chat' && cmd.chat_id) {
      broadcastToWebviews({ type: 'switchChat', chatId: cmd.chat_id });
    }
  }

  // Polling liviano de comandos remotos del daemon (compatible con cualquier versión Node de VS Code / OpenVSCode)
  pollTimer = setInterval(async () => {
    const rt = readLocalRuntimeInfo();
    if (!rt.daemonUrl) return;
    try {
      const headers = {};
      if (rt.localToken) headers['X-Workstation-Token'] = rt.localToken;
      const wsParam = encodeURIComponent(lastBootstrap?.workspacePath || '.');
      const res = await fetch(`${rt.daemonUrl}/local/ide/commands/poll?workspace=${wsParam}`, { headers });
      if (res.ok) {
        const data = await res.json();
        const cmds = Array.isArray(data.commands) ? data.commands : [];
        for (const c of cmds) {
          await handleIncomingDaemonCommand(c);
        }
      }
    } catch {}
  }, 1400);

  context.subscriptions.push({
    dispose: () => {
      if (pollTimer) clearInterval(pollTimer);
      if (diagTimer) clearTimeout(diagTimer);
    },
  });

  function wireWebview(webview) {
    activeWebviews.add(webview);
    webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
    };
    webview.html = buildWebviewHtml(webview, context.extensionUri);

    webview.onDidReceiveMessage(async (msg) => {
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'ready') {
        lastBootstrap = await fetchDaemonBootstrap(context);
        webview.postMessage({ type: 'bootstrap', payload: lastBootstrap });
        pushEditorContext();
        syncDiagnosticsToDaemon();
      } else if (msg.type === 'openFile' || msg.type === 'openDiff') {
        await openWorkspaceFile(msg.path, msg.line);
      } else if (msg.type === 'openExternalApp') {
        const base = lastBootstrap?.backendUrl || 'https://harnes.insanustech.com.ar';
        vscode.env.openExternal(vscode.Uri.parse(base));
      } else if (msg.type === 'saveLoginToken' && msg.token) {
        await context.globalState.update('insanus_jwt_token', msg.token);
      }
    });
  }

  const sidebarProvider = {
    resolveWebviewView(webviewView) {
      wireWebview(webviewView.webview);
      webviewView.onDidDispose(() => {
        activeWebviews.delete(webviewView.webview);
      });
    },
  };

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('insanuschat.agentView', sidebarProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('insanuschat.focusChat', async () => {
      await vscode.commands.executeCommand('workbench.view.extension.insanuschat-sidebar');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('insanuschat.openAgentView', () => {
      const panel = vscode.window.createWebviewPanel(
        'insanuschatAgentPanel',
        'insanus-harnes — Chat del Workspace',
        vscode.ViewColumn.Beside,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
        }
      );
      wireWebview(panel.webview);
      panel.onDidDispose(() => activeWebviews.delete(panel.webview));
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('insanuschat.sendSelectionToAgent', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('insanus-harnes: Abrí un archivo primero.');
        return;
      }
      const selection = editor.document.getText(editor.selection);
      const relPath = vscode.workspace.asRelativePath(editor.document.uri, false);
      const line = editor.selection.start.line + 1;
      const snippet = selection
        ? `Archivo \`${relPath}:${line}\`:\n\`\`\`\n${selection}\n\`\`\``
        : `Revisá \`${relPath}:${line}\``;
      await vscode.commands.executeCommand('insanuschat.focusChat');
      setTimeout(() => broadcastToWebviews({ type: 'prefillPrompt', text: snippet }), 250);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('insanuschat.sendDiagnosticsToAgent', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const diags = vscode.languages.getDiagnostics(editor.document.uri);
      const relPath = vscode.workspace.asRelativePath(editor.document.uri, false);
      const summary = diags
        .map((d) => `- Línea ${d.range.start.line + 1} [${d.source || 'LSP'}]: ${d.message}`)
        .join('\n');
      const prompt = `Corregí los siguientes diagnósticos LSP en \`${relPath}\`:\n${summary || '(Sin errores detectados)'}`;
      await vscode.commands.executeCommand('insanuschat.focusChat');
      setTimeout(() => broadcastToWebviews({ type: 'prefillPrompt', text: prompt }), 250);
    })
  );

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => pushEditorContext()),
    vscode.window.onDidChangeTextEditorSelection(() => pushEditorContext()),
    vscode.languages.onDidChangeDiagnostics(() => scheduleDiagnosticsSync())
  );

  // Sincronización inicial con el daemon + auto-foco en Editor Vestido (Desktop)
  fetchDaemonBootstrap(context).then((boot) => {
    lastBootstrap = boot;
    syncDiagnosticsToDaemon();
    const cfg = vscode.workspace.getConfiguration('insanuschat');
    if (vscode.env.uiKind === vscode.UIKind.Desktop && cfg.get('autoFocusSidebar', true)) {
      // Solo enfoca automáticamente cuando se abrió con el perfil vestido de insanus-harnes
      const userDataHint = (process.env.VSCODE_APPDATA || context.globalStorageUri?.fsPath || '').toLowerCase();
      if (userDataHint.includes('vscode-dressed-profile')) {
        vscode.commands.executeCommand('workbench.view.extension.insanuschat-sidebar');
      }
    }
  });
}

function deactivate() {}

module.exports = { activate, deactivate };
