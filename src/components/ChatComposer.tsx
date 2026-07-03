import React, { useEffect, useRef } from 'react';
import { ArrowUp, Bot, GitBranch, Shield, Square, Terminal, Zap } from 'lucide-react';
import { AgentItem, ChatItem, ChatMessage } from '../types';

interface ChatComposerProps {
  inputText: string;
  onChangeInput: (val: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onStop: () => void;
  chatLocked: boolean;
  branchTarget: { parentId: string | null; refMsg: ChatMessage } | null;
  onCancelBranch: () => void;
  activeChat: ChatItem | null;
  agents: AgentItem[];
  modelsByProvider: Record<string, { id: string; name: string }[]>;
  onSelectAgent: (agentId: string | null) => Promise<void>;
  onSelectModel: (agentId: string, modelId: string) => Promise<void>;
  onChangeHarnessMode: (mode: 'ask' | 'auto_edit' | 'autopilot') => Promise<void>;
  compact?: boolean;
  placeholder?: string;
}

export const ChatComposer: React.FC<ChatComposerProps> = ({
  inputText,
  onChangeInput,
  onSubmit,
  onStop,
  chatLocked,
  branchTarget,
  onCancelBranch,
  activeChat,
  agents,
  modelsByProvider,
  onSelectAgent,
  onSelectModel,
  onChangeHarnessMode,
  compact = false,
  placeholder,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(160, Math.max(40, el.scrollHeight))}px`;
  }, [inputText]);

  const currentAgent =
    agents.find((a) => a._id === activeChat?.agent_id) ||
    agents.find((a) => a.active) ||
    agents[0] ||
    null;
  const prov = currentAgent?.provider || 'gemini';
  const liveModels = modelsByProvider[prov] || [];
  const executionTarget = activeChat?.execution_target || 'cloud';
  const harnessMode = activeChat?.harness_mode || 'auto_edit';

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (inputText.trim() && !chatLocked) {
        onSubmit(e as unknown as React.FormEvent);
      }
    }
  };

  return (
    <div
      className={`${
        compact ? 'p-2.5' : 'px-3 sm:px-6 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]'
      } shrink-0`}
    >
      <div className={compact ? 'w-full' : 'max-w-3xl mx-auto w-full'}>
        <form
          onSubmit={onSubmit}
          className="rounded-2xl bg-[#161922] border border-white/[0.09] focus-within:border-white/[0.18] focus-within:ring-1 focus-within:ring-emerald-500/20 shadow-xl shadow-black/40 transition overflow-hidden"
        >
          {/* Banner sutil de ramificación */}
          {branchTarget && (
            <div className="h-8 px-3 border-b border-white/[0.06] bg-amber-500/[0.07] flex items-center justify-between gap-2 text-[11px] text-amber-300">
              <span className="flex items-center gap-1.5 truncate min-w-0">
                <GitBranch className="w-3 h-3 shrink-0" />
                <span className="truncate">
                  {branchTarget.refMsg.role === 'user' ? 'Rama alternativa a: ' : 'Ramificando desde: '}
                  <em className="text-amber-200">"{branchTarget.refMsg.content.slice(0, 52)}"</em>
                </span>
              </span>
              <button
                type="button"
                onClick={onCancelBranch}
                className="text-amber-300 hover:text-white underline shrink-0"
              >
                Cancelar
              </button>
            </div>
          )}

          {/* Textarea auto-expandible */}
          <textarea
            ref={textareaRef}
            rows={1}
            value={inputText}
            onChange={(e) => onChangeInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={chatLocked}
            placeholder={
              placeholder ||
              (branchTarget
                ? 'Escribí para bifurcar una nueva rama...'
                : executionTarget === 'workstation'
                ? `Pedile al agente que programe o ejecute comandos en ${activeChat?.workspace_path || 'tu proyecto'}...`
                : 'Escribí un mensaje o consulta...')
            }
            className="w-full min-h-[42px] max-h-[160px] bg-transparent px-3.5 pt-3 pb-1.5 text-base sm:text-[13.5px] text-zinc-100 placeholder:text-zinc-500 outline-none resize-none disabled:opacity-50 leading-relaxed"
          />

          {/* Barra inferior integrada con Agente, Modelo, Política Harness y Botón Enviar */}
          <div className="px-2.5 pb-2 pt-1 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1 min-w-0 overflow-x-auto no-scrollbar">
              {agents.length > 0 && (
                <div className="h-7 px-2 rounded-lg hover:bg-white/[0.06] text-[11.5px] text-zinc-300 flex items-center gap-1 transition shrink-0">
                  <Bot className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                  <select
                    aria-label="Agente"
                    value={activeChat?.agent_id || currentAgent?._id || ''}
                    onChange={(e) => onSelectAgent(e.target.value || null)}
                    className="bg-transparent outline-none max-w-[105px] sm:max-w-[140px] truncate cursor-pointer text-zinc-200"
                  >
                    {agents.map((a) => (
                      <option key={a._id} value={a._id} className="bg-[#161922] text-zinc-100">
                        {a.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {currentAgent && (
                <div className="h-7 px-2 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-[11px] font-mono text-zinc-300 flex items-center transition shrink-0">
                  <select
                    aria-label="Modelo LLM"
                    value={currentAgent.model_selected || 'gemini-2.5-flash'}
                    onChange={(e) => onSelectModel(currentAgent._id, e.target.value)}
                    className="bg-transparent outline-none max-w-[115px] sm:max-w-[165px] truncate cursor-pointer text-zinc-200"
                  >
                    {!liveModels.some((m) => m.id === currentAgent.model_selected) &&
                      currentAgent.model_selected && (
                        <option value={currentAgent.model_selected} className="bg-[#161922] text-zinc-100">
                          {currentAgent.model_selected}
                        </option>
                      )}
                    {liveModels.map((m) => (
                      <option key={m.id} value={m.id} className="bg-[#161922] text-zinc-100">
                        {m.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {executionTarget === 'workstation' && (
                <div
                  className={`h-7 px-2 rounded-lg text-[11px] font-medium flex items-center gap-1 transition shrink-0 ${
                    harnessMode === 'ask'
                      ? 'bg-amber-500/10 text-amber-300'
                      : harnessMode === 'auto_edit'
                      ? 'bg-emerald-500/10 text-emerald-300'
                      : 'bg-sky-500/10 text-sky-300'
                  }`}
                >
                  {harnessMode === 'ask' ? (
                    <Shield className="w-3 h-3 shrink-0" />
                  ) : harnessMode === 'auto_edit' ? (
                    <Zap className="w-3 h-3 shrink-0" />
                  ) : (
                    <Terminal className="w-3 h-3 shrink-0" />
                  )}
                  <select
                    aria-label="Política del Harness"
                    value={harnessMode}
                    onChange={(e) =>
                      onChangeHarnessMode(e.target.value as 'ask' | 'auto_edit' | 'autopilot')
                    }
                    className="bg-transparent outline-none cursor-pointer"
                  >
                    <option value="ask" className="bg-[#161922] text-zinc-100">
                      Ask — Confirmar todo
                    </option>
                    <option value="auto_edit" className="bg-[#161922] text-zinc-100">
                      Auto-Edit
                    </option>
                    <option value="autopilot" className="bg-[#161922] text-zinc-100">
                      Autopilot
                    </option>
                  </select>
                </div>
              )}
            </div>

            {chatLocked ? (
              <button
                type="button"
                onClick={onStop}
                className="w-8 h-8 rounded-xl bg-rose-500/90 hover:bg-rose-400 text-white flex items-center justify-center transition shrink-0"
                title="Detener generación"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!inputText.trim()}
                className="w-8 h-8 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:bg-white/[0.06] disabled:text-zinc-600 text-zinc-950 flex items-center justify-center transition shrink-0"
                title={branchTarget ? 'Ramificar' : 'Enviar mensaje (Enter)'}
              >
                <ArrowUp className="w-4 h-4 stroke-[2.5]" />
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
};
