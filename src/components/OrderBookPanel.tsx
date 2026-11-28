import React, { useState } from 'react';
import { AlertTriangle, RefreshCw, ShieldCheck, XCircle, Zap } from 'lucide-react';
import type { HlAssetMarket, HlL2Level } from '../types/trading';
import { formatSignedUsd } from '../utils/formatters';
import { soundEngine } from '../utils/soundEngine';

interface OrderBookPanelProps {
  asset: HlAssetMarket | undefined;
  bids: HlL2Level[];
  asks: HlL2Level[];
  hasApiKey: boolean;
  mevShieldEnabled: boolean;
  activeRoute?: string;
  defaultNotionalUsd: number;
  leverage?: number;
  l2Error?: string | null;
  l2Loading?: boolean;
  l2Source?: string;
  l2UpdatedAtMs?: number;
  onRetryL2?: () => void;
  executing: boolean;
  useAloEntries?: boolean;
  onToggleAlo?: (useAlo: boolean) => void;
  activePosition?: {
    side: 'LONG' | 'SHORT';
    size: number;
    unrealizedPnl: number;
    isExternal?: boolean;
  } | null;
  closingActive?: boolean;
  onQuickClose?: () => void;
  onManualOrder: (side: 'LONG' | 'SHORT', notionalUsd: number) => void;
  onOpenApiModal: () => void;
}

