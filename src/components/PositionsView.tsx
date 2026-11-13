import React from 'react';
import { RefreshCw, XCircle } from 'lucide-react';
import type { HlAccountSummary, HlAssetMarket, PersistedPosition } from '../types/trading';
import { soundEngine } from '../utils/soundEngine';

interface PositionsViewProps {
  accountSummary: HlAccountSummary | null;
  persistedPositions: PersistedPosition[];
  marketsByCoin: Map<string, HlAssetMarket>;
  masterWalletAddress: string;
  hasApiKey: boolean;
  executingCoin: string | null;
  syncingAccount: boolean;
  lastSyncedAt: number | null;
  onRefreshAccount: () => void;
  onCloseLivePosition: (coin: string, side: 'LONG' | 'SHORT', size: number) => void;
  onClosePersistedPosition: (pos: PersistedPosition) => void;
  onOpenApiModal: () => void;
}

export const PositionsView: React.FC<PositionsViewProps> = ({
  accountSummary,
  persistedPositions,
  marketsByCoin,
  masterWalletAddress,
  hasApiKey,
  executingCoin,
  syncingAccount,
  lastSyncedAt,
  onRefreshAccount,
  onCloseLivePosition,
  onClosePersistedPosition,
  onOpenApiModal,
}) => {
  const openPersisted = persistedPositions.filter((p) => p.status === 'OPEN');
  const closedPersisted = persistedPositions.filter((p) => p.status === 'CLOSED');

  return (
    <div className="space-y-6">
      {/* Account Summary Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-[#0F131A] border border-slate-800/90 rounded-lg p-4">
          <p className="text-xs text-slate-400">Equity Hyperliquid</p>
          <p className="mt-1 text-xl font-bold font-mono-tabular text-slate-100">
            ${(accountSummary?.accountValue ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
        </div>
        <div className="bg-[#0F131A] border border-slate-800/90 rounded-lg p-4">
          <p className="text-xs text-slate-400">Margen Utilizado</p>
          <p className="mt-1 text-xl font-bold font-mono-tabular text-amber-400">
            ${(accountSummary?.totalMarginUsed ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
        </div>
        <div className="bg-[#0F131A] border border-slate-800/90 rounded-lg p-4">
          <p className="text-xs text-slate-400">Exposición Nocional</p>
          <p className="mt-1 text-xl font-bold font-mono-tabular text-slate-100">
            ${(accountSummary?.totalNtlPos ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
        </div>
        <div className="bg-[#0F131A] border border-slate-800/90 rounded-lg p-4">
          <p className="text-xs text-slate-400">USDC Retirable</p>
          <p className="mt-1 text-xl font-bold font-mono-tabular text-emerald-400">
            ${(accountSummary?.withdrawable ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
        </div>
      </div>

      {/* Live Clearinghouse Positions from Hyperliquid */}
      <div className="bg-[#0F131A] border border-slate-800/90 rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-100">Posiciones Reales en Vivo (Hyperliquid L1)</h2>
            <p className="text-xs text-slate-400">
              {masterWalletAddress
                ? `Master Address: ${masterWalletAddress.slice(0, 8)}...${masterWalletAddress.slice(-6)}${
                    lastSyncedAt ? ` · Actualizado ${new Date(lastSyncedAt).toLocaleTimeString()}` : ''
                  }`
                : 'Conecta tu Master Address o API Wallet para sincronizar posiciones reales'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              disabled={syncingAccount}
              onClick={() => {
                soundEngine.click();
                onRefreshAccount();
              }}
              className="px-3.5 py-2 rounded-md bg-slate-800 hover:bg-slate-700 disabled:opacity-60 text-xs font-semibold text-slate-100 inline-flex items-center gap-1.5 transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-amber-400 ${syncingAccount ? 'animate-spin' : ''}`} />
              {syncingAccount ? 'Sincronizando...' : 'Actualizar Posiciones'}
            </button>
            {!masterWalletAddress && (
              <button
                onClick={() => {
                  soundEngine.click();
                  onOpenApiModal();
                }}
                className="px-3 py-2 rounded-md bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold"
              >
                Conectar Wallet
              </button>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-800/80 text-[11px] text-slate-400">
                <th className="py-3 px-4 font-medium">Token</th>
                <th className="py-3 px-4 font-medium">Dirección</th>
                <th className="py-3 px-4 font-medium text-right">Tamaño</th>
                <th className="py-3 px-4 font-medium text-right">Entrada</th>
                <th className="py-3 px-4 font-medium text-right">Mark Actual</th>
                <th className="py-3 px-4 font-medium text-right">Liquidación</th>
                <th className="py-3 px-4 font-medium text-right">PnL No Realizado</th>
                <th className="py-3 px-4 font-medium text-right">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-xs font-mono-tabular">
              {!accountSummary || accountSummary.positions.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-500 font-sans">
                    {masterWalletAddress
                      ? 'Sin posiciones perpetuas abiertas actualmente en Hyperliquid L1.'
                      : 'Ingresa tu Master Address en API Wallet para ver posiciones reales en vivo.'}
                  </td>
                </tr>
              ) : (
                accountSummary.positions.map((pos) => {
                  const market = marketsByCoin.get(pos.coin);
                  const mark = market?.markPx ?? 0;
                  return (
                    <tr key={pos.coin} className="hover:bg-slate-800/30 transition-colors">
                      <td className="py-3 px-4 font-bold text-slate-100 font-sans">
                        {pos.coin} <span className="text-slate-400 font-normal">· {pos.leverage}x</span>
                      </td>
                      <td className={`py-3 px-4 font-semibold ${pos.side === 'LONG' ? 'text-emerald-400' : 'text-red-400'}`}>
                        {pos.side}
                      </td>
                      <td className="py-3 px-4 text-right text-slate-200">{Math.abs(pos.szi).toFixed(4)}</td>
                      <td className="py-3 px-4 text-right text-slate-300">${pos.entryPx.toFixed(4)}</td>
                      <td className="py-3 px-4 text-right text-slate-200">${mark.toFixed(4)}</td>
                      <td className="py-3 px-4 text-right text-amber-400">
                        {pos.liquidationPx ? `$${pos.liquidationPx.toFixed(2)}` : '--'}
                      </td>
                      <td
                        className={`py-3 px-4 text-right font-semibold ${
                          pos.unrealizedPnl >= 0 ? 'text-emerald-400' : 'text-red-400'
                        }`}
                      >
                        {pos.unrealizedPnl >= 0 ? '+' : ''}
                        ${pos.unrealizedPnl.toFixed(2)} ({pos.returnOnEquity.toFixed(1)}%)
                      </td>
                      <td className="py-3 px-4 text-right">
                        <button
                          disabled={!hasApiKey || executingCoin === pos.coin}
                          onClick={() => {
                            soundEngine.click();
                            onCloseLivePosition(pos.coin, pos.side, Math.abs(pos.szi));
                          }}
                          className="px-2.5 py-1 rounded bg-red-600/20 hover:bg-red-600 text-red-300 hover:text-white border border-red-500/40 disabled:opacity-40 text-[11px] font-sans font-medium inline-flex items-center gap-1"
                        >
                          <XCircle className="w-3 h-3" />
                          {executingCoin === pos.coin ? 'Cerrando...' : 'Cerrar'}
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Firestore Persisted Positions (Survives Reloads) */}
      <div className="bg-[#0F131A] border border-slate-800/90 rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800/80 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-100">
              Posiciones Persistidas en Base de Datos (Firestore)
            </h2>
            <p className="text-xs text-slate-400">
              Respaldo automático en la nube ante recargas de página · Abiertas: {openPersisted.length} · Cerradas: {closedPersisted.length}
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-800/80 text-[11px] text-slate-400">
                <th className="py-3 px-4 font-medium">Token / Modo</th>
                <th className="py-3 px-4 font-medium">Estado</th>
                <th className="py-3 px-4 font-medium text-right">Entrada</th>
                <th className="py-3 px-4 font-medium text-right">Mark Vivo</th>
                <th className="py-3 px-4 font-medium text-right">PnL Vivo / Realizado</th>
                <th className="py-3 px-4 font-medium">Tesis</th>
                <th className="py-3 px-4 font-medium text-right">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-xs font-mono-tabular">
              {persistedPositions.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-500 font-sans">
                    Las posiciones ejecutadas se guardan aquí automáticamente para sobrevivir recargas y alimentar el aprendizaje de la IA.
                  </td>
                </tr>
              ) : (
                persistedPositions.map((p) => {
                  const liveMark = marketsByCoin.get(p.coin)?.markPx ?? p.markPx;
                  const livePnl =
                    p.status === 'OPEN'
                      ? (p.side === 'LONG' ? liveMark - p.entryPx : p.entryPx - liveMark) * p.size
                      : p.realizedPnl;

                  return (
                    <tr key={p.id} className="hover:bg-slate-800/30">
                      <td className="py-3 px-4 font-sans">
                        <span className="font-bold text-slate-100">{p.coin}</span>{' '}
                        <span className={p.side === 'LONG' ? 'text-emerald-400' : 'text-red-400'}>
                          {p.side}
                        </span>{' '}
                        <span className="text-slate-500">· {p.mode}</span>
                      </td>
                      <td className="py-3 px-4">
                        <span className={p.status === 'OPEN' ? 'text-amber-400 font-semibold' : 'text-slate-400'}>
                          {p.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right text-slate-300">${p.entryPx.toFixed(4)}</td>
                      <td className="py-3 px-4 text-right text-slate-200">${liveMark.toFixed(4)}</td>
                      <td
                        className={`py-3 px-4 text-right font-semibold ${
                          livePnl >= 0 ? 'text-emerald-400' : 'text-red-400'
                        }`}
                      >
                        {livePnl >= 0 ? '+' : ''}${livePnl.toFixed(2)}
                      </td>
                      <td className="py-3 px-4 font-sans text-slate-400 max-w-xs truncate">{p.thesis}</td>
                      <td className="py-3 px-4 text-right">
                        {p.status === 'OPEN' ? (
                          <button
                            onClick={() => {
                              soundEngine.click();
                              onClosePersistedPosition(p);
                            }}
                            className="px-2.5 py-1 rounded bg-slate-800 hover:bg-red-600 text-slate-200 hover:text-white text-[11px] font-sans"
                          >
                            Cerrar y Aprender
                          </button>
                        ) : (
                          <span className="text-slate-500 text-[11px] font-sans">Aprendido</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
