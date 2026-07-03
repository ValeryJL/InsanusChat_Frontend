import React, { useEffect, useState } from 'react';
import {
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  FileDiff,
  Loader2,
  ShieldAlert,
  Terminal,
  X,
} from 'lucide-react';
import { PendingToolApproval, TaskPlanStep } from '../types';

interface AgentTaskPlanProps {
  steps: TaskPlanStep[];
  pendingApproval: PendingToolApproval | null;
  onResolveApproval: (approvalId: string, approved: boolean, feedback?: string) => Promise<void>;
  compact?: boolean;
}

export const UnifiedDiffBlock: React.FC<{ diff: string; maxHeight?: string }> = ({
  diff,
  maxHeight = 'max-h-56',
}) => {
  if (!diff || !diff.trim()) return null;
  const lines = diff.split('\n');
  return (
    <div
      className={`rounded-lg border border-white/[0.07] bg-[#09090b] font-mono text-[11px] overflow-x-auto ${maxHeight} overflow-y-auto p-2 space-y-0.5`}
    >
      {lines.map((line, idx) => {
        let cls = 'text-zinc-400';
        if (line.startsWith('+++') || line.startsWith('---')) {
          cls = 'text-zinc-500 font-semibold';
        } else if (line.startsWith('@@')) {
          cls = 'text-sky-400 bg-sky-500/10 px-1.5 rounded';
        } else if (line.startsWith('+')) {
          cls = 'text-emerald-300 bg-emerald-500/15 px-1.5 rounded block';
        } else if (line.startsWith('-')) {
          cls = 'text-rose-300 bg-rose-500/15 px-1.5 rounded block';
        }
        return (
          <div key={idx} className={`whitespace-pre ${cls}`}>
            {line || ' '}
          </div>
        );
      })}
    </div>
  );
};

export const AgentTaskPlan: React.FC<AgentTaskPlanProps> = ({
  steps,
  pendingApproval,
  onResolveApproval,
  compact = false,
}) => {
  const hasInProgress = (steps || []).some((s) => s.status === 'in_progress');
  const [expanded, setExpanded] = useState(() =>
    typeof window !== 'undefined' && window.innerWidth >= 1024 && hasInProgress
  );
  const [submitting, setSubmitting] = useState(false);

  // Colapsar automáticamente cuando todos los pasos finalizan para dar aire al hilo
  useEffect(() => {
    if (!hasInProgress && steps.length > 0 && steps.every((s) => s.status === 'completed')) {
      setExpanded(false);
    }
  }, [hasInProgress, steps]);

  const hasSteps = steps && steps.length > 0;
  const completedCount = (steps || []).filter((s) => s.status === 'completed').length;
  const progressPct = hasSteps ? Math.round((completedCount / steps.length) * 100) : 0;
  const activeStep = steps.find((s) => s.status === 'in_progress');

  if (!hasSteps && !pendingApproval) return null;

  return (
    <div className={`${compact ? 'px-2.5 pt-2' : 'px-3 sm:px-6 pt-2'} shrink-0`}>
      <div className={`${compact ? 'w-full' : 'max-w-3xl mx-auto w-full'} space-y-2`}>
        {/* Gate de Aprobación Human-in-the-Loop (HU-22) */}
        {pendingApproval && (
          <div className="p-3 rounded-xl bg-[#161922] border border-amber-500/40 shadow-lg space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-medium text-amber-300">
                <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" />
                <span>Confirmar acción:</span>
                <code className="px-1.5 py-0.5 rounded bg-[#0b0d12] text-emerald-300 border border-white/[0.08] text-[11px]">
                  {pendingApproval.tool}
                </code>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={async () => {
                    setSubmitting(true);
                    try {
                      await onResolveApproval(pendingApproval.approval_id, true);
                    } finally {
                      setSubmitting(false);
                    }
                  }}
                  className="h-7 px-3 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold text-xs flex items-center gap-1 transition"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Aprobar</span>
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={async () => {
                    setSubmitting(true);
                    try {
                      await onResolveApproval(pendingApproval.approval_id, false, 'Rechazado por el usuario');
                    } finally {
                      setSubmitting(false);
                    }
                  }}
                  className="h-7 px-3 rounded-lg bg-white/[0.05] hover:bg-rose-500/15 text-rose-300 border border-rose-500/25 font-medium text-xs flex items-center gap-1 transition"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>Rechazar</span>
                </button>
              </div>
            </div>

            {pendingApproval.args?.command_line && (
              <div className="p-2 rounded-lg bg-[#0b0d12] border border-white/[0.07] font-mono text-xs text-sky-300 flex items-center gap-2">
                <Terminal className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                <span className="break-all">$ {pendingApproval.args.command_line}</span>
              </div>
            )}

            {pendingApproval.args?.path && (
              <div className="text-xs font-mono text-zinc-400 flex items-center gap-1.5">
                <FileDiff className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-zinc-200">{pendingApproval.args.path}</span>
              </div>
            )}

            {pendingApproval.diff && <UnifiedDiffBlock diff={pendingApproval.diff} maxHeight="max-h-40" />}
          </div>
        )}

        {/* Barra Compacta de Plan de Tareas (h-9 colapsada por defecto) */}
        {hasSteps && (
          <div className="rounded-xl bg-[#11131a] border border-white/[0.08] overflow-hidden text-xs">
            <button
              type="button"
              onClick={() => setExpanded((e) => !e)}
              className="w-full h-9 px-3 flex items-center justify-between gap-2 hover:bg-white/[0.03] transition"
            >
              <div className="flex items-center gap-2 min-w-0">
                {hasInProgress ? (
                  <Loader2 className="w-3.5 h-3.5 text-sky-400 animate-spin shrink-0" />
                ) : (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                )}
                <span className="font-medium text-zinc-200 truncate">
                  {activeStep ? activeStep.title : 'Plan de trabajo completado'}
                </span>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <div className="hidden sm:block h-1 w-11 rounded-full bg-white/[0.08] overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 transition-all"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
                <span className="font-mono text-[11px] text-zinc-400 tabular-nums">
                  {completedCount}/{steps.length}
                </span>
                {expanded ? (
                  <ChevronDown className="w-3.5 h-3.5 text-zinc-500" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5 text-zinc-500" />
                )}
              </div>
            </button>

            {expanded && (
              <div className="px-3 py-2 border-t border-white/[0.06] space-y-1 max-h-40 overflow-y-auto">
                {steps.map((s) => (
                  <div key={s.id} className="flex items-center gap-2 py-0.5 text-xs">
                    {s.status === 'completed' ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    ) : s.status === 'in_progress' ? (
                      <Loader2 className="w-3.5 h-3.5 text-sky-400 animate-spin shrink-0" />
                    ) : (
                      <Circle className="w-3.5 h-3.5 text-zinc-600 shrink-0" />
                    )}
                    <span
                      className={
                        s.status === 'completed'
                          ? 'text-zinc-400 line-through decoration-zinc-600'
                          : s.status === 'in_progress'
                          ? 'text-zinc-100 font-medium'
                          : 'text-zinc-500'
                      }
                    >
                      {s.title}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
