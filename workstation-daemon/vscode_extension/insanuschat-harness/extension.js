const vscode = require('vscode');

function getConfigUrls() {
  const cfg = vscode.workspace.getConfiguration('insanuschat');
  const daemonUrl = (cfg.get('localDaemonUrl') || 'http://127.0.0.1:8765').replace(/\/+$/, '');
  const webAppUrl = (cfg.get('webAppUrl') || 'http://localhost:3000').replace(/\/+$/, '');
  return { daemonUrl, webAppUrl };
}

/**
 * Extensión integrada en VS Code / VSCodium / InsanusCode para InsanusChat Workstation v1.4.
 * Se conecta dinámicamente al microservicio local (127.0.0.1) y permite enviar selección y diagnósticos LSP.
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBar.text = '$(git-branch) InsanusChat';
  statusBar.tooltip = 'InsanusChat Workstation Harness — Click para abrir la Vista de Agente';
  statusBar.command = 'insanuschat.openAgentView';
  statusBar.show();
  context.subscriptions.push(statusBar);

  const provider = {
    resolveWebviewView(webviewView) {
      const { daemonUrl, webAppUrl } = getConfigUrls();
      webviewView.webview.options = { enableScripts: true };
      webviewView.webview.html = getWebviewHtml(daemonUrl, webAppUrl);
    },
  };

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('insanuschat.agentView', provider)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('insanuschat.openAgentView', () => {
      const { daemonUrl, webAppUrl } = getConfigUrls();
      const panel = vscode.window.createWebviewPanel(
        'insanuschatAgentPanel',
        'InsanusChat — Vista de Agente & Árbol 2D',
        vscode.ViewColumn.Beside,
        { enableScripts: true, retainContextWhenHidden: true }
      );
      panel.webview.html = getWebviewHtml(daemonUrl, webAppUrl);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('insanuschat.sendSelectionToAgent', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('InsanusChat: Abrí un archivo primero.');
        return;
      }
      const selection = editor.document.getText(editor.selection);
      const relPath = vscode.workspace.asRelativePath(editor.document.uri);
      const line = editor.selection.start.line + 1;
      const snippet = `Archivo: ${relPath}:${line}\n\`\`\`\n${selection}\n\`\`\``;
      await vscode.env.clipboard.writeText(snippet);
      vscode.window.showInformationMessage(
        `InsanusChat: Contexto de ${relPath}:${line} copiado y listo para enviar al Agente.`
      );
      vscode.commands.executeCommand('insanuschat.openAgentView');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('insanuschat.sendDiagnosticsToAgent', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const diags = vscode.languages.getDiagnostics(editor.document.uri);
      const summary = diags
        .map((d) => `Línea ${d.range.start.line + 1} [${d.severity}]: ${d.message}`)
        .join('\n');
      const relPath = vscode.workspace.asRelativePath(editor.document.uri);
      await vscode.env.clipboard.writeText(
        `Corrige los siguientes diagnósticos LSP en ${relPath}:\n${summary || '(Sin errores detectados)'}`
      );
      vscode.window.showInformationMessage(
        `InsanusChat: ${diags.length} diagnósticos LSP de ${relPath} listos para el Agente.`
      );
    })
  );
}

function getWebviewHtml(daemonUrl, appUrl) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <style>
    html, body, iframe { margin: 0; padding: 0; width: 100%; height: 100vh; border: 0; background: #09090b; }
    .bar { display: flex; justify-content: space-between; align-items: center; padding: 6px 10px; background: #0e1017; color: #34d399; font-family: sans-serif; font-size: 11px; border-bottom: 1px solid rgba(255,255,255,0.08); }
    .bar a { color: #38bdf8; text-decoration: none; }
  </style>
</head>
<body>
  <div class="bar">
    <span>⚡ InsanusChat Workstation Daemon: ${daemonUrl}</span>
    <a href="${appUrl}" target="_blank">Abrir Web</a>
  </div>
  <iframe src="${appUrl}" allow="clipboard-read; clipboard-write"></iframe>
</body>
</html>`;
}

function deactivate() {}

module.exports = { activate, deactivate };
