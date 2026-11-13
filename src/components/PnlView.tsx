import React, { useMemo } from 'react';
import type { HlAccountSummary, HlUserFill, PersistedPosition } from '../types/trading';

interface PnlViewProps {
  fills: HlUserFill[];
  persistedPositions: PersistedPosition[];
  accountSummary: HlAccountSummary | null;
}

export const PnlView: React.FC<PnlViewProps> = ({
  fills,
  persistedPositions,
  accountSummary,
}) => {
  const analytics = useMemo(() => {
    const closedFromFills = fills.filter((f) => Math.abs(f.closedPnl) > 0.0001);
    const closedFromDb = persistedPositions.filter((p) => p.status === 'CLOSED');

    const realPnlSource =
      closedFromFills.length > 0
        ? closedFromFills.map((f) => ({
            coin: f.coin,
            pnl: f.closedPnl - f.fee,
            time: f.time,
          }))
        : closedFromDb.map((p) => ({
            coin: p.coin,
            pnl: p.realizedPnl,
            time: p.updatedAtMs,
          }));

    const chronological = [...realPnlSource].sort((a, b) => a.time - b.time);
    let running = 0;
    const curve = chronological.map((item, idx) => {
      running += item.pnl;
      return { idx, pnl: running, delta: item.pnl, coin: item.coin, time: item.time };
    });

    const wins = realPnlSource.filter((t) => t.pnl > 0);
    const losses = realPnlSource.filter((t) => t.pnl < 0);
    const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
    const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
    const realizedTotal = realPnlSource.reduce((s, t) => s + t.pnl, 0);
    const unrealizedTotal = (accountSummary?.positions || []).reduce((s, p) => s + p.unrealizedPnl, 0);
    const winRate = realPnlSource.length > 0 ? (wins.length / realPnlSource.length) * 100 : 0;
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 9.99 : 0;

    return {
      curve,
      realizedTotal,
      unrealizedTotal,
      winRate,
      profitFactor,
      tradeCount: realPnlSource.length,
      sourceLabel: closedFromFills.length > 0 ? 'Hyperliquid Real Fills' : 'Firestore Historial Cerrado',
    };
  }, [fills, persistedPositions, accountSummary]);

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

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-[#0F131A] border border-slate-800/90 rounded-lg p-4">
          <p className="text-xs text-slate-400">PnL Realizado Neto</p>
          <p
            className={`mt-1 text-2xl font-bold font-mono-tabular ${
              analytics.realizedTotal >= 0 ? 'text-emerald-400' : 'text-red-400'
            }`}
          >
            {analytics.realizedTotal >= 0 ? '+' : ''}${analytics.realizedTotal.toFixed(2)}
          </p>
        </div>
        <div className="bg-[#0F131A] border border-slate-800/90 rounded-lg p-4">
          <p className="text-xs text-slate-400">PnL Flotante (Vivo)</p>
          <p
            className={`mt-1 text-2xl font-bold font-mono-tabular ${
              analytics.unrealizedTotal >= 0 ? 'text-emerald-400' : 'text-red-400'
            }`}
          >
            {analytics.unrealizedTotal >= 0 ? '+' : ''}${analytics.unrealizedTotal.toFixed(2)}
          </p>
        </div>
        <div className="bg-[#0F131A] border border-slate-800/90 rounded-lg p-4">
          <p className="text-xs text-slate-400">Win Rate ({analytics.tradeCount} trades)</p>
          <p className="mt-1 text-2xl font-bold font-mono-tabular text-amber-400">
            {analytics.winRate.toFixed(1)}%
          </p>
        </div>
        <div className="bg-[#0F131A] border border-slate-800/90 rounded-lg p-4">
          <p className="text-xs text-slate-400">Profit Factor</p>
          <p className="mt-1 text-2xl font-bold font-mono-tabular text-slate-100">
            {analytics.profitFactor.toFixed(2)}
          </p>
        </div>
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
              stroke={analytics.realizedTotal >= 0 ? '#10B981' : '#EF4444'}
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
              {fills.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-500 font-sans">
                    Sin fills recientes registrados para esta wallet.
                  </td>
                </tr>
              ) : (
                fills.slice(0, 30).map((f, idx) => (
                  <tr key={`${f.oid}-${idx}`} className="hover:bg-slate-800/30">
                    <td className="py-2.5 px-4 text-slate-400">
                      {new Date(f.time).toLocaleString()}
                    </td>
                    <td className="py-2.5 px-4 font-bold text-slate-100 font-sans">{f.coin}</td>
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
                      {f.closedPnl !== 0 ? `${f.closedPnl >= 0 ? '+' : ''}$${f.closedPnl.toFixed(2)}` : '--'}
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
