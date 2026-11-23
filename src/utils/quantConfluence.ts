export function computeQuantConfluence(raw: {
  change24hPct: number;
  annualizedFundingPct: number;
  openInterestUsd: number;
  dayNtlVlm: number;
  markPx: number;
  oraclePx: number;
}): { quantScore: number; quantBias: 'LONG' | 'SHORT' | 'NEUTRAL'; quantSignals: string[] } {
  const signals: string[] = [];
  let bullPts = 0;
  let bearPts = 0;

  const turnover = raw.openInterestUsd > 0 ? raw.dayNtlVlm / raw.openInterestUsd : 0;
  if (turnover > 2.5) {
    signals.push('Alta rotación OI/Vol');
    bullPts += 12;
    bearPts += 12;
  }

  if (raw.change24hPct >= 2.0 && raw.change24hPct <= 14) {
    signals.push(`Momentum alcista +${raw.change24hPct.toFixed(1)}%`);
    bullPts += 28;
  } else if (raw.change24hPct <= -2.0 && raw.change24hPct >= -14) {
    signals.push(`Momentum bajista ${raw.change24hPct.toFixed(1)}%`);
    bearPts += 28;
  } else if (raw.change24hPct > 18) {
    signals.push(`Tendencia fuerte extendida (+${raw.change24hPct.toFixed(1)}%)`);
    bullPts += 10;
  } else if (raw.change24hPct < -18) {
    signals.push(`Tendencia bajista extendida (${raw.change24hPct.toFixed(1)}%)`);
    bearPts += 10;
  }

  if (raw.annualizedFundingPct <= -25) {
    signals.push(`Short Squeeze Funding (${raw.annualizedFundingPct.toFixed(0)}% APR)`);
    bullPts += 18;
  } else if (raw.annualizedFundingPct >= 65) {
    signals.push(`Funding muy cargado (${raw.annualizedFundingPct.toFixed(0)}% APR)`);
    bearPts += 12;
  }

  const basisBps = raw.oraclePx > 0 ? ((raw.markPx - raw.oraclePx) / raw.oraclePx) * 10000 : 0;
  if (basisBps > 8) {
    signals.push('Prima Mark > Oracle');
    bullPts += 10;
  } else if (basisBps < -8) {
    signals.push('Descuento Mark < Oracle');
    bearPts += 10;
  }

  if (raw.dayNtlVlm > 5_000_000) {
    bullPts += 14;
    bearPts += 14;
    signals.push('Liquidez Profunda >$5M');
  }

  const net = bullPts - bearPts;
  const quantScore = Math.min(98, Math.max(bullPts, bearPts));
  if (net >= 16) return { quantScore, quantBias: 'LONG', quantSignals: signals };
  if (net <= -16) return { quantScore, quantBias: 'SHORT', quantSignals: signals };
  return { quantScore: Math.round(quantScore * 0.7), quantBias: 'NEUTRAL', quantSignals: signals };
}
