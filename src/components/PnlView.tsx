import React, { useMemo, useState } from 'react';
import { AlertTriangle, Brain, TrendingUp } from 'lucide-react';
import type { HlAccountSummary, HlUserFill, PersistedPosition } from '../types/trading';
import { computeUnifiedAccounting, isTug777Fill } from '../utils/accounting';
import { formatSignedUsd, formatUsd } from '../utils/formatters';
import { soundEngine } from '../utils/soundEngine';

interface PnlViewProps {
  fills: HlUserFill[];
  persistedPositions: PersistedPosition[];
  accountSummary: HlAccountSummary | null;
  onLearnFromHistory?: () => void;
  learningHistory?: boolean;
}

export const PnlView: React.FC<PnlViewProps> = ({
  fills,
  persistedPositions,
  accountSummary,
  onLearnFromHistory,
  learningHistory = false,
}) => {
  const [onlyTug777, setOnlyTug777] = useState(false);
  const [windowMode, setWindowMode] = useState<'ALL' | '24H' | '7D'>('ALL');

  const analytics = useMemo(() => {
    const now = Date.now();
    const windowStartMs =
      windowMode === '24H'
        ? now - 24 * 3600 * 1000
        : windowMode === '7D'
        ? now - 7 * 24 * 3600 * 1000
        : 0;

    const unified = computeUnifiedAccounting({
      fills,
      persistedPositions,
      windowStartMs,
      onlyTug777,
    });

    const unrealizedTotal = (accountSummary?.positions || [])
      .filter((p) => !onlyTug777 || !p.isExternal)
      .reduce((s, p) => s + p.unrealizedPnl, 0);

    return { ...unified, unrealizedTotal };
  }, [fills, persistedPositions, accountSummary, onlyTug777, windowMode]);

  const svgPoints = useMemo(() => {
    if (analytics.curve.length < 2) return '';
    const w = 800;
    const h = 180;
    const vals = analytics.curve.map((p) => p.pnl);
    const min = Math.min(...vals, 0);
    const max = Math.max(...vals, 1);
    const span = max - min || 1;
    return analytics.curve
      .map((pt, i) => {
        const x = (i / (analytics.curve.length - 1)) * w;
        const y = h - ((pt.pnl - min) / span) * (h - 20) - 10;
        return `${x},${y}`;
      })
      .join(' ');
  }, [analytics.curve]);

  const displayedFills = useMemo(() => {
    const base = onlyTug777 ? fills.filter((f) => isTug777Fill(f)) : fills;
    return base.slice(0, 50);
  }, [fills, onlyTug777]);

  return (
    <div className="space-y-6">
      {/* Filter Controls Bar */}
      <div className="bg-[#0F131A] border border-slate-800/90 rounded-lg p-3.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-slate-400 font-semibold">Contabilidad:</span>
          <button
            type="button"
            onClick={() => {
              soundEngine.click();
              setOnlyTug777(false);
            }}
            className={`px-2.5 py-1 rounded font-semibold border ${
              !onlyTug777
                ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                : 'bg-[#090B0E] border-slate-800 text-slate-400'
            }`}
          >
            Todos ({analytics.totalFillsInWindow})
          </button>
          <button
            type="button"
            onClick={() => {
              soundEngine.click();
              setOnlyTug777(true);
            }}
            className={`px-2.5 py-1 rounded font-semibold border ${
              onlyTug777
                ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
                : 'bg-[#090B0E] border-slate-800 text-slate-400'
            }`}
          >
            Solo TUG777 0x777 ({analytics.tugFilteredCount})
          </button>
        </div>

        <div className="flex items-center gap-1 bg-[#090B0E] p-1 rounded-md border border-slate-800 text-xs font-mono-tabular">
          {(['ALL', '24H', '7D'] as const).map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => {
                soundEngine.click();
                setWindowMode(w);
              }}
              className={`px-2.5 py-1 rounded ${
                windowMode === w ? 'bg-amber-500 text-slate-950 font-bold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {w === 'ALL' ? 'Todo' : w}
            </button>
          ))}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-[#0F131A] border border-slate-800/90 rounded-lg p-4">
          <p className="text-xs text-slate-400">PnL Realizado Neto</p>
          <p
            className={`mt-1 text-2xl font-bold font-mono-tabular ${
              analytics.netRealizedPnlUsd >= 0 ? 'text-emerald-400' : 'text-red-400'
            }`}
          >
            {formatSignedUsd(analytics.netRealizedPnlUsd)}
          </p>
        </div>
        <div className="bg-[#0F131A] border border-slate-800/90 rounded-lg p-4">
          <p className="text-xs text-slate-400">PnL Flotante (Vivo)</p>
          <p
            className={`mt-1 text-2xl font-bold font-mono-tabular ${
              analytics.unrealizedTotal >= 0 ? 'text-emerald-400' : 'text-red-400'
            }`}
          >
            {formatSignedUsd(analytics.unrealizedTotal)}
          </p>
        </div>
        <div className="bg-[#0F131A] border border-slate-800/90 rounded-lg p-4">
          <p className="text-xs text-slate-400">Win Rate ({analytics.closedCount} cierres)</p>
          <p className="mt-1 text-2xl font-bold font-mono-tabular text-amber-400">
            {analytics.winRatePct.toFixed(1)}%
          </p>
        </div>
        <div className="bg-[#0F131A] border border-slate-800/90 rounded-lg p-4">
          <p className="text-xs text-slate-400">Profit Factor / Fees</p>
          <p className="mt-1 text-2xl font-bold font-mono-tabular text-slate-100">
            {analytics.profitFactor.toFixed(2)}{' '}
            <span className="text-xs font-normal text-red-400">(-{formatUsd(analytics.totalFeesUsd)} fee)</span>
          </p>
        </div>
      </div>

      {/* Real History Diagnostic & Learning Injection */}
      <div className="bg-[#0F131A] border border-slate-800/90 rounded-lg p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-100">
              Diagnóstico del Historial Real y Retroalimentación a la Base de Datos
            </h2>
            <p className="text-xs text-slate-400">
              Prom. Ganador: <span className="text-emerald-400 font-mono-tabular">+{formatUsd(analytics.avgWinUsd)}</span> · Prom. Perdedor:{' '}
              <span className="text-red-400 font-mono-tabular">-{formatUsd(analytics.avgLossUsd)}</span> · Comisiones Hyperliquid:{' '}
              <span className="text-amber-300 font-mono-tabular">{formatUsd(analytics.totalFeesUsd)}</span>
            </p>
          </div>
          {onLearnFromHistory && (
            <button
              disabled={learningHistory || fills.length === 0}
              onClick={() => {
                soundEngine.click();
                onLearnFromHistory();
              }}
              className="px-3.5 py-2 rounded-md bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-slate-950 text-xs font-bold inline-flex items-center gap-1.5"
            >
              <Brain className="w-3.5 h-3.5" />
              {learningHistory ? 'Guardando Lecciones...' : 'Aprender Solo TUG777 (0x777) → Firestore'}
            </button>
          )}
        </div>

        {analytics.coinBreakdown.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2.5">
            {analytics.coinBreakdown.slice(0, 6).map((cb) => (
              <div key={cb.coin} className="bg-[#090B0E] border border-slate-800 rounded-md p-2.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-100">{cb.coin}</span>
                  {cb.netPnlUsd < 0 ? (
                    <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
                  ) : (
                    <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                  )}
                </div>
                <div
                  className={`mt-1 font-mono-tabular font-semibold ${
                    cb.netPnlUsd >= 0 ? 'text-emerald-400' : 'text-red-400'
                  }`}
                >
                  {formatSignedUsd(cb.netPnlUsd)}
                </div>
                <div className="text-[10px] text-slate-500 font-mono-tabular">
                  {cb.fillsCount} fills · fee {formatUsd(cb.feesUsd)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Equity Curve */}
      <div className="bg-[#0F131A] border border-slate-800/90 rounded-lg p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-bold text-slate-100">Curva de PnL Acumulado</h2>
            <p className="text-xs text-slate-400">Origen: {analytics.sourceLabel}</p>
          </div>
        </div>
        {analytics.curve.length < 2 ? (
          <div className="h-44 flex items-center justify-center text-sm text-slate-500">
            Se necesitan al menos 2 ejecuciones cerradas reales para graficar la curva de rendimiento.
          </div>
        ) : (
          <svg viewBox="0 0 800 180" className="w-full h-44">
            <polyline
              fill="none"
              stroke={analytics.netRealizedPnlUsd >= 0 ? '#10B981' : '#EF4444'}
              strokeWidth={2.4}
              points={svgPoints}
            />
          </svg>
        )}
      </div>

      {/* Real Hyperliquid Fills Table */}
      <div className="bg-[#0F131A] border border-slate-800/90 rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800/80">
          <h2 className="text-base font-bold text-slate-100">Historial Real de Fills (Hyperliquid)</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-800/80 text-[11px] text-slate-400">
                <th className="py-3 px-4 font-medium">Hora</th>
                <th className="py-3 px-4 font-medium">Token</th>
                <th className="py-3 px-4 font-medium">Lado</th>
                <th className="py-3 px-4 font-medium text-right">Precio</th>
                <th className="py-3 px-4 font-medium text-right">Tamaño</th>
                <th className="py-3 px-4 font-medium text-right">Fee</th>
                <th className="py-3 px-4 font-medium text-right">PnL Cerrado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-xs font-mono-tabular">
              {displayedFills.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-500 font-sans">
                    Sin fills recientes registrados para este filtro.
                  </td>
                </tr>
              ) : (
                displayedFills.map((f, idx) => (
                  <tr key={`${f.oid}-${idx}`} className="hover:bg-slate-800/30">
                    <td className="py-2.5 px-4 text-slate-400">
                      {new Date(f.time).toLocaleString()}
                    </td>
                    <td className="py-2.5 px-4 font-bold text-slate-100 font-sans">
                      {f.coin}
                      {isTug777Fill(f) && (
                        <span className="ml-1.5 px-1 py-0.5 rounded bg-emerald-500/15 text-emerald-300 text-[9px] font-mono-tabular">
                          0x777
                        </span>
                      )}
                    </td>
                    <td className={`py-2.5 px-4 ${f.side === 'B' ? 'text-emerald-400' : 'text-red-400'}`}>
                      {f.side === 'B' ? 'BUY' : 'SELL'}
                    </td>
                    <td className="py-2.5 px-4 text-right text-slate-200">${f.px.toFixed(4)}</td>
                    <td className="py-2.5 px-4 text-right text-slate-300">{f.sz.toFixed(4)}</td>
                    <td className="py-2.5 px-4 text-right text-slate-400">${f.fee.toFixed(4)}</td>
                    <td
                      className={`py-2.5 px-4 text-right font-semibold ${
                        f.closedPnl > 0
                          ? 'text-emerald-400'
                          : f.closedPnl < 0
                          ? 'text-red-400'
                          : 'text-slate-400'
                      }`}
                    >
                      {Math.abs(f.closedPnl) > 0.0001 ? formatSignedUsd(f.closedPnl) : '--'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
