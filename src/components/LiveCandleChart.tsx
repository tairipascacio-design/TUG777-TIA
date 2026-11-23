import React, { useMemo, useState } from 'react';
import type { HlCandle } from '../types/trading';
import { soundEngine } from '../utils/soundEngine';

interface LiveCandleChartProps {
  coin: string;
  candles: HlCandle[];
  interval: '1m' | '5m' | '15m' | '1h' | '4h';
  onIntervalChange: (tf: '1m' | '5m' | '15m' | '1h' | '4h') => void;
  markPx: number;
  loading: boolean;
}

function calcEma(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const result: number[] = [values[0]];
  for (let i = 1; i < values.length; i++) {
    result.push(values[i] * k + result[i - 1] * (1 - k));
  }
  return result;
}

export const LiveCandleChart: React.FC<LiveCandleChartProps> = ({
  coin,
  candles,
  interval,
  onIntervalChange,
  markPx,
  loading,
}) => {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const chartStats = useMemo(() => {
    if (candles.length === 0) return null;
    const highs = candles.map((c) => c.h);
    const lows = candles.map((c) => c.l);
    const closes = candles.map((c) => c.c);
    const vols = candles.map((c) => c.v);

    const maxP = Math.max(...highs);
    const minP = Math.min(...lows);
    const pad = (maxP - minP) * 0.08 || maxP * 0.005;
    const topP = maxP + pad;
    const botP = Math.max(0, minP - pad);
    const maxV = Math.max(...vols, 1);

    const ema9 = calcEma(closes, 9);
    const ema21 = calcEma(closes, 21);

    return { topP, botP, maxV, ema9, ema21 };
  }, [candles]);

  const activeCandle = hoverIdx !== null ? candles[hoverIdx] : candles[candles.length - 1];

  const width = 920;
  const height = 340;
  const volHeight = 56;
  const priceHeight = height - volHeight - 16;

  const formatPx = (p: number) => {
    if (p >= 1000) return p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (p >= 1) return p.toFixed(4);
    return p.toPrecision(5);
  };

  return (
    <div className="bg-[#0F131A] border border-slate-800/90 rounded-lg overflow-hidden">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-3 border-b border-slate-800/80">
        <div className="flex items-center gap-4">
          <div className="flex items-baseline gap-2">
            <span className="text-base font-bold text-slate-100">{coin}-PERP</span>
            <span className="font-mono-tabular text-sm font-semibold text-amber-400">
              ${formatPx(markPx || activeCandle?.c || 0)}
            </span>
          </div>
          {activeCandle && (
            <div className="hidden sm:flex items-center gap-3 text-xs text-slate-400 font-mono-tabular">
              <span>O {formatPx(activeCandle.o)}</span>
              <span>H {formatPx(activeCandle.h)}</span>
              <span>L {formatPx(activeCandle.l)}</span>
              <span>C {formatPx(activeCandle.c)}</span>
              <span>Vol {activeCandle.v.toFixed(1)}</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1 bg-[#090B0E] p-1 rounded-md border border-slate-800">
          {(['1m', '5m', '15m', '1h', '4h'] as const).map((tf) => (
            <button
              key={tf}
              onClick={() => {
                soundEngine.click();
                onIntervalChange(tf);
              }}
              className={`px-2.5 py-1 text-xs font-mono-tabular rounded transition-colors whitespace-nowrap shrink-0 ${
                interval === tf
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {tf}
            </button>
          ))}
        </div>
      </div>

      {/* SVG Candle Canvas */}
      <div className="relative p-2">
        {loading && candles.length === 0 ? (
          <div className="h-[300px] flex items-center justify-center text-sm text-slate-400 font-mono-tabular">
            Cargando velas reales de Hyperliquid...
          </div>
        ) : !chartStats || candles.length === 0 ? (
          <div className="h-[300px] flex items-center justify-center text-sm text-slate-500">
            Sin datos de velas disponibles para {coin}.
          </div>
        ) : (
          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="w-full h-[300px] select-none"
            onMouseLeave={() => setHoverIdx(null)}
          >
            {/* Horizontal grid lines */}
            {[0.2, 0.4, 0.6, 0.8].map((ratio) => {
              const y = ratio * priceHeight;
              const priceAtY = chartStats.topP - ratio * (chartStats.topP - chartStats.botP);
              return (
                <g key={ratio}>
                  <line x1={0} y1={y} x2={width - 88} y2={y} stroke="#1E293B" strokeDasharray="3 3" strokeWidth={1} />
                  <text
                    x={width - 82}
                    y={y + 4}
                    fill="#94A3B8"
                    fontSize="12"
                    fontFamily="JetBrains Mono, monospace"
                  >
                    {formatPx(priceAtY)}
                  </text>
                </g>
              );
            })}

            {/* EMA 9 & EMA 21 */}
            <polyline
              fill="none"
              stroke="#F59E0B"
              strokeWidth={1.4}
              opacity={0.85}
              points={chartStats.ema9
                .map((val, idx) => {
                  const step = (width - 94) / candles.length;
                  const x = idx * step + step * 0.5;
                  const y = ((chartStats.topP - val) / (chartStats.topP - chartStats.botP)) * priceHeight;
                  return `${x},${y}`;
                })
                .join(' ')}
            />
            <polyline
              fill="none"
              stroke="#38BDF8"
              strokeWidth={1.4}
              opacity={0.8}
              points={chartStats.ema21
                .map((val, idx) => {
                  const step = (width - 94) / candles.length;
                  const x = idx * step + step * 0.5;
                  const y = ((chartStats.topP - val) / (chartStats.topP - chartStats.botP)) * priceHeight;
                  return `${x},${y}`;
                })
                .join(' ')}
            />

            {/* Candles & Volume */}
            {candles.map((c, idx) => {
              const plotW = width - 94;
              const step = plotW / candles.length;
              const candleW = Math.max(2, step * 0.64);
              const xCenter = idx * step + step * 0.5;
              const xLeft = xCenter - candleW / 2;

              const toY = (p: number) =>
                ((chartStats.topP - p) / (chartStats.topP - chartStats.botP)) * priceHeight;

              const yHigh = toY(c.h);
              const yLow = toY(c.l);
              const yOpen = toY(c.o);
              const yClose = toY(c.c);
              const isBull = c.c >= c.o;
              const color = isBull ? '#10B981' : '#EF4444';

              const bodyTop = Math.min(yOpen, yClose);
              const bodyH = Math.max(1.5, Math.abs(yClose - yOpen));

              const volH = (c.v / chartStats.maxV) * volHeight;
              const volY = height - volH;

              return (
                <g key={c.t} onMouseEnter={() => setHoverIdx(idx)} className="cursor-crosshair">
                  <rect x={xLeft - 1} y={0} width={step} height={height} fill="transparent" />
                  <line x1={xCenter} y1={yHigh} x2={xCenter} y2={yLow} stroke={color} strokeWidth={1.2} />
                  <rect x={xLeft} y={bodyTop} width={candleW} height={bodyH} fill={color} rx={0.5} />
                  <rect x={xLeft} y={volY} width={candleW} height={volH} fill={color} opacity={0.28} />
                </g>
              );
            })}

            {/* Current Mark Price Horizontal Line */}
            {markPx > 0 && (
              <g>
                {(() => {
                  const yMark = Math.max(
                    10,
                    Math.min(
                      priceHeight - 10,
                      ((chartStats.topP - markPx) / (chartStats.topP - chartStats.botP)) * priceHeight
                    )
                  );
                  return (
                    <>
                      <line
                        x1={0}
                        y1={yMark}
                        x2={width - 88}
                        y2={yMark}
                        stroke="#F59E0B"
                        strokeDasharray="2 2"
                        strokeWidth={1}
                      />
                      <rect x={width - 86} y={yMark - 10} width={84} height={20} rx={3} fill="#F59E0B" />
                      <text
                        x={width - 80}
                        y={yMark + 4}
                        fill="#090B0E"
                        fontSize="11.5"
                        fontWeight="700"
                        fontFamily="JetBrains Mono, monospace"
                      >
                        {formatPx(markPx)}
                      </text>
                    </>
                  );
                })()}
              </g>
            )}
          </svg>
        )}
        <div className="flex items-center justify-between px-1 pt-2 text-[11px] text-slate-500">
          <div className="flex items-center gap-4">
            <span className="text-amber-400">EMA 9</span>
            <span className="text-sky-400">EMA 21</span>
            <span>Fuente: Hyperliquid CandleSnapshot</span>
          </div>
          <span className="font-mono-tabular">
            {activeCandle ? new Date(activeCandle.t).toLocaleTimeString() : '--:--'}
          </span>
        </div>
      </div>
    </div>
  );
};