export const OrderBookPanel: React.FC<OrderBookPanelProps> = ({
  asset,
  bids,
  asks,
  hasApiKey,
  mevShieldEnabled,
  activeRoute = 'TUG777-ENGINE',
  defaultNotionalUsd,
  leverage = 10,
  l2Error = null,
  l2Loading = false,
  l2Source,
  onRetryL2,
  executing,
  useAloEntries = false,
  onToggleAlo,
  activePosition,
  closingActive = false,
  onQuickClose,
  onManualOrder,
  onOpenApiModal,
}) => {
  const [notionalUsd, setNotionalUsd] = useState<string>(String(defaultNotionalUsd || 50));

  const bestBid = bids[0]?.px ?? 0;
  const bestAsk = asks[0]?.px ?? 0;
  const mid = bestBid && bestAsk ? (bestBid + bestAsk) / 2 : asset?.markPx ?? 0;
  const spreadBps = mid > 0 && bestBid && bestAsk ? ((bestAsk - bestBid) / mid) * 10000 : 0;

  const maxBidSz = Math.max(...bids.map((b) => b.sz), 0.0001);
  const maxAskSz = Math.max(...asks.map((a) => a.sz), 0.0001);

  const formatPx = (p: number) => (p >= 1000 ? p.toFixed(2) : p >= 1 ? p.toFixed(4) : p.toPrecision(5));

  const effectiveLeverage = Math.max(1, Math.min(asset?.maxLeverage ?? 20, Math.round(leverage || 10)));

  return (
    <div className="bg-[#0F131A] border border-slate-800/90 rounded-lg flex flex-col">
      <div className="px-4 py-3 border-b border-slate-800/80 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-100 truncate">Libro L2 y Ejecución</h3>
          <p className="text-xs text-slate-400 truncate">
            Apalancamiento <span className="text-amber-300 font-semibold">{effectiveLeverage}x</span> (Cross) · Max {asset?.maxLeverage ?? 20}x
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span
            className={`font-mono-tabular text-xs whitespace-nowrap ${
              l2Error ? 'text-red-400' : 'text-slate-400'
            }`}
          >
            {bestBid > 0 && bestAsk > 0 ? `Spread ${spreadBps.toFixed(1)} bps` : 'Spread --'}
          </span>
          {onRetryL2 && (
            <button
              type="button"
              title="Actualizar Libro L2"
              disabled={l2Loading}
              onClick={() => {
                soundEngine.click();
                onRetryL2();
              }}
              className="p-1 rounded bg-slate-800/90 hover:bg-slate-700 text-slate-300 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${l2Loading ? 'animate-spin' : ''}`} />
            </button>
          )}
        </div>
      </div>

      {l2Error && (
        <div className="mx-3 mt-2.5 p-2.5 rounded-md bg-red-500/10 border border-red-500/40 text-[11px] text-red-200 flex items-start justify-between gap-2">
          <div className="flex items-start gap-1.5 min-w-0">
            <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
            <span className="break-words">
              <strong className="text-red-300">Error Motor L2:</strong> {l2Error}
            </span>
          </div>
          {onRetryL2 && (
            <button
              type="button"
              onClick={() => {
                soundEngine.click();
                onRetryL2();
              }}
              className="px-2 py-1 rounded bg-red-600/30 hover:bg-red-600/50 text-red-100 font-semibold whitespace-nowrap shrink-0"
            >
              Reintentar
            </button>
          )}
        </div>
      )}

      {!l2Error && bids.length === 0 && asks.length === 0 && (
        <div className="mx-3 mt-2.5 p-2.5 rounded-md bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-200 flex items-center justify-between gap-2">
          <span>
            {l2Loading
              ? `Cargando libro L2 de ${asset?.coin || 'mercado'}...`
              : `Libro L2 sin niveles para ${asset?.coin || 'mercado'}${l2Source ? ` (${l2Source})` : ''}.`}
          </span>
          {onRetryL2 && !l2Loading && (
            <button
              type="button"
              onClick={() => {
                soundEngine.click();
                onRetryL2();
              }}
              className="px-2 py-1 rounded bg-amber-500/20 hover:bg-amber-500/35 text-amber-200 font-semibold whitespace-nowrap shrink-0"
            >
              Reintentar L2
            </button>
          )}
        </div>
      )}

      {/* Asks (top 6 reversed) */}
      <div className="px-3 pt-2 pb-1 space-y-0.5 font-mono-tabular text-xs">
        <div className="grid grid-cols-3 text-[11px] text-slate-500 pb-1">
          <span>Precio</span>
          <span className="text-right">Tamaño</span>
          <span className="text-right">Total USD</span>
        </div>
        {[...asks.slice(0, 6)].reverse().map((lvl, i) => (
          <div key={`ask-${i}`} className="relative grid grid-cols-3 py-0.5 items-center">
            <div
              className="absolute right-0 top-0 bottom-0 bg-red-500/12 pointer-events-none"
              style={{ width: `${Math.min(100, (lvl.sz / maxAskSz) * 100)}%` }}
            />
            <span className="text-red-400 z-10">{formatPx(lvl.px)}</span>
            <span className="text-right text-slate-300 z-10">{lvl.sz.toFixed(3)}</span>
            <span className="text-right text-slate-400 z-10">
              ${(lvl.px * lvl.sz).toFixed(0)}
            </span>
          </div>
        ))}
      </div>

      {/* Spread Divider */}
      <div className="my-1 px-3 py-1.5 bg-[#090B0E] border-y border-slate-800/80 flex items-center justify-between font-mono-tabular text-xs gap-2">
        <span className="text-amber-400 font-semibold truncate">
          Mark ${formatPx(asset?.markPx ?? 0)}
        </span>
        <span className="text-slate-400 truncate">
          Oracle ${formatPx(asset?.oraclePx ?? 0)}
        </span>
      </div>

      {/* Bids (top 6) */}
      <div className="px-3 pt-1 pb-3 space-y-0.5 font-mono-tabular text-xs">
        {bids.slice(0, 6).map((lvl, i) => (
          <div key={`bid-${i}`} className="relative grid grid-cols-3 py-0.5 items-center">
            <div
              className="absolute right-0 top-0 bottom-0 bg-emerald-500/12 pointer-events-none"
              style={{ width: `${Math.min(100, (lvl.sz / maxBidSz) * 100)}%` }}
            />
            <span className="text-emerald-400 z-10">{formatPx(lvl.px)}</span>
            <span className="text-right text-slate-300 z-10">{lvl.sz.toFixed(3)}</span>
            <span className="text-right text-slate-400 z-10">
              ${(lvl.px * lvl.sz).toFixed(0)}
            </span>
          </div>
        ))}
      </div>

      {/* Direct Manual Execution */}
      <div className="mt-auto p-4 border-t border-slate-800/80 space-y-3 bg-[#0C1016]">
        <div>
          <div className="flex items-center justify-between gap-2 mb-1">
            <label className="block text-xs text-slate-400 truncate">
              Nocional (USD) · min $10
            </label>
            {onToggleAlo && (
              <button
                type="button"
                onClick={() => {
                  soundEngine.click();
                  onToggleAlo(!useAloEntries);
                }}
                className={`px-2 py-0.5 rounded text-[10px] font-mono-tabular font-bold border whitespace-nowrap shrink-0 ${
                  useAloEntries
                    ? 'bg-sky-500/20 border-sky-500/50 text-sky-300'
                    : 'bg-slate-800 border-slate-700 text-slate-300'
                }`}
              >
                {useAloEntries ? 'ALO Post-Only' : 'IOC (1.0-1.5%)'}
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={10}
              step={10}
              value={notionalUsd}
              onChange={(e) => setNotionalUsd(e.target.value)}
              className="w-full bg-[#090B0E] border border-slate-700 rounded-md px-3 py-2 text-sm font-mono-tabular text-slate-100 focus:outline-none focus:border-amber-500"
            />
            <button
              type="button"
              onClick={() => {
                soundEngine.click();
                setNotionalUsd('100');
              }}
              className="px-2.5 py-2 text-xs font-mono-tabular bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-md whitespace-nowrap shrink-0"
            >
              $100
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-1.5 text-xs text-slate-400">
          <span className="inline-flex items-center gap-1.5 text-emerald-400 min-w-0 truncate">
            <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">
              {mevShieldEnabled ? `Escudo MEV (${activeRoute})` : `MEV Off (${activeRoute})`}
            </span>
          </span>
          <span className="font-mono-tabular whitespace-nowrap shrink-0 text-slate-300">
            {asset ? `${(Number(notionalUsd || 0) / asset.markPx).toFixed(4)} ${asset.coin}` : '--'}
          </span>
        </div>

        {activePosition && onQuickClose && (
          <button
            type="button"
            disabled={closingActive || executing}
            onClick={() => {
              soundEngine.click();
              onQuickClose();
            }}
            className="w-full py-2.5 px-3 rounded-md bg-red-600/20 hover:bg-red-600 text-red-200 hover:text-white border border-red-500/50 disabled:opacity-50 text-xs font-bold flex items-center justify-between gap-2 transition-colors"
          >
            <span className="inline-flex items-center gap-1.5 min-w-0 truncate">
              <XCircle className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">
                {closingActive
                  ? `Cerrando ${asset?.coin}...`
                  : `Cerrar ${activePosition.side} ${asset?.coin}${activePosition.isExternal ? ' [EXT]' : ''}`}
              </span>
            </span>
            <span
              className={`font-mono-tabular shrink-0 ${
                activePosition.unrealizedPnl >= 0 ? 'text-emerald-300' : 'text-red-300'
              }`}
            >
              {formatSignedUsd(activePosition.unrealizedPnl)}
            </span>
          </button>
        )}

        {hasApiKey ? (
          <div className="grid grid-cols-2 gap-2">
            <button
              disabled={executing || !asset}
              onClick={() => {
                soundEngine.click();
                onManualOrder('LONG', Number(notionalUsd || 50));
              }}
              className="py-2.5 px-3 rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold transition-colors whitespace-nowrap"
            >
              {executing ? 'Firmando...' : 'Abrir Long'}
            </button>
            <button
              disabled={executing || !asset}
              onClick={() => {
                soundEngine.click();
                onManualOrder('SHORT', Number(notionalUsd || 50));
              }}
              className="py-2.5 px-3 rounded-md bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-xs font-semibold transition-colors whitespace-nowrap"
            >
              {executing ? 'Firmando...' : 'Abrir Short'}
            </button>
          </div>
        ) : (
          <button
            onClick={() => {
              soundEngine.click();
              onOpenApiModal();
            }}
            className="w-full py-2.5 px-4 rounded-md bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold flex items-center justify-center gap-2 transition-colors whitespace-nowrap"
          >
            <Zap className="w-3.5 h-3.5" />
            Conectar API Wallet Hyperliquid
          </button>
        )}
      </div>
    </div>
  );
};
