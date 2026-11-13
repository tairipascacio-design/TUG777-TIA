import React, { useState } from 'react';
import { BookOpen, Brain, ShieldCheck } from 'lucide-react';
import { DEFAULT_STRATEGY_PLAYBOOK, POSITION_MANAGEMENT_GUIDE_RULES } from '../services/strategyEngine';
import type { AiMemoryEntry, StrategyPlaybookItem, TradeLogEntry } from '../types/trading';
import { soundEngine } from '../utils/soundEngine';

interface LogsAndMemoryViewProps {
  logs: TradeLogEntry[];
  memories: AiMemoryEntry[];
  playbook: StrategyPlaybookItem[];
  onToggleStrategy?: (strategyId: string, enabled: boolean) => void;
}

export const LogsAndMemoryView: React.FC<LogsAndMemoryViewProps> = ({
  logs,
  memories,
  playbook,
  onToggleStrategy,
}) => {
  const [filter, setFilter] = useState<'ALL' | 'EXEC' | 'MEV_GUARD' | 'INFO' | 'ERROR'>('ALL');

  const filteredLogs = filter === 'ALL' ? logs : logs.filter((l) => l.level === filter);

  const effectivePlaybook: StrategyPlaybookItem[] =
    playbook.length > 0
      ? [...playbook].sort((a, b) => b.weight - a.weight)
      : DEFAULT_STRATEGY_PLAYBOOK.map((d) => ({
          ...d,
          ownerId: 'local',
          wins: 0,
          losses: 0,
          totalPnlUsd: 0,
          updatedAtMs: Date.now(),
        }));

  return (
    <div className="space-y-6">
      {/* Unified 10-Strategy Playbook + Position Management Guide (Synced with Firestore) */}
      <div className="bg-[#0F131A] border border-slate-800/90 rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <BookOpen className="w-4 h-4 text-amber-400" />
            <div>
              <h2 className="text-base font-bold text-slate-100">
                Biblioteca Unificada de Estrategias y Guía de Gestión de Posiciones (Base de Datos)
              </h2>
              <p className="text-xs text-slate-400">
                10 estrategias institucionales en cruce vivo con Firestore · Los pesos (0.30x–2.50x) se auto-ajustan según el rendimiento real
              </p>
            </div>
          </div>
          <span className="text-xs font-mono-tabular text-emerald-400">
            {effectivePlaybook.filter((s) => s.enabled).length}/{effectivePlaybook.length} Activas
          </span>
        </div>

        {/* Position Management Guide Strip */}
        <div className="p-4 bg-[#090B0E] border-b border-slate-800/80 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {POSITION_MANAGEMENT_GUIDE_RULES.map((rule, idx) => (
            <div key={idx} className="text-[11px] text-slate-300 bg-[#0F131A] border border-slate-800/80 rounded p-2.5 leading-relaxed">
              {rule}
            </div>
          ))}
        </div>

        {/* 10 Strategies Matrix */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-800/80 text-[11px] text-slate-400">
                <th className="py-2.5 px-4 font-medium">Estrategia</th>
                <th className="py-2.5 px-4 font-medium">Regímenes Óptimos</th>
                <th className="py-2.5 px-4 font-medium">Regla de Entrada &amp; Gestión</th>
                <th className="py-2.5 px-4 font-medium text-right">Peso IA</th>
                <th className="py-2.5 px-4 font-medium text-right">W / L · PnL</th>
                <th className="py-2.5 px-4 font-medium text-right">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-xs">
              {effectivePlaybook.map((st) => (
                <tr key={st.strategyId} className="hover:bg-slate-800/25">
                  <td className="py-3 px-4">
                    <div className="font-bold text-slate-100">{st.name}</div>
                    <div className="text-[10px] font-mono-tabular text-amber-400">{st.category}</div>
                  </td>
                  <td className="py-3 px-4 font-mono-tabular text-[11px] text-slate-300">
                    {st.preferredRegimes.replace(/,/g, ' · ')}
                  </td>
                  <td className="py-3 px-4 text-[11px] text-slate-400 max-w-md">
                    <div className="text-slate-200">{st.entryRule}</div>
                    <div className="text-slate-500 mt-0.5">{st.positionManagementGuide}</div>
                  </td>
                  <td className="py-3 px-4 text-right font-mono-tabular font-bold text-amber-300">
                    {st.weight.toFixed(2)}x
                  </td>
                  <td className="py-3 px-4 text-right font-mono-tabular">
                    <span className="text-emerald-400">{st.wins}W</span>
                    {' / '}
                    <span className="text-red-400">{st.losses}L</span>
                    <div className={st.totalPnlUsd >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                      {st.totalPnlUsd >= 0 ? '+' : ''}${st.totalPnlUsd.toFixed(2)}
                    </div>
                  </td>
                  <td className="py-3 px-4 text-right">
                    <button
                      disabled={!onToggleStrategy}
                      onClick={() => {
                        soundEngine.click();
                        onToggleStrategy?.(st.strategyId, !st.enabled);
                      }}
                      className={`px-2.5 py-1 rounded text-[11px] font-bold ${
                        st.enabled
                          ? 'bg-emerald-600/25 text-emerald-300 border border-emerald-500/40'
                          : 'bg-slate-800 text-slate-500'
                      }`}
                    >
                      {st.enabled ? 'ON' : 'OFF'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        {/* Left: Execution, MEV Guard & Latency Logs */}
        <div className="xl:col-span-7 bg-[#0F131A] border border-slate-800/90 rounded-lg overflow-hidden flex flex-col">
          <div className="px-5 py-4 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-slate-100">Logs de Ejecución y Escudo MEV</h2>
              <p className="text-xs text-slate-400">
                Auditoría persistente en Firestore · Latencia real medida por operación
              </p>
            </div>
            <div className="flex items-center gap-1 bg-[#090B0E] p-1 rounded-md border border-slate-800">
              {(['ALL', 'EXEC', 'MEV_GUARD', 'INFO', 'ERROR'] as const).map((lvl) => (
                <button
                  key={lvl}
                  onClick={() => {
                    soundEngine.click();
                    setFilter(lvl);
                  }}
                  className={`px-2.5 py-1 text-[11px] font-mono-tabular rounded transition-colors ${
                    filter === lvl
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {lvl}
                </button>
              ))}
            </div>
          </div>

          <div className="divide-y divide-slate-800/60 max-h-[540px] overflow-y-auto">
            {filteredLogs.length === 0 ? (
              <div className="py-12 text-center text-sm text-slate-500">
                No hay registros de logs todavía para este filtro.
              </div>
            ) : (
              filteredLogs.map((log) => (
                <div key={log.id} className="px-4 py-3 hover:bg-slate-800/25 flex items-start justify-between gap-4">
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2 text-xs font-mono-tabular">
                      <span
                        className={`font-semibold ${
                          log.level === 'EXEC'
                            ? 'text-emerald-400'
                            : log.level === 'MEV_GUARD'
                            ? 'text-amber-400'
                            : log.level === 'ERROR'
                            ? 'text-red-400'
                            : 'text-sky-400'
                        }`}
                      >
                        {log.level}
                      </span>
                      <span className="text-slate-500">·</span>
                      <span className="text-slate-200 font-semibold">{log.coin}</span>
                      <span className="text-slate-500">·</span>
                      <span className="text-slate-400">{log.category}</span>
                    </div>
                    <p className="text-xs text-slate-300 break-words">{log.message}</p>
                  </div>
                  <div className="text-right shrink-0 font-mono-tabular text-[11px] text-slate-500">
                    <div>{new Date(log.createdAtMs).toLocaleTimeString()}</div>
                    {log.latencyMs > 0 && <div className="text-emerald-400">{log.latencyMs} ms</div>}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right: AI Unified Brain Learned Memory */}
        <div className="xl:col-span-5 bg-[#0F131A] border border-slate-800/90 rounded-lg overflow-hidden flex flex-col">
          <div className="px-5 py-4 border-b border-slate-800/80 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Brain className="w-4 h-4 text-amber-400" />
              <div>
                <h2 className="text-base font-bold text-slate-100">Memoria Evolutiva de la IA</h2>
                <p className="text-xs text-slate-400">
                  Reglas aprendidas de trades reales consultadas antes de cada entrada
                </p>
              </div>
            </div>
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
          </div>

          <div className="divide-y divide-slate-800/60 max-h-[540px] overflow-y-auto">
            {memories.length === 0 ? (
              <div className="py-12 px-6 text-center text-sm text-slate-500">
                Cada trade cerrado destila automáticamente una lección táctica y la guarda en Firestore para mejorar las próximas decisiones del Cerebro Unificado.
              </div>
            ) : (
              memories.map((mem) => (
                <div key={mem.id} className="p-4 space-y-1.5">
                  <div className="flex items-center justify-between text-xs font-mono-tabular">
                    <div>
                      <span className="font-bold text-slate-100 font-sans">{mem.coin}</span>{' '}
                      <span className="text-slate-500">· {mem.regime}</span>
                    </div>
                    <span
                      className={`font-semibold ${
                        mem.outcome === 'WIN'
                          ? 'text-emerald-400'
                          : mem.outcome === 'LOSS'
                          ? 'text-red-400'
                          : 'text-slate-400'
                      }`}
                    >
                      {mem.outcome} ({mem.pnlUsd >= 0 ? '+' : ''}${mem.pnlUsd.toFixed(2)})
                    </span>
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed">{mem.lesson}</p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
