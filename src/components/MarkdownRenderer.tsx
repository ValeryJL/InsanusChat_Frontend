import React, { useState } from 'react';
import {
  AlertCircle,
  Check,
  ChevronRight,
  Copy,
  FileCode2,
  Terminal,
} from 'lucide-react';
import { ToolCallTrace } from '../types';
import { UnifiedDiffBlock } from './AgentTaskPlan';

interface MarkdownRendererProps {
  content: string;
  toolCalls?: ToolCallTrace[];
  onOpenFileInEditor?: (filePath: string, diff?: string) => void;
}

function formatInline(text: string): React.ReactNode[] {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return parts.map((part, idx) => {
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <code
          key={idx}
          className="px-1.5 py-0.5 mx-0.5 text-[12px] font-mono rounded bg-white/[0.06] text-emerald-300 border border-white/[0.07] break-all"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return (
        <strong key={idx} className="font-semibold text-zinc-50">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      return (
        <em key={idx} className="italic text-zinc-300">
          {part.slice(1, -1)}
        </em>
      );
    }
    return part;
  });
}

const CodeBlock: React.FC<{ lang: string; code: string }> = ({ lang, code }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard?.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="my-3 rounded-xl overflow-hidden border border-white/[0.08] bg-[#0b0d12]">
      <div className="h-8 flex items-center justify-between px-3 bg-[#11131a] border-b border-white/[0.06] text-[11px] text-zinc-400">
        <span className="flex items-center gap-1.5 font-mono uppercase tracking-wider text-zinc-400">
          <Terminal className="w-3 h-3 text-emerald-400" />
          {lang || 'code'}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-white/[0.06] text-zinc-400 hover:text-zinc-200 transition"
          title="Copiar código"
        >
          {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
          <span>{copied ? 'Copiado' : 'Copiar'}</span>
        </button>
      </div>
      <pre className="p-3 text-[12px] font-mono text-zinc-200 overflow-x-auto leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
};

function describeToolAction(tc: ToolCallTrace, parsedResult: any): { label: string; target: string; ok: boolean } {
  const name = tc.tool || 'tool';
  const args = tc.args || {};
  const hasErr =
    (parsedResult && parsedResult.exit_code !== undefined && parsedResult.exit_code !== 0) ||
    (parsedResult && parsedResult.status === 'rejected_by_user') ||
    (typeof tc.result === 'string' && tc.result.toLowerCase().startsWith('error:'));

  if (name === 'workspace_list_files') {
    return { label: 'Listó archivos', target: args.directory || '.', ok: !hasErr };
  }
  if (name === 'workspace_read_file') {
    return { label: 'Leyó', target: args.path || '', ok: !hasErr };
  }
  if (name === 'workspace_edit_file') {
    return { label: 'Editó', target: parsedResult?.path || args.path || '', ok: !hasErr };
  }
  if (name === 'workspace_write_file') {
    const verb = parsedResult?.action === 'created' ? 'Creó' : 'Escribió';
    return { label: verb, target: parsedResult?.path || args.path || '', ok: !hasErr };
  }
  if (name === 'workspace_grep_search') {
    return { label: 'Buscó', target: args.query || '', ok: !hasErr };
  }
  if (name === 'workspace_run_command') {
    const cmd = parsedResult?.command || args.command_line || '';
    const extra = parsedResult?.duration_ms ? ` · ${parsedResult.duration_ms}ms` : '';
    return { label: 'Ejecutó', target: `${cmd}${extra}`, ok: !hasErr };
  }
  if (name === 'harness_update_plan') {
    const count = parsedResult?.task_plan?.length || args.steps?.length || 0;
    return { label: 'Actualizó plan', target: `${count} pasos`, ok: !hasErr };
  }
  if (name === 'workspace_git_checkpoint') {
    return { label: 'Git checkpoint', target: parsedResult?.branch_suggested || args.label || '', ok: !hasErr };
  }
  const argPreview = Object.values(args).slice(0, 2).join(', ');
  return { label: name, target: argPreview.slice(0, 48), ok: !hasErr };
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({
  content,
  toolCalls,
  onOpenFileInEditor,
}) => {
  // Por defecto TODAS las llamadas a herramientas arrancan colapsadas en 1 línea limpia estilo Antigravity/Claude
  const [openIndices, setOpenIndices] = useState<Record<number, boolean>>({});

  const segments = (content || '').split(/(```[\s\S]*?```)/g);

  return (
    <div className="space-y-2 text-[13.5px] text-zinc-300 leading-relaxed break-words min-w-0">
      {toolCalls && toolCalls.length > 0 && (
        <div className="space-y-1.5 mb-3">
          {toolCalls.map((tc, i) => {
            let parsedResult: any = null;
            try {
              if (typeof tc.result === 'string' && tc.result.trim().startsWith('{')) {
                parsedResult = JSON.parse(tc.result);
              }
            } catch {}

            const { label, target, ok } = describeToolAction(tc, parsedResult);
            const isOpen = Boolean(openIndices[i]);
            const isFileDiffTool =
              (tc.tool === 'workspace_edit_file' || tc.tool === 'workspace_write_file') &&
              parsedResult?.path;
            const isCommandTool =
              tc.tool === 'workspace_run_command' && parsedResult && parsedResult.command !== undefined;

            return (
              <div
                key={i}
                className="rounded-lg bg-[#11131a] border border-white/[0.07] overflow-hidden"
              >
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setOpenIndices((prev) => ({ ...prev, [i]: !prev[i] }))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setOpenIndices((prev) => ({ ...prev, [i]: !prev[i] }));
                    }
                  }}
                  className="min-h-[32px] px-2.5 py-1.5 hover:bg-[#161922] flex items-center justify-between gap-2 text-xs cursor-pointer transition"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {ok ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    ) : (
                      <AlertCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                    )}
                    <span className="text-zinc-300 font-medium shrink-0">{label}</span>
                    {target && (
                      <span className="font-mono text-[11px] text-zinc-500 truncate">{target}</span>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {isFileDiffTool && onOpenFileInEditor && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenFileInEditor(parsedResult.path, parsedResult.diff);
                        }}
                        className="px-2 py-0.5 rounded-md bg-white/[0.06] hover:bg-white/[0.12] text-zinc-200 text-[11px] flex items-center gap-1 transition"
                      >
                        <FileCode2 className="w-3 h-3 text-emerald-400" />
                        <span>Abrir</span>
                      </button>
                    )}
                    <ChevronRight
                      className={`w-3.5 h-3.5 text-zinc-500 transition-transform ${
                        isOpen ? 'rotate-90' : ''
                      }`}
                    />
                  </div>
                </div>

                {isOpen && (
                  <div className="px-3 py-2 border-t border-white/[0.06] bg-[#0b0d12] font-mono text-[11px] max-h-52 overflow-auto space-y-2">
                    {isFileDiffTool && parsedResult.diff ? (
                      <UnifiedDiffBlock diff={parsedResult.diff} maxHeight="max-h-48" />
                    ) : isCommandTool ? (
                      <div className="space-y-1">
                        <div className="text-amber-300">$ {parsedResult.command}</div>
                        {parsedResult.stdout && (
                          <pre className="text-zinc-200 whitespace-pre-wrap break-all">
                            {parsedResult.stdout}
                          </pre>
                        )}
                        {parsedResult.stderr && (
                          <pre className="text-rose-300 whitespace-pre-wrap break-all">
                            {parsedResult.stderr}
                          </pre>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-1.5 text-zinc-400">
                        <div>
                          <span className="text-zinc-500">Args: </span>
                          {JSON.stringify(tc.args)}
                        </div>
                        <pre className="text-zinc-300 whitespace-pre-wrap break-all">
                          {parsedResult ? JSON.stringify(parsedResult, null, 2) : tc.result}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {segments.map((seg, i) => {
        if (seg.startsWith('```') && seg.endsWith('```')) {
          const inner = seg.slice(3, -3);
          const firstNewLine = inner.indexOf('\n');
          const lang = firstNewLine !== -1 ? inner.slice(0, firstNewLine).trim() : '';
          const code = firstNewLine !== -1 ? inner.slice(firstNewLine + 1) : inner;
          return <CodeBlock key={i} lang={lang} code={code} />;
        }

        const lines = seg.split('\n');
        return (
          <div key={i} className="space-y-1.5">
            {lines.map((line, lIdx) => {
              const trimmed = line.trim();
              if (!trimmed) return <div key={lIdx} className="h-1" />;
              if (trimmed.startsWith('#### ')) {
                return (
                  <h4 key={lIdx} className="text-[13px] font-semibold text-emerald-300 pt-1">
                    {formatInline(trimmed.slice(5))}
                  </h4>
                );
              }
              if (trimmed.startsWith('### ')) {
                return (
                  <h3 key={lIdx} className="text-[14.5px] font-semibold text-zinc-100 pt-1.5">
                    {formatInline(trimmed.slice(4))}
                  </h3>
                );
              }
              if (trimmed.startsWith('## ')) {
                return (
                  <h2 key={lIdx} className="text-[15.5px] font-bold text-zinc-50 pt-2">
                    {formatInline(trimmed.slice(3))}
                  </h2>
                );
              }
              if (trimmed.startsWith('# ')) {
                return (
                  <h1 key={lIdx} className="text-lg font-bold text-zinc-50 pt-2">
                    {formatInline(trimmed.slice(2))}
                  </h1>
                );
              }
              if (trimmed.startsWith('> ')) {
                return (
                  <blockquote
                    key={lIdx}
                    className="pl-3 py-1 border-l-2 border-emerald-500/60 bg-white/[0.02] text-zinc-400 text-xs rounded-r"
                  >
                    {formatInline(trimmed.slice(2))}
                  </blockquote>
                );
              }
              if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
                return (
                  <div key={lIdx} className="flex items-start gap-2 pl-1.5">
                    <span className="text-emerald-500/80 mt-0.5">•</span>
                    <span className="flex-1">{formatInline(trimmed.slice(2))}</span>
                  </div>
                );
              }
              return (
                <p key={lIdx} className="leading-relaxed">
                  {formatInline(line)}
                </p>
              );
            })}
          </div>
        );
      })}
    </div>
  );
};
