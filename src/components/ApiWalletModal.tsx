import React, { useEffect, useMemo, useState } from 'react';
import { Wallet } from 'ethers';
import { KeyRound, ShieldAlert, ShieldCheck, X } from 'lucide-react';
import type { BotConfigData, HlNetwork } from '../types/trading';
import { soundEngine } from '../utils/soundEngine';

interface ApiWalletModalProps {
  open: boolean;
  onClose: () => void;
  config: BotConfigData;
  apiPrivateKey: string;
  onSave: (params: {
    network: HlNetwork;
    masterWalletAddress: string;
    apiPrivateKey: string;
    rememberKey: boolean;
    mevShieldEnabled: boolean;
    maxSlippageBps: number;
    maxOracleDeviationBps: number;
    riskPerTradeUsd: number;
  }) => void;
}

export const ApiWalletModal: React.FC<ApiWalletModalProps> = ({
  open,
  onClose,
  config,
  apiPrivateKey,
  onSave,
}) => {
  const [network, setNetwork] = useState<HlNetwork>(config.network);
  const [masterWallet, setMasterWallet] = useState(config.masterWalletAddress);
  const [privKey, setPrivKey] = useState(apiPrivateKey);
  const [rememberKey, setRememberKey] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    return localStorage.getItem('tug777_remember_pk') !== 'false';
  });
  const [mevShield, setMevShield] = useState(config.mevShieldEnabled);
  const [maxSlippageBps, setMaxSlippageBps] = useState(String(config.maxSlippageBps));
  const [maxOracleBps, setMaxOracleBps] = useState(String(config.maxOracleDeviationBps));
  const [riskUsd, setRiskUsd] = useState(String(config.riskPerTradeUsd));

  useEffect(() => {
    if (!open) return;
    setNetwork(config.network);
    setMasterWallet(config.masterWalletAddress);
    setPrivKey(apiPrivateKey);
    setMevShield(config.mevShieldEnabled);
    setMaxSlippageBps(String(config.maxSlippageBps));
    setMaxOracleBps(String(config.maxOracleDeviationBps));
    setRiskUsd(String(config.riskPerTradeUsd));
  }, [open, config, apiPrivateKey]);

  const derivedAgentAddress = useMemo(() => {
    const trimmed = privKey.trim();
    if (!trimmed) return null;
    try {
      const normalized = trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`;
      return new Wallet(normalized).address;
    } catch {
      return 'Clave privada inválida';
    }
  }, [privKey]);

  if (!open) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    soundEngine.tradeExecuted();
    const cleanedKey = privKey.trim();
    const normalizedKey = cleanedKey ? (cleanedKey.startsWith('0x') ? cleanedKey : `0x${cleanedKey}`) : '';
    onSave({
      network,
      masterWalletAddress: masterWallet.trim(),
      apiPrivateKey: normalizedKey,
      rememberKey,
      mevShieldEnabled: mevShield,
      maxSlippageBps: Math.max(5, Math.min(300, Number(maxSlippageBps || 25))),
      maxOracleDeviationBps: Math.max(5, Math.min(300, Number(maxOracleBps || 45))),
      riskPerTradeUsd: Math.max(10, Math.min(1000000, Number(riskUsd || 50))),
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      <div className="w-full max-w-xl bg-[#0F131A] border border-slate-800 rounded-xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <KeyRound className="w-5 h-5 text-amber-400" />
            <div>
              <h2 className="text-base font-bold text-slate-100">
                Conexión Real API Wallet — Hyperliquid Perps
              </h2>
              <p className="text-xs text-slate-400">
                Firma EIP-712 local en sesión · Tu API Wallet no puede retirar fondos
              </p>
            </div>
          </div>
          <button
            onClick={() => {
              soundEngine.click();
              onClose();
            }}
            className="p-1.5 text-slate-400 hover:text-slate-100 rounded-md"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[82vh] overflow-y-auto">
          {/* Network selector */}
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              Red de Ejecución Hyperliquid
            </label>
            <div className="grid grid-cols-2 gap-2">
              {(['mainnet', 'testnet'] as const).map((net) => (
                <button
                  key={net}
                  type="button"
                  onClick={() => {
                    soundEngine.click();
                    setNetwork(net);
                  }}
                  className={`py-2 px-3 rounded-md text-xs font-semibold border transition-colors ${
                    network === net
                      ? 'bg-amber-500/15 border-amber-500 text-amber-300'
                      : 'bg-[#090B0E] border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {net === 'mainnet' ? 'Mainnet (Dinero Real)' : 'Testnet (Pruebas)'}
                </button>
              ))}
            </div>
          </div>

          {/* Master Wallet Address */}
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              Dirección Wallet Principal (Master Address 0x...)
            </label>
            <input
              type="text"
              placeholder="0xTuWalletPrincipalEnHyperliquid..."
              value={masterWallet}
              onChange={(e) => setMasterWallet(e.target.value)}
              className="w-full bg-[#090B0E] border border-slate-700 rounded-md px-3 py-2 text-sm font-mono-tabular text-slate-100 focus:outline-none focus:border-amber-500"
            />
            <p className="mt-1 text-[11px] text-slate-500">
              Se usa para leer tus posiciones vivas, balance USDC, margen e historial real de fills.
            </p>
          </div>

          {/* Hyperliquid API Wallet Private Key */}
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              Clave Privada de API Wallet (Agent Private Key)
            </label>
            <input
              type="password"
              placeholder="0x... (Generada en app.hyperliquid.xyz/API)"
              value={privKey}
              onChange={(e) => setPrivKey(e.target.value)}
              className="w-full bg-[#090B0E] border border-slate-700 rounded-md px-3 py-2 text-sm font-mono-tabular text-slate-100 focus:outline-none focus:border-amber-500"
            />
            {derivedAgentAddress && (
              <div
                className={`mt-1.5 text-xs font-mono-tabular flex items-center gap-1.5 ${
                  derivedAgentAddress.includes('inválida') ? 'text-red-400' : 'text-emerald-400'
                }`}
              >
                {derivedAgentAddress.includes('inválida') ? (
                  <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                ) : (
                  <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                )}
                <span>Agent Address derivada: {derivedAgentAddress}</span>
              </div>
            )}
            <label className="mt-2.5 flex items-start gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={rememberKey}
                onChange={(e) => setRememberKey(e.target.checked)}
                className="mt-0.5 accent-amber-500 rounded"
              />
              <span className="text-[11px] text-slate-300 leading-snug">
                Recordar Agent Private Key en este dispositivo (`localStorage`) para cerrar y operar con 1 toque sin volver a pegarla tras recargar o abrir el APK. Nunca se envía a Firestore ni puede retirar fondos.
              </span>
            </label>
          </div>

          {/* Risk & Anti-MEV Flashbots Shield */}
          <div className="pt-2 border-t border-slate-800/80 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs font-semibold text-slate-200">
                  Seguro Anti-Flashbots / Mempool & Slippage Guard
                </span>
                <p className="text-[11px] text-slate-400">
                  Bloquea órdenes IOC si el spread, liquidez L2 o desviación Oracle superan tu límite.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  soundEngine.click();
                  setMevShield(!mevShield);
                }}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                  mevShield ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-400'
                }`}
              >
                {mevShield ? 'ACTIVO' : 'INACTIVO'}
              </button>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Nocional / Trade ($)</label>
                <input
                  type="number"
                  min={10}
                  value={riskUsd}
                  onChange={(e) => setRiskUsd(e.target.value)}
                  className="w-full bg-[#090B0E] border border-slate-700 rounded-md px-2.5 py-1.5 text-xs font-mono-tabular text-slate-100"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Max Slippage (bps)</label>
                <input
                  type="number"
                  min={5}
                  value={maxSlippageBps}
                  onChange={(e) => setMaxSlippageBps(e.target.value)}
                  className="w-full bg-[#090B0E] border border-slate-700 rounded-md px-2.5 py-1.5 text-xs font-mono-tabular text-slate-100"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Max Oracle Δ (bps)</label>
                <input
                  type="number"
                  min={5}
                  value={maxOracleBps}
                  onChange={(e) => setMaxOracleBps(e.target.value)}
                  className="w-full bg-[#090B0E] border border-slate-700 rounded-md px-2.5 py-1.5 text-xs font-mono-tabular text-slate-100"
                />
              </div>
            </div>
          </div>

          <div className="pt-3 flex items-center justify-end gap-3 border-t border-slate-800">
            <button
              type="button"
              onClick={() => {
                soundEngine.click();
                onClose();
              }}
              className="px-4 py-2 text-xs font-medium text-slate-300 hover:text-white"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={Boolean(privKey.trim() && derivedAgentAddress?.includes('inválida'))}
              className="px-5 py-2 rounded-md bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-slate-950 text-xs font-bold transition-colors"
            >
              Guardar y Conectar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
