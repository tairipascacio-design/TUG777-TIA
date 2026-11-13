import React, { useMemo } from 'react';
import { Flame, TrendingDown, TrendingUp } from 'lucide-react';
import type { HlAssetMarket } from '../types/trading';
import { soundEngine } from '../utils/soundEngine';

interface WhaleBonusRadarProps {
  markets: HlAssetMarket[];
  selectedCoin: string;
  onSelectCoin: (coin: string) => void;
}

export const WhaleBonusRadar: React.FC<WhaleBonusRadarProps> = ({
  markets,
  selectedCoin,
  onSelectCoin,
}) => {
  const { fundingOpportunities, oiLeaders } = useMemo(() => {
    const liquid = markets.filter((m) => m.dayNtlVlm >= 1_500_000);
    const fundingSorted = [...liquid]
      .sort((a, b) => Math.abs(b.annualizedFundingPct) - Math.abs(a.annualizedFundingPct))
      .slice(0, 5);

    const oiTurnoverSorted = [...liquid]
      .filter((m) => m.openInterestUsd > 500_000)
      .sort((a, b) => b.dayNtlVlm / b.openInterestUsd - a.dayNtlVlm / a.openInterestUsd)
      .slice(0, 5);

    return {
      fundingOpportunities: fundingSorted,
      oiLeaders: oiTurnoverSorted,
    };
  }, [markets]);

  return (
    <div className="bg-[#0F131A] border border-amber-500/30 rounded-lg overflow-hidden">
      <div className="px-5 py-3.5 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-2 bg-amber-500/[0.04]">
        <div className="flex items-center gap-2">
          <Flame className="w-4 h-4 text-amber-400" />
          <h3 className="text-sm font-bold text-slate-100">
            Regalo Plus TUG777 · Radar Institucional de Funding & Ballenas
          </h3>
        </div>
        <span className="text-xs text-amber-300/90">
          Escaneo en vivo de {markets.length} perpetuos reales · 0% simulación
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-slate-800/80">
        {/* Extreme Funding Carry / Squeeze Radar */}
        <div className="p-4 space-y-2.5">
          <p className="text-xs font-semibold text-slate-300">
            Arbitraje de Funding Extremo (APR Anualizado)
          </p>
          <div className="space-y-1.5">
            {fundingOpportunities.map((m) => {
              const isNegative = m.annualizedFundingPct < 0;
              return (
                <button
                  key={`fund-${m.coin}`}
                  onClick={() => {
                    soundEngine.click();
                    onSelectCoin(m.coin);
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-xs transition-colors border ${
                    selectedCoin === m.coin
                      ? 'bg-amber-500/15 border-amber-500/40'
                      : 'bg-[#090B0E] border-slate-800/70 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {isNegative ? (
                      <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <TrendingDown className="w-3.5 h-3.5 text-red-400" />
                    )}
                    <span className="font-bold text-slate-100">{m.coin}</span>
                    <span className="text-slate-400">
                      {isNegative ? 'Shorts pagan a Longs' : 'Longs pagan a Shorts'}
                    </span>
                  </div>
                  <span
                    className={`font-mono-tabular font-semibold ${
                      isNegative ? 'text-emerald-400' : 'text-amber-400'
                    }`}
                  >
                    {m.annualizedFundingPct >= 0 ? '+' : ''}
                    {m.annualizedFundingPct.toFixed(1)}% APR
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* High Institutional Turnover (Vol / OI) */}
        <div className="p-4 space-y-2.5">
          <p className="text-xs font-semibold text-slate-300">
            Rotación Institucional Explosiva (Volumen 24h / Open Interest)
          </p>
          <div className="space-y-1.5">
            {oiLeaders.map((m) => {
              const ratio = m.openInterestUsd > 0 ? m.dayNtlVlm / m.openInterestUsd : 0;
              return (
                <button
                  key={`oi-${m.coin}`}
                  onClick={() => {
                    soundEngine.click();
                    onSelectCoin(m.coin);
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-xs transition-colors border ${
                    selectedCoin === m.coin
                      ? 'bg-amber-500/15 border-amber-500/40'
                      : 'bg-[#090B0E] border-slate-800/70 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-100">{m.coin}</span>
                    <span className="text-slate-400 font-mono-tabular">
                      Vol ${(m.dayNtlVlm / 1e6).toFixed(1)}M
                    </span>
                  </div>
                  <div className="flex items-center gap-3 font-mono-tabular">
                    <span
                      className={
                        m.change24hPct >= 0 ? 'text-emerald-400' : 'text-red-400'
                      }
                    >
                      {m.change24hPct >= 0 ? '+' : ''}
                      {m.change24hPct.toFixed(2)}%
                    </span>
                    <span className="text-sky-400 font-semibold">{ratio.toFixed(1)}x OI</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
