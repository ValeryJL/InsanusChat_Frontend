import React, { useEffect, useRef, useState } from 'react';
import { RotateCw } from 'lucide-react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { getRemoteTerminalWebSocketUrl } from '../api';

interface XtermTerminalProps {
  nodeId: string;
  nodeName: string;
  nodeOs?: string;
  defaultShell?: string;
  workspace: string;
  onCommandComplete?: () => void;
}

export const XtermTerminal: React.FC<XtermTerminalProps> = ({
  nodeId,
  nodeOs,
  defaultShell,
  workspace,
}) => {
  const isWindows = (nodeOs || '').toLowerCase().startsWith('win');
  const availableShells = isWindows ? ['powershell', 'cmd', 'bash'] : ['bash', 'sh'];
  const [selectedShell, setSelectedShell] = useState<string>(
    defaultShell || (isWindows ? 'powershell' : 'bash')
  );
  const [activeShell, setActiveShell] = useState<string>(
    defaultShell || (isWindows ? 'powershell' : 'bash')
  );
  const [sessionNonce, setSessionNonce] = useState(0);
  const [connected, setConnected] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setSelectedShell(defaultShell || (isWindows ? 'powershell' : 'bash'));
  }, [nodeId, nodeOs, defaultShell]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const term = new XTerm({
      cursorBlink: true,
      allowProposedApi: true,
      fontFamily: '"JetBrains Mono", "Cascadia Code", Consolas, monospace',
      fontSize: 12.5,
      lineHeight: 1.32,
      scrollback: 5000,
      theme: {
        background: '#09090b',
        foreground: '#e4e4e7',
        cursor: '#10b981',
        cursorAccent: '#09090b',
        selectionBackground: '#10b98138',
        black: '#18181b',
        red: '#fb7185',
        green: '#34d399',
        yellow: '#fbbf24',
        blue: '#60a5fa',
        magenta: '#c084fc',
        cyan: '#22d3ee',
        white: '#f4f4f5',
        brightBlack: '#52525b',
        brightRed: '#fda4af',
        brightGreen: '#6ee7b7',
        brightYellow: '#fde047',
        brightBlue: '#93c5fd',
        brightMagenta: '#d8b4fe',
        brightCyan: '#67e8f9',
        brightWhite: '#ffffff',
      },
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(el);
    try {
      fitAddon.fit();
    } catch {}

    const initialCols = term.cols || 100;
    const initialRows = term.rows || 24;

    const wsUrl = getRemoteTerminalWebSocketUrl(nodeId, workspace, {
      cols: initialCols,
      rows: initialRows,
      shell: selectedShell,
    });
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      setConnected(true);
      term.focus();
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.cmd === 'terminal_ready') {
          if (msg.shell) setActiveShell(msg.shell);
        } else if (msg.cmd === 'pty_output' && typeof msg.data === 'string') {
          term.write(msg.data);
        } else if (msg.cmd === 'pty_error') {
          term.writeln(`\r\n\x1b[31m[Error PTY] ${msg.message || 'No se pudo abrir el shell'}\x1b[0m`);
        } else if (msg.cmd === 'pty_exit') {
          term.writeln(
            `\r\n\x1b[90m[Proceso ${activeShell} finalizado · código ${msg.exit_code ?? 0}. Presioná Reiniciar para abrir otra sesión.]\x1b[0m`
          );
          setConnected(false);
        }
      } catch {}
    };

    ws.onerror = () => {
      setConnected(false);
    };

    ws.onclose = () => {
      setConnected(false);
    };

    // Streaming crudo bidireccional: cada tecla (Tab, Ctrl+C, flechas, REPLs, cd, vim) va directo al PTY real
    const onDataDisp = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ cmd: 'input', data }));
      }
    });

    const onResizeDisp = term.onResize(({ cols, rows }) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ cmd: 'resize', cols, rows }));
      }
    });

    const resizeObs = new ResizeObserver(() => {
      try {
        fitAddon.fit();
      } catch {}
    });
    resizeObs.observe(el);

    return () => {
      resizeObs.disconnect();
      onDataDisp.dispose();
      onResizeDisp.dispose();
      try {
        ws.close();
      } catch {}
      term.dispose();
    };
  }, [nodeId, workspace, selectedShell, sessionNonce]);

  return (
    <div className="w-full h-full bg-[#09090b] overflow-hidden flex flex-col">
      {/* Barra limpia del shell real sin solaparse jamás con la salida del terminal */}
      <div className="h-7 px-2.5 bg-[#0c0e14] border-b border-white/[0.05] flex items-center justify-between text-[10.5px] font-mono shrink-0">
        <div className="flex items-center gap-1.5 text-zinc-400 truncate">
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${connected ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
          <span className="text-zinc-300">{activeShell}</span>
          <span className="text-zinc-600">·</span>
          <span className="text-zinc-500 truncate">{workspace}</span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <select
            aria-label="Shell real del sistema"
            value={selectedShell}
            onChange={(e) => setSelectedShell(e.target.value)}
            className="bg-[#161922] border border-white/[0.08] rounded px-1.5 py-0.5 text-[10.5px] text-zinc-300 outline-none cursor-pointer"
          >
            {availableShells.map((sh) => (
              <option key={sh} value={sh} className="bg-[#11131a] text-zinc-100">
                {sh}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setSessionNonce((n) => n + 1)}
            className="p-1 rounded hover:bg-white/[0.08] text-zinc-400 hover:text-zinc-100 transition"
            title={`Reiniciar sesión real de ${activeShell}`}
          >
            <RotateCw className="w-3 h-3" />
          </button>
        </div>
      </div>

      <div ref={containerRef} className="flex-1 min-h-0 w-full px-2 py-1" />
    </div>
  );
};
