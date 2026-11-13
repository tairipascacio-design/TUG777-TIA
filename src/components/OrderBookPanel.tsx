import React, { useState } from 'react';
import { ShieldCheck, Zap } from 'lucide-react';
import type { HlAssetMarket, HlL2Level } from '../types/trading';
import { soundEngine } from '../utils/soundEngine';

interface OrderBookPanelProps {
  asset: HlAssetMarket | undefined;
  bids: HlL2Level[];
  asks: HlL2Level[];
  hasApiKey: boolean;
  mevShieldEnabled: boolean;
  defaultNotionalUsd: number;
  executing: boolean;
  onManualOrder: (side: 'LONG' | 'SHORT', notionalUsd: number) => void;
  onOpenApiModal: () => void;
}

export const OrderBookPanel: React.FC<OrderBookPanelProps> = ({
  asset,
  bids,
  asks,
  hasApiKey,
  mevShieldEnabled,
  defaultNotionalUsd,
  executing,
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

  return (
    <div className="bg-[#0F131A] border border-slate-800/90 rounded-lg flex flex-col">
      <div className="px-4 py-3 border-b border-slate-800/80 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-100">Libro L2 y Ejecución</h3>
          <p className="text-xs text-slate-400">
            Apalancamiento nativo · Max {asset?.maxLeverage ?? 20}x
          </p>
        </div>
        <span className="font-mono-tabular text-xs text-slate-400">
          Spread {spreadBps.toFixed(1)} bps
        </span>
      </div>

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
      <div className="my-1 px-3 py-1.5 bg-[#090B0E] border-y border-slate-800/80 flex items-center justify-between font-mono-tabular text-xs">
        <span className="text-amber-400 font-semibold">
          Mark ${formatPx(asset?.markPx ?? 0)}
        </span>
        <span className="text-slate-400">
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
          <label className="block text-xs text-slate-400 mb-1">
            Tamaño Nocional (USD) · Apalancamiento por defecto
          </label>
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
              className="px-2.5 py-2 text-xs font-mono-tabular bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-md whitespace-nowrap"
            >
              $100
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between text-xs text-slate-400">
          <span className="inline-flex items-center gap-1.5 text-emerald-400">
            <ShieldCheck className="w-3.5 h-3.5" />
            {mevShieldEnabled ? 'Escudo Anti-MEV Activo' : 'Escudo MEV Inactivo'}
          </span>
          <span className="font-mono-tabular">
            {asset ? `${(Number(notionalUsd || 0) / asset.markPx).toFixed(4)} ${asset.coin}` : '--'}
          </span>
        </div>

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
