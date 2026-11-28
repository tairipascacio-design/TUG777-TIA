import type {
  AiMemoryEntry,
  BotConfigData,
  DecisionBand,
  DeepAssetAnalysis,
  HlAccountSummary,
  HlAssetMarket,
  HlCandle,
  HlL2Level,
  HlLivePosition,
  MarketRegime,
  PersistedPosition,
  PositionManagementDecision,
  StrategyPlaybookItem,
} from '../types/trading';

export const MIN_ATTRIBUTABLE_TRADES = 25;

export function parsePairBiasLocks(jsonStr?: string): Record<string, 'AMBOS' | 'SOLO_LONG' | 'SOLO_SHORT' | 'PAUSA'> {
  if (!jsonStr || !jsonStr.trim()) return {};
  try {
    const parsed = JSON.parse(jsonStr) as Record<string, string>;
    const out: Record<string, 'AMBOS' | 'SOLO_LONG' | 'SOLO_SHORT' | 'PAUSA'> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (v === 'AMBOS' || v === 'SOLO_LONG' || v === 'SOLO_SHORT' || v === 'PAUSA') {
        out[k.toUpperCase()] = v;
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function computeCalibratedStrategyWeight(params: {
  wins: number;
  losses: number;
  totalPnlUsd: number;
  grossWinUsd?: number;
  grossLossUsd?: number;
}): number {
  const total = params.wins + params.losses;
  if (total < MIN_ATTRIBUTABLE_TRADES) {
    return 1.0;
  }
  const wr = total > 0 ? params.wins / total : 0.5;
  const estGrossWin =
    typeof params.grossWinUsd === 'number'
      ? params.grossWinUsd
      : params.totalPnlUsd > 0
      ? params.totalPnlUsd + Math.max(0.5, params.losses * 0.6)
      : Math.max(0.1, params.wins * 0.5);
  const estGrossLoss =
    typeof params.grossLossUsd === 'number'
      ? params.grossLossUsd
      : params.totalPnlUsd < 0
      ? Math.abs(params.totalPnlUsd) + Math.max(0.5, params.wins * 0.5)
      : Math.max(0.5, params.losses * 0.6);

  const profitFactor = estGrossLoss > 0 ? estGrossWin / estGrossLoss : estGrossWin > 0 ? 2.5 : 1.0;
  const pfScore = Math.max(0.3, Math.min(2.2, 0.55 + (profitFactor - 1.0) * 0.55 + (wr - 0.5) * 0.7));
  let weight = Number(pfScore.toFixed(2));
  // Hard invariant: a strategy with negative net PnL MUST NEVER exceed 1.00x weight
  if (params.totalPnlUsd < 0) {
    weight = Math.min(1.0, weight);
  }
  return Math.max(0.3, Math.min(2.5, weight));
}

export function getDecisionBand(score: number): DecisionBand {
  if (score >= 80) return 'CONFLUENCIA_ALTA';
  if (score >= 65) return 'SENAL_VALIDA';
  if (score >= 50) return 'ESPERAR_CONFIRMACION';
  return 'NO_OPERAR';
}

export function formatDecisionBandLabel(band?: DecisionBand): string {
  switch (band) {
    case 'CONFLUENCIA_ALTA':
      return '80–100 Confluencia Alta';
    case 'SENAL_VALIDA':
      return '65–79 Señal Válida';
    case 'ESPERAR_CONFIRMACION':
      return '50–64 Esperar Confirmación';
    default:
      return '0–49 No Operar';
  }
}

export type StrategySampleStatus = 'SIN_MUESTRA' | 'MUESTRA_BAJA' | 'DEMOSTRADO';

export function getStrategySampleStatus(
  item: Pick<StrategyPlaybookItem, 'wins' | 'losses'>
): { total: number; status: StrategySampleStatus; label: string; proven: boolean } {
  const total = (item.wins || 0) + (item.losses || 0);
  if (total === 0) {
    return { total, status: 'SIN_MUESTRA', label: `Sin muestra (0/${MIN_ATTRIBUTABLE_TRADES})`, proven: false };
  }
  if (total < MIN_ATTRIBUTABLE_TRADES) {
    return {
      total,
      status: 'MUESTRA_BAJA',
      label: `Muestra baja (${total}/${MIN_ATTRIBUTABLE_TRADES})`,
      proven: false,
    };
  }
  return { total, status: 'DEMOSTRADO', label: `Demostrado (${total} ops)`, proven: true };
}

export const POSITION_MANAGEMENT_GUIDE_RULES = [
  '1. Stop Loss Nativo reduceOnly en Hyperliquid (normalTpsl): Protege la posición directo en el exchange al instante de abrirla.',
  '2. Take Profit Escalonado (+3R) si nocional >= $35 USD: TP1 30% + BE, TP2 30%, 40% Trailing. Si < $35 USD: 1 SL nativo + 1 TP nativo + BE opcional.',
  '3. Riesgo Cuantitativo 0.25%–0.5% / Trade & Kill Switch Diario 2.0%–3.0%: Tamaño calculado por riesgo real y distancia al stop.',
  '4. Bloqueo Direccional (AMBOS/LONG/SHORT/PAUSA) + Anti-Correlación + Cooldown 3h tras racha de 3 pérdidas consecutivas.',
  '5. Motor Inteligencia Completo: EMA 9/21/50/200, ADX(14), CVD, Volume Profile (POC/VAH/VAL), SMC (BOS/CHoCH/FVG), Caza-Barridas y Anti-Trampas.',
  '6. Calibración Honesta (>=25 ops): Bandas 0–49 No operar | 50–64 Esperar | 65–79 Válida | 80–100 Confluencia alta; pesos <=1.0x si PnL < 0.',
];

export const DEFAULT_STRATEGY_PLAYBOOK: Array<
  Omit<StrategyPlaybookItem, 'ownerId' | 'wins' | 'losses' | 'totalPnlUsd' | 'updatedAtMs'>
> = [
  {
    strategyId: 'EMA_RIBBON_PULLBACK',
    name: 'Smart Money Concepts (SMC) + EMA 9/21/50/200',
    category: 'TREND',
    preferredRegimes: 'TRENDING_BULL,TRENDING_BEAR',
    entryRule: 'BOS/CHoCH + Fair Value Gap (FVG) / Order Block en retroceso limpio a EMA21/50 con macro EMA200 alineada.',
    positionManagementGuide: 'TP1 30% + Breakeven (+0.15%); cerrar por invalidación si pierde estructura BOS/EMA21.',
    weight: 1.0,
    enabled: true,
  },
  {
    strategyId: 'SUPERTREND_REGIME_RIDER',
    name: 'Trend Following (EMA + ADX + Supertrend MTF)',
    category: 'TREND',
    preferredRegimes: 'TRENDING_BULL,TRENDING_BEAR,BREAKOUT_EXPANSION',
    entryRule: 'Supertrend 15M+1H alineado con EMA50/200 y fuerza direccional ADX(14) >= 18 (bloqueado en mercado sin fuerza).',
    positionManagementGuide: 'Dejar correr 40% final con trailing dinámico tras TP1/TP2 hasta TP3 (3.5%).',
    weight: 1.0,
    enabled: true,
  },
  {
    strategyId: 'BOLLINGER_SQUEEZE_BREAKOUT',
    name: 'Volatility Breakout (ATR + BB Squeeze)',
    category: 'VOLATILITY',
    preferredRegimes: 'HIGH_VOLATILITY_SQUEEZE,BREAKOUT_EXPANSION',
    entryRule: 'Compresión BBWidth(20,2) seguida de ruptura con expansión de volumen >1.3x y sin señal de ruptura falsa.',
    positionManagementGuide: 'TP1 al 1R, si falla la banda media con flujo CVD en contra salir por invalidación.',
    weight: 1.0,
    enabled: true,
  },
  {
    strategyId: 'VWAP_MEAN_REVERSION',
    name: 'Mean Reversion + Volume Profile (VWAP/VAH/VAL)',
    category: 'MEAN_REVERSION',
    preferredRegimes: 'RANGING_CHOP',
    entryRule: 'Desviación extrema |Z-Score| >= 2.0 y extensión fuera de Value Area (VAH/VAL) buscando retorno al POC/VWAP.',
    positionManagementGuide: 'Tomar TP1 rápido rumbo al POC/VWAP; nunca operar contra tendencia 1H intacta.',
    weight: 1.0,
    enabled: true,
  },
  {
    strategyId: 'RSI_DIVERGENCE_REVERSAL',
    name: 'RSI(14) Divergencia & Agotamiento',
    category: 'MOMENTUM',
    preferredRegimes: 'RANGING_CHOP,TRENDING_BULL,TRENDING_BEAR',
    entryRule: 'Divergencia alcista/bajista en RSI(14) sobre swing clave con confirmación de vela y sin trampa de soporte/resistencia falso.',
    positionManagementGuide: 'SL dinámico detrás del swing (>=0.85%); TP1 30%, TP2 30%, trailing 40%.',
    weight: 1.0,
    enabled: true,
  },
  {
    strategyId: 'MACD_MOMENTUM_CROSS',
    name: 'MACD(12,26,9) Histograma Acelerado',
    category: 'MOMENTUM',
    preferredRegimes: 'TRENDING_BULL,TRENDING_BEAR,BREAKOUT_EXPANSION',
    entryRule: 'Cruce y expansión creciente del histograma MACD alineado con EMA9/21/50 y pendiente 1H.',
    positionManagementGuide: 'Reducir exposición o apretar trailing cuando el histograma pierde pendiente.',
    weight: 1.0,
    enabled: true,
  },
  {
    strategyId: 'ATR_DONCHIAN_BREAKOUT',
    name: 'Breakout & Retest (Donchian 20)',
    category: 'TREND',
    preferredRegimes: 'BREAKOUT_EXPANSION,TRENDING_BULL,TRENDING_BEAR',
    entryRule: 'Ruptura confirmada o retesteo limpio de rango 20 velas con cuerpo sólido (>48%) y volumen expansivo.',
    positionManagementGuide: 'Cerrar si reingresa fallidamente dentro del rango y confirma invalidación 15M+1H.',
    weight: 1.0,
    enabled: true,
  },
  {
    strategyId: 'LIQUIDITY_SWEEP_REJECTION',
    name: 'Liquidity Sweep (Prioritaria / Stop Hunt)',
    category: 'ORDERFLOW',
    preferredRegimes: 'RANGING_CHOP,HIGH_VOLATILITY_SQUEEZE,TRENDING_BULL,TRENDING_BEAR',
    entryRule: 'Barrida de máximos/mínimos de liquidez con mecha >=42%, reclaim confirmado y absorción L2/CVD.',
    positionManagementGuide: 'Alta asimetría: TP1 30% + Breakeven inmediato, TP2 30%, runner 40% con trailing.',
    weight: 1.0,
    enabled: true,
  },
  {
    strategyId: 'L2_ORDERBOOK_IMBALANCE',
    name: 'Order Flow, CVD & Volume Profile (L2 + POC)',
    category: 'ORDERFLOW',
    preferredRegimes: 'TRENDING_BULL,TRENDING_BEAR,RANGING_CHOP,BREAKOUT_EXPANSION',
    entryRule: 'Desequilibrio neto en L2 (>=24%) alineado con flujo CVD y rechazo en POC / Value Area con spread <=14 bps.',
    positionManagementGuide: 'Confirmación institucional de flujo; aborta si el spread supera límite MEV.',
    weight: 1.0,
    enabled: true,
  },
  {
    strategyId: 'FUNDING_OI_SQUEEZE',
    name: 'Liquidation Hunting (Funding + OI Squeeze)',
    category: 'ORDERFLOW',
    preferredRegimes: 'BREAKOUT_EXPANSION,TRENDING_BULL,TRENDING_BEAR',
    entryRule: 'Funding anualizado extremo (<-25% o >+65%) + alta rotación OI/Volumen detectando cascada de stops.',
    positionManagementGuide: 'Asegurar TP1/TP2 rápido durante la cascada de liquidaciones y trailing al resto.',
    weight: 1.0,
    enabled: true,
  },
];

// ---------- Pure Mathematical Technical Indicators ----------

function calcEmaSeries(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const result: number[] = [values[0]];
  for (let i = 1; i < values.length; i++) {
    result.push(values[i] * k + result[i - 1] * (1 - k));
  }
  return result;
}

function calcRsiSeries(closes: number[], period = 14): number[] {
  if (closes.length <= period) return closes.map(() => 50);
  const rsis: number[] = new Array(closes.length).fill(50);
  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gainSum += diff;
    else lossSum += Math.abs(diff);
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  rsis[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    rsis[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return rsis;
}

function calcAtrSeries(candles: HlCandle[], period = 14): number[] {
  if (candles.length === 0) return [];
  const trs: number[] = [candles[0].h - candles[0].l];
  for (let i = 1; i < candles.length; i++) {
    const cur = candles[i];
    const prevClose = candles[i - 1].c;
    trs.push(Math.max(cur.h - cur.l, Math.abs(cur.h - prevClose), Math.abs(cur.l - prevClose)));
  }
  return calcEmaSeries(trs, period);
}

function calcSupertrendDirection(candles: HlCandle[], period = 10, mult = 3.0): 'LONG' | 'SHORT' {
  if (candles.length < period + 2) return 'LONG';
  const atr = calcAtrSeries(candles, period);
  let upperBand = 0;
  let lowerBand = 0;
  let trend: 'LONG' | 'SHORT' = 'LONG';

  for (let i = 0; i < candles.length; i++) {
    const hl2 = (candles[i].h + candles[i].l) / 2;
    const rawUpper = hl2 + mult * atr[i];
    const rawLower = hl2 - mult * atr[i];
    if (i === 0) {
      upperBand = rawUpper;
      lowerBand = rawLower;
      continue;
    }
    const prevClose = candles[i - 1].c;
    lowerBand = rawLower > lowerBand || prevClose < lowerBand ? rawLower : lowerBand;
    upperBand = rawUpper < upperBand || prevClose > upperBand ? rawUpper : upperBand;

    if (candles[i].c > upperBand) trend = 'LONG';
    else if (candles[i].c < lowerBand) trend = 'SHORT';
  }
  return trend;
}

function calcVwapAndZScore(candles: HlCandle[]): { vwap: number; zScore: number; distPct: number } {
  const slice = candles.slice(-48);
  if (slice.length === 0) return { vwap: 0, zScore: 0, distPct: 0 };
  let pvSum = 0;
  let vSum = 0;
  const typPrices: number[] = [];
  for (const c of slice) {
    const tp = (c.h + c.l + c.c) / 3;
    typPrices.push(tp);
    const vol = Math.max(c.v, 1e-8);
    pvSum += tp * vol;
    vSum += vol;
  }
  const vwap = vSum > 0 ? pvSum / vSum : slice[slice.length - 1].c;
  const variance =
    typPrices.reduce((acc, p) => acc + Math.pow(p - vwap, 2), 0) / Math.max(1, typPrices.length);
  const std = Math.sqrt(variance) || vwap * 0.004;
  const last = slice[slice.length - 1].c;
  return {
    vwap,
    zScore: (last - vwap) / std,
    distPct: vwap > 0 ? ((last - vwap) / vwap) * 100 : 0,
  };
}

function calcBollinger(closes: number[], period = 20, mult = 2.0) {
  const slice = closes.slice(-period);
  if (slice.length < 5) {
    const px = closes[closes.length - 1] || 1;
    return { mid: px, upper: px, lower: px, widthPct: 1 };
  }
  const mid = slice.reduce((a, b) => a + b, 0) / slice.length;
  const variance = slice.reduce((a, b) => a + Math.pow(b - mid, 2), 0) / slice.length;
  const std = Math.sqrt(variance);
  const upper = mid + mult * std;
  const lower = mid - mult * std;
  const widthPct = mid > 0 ? ((upper - lower) / mid) * 100 : 0;
  return { mid, upper, lower, widthPct };
}

function calcAdx(candles: HlCandle[], period = 14): { adx: number; plusDi: number; minusDi: number } {
  if (candles.length < period + 2) return { adx: 20, plusDi: 20, minusDi: 20 };
  const trs: number[] = [];
  const plusDms: number[] = [];
  const minusDms: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const cur = candles[i];
    const prev = candles[i - 1];
    const tr = Math.max(cur.h - cur.l, Math.abs(cur.h - prev.c), Math.abs(cur.l - prev.c));
    const upMove = cur.h - prev.h;
    const downMove = prev.l - cur.l;
    trs.push(tr);
    plusDms.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDms.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }
  const trEma = calcEmaSeries(trs, period);
  const plusEma = calcEmaSeries(plusDms, period);
  const minusEma = calcEmaSeries(minusDms, period);
  const dxs: number[] = [];
  let lastPlus = 20;
  let lastMinus = 20;
  for (let i = 0; i < trEma.length; i++) {
    const t = Math.max(trEma[i], 1e-9);
    const pdi = (plusEma[i] / t) * 100;
    const mdi = (minusEma[i] / t) * 100;
    lastPlus = pdi;
    lastMinus = mdi;
    const sum = pdi + mdi;
    dxs.push(sum > 0 ? (Math.abs(pdi - mdi) / sum) * 100 : 0);
  }
  const adxArr = calcEmaSeries(dxs, period);
  return {
    adx: adxArr[adxArr.length - 1] ?? 20,
    plusDi: lastPlus,
    minusDi: lastMinus,
  };
}

function calcCvdFlow(candles: HlCandle[]): { cvdSlope: number; netDeltaRatio: number } {
  const slice = candles.slice(-20);
  if (slice.length < 4) return { cvdSlope: 0, netDeltaRatio: 0 };
  const deltas: number[] = [];
  let totalVol = 0;
  for (const c of slice) {
    const range = Math.max(c.h - c.l, 1e-9);
    const ratio = (2 * c.c - c.h - c.l) / range; // +1 full bull close, -1 full bear close
    deltas.push(c.v * ratio);
    totalVol += Math.max(c.v, 0);
  }
  const recent6 = deltas.slice(-6).reduce((a, b) => a + b, 0);
  const prev6 = deltas.slice(-12, -6).reduce((a, b) => a + b, 0);
  const recentVol = slice.slice(-6).reduce((a, b) => a + b.v, 0) || 1;
  const netDeltaRatio = totalVol > 0 ? deltas.reduce((a, b) => a + b, 0) / totalVol : 0;
  const cvdSlope = recentVol > 0 ? (recent6 - prev6 * 0.5) / recentVol : 0;
  return {
    cvdSlope: Number(Math.max(-2, Math.min(2, cvdSlope)).toFixed(3)),
    netDeltaRatio: Number(Math.max(-1, Math.min(1, netDeltaRatio)).toFixed(3)),
  };
}

function calcVolumeProfile(candles: HlCandle[], bins = 16): { pocPx: number; vahPx: number; valPx: number } {
  const slice = candles.slice(-60);
  if (slice.length < 5) {
    const px = candles[candles.length - 1]?.c || 0;
    return { pocPx: px, vahPx: px, valPx: px };
  }
  const minLow = Math.min(...slice.map((c) => c.l));
  const maxHigh = Math.max(...slice.map((c) => c.h));
  const span = Math.max(maxHigh - minLow, 1e-8);
  const step = span / bins;
  const buckets = new Array<number>(bins).fill(0);
  let totalVol = 0;
  for (const c of slice) {
    const mid = (c.h + c.l + c.c) / 3;
    const idx = Math.max(0, Math.min(bins - 1, Math.floor((mid - minLow) / step)));
    buckets[idx] += Math.max(c.v, 0);
    totalVol += Math.max(c.v, 0);
  }
  let pocIdx = 0;
  for (let i = 1; i < bins; i++) {
    if (buckets[i] > buckets[pocIdx]) pocIdx = i;
  }
  let accVol = buckets[pocIdx];
  let loIdx = pocIdx;
  let hiIdx = pocIdx;
  const targetVol = totalVol * 0.7;
  while (accVol < targetVol && (loIdx > 0 || hiIdx < bins - 1)) {
    const leftVol = loIdx > 0 ? buckets[loIdx - 1] : -1;
    const rightVol = hiIdx < bins - 1 ? buckets[hiIdx + 1] : -1;
    if (rightVol >= leftVol && hiIdx < bins - 1) {
      hiIdx += 1;
      accVol += buckets[hiIdx];
    } else if (loIdx > 0) {
      loIdx -= 1;
      accVol += buckets[loIdx];
    } else {
      break;
    }
  }
  return {
    pocPx: minLow + (pocIdx + 0.5) * step,
    valPx: minLow + loIdx * step,
    vahPx: minLow + (hiIdx + 1) * step,
  };
}

function detectSmcStructure(candles: HlCandle[]): {
  bias: 'BULL_BOS' | 'BEAR_BOS' | 'BULL_CHOCH' | 'BEAR_CHOCH' | 'NEUTRAL';
  bullFvg: boolean;
  bearFvg: boolean;
} {
  if (candles.length < 20) return { bias: 'NEUTRAL', bullFvg: false, bearFvg: false };
  const recent = candles.slice(-18);
  const prior = recent.slice(0, -4);
  const last4 = recent.slice(-4);
  const prevHigh = Math.max(...prior.map((c) => c.h));
  const prevLow = Math.min(...prior.map((c) => c.l));
  const older = candles.slice(-36, -18);
  const olderTrendUp =
    older.length >= 4 && older[older.length - 1].c > older[0].c;
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2] ?? last;
  const prev2 = candles[candles.length - 3] ?? prev;

  // Fair Value Gap (3-candle imbalance)
  const bullFvg = last.l > prev2.h || prev.l > (candles[candles.length - 4]?.h ?? prev.h);
  const bearFvg = last.h < prev2.l || prev.h < (candles[candles.length - 4]?.l ?? prev.l);

  const brokeHigh = last4.some((c) => c.c > prevHigh);
  const brokeLow = last4.some((c) => c.c < prevLow);

  if (brokeHigh && !brokeLow) {
    return { bias: olderTrendUp ? 'BULL_BOS' : 'BULL_CHOCH', bullFvg, bearFvg };
  }
  if (brokeLow && !brokeHigh) {
    return { bias: !olderTrendUp ? 'BEAR_BOS' : 'BEAR_CHOCH', bullFvg, bearFvg };
  }
  return { bias: 'NEUTRAL', bullFvg, bearFvg };
}

// ---------- Market Regime & Unified 10-Strategy Evaluation ----------

export function evaluateUnifiedDeepSetup(params: {
  market: HlAssetMarket;
  candles15m: HlCandle[];
  candles1h: HlCandle[];
  bids: HlL2Level[];
  asks: HlL2Level[];
  playbook: StrategyPlaybookItem[];
  memories: AiMemoryEntry[];
}): DeepAssetAnalysis {
  const { market, candles15m, candles1h, bids, asks, playbook, memories } = params;
  const c15 = candles15m.length >= 25 ? candles15m : candles1h;
  const c1h = candles1h.length >= 25 ? candles1h : c15;

  const closes15 = c15.map((k) => k.c);
  const closes1h = c1h.map((k) => k.c);
  const lastCandle = c15[c15.length - 1] ?? {
    o: market.markPx,
    c: market.markPx,
    h: market.markPx,
    l: market.markPx,
    v: 0,
    t: Date.now(),
    T: Date.now(),
    s: market.coin,
    i: '15m',
    n: 0,
  };
  const prevCandle = c15[c15.length - 2] ?? lastCandle;
  const px = market.markPx || lastCandle.c;

  const ema9Arr = calcEmaSeries(closes15, 9);
  const ema21Arr = calcEmaSeries(closes15, 21);
  const ema50Arr = calcEmaSeries(closes15, 50);
  const ema55Arr = calcEmaSeries(closes15, 55);
  const ema200Arr = calcEmaSeries(closes15, 200);
  const ema9 = ema9Arr[ema9Arr.length - 1] ?? px;
  const ema21 = ema21Arr[ema21Arr.length - 1] ?? px;
  const ema50 = ema50Arr[ema50Arr.length - 1] ?? px;
  const ema55 = ema55Arr[ema55Arr.length - 1] ?? px;
  const ema200 = ema200Arr[ema200Arr.length - 1] ?? ema50;

  const ema21_1hArr = calcEmaSeries(closes1h, 21);
  const ema50_1hArr = calcEmaSeries(closes1h, 50);
  const ema21_1h = ema21_1hArr[ema21_1hArr.length - 1] ?? px;
  const ema50_1h = ema50_1hArr[ema50_1hArr.length - 1] ?? px;
  const trend1hUp = px > ema21_1h && ema21_1h >= ema50_1h * 0.998;
  const trend1hDown = px < ema21_1h && ema21_1h <= ema50_1h * 1.002;

  const rsiArr = calcRsiSeries(closes15, 14);
  const rsi14 = rsiArr[rsiArr.length - 1] ?? 50;
  const prevRsi = rsiArr[rsiArr.length - 5] ?? rsi14;

  const ema12 = calcEmaSeries(closes15, 12);
  const ema26 = calcEmaSeries(closes15, 26);
  const macdLine = ema12.map((v, idx) => v - (ema26[idx] ?? v));
  const signalLine = calcEmaSeries(macdLine, 9);
  const histNow = (macdLine[macdLine.length - 1] ?? 0) - (signalLine[signalLine.length - 1] ?? 0);
  const histPrev = (macdLine[macdLine.length - 2] ?? 0) - (signalLine[signalLine.length - 2] ?? 0);

  const atrArr = calcAtrSeries(c15, 14);
  const atr = atrArr[atrArr.length - 1] || px * 0.008;
  const atrPct = px > 0 ? (atr / px) * 100 : 0.8;

  const adxInfo = calcAdx(c15, 14);
  const cvdInfo = calcCvdFlow(c15);
  const vpInfo = calcVolumeProfile(c15, 16);
  const smcInfo = detectSmcStructure(c15);

  const bb = calcBollinger(closes15, 20, 2.0);
  const prevBb = calcBollinger(closes15.slice(0, -3), 20, 2.0);
  const vwapInfo = calcVwapAndZScore(c15);

  const supertrend15 = calcSupertrendDirection(c15, 10, 3.0);
  const supertrend1h = calcSupertrendDirection(c1h, 10, 3.0);

  const volSlice = c15.slice(-22, -2).map((k) => k.v);
  const avgVol = volSlice.length > 0 ? volSlice.reduce((a, b) => a + b, 0) / volSlice.length : prevCandle.v || 1;
  const elapsedMs = Math.max(60_000, Date.now() - lastCandle.t);
  const elapsedFrac = Math.min(1, elapsedMs / 900_000);
  const effectiveVol = elapsedFrac < 0.35 ? prevCandle.v : lastCandle.v / elapsedFrac;
  const volRatio = avgVol > 0 ? effectiveVol / avgVol : 1;

  // L2 Orderbook imbalance & spread
  const topBidUsd = bids.slice(0, 10).reduce((acc, b) => acc + b.px * b.sz, 0);
  const topAskUsd = asks.slice(0, 10).reduce((acc, a) => acc + a.px * a.sz, 0);
  const l2Imbalance =
    topBidUsd + topAskUsd > 0 ? (topBidUsd - topAskUsd) / (topBidUsd + topAskUsd) : 0;
  const bestBid = bids[0]?.px ?? px;
  const bestAsk = asks[0]?.px ?? px;
  const spreadBps = px > 0 ? ((bestAsk - bestBid) / px) * 10000 : 0;

  // Detect Market Regime incorporating ADX + EMA50/200 + BB
  let regime: MarketRegime = 'RANGING_CHOP';
  if (bb.widthPct < 1.35 && prevBb.widthPct < 1.35) {
    regime = 'HIGH_VOLATILITY_SQUEEZE';
  } else if (volRatio >= 1.45 && (px > bb.upper || px < bb.lower)) {
    regime = 'BREAKOUT_EXPANSION';
  } else if (ema9 > ema21 && ema21 > ema50 && trend1hUp && adxInfo.adx >= 17) {
    regime = 'TRENDING_BULL';
  } else if (ema9 < ema21 && ema21 < ema50 && trend1hDown && adxInfo.adx >= 17) {
    regime = 'TRENDING_BEAR';
  }

  // Higher-Timeframe structural lock: forbids counter-trend fades into active 1H+15M trends
  const htfBullLocked =
    regime === 'TRENDING_BULL' ||
    (supertrend1h === 'LONG' && supertrend15 === 'LONG') ||
    (trend1hUp && ema9 > ema21 && px > ema50);
  const htfBearLocked =
    regime === 'TRENDING_BEAR' ||
    (supertrend1h === 'SHORT' && supertrend15 === 'SHORT') ||
    (trend1hDown && ema9 < ema21 && px < ema50);

  // Map playbook items from Firestore (or default if unauthenticated)
  const playbookMap = new Map<string, StrategyPlaybookItem>();
  for (const def of DEFAULT_STRATEGY_PLAYBOOK) {
    playbookMap.set(def.strategyId, {
      ...def,
      ownerId: 'default',
      wins: 0,
      losses: 0,
      totalPnlUsd: 0,
      updatedAtMs: Date.now(),
    });
  }
  for (const p of playbook) {
    playbookMap.set(p.strategyId, p);
  }

  let longPts = 0;
  let shortPts = 0;
  const firedLong: string[] = [];
  const firedShort: string[] = [];
  const reasonsLong: string[] = [];
  const reasonsShort: string[] = [];

  const vote = (
    strategyId: string,
    side: 'LONG' | 'SHORT',
    basePts: number,
    reason: string,
    isCounterTrend = false
  ) => {
    if (side === 'SHORT' && htfBullLocked && isCounterTrend) return;
    if (side === 'LONG' && htfBearLocked && isCounterTrend) return;

    const cfg = playbookMap.get(strategyId);
    if (cfg && !cfg.enabled) return;
    const sampleTrades = cfg ? cfg.wins + cfg.losses : 0;
    const learnedWeight =
      cfg && sampleTrades >= MIN_ATTRIBUTABLE_TRADES ? cfg.weight : Math.min(1.0, cfg?.weight ?? 1.0);
    const regimeMatch = cfg?.preferredRegimes.includes(regime) ? 1.25 : 0.85;
    const pts = basePts * learnedWeight * regimeMatch;
    if (side === 'LONG') {
      longPts += pts;
      firedLong.push(strategyId);
      reasonsLong.push(reason);
    } else {
      shortPts += pts;
      firedShort.push(strategyId);
      reasonsShort.push(reason);
    }
  };

  // Evaluate closed signal candle when current candle just opened
  const sigCandle = elapsedFrac < 0.25 ? prevCandle : lastCandle;
  const sigPrev = elapsedFrac < 0.25 ? (c15[c15.length - 3] ?? prevCandle) : prevCandle;

  // 1. Smart Money Concepts (BOS/CHoCH/FVG) + EMA 9/21/50/200 Pullback Sniper
  const distFromEma21Atr = atr > 0 ? (px - ema21) / atr : 0;
  const smcBullAligned =
    (smcInfo.bias === 'BULL_BOS' || smcInfo.bias === 'BULL_CHOCH') && (smcInfo.bullFvg || px >= ema200 * 0.995);
  const smcBearAligned =
    (smcInfo.bias === 'BEAR_BOS' || smcInfo.bias === 'BEAR_CHOCH') && (smcInfo.bearFvg || px <= ema200 * 1.005);

  if (
    ((ema9 > ema21 && ema21 > ema50 && trend1hUp) || smcBullAligned) &&
    distFromEma21Atr >= -0.9 &&
    distFromEma21Atr <= 1.6
  ) {
    vote(
      'EMA_RIBBON_PULLBACK',
      'LONG',
      22,
      smcBullAligned
        ? `SMC ${smcInfo.bias}${smcInfo.bullFvg ? '+FVG' : ''} + pullback EMA21/50`
        : 'Pullback alcista limpio en EMA21/50/200 (15M+1H)'
    );
  } else if (
    ((ema9 < ema21 && ema21 < ema50 && trend1hDown) || smcBearAligned) &&
    distFromEma21Atr <= 0.9 &&
    distFromEma21Atr >= -1.6
  ) {
    vote(
      'EMA_RIBBON_PULLBACK',
      'SHORT',
      22,
      smcBearAligned
        ? `SMC ${smcInfo.bias}${smcInfo.bearFvg ? '+FVG' : ''} + pullback EMA21/50`
        : 'Pullback bajista limpio en EMA21/50/200 (15M+1H)'
    );
  }

  // 2. Trend Following (EMA + ADX + Supertrend MTF Rider) — requires ADX >= 18 so it doesn't fire in dead chop
  if (supertrend15 === 'LONG' && supertrend1h === 'LONG' && adxInfo.adx >= 18 && adxInfo.plusDi >= adxInfo.minusDi) {
    vote('SUPERTREND_REGIME_RIDER', 'LONG', 21, `Trend LONG 15M+1H · ADX ${adxInfo.adx.toFixed(0)}`);
  } else if (
    supertrend15 === 'SHORT' &&
    supertrend1h === 'SHORT' &&
    adxInfo.adx >= 18 &&
    adxInfo.minusDi >= adxInfo.plusDi
  ) {
    vote('SUPERTREND_REGIME_RIDER', 'SHORT', 21, `Trend SHORT 15M+1H · ADX ${adxInfo.adx.toFixed(0)}`);
  }

  // Pre-compute Liquidity Pools, Breakouts & Anti-Trap Flags (Fake Breakouts, Fake Sweeps, Fake Supports/Resistances)
  const lookbackCandles = c15.slice(-16, -2);
  const lookbackLow = lookbackCandles.length > 0 ? Math.min(...lookbackCandles.map((k) => k.l)) : px;
  const lookbackHigh = lookbackCandles.length > 0 ? Math.max(...lookbackCandles.map((k) => k.h)) : px;
  const high20 = Math.max(...c15.slice(-22, -2).map((k) => k.h));
  const low20 = Math.min(...c15.slice(-22, -2).map((k) => k.l));
  const prevWindow20 = c15.slice(-23, -3);
  const prevHigh20 = prevWindow20.length > 0 ? Math.max(...prevWindow20.map((k) => k.h)) : high20;
  const prevLow20 = prevWindow20.length > 0 ? Math.min(...prevWindow20.map((k) => k.l)) : low20;

  const candleRange = Math.max(sigCandle.h - sigCandle.l, 1e-8);
  const bodyRatio = Math.abs(sigCandle.c - sigCandle.o) / candleRange;
  const lowerWickRatio = (Math.min(sigCandle.o, sigCandle.c) - sigCandle.l) / candleRange;
  const upperWickRatio = (sigCandle.h - Math.max(sigCandle.o, sigCandle.c)) / candleRange;
  const closePosInCandle = (sigCandle.c - sigCandle.l) / candleRange;

  const trapWarnings: string[] = [];
  let sweepDirection: 'LONG_SWEEP' | 'SHORT_SWEEP' | 'NONE' = 'NONE';

  // Trap 1: Fake Breakout Detector (wick poke outside 20-bar range, weak volume/body breakout, or failed hold back inside)
  const bullFakeout =
    (sigCandle.h > high20 && sigCandle.c <= high20) ||
    (sigCandle.c > high20 && (volRatio < 1.15 || bodyRatio < 0.42)) ||
    (sigPrev.c > prevHigh20 && sigCandle.c < prevHigh20);
  const bearFakeout =
    (sigCandle.l < low20 && sigCandle.c >= low20) ||
    (sigCandle.c < low20 && (volRatio < 1.15 || bodyRatio < 0.42)) ||
    (sigPrev.c < prevLow20 && sigCandle.c > prevLow20);

  if (bullFakeout) trapWarnings.push('RUPTURA FALSA ALCISTA (bloquea chase LONG)');
  if (bearFakeout) trapWarnings.push('RUPTURA FALSA BAJISTA (bloquea chase SHORT)');

  // Trap 2: Fake Sweep / Falling-Knife Detector (broke support/resistance & closed weak outside WITHOUT reclaim!)
  const fakeDownSweepKnife =
    sigCandle.l < lookbackLow && sigCandle.c < lookbackLow && lowerWickRatio < 0.30;
  const fakeUpSweepBreak =
    sigCandle.h > lookbackHigh && sigCandle.c > lookbackHigh && upperWickRatio < 0.30;

  if (fakeDownSweepKnife) trapWarnings.push('BARRIDA FALSA BAJISTA (cuchillo sin reclaim)');
  if (fakeUpSweepBreak) trapWarnings.push('BARRIDA FALSA ALCISTA (ruptura fuerte sin rechazo)');

  // Trap 3: Fake Support / Fake Resistance Liquidity Magnet (repeated flat touches + adverse L2 pressure)
  const supportTouches = lookbackCandles.filter(
    (k) => lookbackLow > 0 && Math.abs(k.l - lookbackLow) / lookbackLow <= 0.0018
  ).length;
  const resistanceTouches = lookbackCandles.filter(
    (k) => lookbackHigh > 0 && Math.abs(k.h - lookbackHigh) / lookbackHigh <= 0.0018
  ).length;
  const fakeSupport =
    supportTouches >= 2 &&
    lookbackLow > 0 &&
    px > lookbackLow &&
    (px - lookbackLow) / px <= 0.0028 &&
    (l2Imbalance <= -0.14 || (volRatio < 0.9 && !trend1hUp));
  const fakeResistance =
    resistanceTouches >= 2 &&
    lookbackHigh > 0 &&
    px < lookbackHigh &&
    (lookbackHigh - px) / px <= 0.0028 &&
    (l2Imbalance >= 0.14 || (volRatio < 0.9 && !trend1hDown));

  if (fakeSupport) trapWarnings.push('SOPORTE FALSO (imán de stops debajo)');
  if (fakeResistance) trapWarnings.push('RESISTENCIA FALSA (imán de stops arriba)');

  // 3. Bollinger Squeeze + Volume Expansion (strictly guarded against bull/bear fakeouts)
  if (
    prevBb.widthPct < 1.9 &&
    volRatio >= 1.3 &&
    px > bb.upper &&
    sigCandle.c > sigCandle.o &&
    !htfBearLocked &&
    !bullFakeout
  ) {
    vote('BOLLINGER_SQUEEZE_BREAKOUT', 'LONG', 22, `Ruptura alcista squeeze BB + vol ${volRatio.toFixed(1)}x`);
  } else if (
    prevBb.widthPct < 1.9 &&
    volRatio >= 1.3 &&
    px < bb.lower &&
    sigCandle.c < sigCandle.o &&
    !htfBullLocked &&
    !bearFakeout
  ) {
    vote('BOLLINGER_SQUEEZE_BREAKOUT', 'SHORT', 22, `Ruptura bajista squeeze BB + vol ${volRatio.toFixed(1)}x`);
  }

  // 4. VWAP + Volume Profile Value Area (VAL/VAH) Mean Reversion
  if (
    (vwapInfo.zScore <= -2.0 || (px <= vpInfo.valPx && vwapInfo.zScore <= -1.35)) &&
    sigCandle.c > sigCandle.o &&
    rsi14 < 38 &&
    !fakeDownSweepKnife &&
    !fakeSupport
  ) {
    vote('VWAP_MEAN_REVERSION', 'LONG', 16, `Reversión VWAP/VAL (Z=${vwapInfo.zScore.toFixed(2)}, POC $${vpInfo.pocPx.toFixed(2)})`, true);
  } else if (
    (vwapInfo.zScore >= 2.0 || (px >= vpInfo.vahPx && vwapInfo.zScore >= 1.35)) &&
    sigCandle.c < sigCandle.o &&
    rsi14 > 62 &&
    !fakeUpSweepBreak &&
    !fakeResistance
  ) {
    vote('VWAP_MEAN_REVERSION', 'SHORT', 16, `Reversión VWAP/VAH (Z=+${vwapInfo.zScore.toFixed(2)}, POC $${vpInfo.pocPx.toFixed(2)})`, true);
  }

  // 5. RSI Divergence & Momentum Exhaustion (counter-trend-gated & trap-guarded)
  if (
    !fakeDownSweepKnife &&
    !fakeSupport &&
    ((rsi14 <= 30 && sigCandle.c > sigPrev.c) || (sigCandle.l <= lookbackLow && rsi14 > prevRsi + 4))
  ) {
    vote('RSI_DIVERGENCE_REVERSAL', 'LONG', 16, `RSI(${rsi14.toFixed(0)}) divergencia/giro alcista`, true);
  } else if (
    !fakeUpSweepBreak &&
    !fakeResistance &&
    ((rsi14 >= 70 && sigCandle.c < sigPrev.c) || (sigCandle.h >= lookbackHigh && rsi14 < prevRsi - 4))
  ) {
    vote('RSI_DIVERGENCE_REVERSAL', 'SHORT', 16, `RSI(${rsi14.toFixed(0)}) divergencia/giro bajista`, true);
  }

  // 6. MACD Histogram Acceleration (single deduplicated momentum vote aligned with 1H + EMA9/EMA21)
  if (histNow > 0 && histNow > histPrev && trend1hUp && ema9 > ema21 && rsi14 >= 48 && rsi14 <= 74 && !bullFakeout) {
    vote('MACD_MOMENTUM_CROSS', 'LONG', 19, 'MACD histograma positivo acelerando con EMA9>EMA21 y 1H');
  } else if (
    histNow < 0 &&
    histNow < histPrev &&
    trend1hDown &&
    ema9 < ema21 &&
    rsi14 <= 52 &&
    rsi14 >= 26 &&
    !bearFakeout
  ) {
    vote('MACD_MOMENTUM_CROSS', 'SHORT', 19, 'MACD histograma negativo acelerando con EMA9<EMA21 y 1H');
  }

  // 7. Breakout & Retest (Donchian 20 clean break OR successful retest hold above high20 / below low20)
  const bullRetest = sigPrev.c > prevHigh20 && sigCandle.l <= prevHigh20 * 1.0025 && sigCandle.c > prevHigh20 && sigCandle.c > sigCandle.o;
  const bearRetest = sigPrev.c < prevLow20 && sigCandle.h >= prevLow20 * 0.9975 && sigCandle.c < prevLow20 && sigCandle.c < sigCandle.o;
  if ((sigCandle.c > high20 && bodyRatio >= 0.48 && volRatio >= 1.15 && !bullFakeout) || bullRetest) {
    if (!htfBearLocked) {
      vote(
        'ATR_DONCHIAN_BREAKOUT',
        'LONG',
        21,
        bullRetest ? 'Breakout & Retest alcista confirmado sobre techo 20v' : 'Ruptura estructura 20v alcista con cuerpo y volumen'
      );
    }
  } else if ((sigCandle.c < low20 && bodyRatio >= 0.48 && volRatio >= 1.15 && !bearFakeout) || bearRetest) {
    if (!htfBullLocked) {
      vote(
        'ATR_DONCHIAN_BREAKOUT',
        'SHORT',
        21,
        bearRetest ? 'Breakout & Retest bajista confirmado bajo piso 20v' : 'Ruptura estructura 20v bajista con cuerpo y volumen'
      );
    }
  }

  // 8. Real Liquidity Sweep / Stop Hunt Catcher (buys downside capitulation reclaims & sells upside FOMO bull-traps!)
  const realDownSweep1Bar =
    sigCandle.l < lookbackLow * 0.9995 &&
    sigCandle.c > lookbackLow &&
    lowerWickRatio >= 0.42 &&
    closePosInCandle >= 0.52 &&
    (volRatio >= 1.15 || l2Imbalance >= 0.06 || cvdInfo.cvdSlope > 0 || market.annualizedFundingPct < 0);
  const realDownSweep2Bar =
    sigPrev.l < lookbackLow * 0.9995 &&
    sigCandle.c > lookbackLow &&
    sigCandle.c > sigCandle.o &&
    sigCandle.c > sigPrev.h * 0.999 &&
    !fakeDownSweepKnife;

  const realUpSweep1Bar =
    sigCandle.h > lookbackHigh * 1.0005 &&
    sigCandle.c < lookbackHigh &&
    upperWickRatio >= 0.42 &&
    closePosInCandle <= 0.48 &&
    (volRatio >= 1.15 || l2Imbalance <= -0.06 || cvdInfo.cvdSlope < 0 || market.annualizedFundingPct > 20);
  const realUpSweep2Bar =
    sigPrev.h > lookbackHigh * 1.0005 &&
    sigCandle.c < lookbackHigh &&
    sigCandle.c < sigCandle.o &&
    sigCandle.c < sigPrev.l * 1.001 &&
    !fakeUpSweepBreak;

  if (realDownSweep1Bar || realDownSweep2Bar) {
    sweepDirection = 'LONG_SWEEP';
    vote(
      'LIQUIDITY_SWEEP_REJECTION',
      'LONG',
      25,
      `Caza-Barrida LONG: liquidaron stops bajo $${lookbackLow.toFixed(2)} + reclaim + CVD ${cvdInfo.cvdSlope >= 0 ? '+' : ''}${cvdInfo.cvdSlope.toFixed(2)}`,
      false
    );
  } else if (realUpSweep1Bar || realUpSweep2Bar) {
    sweepDirection = 'SHORT_SWEEP';
    vote(
      'LIQUIDITY_SWEEP_REJECTION',
      'SHORT',
      25,
      `Caza-Barrida SHORT: barrieron máximos sobre $${lookbackHigh.toFixed(2)} + rechazo + CVD ${cvdInfo.cvdSlope.toFixed(2)}`,
      false
    );
  }

  // 9. Order Flow, CVD & Volume Profile L2 Filter
  if (
    spreadBps <= 14 &&
    (l2Imbalance >= 0.24 || (cvdInfo.cvdSlope >= 0.16 && cvdInfo.netDeltaRatio > 0.08 && px >= vpInfo.pocPx * 0.997)) &&
    !fakeSupport
  ) {
    vote(
      'L2_ORDERBOOK_IMBALANCE',
      'LONG',
      18,
      `OrderFlow L2 +${(l2Imbalance * 100).toFixed(0)}% · CVD +${cvdInfo.cvdSlope.toFixed(2)} · POC $${vpInfo.pocPx.toFixed(2)}`,
      sweepDirection !== 'LONG_SWEEP' && cvdInfo.cvdSlope < 0.2
    );
  } else if (
    spreadBps <= 14 &&
    (l2Imbalance <= -0.24 || (cvdInfo.cvdSlope <= -0.16 && cvdInfo.netDeltaRatio < -0.08 && px <= vpInfo.pocPx * 1.003)) &&
    !fakeResistance
  ) {
    vote(
      'L2_ORDERBOOK_IMBALANCE',
      'SHORT',
      18,
      `OrderFlow L2 ${(l2Imbalance * 100).toFixed(0)}% · CVD ${cvdInfo.cvdSlope.toFixed(2)} · POC $${vpInfo.pocPx.toFixed(2)}`,
      sweepDirection !== 'SHORT_SWEEP' && cvdInfo.cvdSlope > -0.2
    );
  }

  // 10. Liquidation Hunting (Funding Squeeze + OI Flow)
  const turnover = market.openInterestUsd > 0 ? market.dayNtlVlm / market.openInterestUsd : 0;
  if (market.annualizedFundingPct <= -25 && (turnover >= 1.5 || l2Imbalance > 0 || cvdInfo.cvdSlope > 0)) {
    vote(
      'FUNDING_OI_SQUEEZE',
      'LONG',
      16,
      `Funding squeeze ${market.annualizedFundingPct.toFixed(0)}% APR`,
      !trend1hUp && sweepDirection !== 'LONG_SWEEP'
    );
  } else if (market.annualizedFundingPct >= 65 && (turnover >= 1.5 || l2Imbalance < 0 || cvdInfo.cvdSlope < 0)) {
    vote(
      'FUNDING_OI_SQUEEZE',
      'SHORT',
      16,
      `Crowding long ${market.annualizedFundingPct.toFixed(0)}% APR`,
      !trend1hDown && sweepDirection !== 'SHORT_SWEEP'
    );
  }

  // Apply explicit trap penalties so fake breakouts / fake sweeps / fake supports never trigger blind entries
  if (bullFakeout || fakeDownSweepKnife || fakeSupport) {
    longPts *= 0.70;
  }
  if (bearFakeout || fakeUpSweepBreak || fakeResistance) {
    shortPts *= 0.70;
  }

  // Cross-reference Firestore AI Memories (penalize repeat mistakes, boost proven edges)
  const coinMemories = memories.filter((m) => m.coin === market.coin).slice(0, 8);
  const recentLosses = coinMemories.filter((m) => m.outcome === 'LOSS').length;
  const recentWins = coinMemories.filter((m) => m.outcome === 'WIN').length;
  if (recentLosses >= 2 && recentLosses > recentWins) {
    longPts *= 0.82;
    shortPts *= 0.82;
  } else if (recentWins > recentLosses && recentWins >= 2) {
    longPts *= 1.1;
    shortPts *= 1.1;
  }

  // Higher-Timeframe + EMA200 alignment bonus
  if (trend1hUp && supertrend1h === 'LONG' && px >= ema200 && firedLong.length > 0) {
    longPts += 14;
    reasonsLong.push('Alineación estructural 1H + EMA200 alcista');
  }
  if (trend1hDown && supertrend1h === 'SHORT' && px <= ema200 && firedShort.length > 0) {
    shortPts += 14;
    reasonsShort.push('Alineación estructural 1H + EMA200 bajista');
  }

  // Strictly deduplicate fired strategies BEFORE checking consensus (prevents single-indicator double counting)
  const uniqueLong = Array.from(new Set(firedLong));
  const uniqueShort = Array.from(new Set(firedShort));
  const longCategories = new Set(uniqueLong.map((id) => playbookMap.get(id)?.category || 'OTHER'));
  const shortCategories = new Set(uniqueShort.map((id) => playbookMap.get(id)?.category || 'OTHER'));

  const net = longPts - shortPts;
  let direction: 'LONG' | 'SHORT' | 'NEUTRAL' = 'NEUTRAL';
  let firedStrategies: string[] = [];
  let chosenReasons: string[] = [];
  let rawScore = 0;

  if (net >= 18 && uniqueLong.length >= 2 && (!htfBearLocked || sweepDirection === 'LONG_SWEEP')) {
    direction = 'LONG';
    firedStrategies = uniqueLong;
    chosenReasons = reasonsLong;
    const diversityBonus = longCategories.size >= 2 ? 12 : -6;
    rawScore = longPts - shortPts * 0.35 + (uniqueLong.length >= 3 ? 16 : 10) + diversityBonus;
  } else if (net <= -18 && uniqueShort.length >= 2 && (!htfBullLocked || sweepDirection === 'SHORT_SWEEP')) {
    direction = 'SHORT';
    firedStrategies = uniqueShort;
    chosenReasons = reasonsShort;
    const diversityBonus = shortCategories.size >= 2 ? 12 : -6;
    rawScore = shortPts - longPts * 0.35 + (uniqueShort.length >= 3 ? 16 : 10) + diversityBonus;
  } else {
    rawScore = Math.min(49, Math.max(longPts, shortPts) * 0.65);
    chosenReasons = longPts >= shortPts ? reasonsLong : reasonsShort;
  }

  // Chop Regime Dampener: avoid fee bleed in RANGING_CHOP unless >=3 strategies + orderflow/sweep confirm
  if (regime === 'RANGING_CHOP' && direction !== 'NEUTRAL') {
    const hasOrderflowConfirm =
      firedStrategies.includes('LIQUIDITY_SWEEP_REJECTION') ||
      firedStrategies.includes('L2_ORDERBOOK_IMBALANCE');
    if (firedStrategies.length < 3 || !hasOrderflowConfirm) {
      rawScore *= 0.75;
      chosenReasons.push('Precaución: régimen lateral (RANGING_CHOP) sin confluencia triple A+');
    }
  }

  // Contradiction / weak-signal filter: if opposing side also had >= 2 strategies, downgrade to Esperar
  if (direction === 'LONG' && uniqueShort.length >= 2 && shortPts > longPts * 0.72) {
    rawScore = Math.min(rawScore, 58);
    chosenReasons.push('Señales contradictorias entre estrategias; esperar confirmación');
  } else if (direction === 'SHORT' && uniqueLong.length >= 2 && longPts > shortPts * 0.72) {
    rawScore = Math.min(rawScore, 58);
    chosenReasons.push('Señales contradictorias entre estrategias; esperar confirmación');
  }

  // Liquidity floor penalty inside scoring for thin <$5M markets
  if (market.dayNtlVlm < 5_000_000) {
    rawScore *= 0.85;
  }

  // Disciplined Anti-chasing shield (2.1x ATR): enter on clean pullbacks/breakouts, never parabolic tops/bottoms
  let antiChaseBlocked = false;
  if (direction === 'LONG' && distFromEma21Atr > 2.1 && sweepDirection !== 'LONG_SWEEP') {
    antiChaseBlocked = true;
    direction = 'NEUTRAL';
    rawScore = Math.min(rawScore, 42);
    chosenReasons.push('Espera: sobreextendido alcista (>2.1×ATR), esperando pullback a EMA21');
  } else if (direction === 'SHORT' && distFromEma21Atr < -2.1 && sweepDirection !== 'SHORT_SWEEP') {
    antiChaseBlocked = true;
    direction = 'NEUTRAL';
    rawScore = Math.min(rawScore, 42);
    chosenReasons.push('Espera: sobreextendido bajista (<-2.1×ATR), esperando rebote a EMA21');
  }

  if (trapWarnings.length > 0) {
    chosenReasons = [...chosenReasons, ...trapWarnings.slice(0, 2)];
  }

  const unifiedScore = Math.max(10, Math.min(98, Math.round(rawScore)));
  const decisionBand = getDecisionBand(unifiedScore);
  if (decisionBand === 'NO_OPERAR') {
    direction = 'NEUTRAL';
  }
  const confidence =
    direction === 'NEUTRAL'
      ? Math.min(49, unifiedScore)
      : Math.max(
          50,
          Math.min(97, Math.round(unifiedScore * (firedStrategies.length >= 3 ? 1.04 : 0.98)))
        );

  // Fee-proof volatility/structure-calibrated SL & 3-level TP (+1R, +2R, +3.5%)
  const recommendedSlPct = Number(Math.max(0.85, Math.min(1.65, atrPct * 1.15)).toFixed(2));
  const recommendedTpPct = 3.5;
  const tp1Pct = Number(Math.max(0.85, recommendedSlPct * 1.15).toFixed(2));
  const tp2Pct = Number(Math.max(1.75, recommendedTpPct * 0.58).toFixed(2));
  const tp3Pct = recommendedTpPct;
  const rrRatio = Number((recommendedTpPct / recommendedSlPct).toFixed(2));

  return {
    coin: market.coin,
    markPx: px,
    regime,
    direction,
    unifiedScore,
    confidence,
    decisionBand,
    firedStrategies,
    rsi14: Number(rsi14.toFixed(1)),
    ema9,
    ema21,
    ema55,
    ema50,
    ema200,
    adx14: Number(adxInfo.adx.toFixed(1)),
    cvdSlope: cvdInfo.cvdSlope,
    vpPocPx: Number(vpInfo.pocPx.toFixed(4)),
    smcBias: smcInfo.bias,
    atrPct: Number(atrPct.toFixed(2)),
    vwapDistPct: Number(vwapInfo.distPct.toFixed(2)),
    bbWidthPct: Number(bb.widthPct.toFixed(2)),
    l2Imbalance: Number(l2Imbalance.toFixed(2)),
    spreadBps: Number(spreadBps.toFixed(1)),
    recommendedSlPct,
    recommendedTpPct,
    tp1Pct,
    tp2Pct,
    tp3Pct,
    rrRatio,
    validUntilMs: Date.now() + 90_000,
    timeframe: '15m+1h',
    antiChaseBlocked,
    sweepDirection,
    trapWarnings,
    reasons: chosenReasons.slice(0, 5),
  };
}

// ---------- Quantitative Risk-Based Position Sizing ----------

export function computeDynamicOrderNotionalUsd(params: {
  config: BotConfigData;
  accountSummary: HlAccountSummary | null;
  asset: HlAssetMarket;
  slPctOverride?: number;
}): number {
  const { config, accountSummary, asset, slPctOverride } = params;
  if (config.sizingMode !== 'equity_pct' || !accountSummary || accountSummary.accountValue <= 0) {
    return Math.max(11, config.riskPerTradeUsd || 50);
  }

  const equity = accountSummary.accountValue;
  const pct = Math.max(1, Math.min(100, config.capitalPctPerTrade || 15)) / 100;
  const slFrac = Math.max(0.0005, (slPctOverride || config.slPct || 0.85) / 100);
  const riskPct = Math.max(0.05, Math.min(25, config.riskPerTradePct ?? 0.35)) / 100;

  // Risk-derived notional = (Equity * Risk%) / SL_distance; leverage derived cleanly from risk & stop distance
  const riskDerivedNotional = (equity * riskPct) / slFrac;
  const targetLev = Math.max(1, Math.min(100, Number(config.leverage ?? 10)));
  const effectiveLev = Math.max(1, Math.min(asset.maxLeverage || targetLev, targetLev));
  const equityPctNotional = equity * pct * effectiveLev;

  // Cap desired notional by risk budget headroom (1.35x) so wide stops automatically shrink size & leverage!
  const desiredNotional = Math.min(equityPctNotional, Math.max(11, riskDerivedNotional * 1.35));

  // Respect Hyperliquid real available margin
  const maxSafeNotional = Math.max(11, accountSummary.withdrawable * Math.max(1, asset.maxLeverage * 0.85));
  return Math.max(11, Math.min(desiredNotional, maxSafeNotional));
}

// ---------- Active Position Management Engine (TP1/TP2/TP3 Partials, BE Lock, Trailing, Liq Guard) ----------

export function evaluateOpenPositionManagement(params: {
  position: HlLivePosition;
  deepAnalysis: DeepAssetAnalysis;
  config: BotConfigData;
  peakMovePct: number;
  partialStage?: number;
}): PositionManagementDecision {
  const { position, deepAnalysis, config, peakMovePct, partialStage = 0 } = params;
  const markPx = deepAnalysis.markPx || position.entryPx;
  const rawMovePct =
    position.entryPx > 0
      ? ((position.side === 'LONG' ? markPx - position.entryPx : position.entryPx - markPx) /
          position.entryPx) *
        100
      : 0;

  const updatedPeak = Math.max(peakMovePct, rawMovePct);
  const slPct = Math.max(0.05, config.slPct > 0 ? config.slPct : deepAnalysis.recommendedSlPct || 0.85);
  const tpPct = Math.max(0.2, config.tpPct > 0 ? config.tpPct : deepAnalysis.recommendedTpPct || 3.5);
  const size = Math.abs(position.szi);
  const posNotionalUsd = size * markPx;

  // 0. Liquidation Proximity Guard (exit immediately before exchange liquidation!)
  if (position.liquidationPx && position.liquidationPx > 0 && markPx > 0) {
    const liqDistPct =
      position.side === 'LONG'
        ? ((markPx - position.liquidationPx) / markPx) * 100
        : ((position.liquidationPx - markPx) / markPx) * 100;
    if (liqDistPct >= 0 && liqDistPct <= 2.8) {
      return {
        coin: position.coin,
        side: position.side,
        size,
        action: 'CLOSE_LIQ_GUARD',
        stage: partialStage,
        movePct: rawMovePct,
        peakMovePct: updatedPeak,
        reason: `Escudo Anti-Liquidación: distancia a liquidación ${liqDistPct.toFixed(2)}% <= 2.8%. Cierre preventivo total.`,
      };
    }
  }

  // 1. Fee-Proof Hard Stop Loss (executes strictly at -slPct, default -0.85%)
  if (rawMovePct <= -slPct) {
    return {
      coin: position.coin,
      side: position.side,
      size,
      action: 'CLOSE_SL',
      stage: partialStage,
      movePct: rawMovePct,
      peakMovePct: updatedPeak,
      reason: `Stop Loss (${slPct.toFixed(2)}%) ejecutado en ${rawMovePct.toFixed(2)}% para proteger capital.`,
    };
  }

  // 2. Partial Take Profits (TP1 = 30% @ ~+1R, TP2 = 30% orig (~43% rem) @ ~+2R, Runner 40% to TP3)
  // Auto-disable 3-part scaled TP when order notional < $35 USD (use 1 native SL + 1 native TP + optional BE)
  const allowScaledTp = posNotionalUsd >= 35;
  const tp1Target = Math.max(0.75, Number((slPct * 1.15).toFixed(2)));
  const tp2Target = Math.max(1.65, Number((tpPct * 0.58).toFixed(2)));

  if (allowScaledTp && partialStage === 0 && rawMovePct >= tp1Target && posNotionalUsd * 0.30 >= 10.5 && posNotionalUsd * 0.70 >= 10.5) {
    return {
      coin: position.coin,
      side: position.side,
      size,
      action: 'PARTIAL_TP1',
      closeFraction: 0.30,
      stage: 1,
      movePct: rawMovePct,
      peakMovePct: updatedPeak,
      reason: `TP1 alcanzado (+${rawMovePct.toFixed(2)}% >= +${tp1Target.toFixed(2)}%): cerrando 30% y blindando Breakeven (+0.15%).`,
    };
  }

  if (allowScaledTp && partialStage === 1 && rawMovePct >= tp2Target && posNotionalUsd * 0.43 >= 10.5 && posNotionalUsd * 0.57 >= 10.5) {
    return {
      coin: position.coin,
      side: position.side,
      size,
      action: 'PARTIAL_TP2',
      closeFraction: 0.43,
      stage: 2,
      movePct: rawMovePct,
      peakMovePct: updatedPeak,
      reason: `TP2 alcanzado (+${rawMovePct.toFixed(2)}% >= +${tp2Target.toFixed(2)}%): cerrando otro 30% original y corriendo 40% con Trailing.`,
    };
  }

  // 3. Final TP3 Target (default +3.5%)
  if (rawMovePct >= tpPct) {
    if (!config.trailingStopEnabled) {
      return {
        coin: position.coin,
        side: position.side,
        size,
        action: 'CLOSE_TP',
        stage: partialStage,
        movePct: rawMovePct,
        peakMovePct: updatedPeak,
        reason: `Take Profit TP3 alcanzado (+${rawMovePct.toFixed(2)}% >= +${tpPct.toFixed(2)}%).`,
      };
    }
    const tpTrailFloor = updatedPeak - Math.max(0.22, slPct * 0.40);
    if (rawMovePct <= tpTrailFloor) {
      return {
        coin: position.coin,
        side: position.side,
        size,
        action: 'CLOSE_TP',
        stage: partialStage,
        movePct: rawMovePct,
        peakMovePct: updatedPeak,
        reason: `TP3 + Runner asegurado (+${rawMovePct.toFixed(2)}% desde pico +${updatedPeak.toFixed(2)}%).`,
      };
    }
  }

  // 4. Breakeven Lock (+0.55% or post-TP1 -> +0.15%) + Progressive Trailing Stop (+1.10%+)
  if (config.trailingStopEnabled || partialStage >= 1) {
    const breakevenTrigger = Math.max(0.50, Math.min(0.85, slPct * 0.65));
    const breakevenLockFloor = 0.15; // Covers HL round-trip fees
    const trailStartTrigger = Math.max(1.05, Math.min(1.6, tpPct * 0.32));

    if (updatedPeak >= trailStartTrigger) {
      // Tighten runner trailing after TP2 is banked
      const trailMult = partialStage >= 2 ? 0.22 : 0.28;
      const trailGap = Math.max(0.28, Math.min(0.90, updatedPeak * trailMult));
      const trailFloor = updatedPeak - trailGap;
      if (rawMovePct <= trailFloor) {
        return {
          coin: position.coin,
          side: position.side,
          size,
          action: 'CLOSE_TRAILING',
          stage: partialStage,
          movePct: rawMovePct,
          peakMovePct: updatedPeak,
          reason: `Trailing Progresivo asegurado (+${rawMovePct.toFixed(2)}% desde pico +${updatedPeak.toFixed(2)}%).`,
        };
      }
    } else if ((updatedPeak >= breakevenTrigger || partialStage >= 1) && rawMovePct <= breakevenLockFloor) {
      return {
        coin: position.coin,
        side: position.side,
        size,
        action: 'CLOSE_TRAILING',
        stage: partialStage,
        movePct: rawMovePct,
        peakMovePct: updatedPeak,
        reason: `Breakeven Lock (+${breakevenLockFloor.toFixed(2)}% sobre fees) ejecutado tras pico +${updatedPeak.toFixed(2)}%.`,
      };
    }
  }

  // 5. Regime / Multi-Strategy Structural Thesis Invalidation
  const oppositeSide = position.side === 'LONG' ? 'SHORT' : 'LONG';
  if (
    deepAnalysis.direction === oppositeSide &&
    deepAnalysis.unifiedScore >= 72 &&
    deepAnalysis.firedStrategies.length >= 2 &&
    rawMovePct < -slPct * 0.72
  ) {
    return {
      coin: position.coin,
      side: position.side,
      size,
      action: 'CLOSE_INVALIDATION',
      stage: partialStage,
      movePct: rawMovePct,
      peakMovePct: updatedPeak,
      reason: `Invalidación de estructura: 15M+1H giraron a ${oppositeSide} (${deepAnalysis.unifiedScore} pts, ${deepAnalysis.firedStrategies.length} est.) sin esperar al SL.`,
    };
  }

  return {
    coin: position.coin,
    side: position.side,
    size,
    action: 'HOLD',
    stage: partialStage,
    movePct: rawMovePct,
    peakMovePct: updatedPeak,
    reason: `En gestión activa${partialStage > 0 ? ` [TP${partialStage} OK]` : ''} (${rawMovePct >= 0 ? '+' : ''}${rawMovePct.toFixed(2)}% | pico +${updatedPeak.toFixed(2)}% | SL -${slPct.toFixed(2)}% / TP3 +${tpPct.toFixed(2)}%).`,
  };
}

// ---------- Institutional DB + Trader History + Pro Discipline Gatekeeper ----------

export interface FillsSummarySnapshot {
  totalClosed: number;
  winRatePct: number;
  netPnlUsd: number;
  totalFeesUsd: number;
  losingCoins: Array<{ coin: string; netPnl: number; trades: number; wins: number; losses: number }>;
  winningCoins: Array<{ coin: string; netPnl: number; trades: number; wins: number; losses: number }>;
  recentClosed: Array<{ coin: string; side: string; netPnl: number; px: number; time: number }>;
}

export interface DbClosedHistorySummary {
  totalDbClosed: number;
  dbWinRatePct: number;
  dbNetPnlUsd: number;
  consecutiveRecentLosses: number;
  coinStats: Array<{
    coin: string;
    trades: number;
    wins: number;
    losses: number;
    netPnlUsd: number;
    lastClosedAtMs: number;
    lastOutcome: 'WIN' | 'LOSS' | 'BREAKEVEN';
  }>;
  topStrategies: Array<{
    strategyId: string;
    weight: number;
    wins: number;
    losses: number;
    winRatePct: number;
    totalPnlUsd: number;
    enabled: boolean;
  }>;
}

export function buildDbTradingHistorySummary(params: {
  persistedPositions: PersistedPosition[];
  aiMemories: AiMemoryEntry[];
  strategyPlaybook: StrategyPlaybookItem[];
}): DbClosedHistorySummary {
  const closedDb = [...params.persistedPositions]
    .filter((p) => p.status === 'CLOSED')
    .sort((a, b) => b.updatedAtMs - a.updatedAtMs);

  const coinMap = new Map<
    string,
    {
      coin: string;
      trades: number;
      wins: number;
      losses: number;
      netPnlUsd: number;
      lastClosedAtMs: number;
      lastOutcome: 'WIN' | 'LOSS' | 'BREAKEVEN';
    }
  >();

  let wins = 0;
  let dbNetPnlUsd = 0;

  for (const p of closedDb) {
    const pnl = Number(p.realizedPnl || 0);
    dbNetPnlUsd += pnl;
    const outcome: 'WIN' | 'LOSS' | 'BREAKEVEN' = pnl > 0.05 ? 'WIN' : pnl < -0.05 ? 'LOSS' : 'BREAKEVEN';
    if (outcome === 'WIN') wins += 1;

    const existing = coinMap.get(p.coin);
    if (!existing) {
      coinMap.set(p.coin, {
        coin: p.coin,
        trades: 1,
        wins: outcome === 'WIN' ? 1 : 0,
        losses: outcome === 'LOSS' ? 1 : 0,
        netPnlUsd: pnl,
        lastClosedAtMs: p.updatedAtMs,
        lastOutcome: outcome,
      });
    } else {
      existing.trades += 1;
      if (outcome === 'WIN') existing.wins += 1;
      if (outcome === 'LOSS') existing.losses += 1;
      existing.netPnlUsd += pnl;
    }
  }

  // Also merge ALL accumulated ai_memory outcomes for coins without duplicate closedDb entries
  const coinsInClosedDb = new Set(closedDb.map((p) => p.coin));
  for (const m of params.aiMemories) {
    if (coinsInClosedDb.has(m.coin)) continue;
    const existing = coinMap.get(m.coin);
    if (!existing) {
      coinMap.set(m.coin, {
        coin: m.coin,
        trades: 1,
        wins: m.outcome === 'WIN' ? 1 : 0,
        losses: m.outcome === 'LOSS' ? 1 : 0,
        netPnlUsd: Number(m.pnlUsd || 0),
        lastClosedAtMs: m.createdAtMs,
        lastOutcome: m.outcome,
      });
    } else {
      existing.trades += 1;
      if (m.outcome === 'WIN') existing.wins += 1;
      if (m.outcome === 'LOSS') existing.losses += 1;
      existing.netPnlUsd += Number(m.pnlUsd || 0);
      if (m.createdAtMs > existing.lastClosedAtMs) {
        existing.lastClosedAtMs = m.createdAtMs;
        existing.lastOutcome = m.outcome;
      }
    }
  }

  let consecutiveRecentLosses = 0;
  for (const p of closedDb) {
    if (p.realizedPnl < -0.05) consecutiveRecentLosses += 1;
    else if (p.realizedPnl > 0.05) break;
  }

  const playbookSource =
    params.strategyPlaybook.length > 0
      ? params.strategyPlaybook
      : DEFAULT_STRATEGY_PLAYBOOK.map((d) => ({
          ...d,
          ownerId: 'default',
          wins: 0,
          losses: 0,
          totalPnlUsd: 0,
          updatedAtMs: Date.now(),
        }));

  const topStrategies = playbookSource.map((s) => {
    const total = s.wins + s.losses;
    return {
      strategyId: s.strategyId,
      weight: s.weight,
      wins: s.wins,
      losses: s.losses,
      winRatePct: total > 0 ? Number(((s.wins / total) * 100).toFixed(1)) : 50,
      totalPnlUsd: Number(s.totalPnlUsd.toFixed(2)),
      enabled: s.enabled,
    };
  });

  return {
    totalDbClosed: closedDb.length,
    dbWinRatePct: closedDb.length > 0 ? Number(((wins / closedDb.length) * 100).toFixed(1)) : 0,
    dbNetPnlUsd: Number(dbNetPnlUsd.toFixed(2)),
    consecutiveRecentLosses,
    coinStats: Array.from(coinMap.values()).map((c) => ({
      ...c,
      netPnlUsd: Number(c.netPnlUsd.toFixed(2)),
    })),
    topStrategies,
  };
}

export interface SeparatedLearningRules {
  positiveEntryRules: AiMemoryEntry[];
  negativeNoEntryRules: AiMemoryEntry[];
  positiveCoins: string[];
  negativeCoins: string[];
  positiveStrategies: string[];
  negativeStrategies: string[];
}

export function isNegativeMemoryRule(m: Pick<AiMemoryEntry, 'regime' | 'outcome' | 'pnlUsd'>): boolean {
  const reg = m.regime.toUpperCase();
  if (reg.startsWith('NO_ENTRAR')) return true;
  if (reg.startsWith('SI_ENTRAR')) return false;
  return m.outcome === 'LOSS' || (m.outcome === 'BREAKEVEN' && m.pnlUsd < 0);
}

export function extractSeparatedLearningRules(params: {
  memories: AiMemoryEntry[];
  dbHistory: DbClosedHistorySummary;
  fillsSummary: FillsSummarySnapshot;
  playbook: StrategyPlaybookItem[];
}): SeparatedLearningRules {
  const positiveEntryRules: AiMemoryEntry[] = [];
  const negativeNoEntryRules: AiMemoryEntry[] = [];
  const seenPos = new Set<string>();
  const seenNeg = new Set<string>();

  for (const m of params.memories) {
    const key = `${m.coin}|${m.regime}|${m.lesson.slice(0, 60)}`.toLowerCase();
    if (isNegativeMemoryRule(m)) {
      if (!seenNeg.has(key)) {
        seenNeg.add(key);
        negativeNoEntryRules.push(m);
      }
    } else if (m.outcome === 'WIN' || m.regime.toUpperCase().startsWith('SI_ENTRAR')) {
      if (!seenPos.has(key)) {
        seenPos.add(key);
        positiveEntryRules.push(m);
      }
    }
  }

  const posCoins = new Set<string>();
  const negCoins = new Set<string>();
  for (const c of params.fillsSummary.winningCoins) posCoins.add(c.coin);
  for (const c of params.fillsSummary.losingCoins) {
    if (c.losses >= 2 || c.netPnl < -1.5) negCoins.add(c.coin);
  }
  for (const c of params.dbHistory.coinStats) {
    if (c.netPnlUsd > 0.5 && c.wins >= c.losses) posCoins.add(c.coin);
    if (c.netPnlUsd < -1.5 && c.losses >= 2) negCoins.add(c.coin);
  }

  const posStrats: string[] = [];
  const negStrats: string[] = [];
  for (const s of params.playbook) {
    const total = s.wins + s.losses;
    // Honest sample rule: do NOT declare a strategy proven (SI or NO) until >= MIN_ATTRIBUTABLE_TRADES (5)
    if (total < MIN_ATTRIBUTABLE_TRADES) continue;
    const wr = s.wins / total;
    if (s.totalPnlUsd > 0 && wr >= 0.5) posStrats.push(s.strategyId);
    if (wr < 0.38 || s.totalPnlUsd < -2) negStrats.push(s.strategyId);
  }

  return {
    positiveEntryRules: positiveEntryRules.slice(0, 40),
    negativeNoEntryRules: negativeNoEntryRules.slice(0, 40),
    positiveCoins: Array.from(posCoins),
    negativeCoins: Array.from(negCoins),
    positiveStrategies: posStrats,
    negativeStrategies: negStrats,
  };
}

export function synthesizeStructuredLearningFromHistory(params: {
  fillsSummary: FillsSummarySnapshot;
  closedPositions: PersistedPosition[];
  playbook: StrategyPlaybookItem[];
}): Array<Omit<AiMemoryEntry, 'id' | 'ownerId' | 'createdAtMs'>> {
  const distilled: Array<Omit<AiMemoryEntry, 'id' | 'ownerId' | 'createdAtMs'>> = [];

  // 1. Coin-level distilled rules (ONLY when statistically meaningful — never dump 20 raw trades)
  for (const good of params.fillsSummary.winningCoins) {
    if (good.wins < 1 || good.netPnl <= 0.25) continue;
    distilled.push({
      coin: good.coin,
      regime: 'SI_ENTRAR: Ventaja Token',
      outcome: 'WIN',
      pnlUsd: good.netPnl,
      lesson: `CUÁNDO SÍ ENTRAR en ${good.coin}: edge comprobado (${good.wins}W/${good.losses}L, +$${good.netPnl.toFixed(2)} neto). Entrar solo a favor de EMA+VWAP con Trailing Stop ON.`,
    });
  }

  for (const bad of params.fillsSummary.losingCoins) {
    if (bad.losses < 2 && bad.netPnl > -1.0) continue;
    distilled.push({
      coin: bad.coin,
      regime: 'NO_ENTRAR: Token Adverso',
      outcome: 'LOSS',
      pnlUsd: bad.netPnl,
      lesson: `CUÁNDO NO ENTRAR en ${bad.coin}: suma ${bad.losses} pérdidas (${bad.netPnl.toFixed(2)} USD). NO entrar en rango/contra-BTC; exigir confluencia >=2 estrategias y score >=65.`,
    });
  }

  // 2. Per-strategy accumulation ONLY when strategy has >= MIN_ATTRIBUTABLE_TRADES (5)
  for (const st of params.playbook) {
    const total = st.wins + st.losses;
    if (total < MIN_ATTRIBUTABLE_TRADES) continue;
    const wrPct = ((st.wins / total) * 100).toFixed(0);
    if (st.totalPnlUsd > 0.2 && st.wins >= st.losses) {
      distilled.push({
        coin: 'STRATEGY',
        regime: `SI_ENTRAR: ${st.strategyId.slice(0, 48)}`,
        outcome: 'WIN',
        pnlUsd: Number(st.totalPnlUsd.toFixed(2)),
        lesson: `CUÁNDO SÍ ENTRAR (${st.name}): demostrado ${wrPct}% WR (${st.wins}W/${st.losses}L, +$${st.totalPnlUsd.toFixed(2)}). Priorizar en ${st.preferredRegimes.replace(/,/g, '/')}.`,
      });
    } else if (st.totalPnlUsd < -0.5 || st.wins / total < 0.38) {
      distilled.push({
        coin: 'STRATEGY',
        regime: `NO_ENTRAR: ${st.strategyId.slice(0, 48)}`,
        outcome: 'LOSS',
        pnlUsd: Number(st.totalPnlUsd.toFixed(2)),
        lesson: `CUÁNDO NO ENTRAR (${st.name}): bajo rendimiento demostrado ${wrPct}% WR (${st.wins}W/${st.losses}L, $${st.totalPnlUsd.toFixed(2)}). Exigir confirmación L2 + 1H.`,
      });
    }
  }

  // 3. Aggregated DB Closed Positions by Coin + Side (distills repeating pattern, avoids saving blindly)
  const dbGroupMap = new Map<
    string,
    { coin: string; side: 'LONG' | 'SHORT'; wins: number; losses: number; pnl: number }
  >();
  for (const cp of params.closedPositions) {
    const k = `${cp.coin}:${cp.side}`;
    const cur = dbGroupMap.get(k) || { coin: cp.coin, side: cp.side, wins: 0, losses: 0, pnl: 0 };
    if (cp.realizedPnl > 0.05) cur.wins += 1;
    else if (cp.realizedPnl < -0.05) cur.losses += 1;
    cur.pnl += cp.realizedPnl;
    dbGroupMap.set(k, cur);
  }
  for (const g of dbGroupMap.values()) {
    if (g.wins + g.losses < 1) continue;
    if (g.pnl >= 0.5) {
      distilled.push({
        coin: g.coin,
        regime: `SI_ENTRAR: ${g.side} DB`,
        outcome: 'WIN',
        pnlUsd: Number(g.pnl.toFixed(2)),
        lesson: `CUÁNDO SÍ ENTRAR ${g.side} ${g.coin}: historial BD positivo (${g.wins}W/${g.losses}L, +$${g.pnl.toFixed(2)}). Seguir rupturas limpias con SL ajustado.`,
      });
    } else if (g.pnl <= -1.0 || g.losses >= 2) {
      distilled.push({
        coin: g.coin,
        regime: `NO_ENTRAR: ${g.side} DB`,
        outcome: 'LOSS',
        pnlUsd: Number(g.pnl.toFixed(2)),
        lesson: `CUÁNDO NO ENTRAR ${g.side} ${g.coin}: patrón perdedor en BD (${g.wins}W/${g.losses}L, $${g.pnl.toFixed(2)}). Bloquear en chop o sobreextensión.`,
      });
    }
  }

  // 4. Fee Burn / Chop Guard
  if (params.fillsSummary.totalFeesUsd > Math.abs(params.fillsSummary.netPnlUsd) * 0.45 && params.fillsSummary.totalFeesUsd > 1) {
    distilled.push({
      coin: 'ALL',
      regime: 'NO_ENTRAR: Fees/Chop',
      outcome: 'LOSS',
      pnlUsd: Number((-params.fillsSummary.totalFeesUsd).toFixed(2)),
      lesson: `CUÁNDO NO ENTRAR (Sobreoperación): comisiones altas ($${params.fillsSummary.totalFeesUsd.toFixed(2)}). Prohibido entrar en RANGING_CHOP o con recorrido <2% TP.`,
    });
  }

  return distilled;
}

export interface ProEntryGateResult {
  allowed: boolean;
  reason: string;
  adjustedConfidence: number;
  requiredScore: number;
}

export function evaluateProfessionalEntryGate(params: {
  coin: string;
  side: 'LONG' | 'SHORT';
  decisionConfidence: number;
  tpPct: number;
  slPct: number;
  deepAnalysis: DeepAssetAnalysis | undefined;
  config: BotConfigData;
  playbook: StrategyPlaybookItem[];
  dbHistory: DbClosedHistorySummary;
  fillsSummary: FillsSummarySnapshot;
  memories: AiMemoryEntry[];
  openPositions: HlLivePosition[];
  accountSummary: HlAccountSummary | null;
  orderUsd: number;
  assetMaxLeverage: number;
  dailyDrawdownPct?: number;
  recentEntryZones?: Array<{ coin: string; px: number; ts: number }>;
}): ProEntryGateResult {
  const {
    coin,
    side,
    decisionConfidence,
    tpPct,
    slPct,
    deepAnalysis,
    config,
    playbook,
    dbHistory,
    fillsSummary,
    memories,
    openPositions,
    accountSummary,
    orderUsd,
    assetMaxLeverage,
    dailyDrawdownPct = 0,
    recentEntryZones = [],
  } = params;

  // -1. Global & Per-Pair Bias Lock Enforcement (AMBOS | SOLO_LONG | SOLO_SHORT | PAUSA)
  const pairLocks = parsePairBiasLocks(config.pairBiasLocksJson);
  const pairBias = pairLocks[coin.toUpperCase()];
  const effectiveBias = pairBias || config.globalBiasLock || 'AMBOS';
  if (effectiveBias === 'PAUSA') {
    return {
      allowed: false,
      reason: `Bias Lock PAUSA activo${pairBias ? ` en ${coin}` : ' (Global)'}: nuevas entradas detenidas hasta reactivación.`,
      adjustedConfidence: 0,
      requiredScore: config.minQuantScore,
    };
  }
  if (effectiveBias === 'SOLO_LONG' && side !== 'LONG') {
    return {
      allowed: false,
      reason: `Bias Lock SOLO_LONG activo${pairBias ? ` en ${coin}` : ' (Global)'}: señal ${side} bloqueada.`,
      adjustedConfidence: 0,
      requiredScore: config.minQuantScore,
    };
  }
  if (effectiveBias === 'SOLO_SHORT' && side !== 'SHORT') {
    return {
      allowed: false,
      reason: `Bias Lock SOLO_SHORT activo${pairBias ? ` en ${coin}` : ' (Global)'}: señal ${side} bloqueada.`,
      adjustedConfidence: 0,
      requiredScore: config.minQuantScore,
    };
  }

  // 0. Daily Max Loss Kill Switch (ONLY active when user explicitly enables killSwitchEnabled)
  const dailyMaxLoss = Math.max(0.1, config.dailyMaxLossPct ?? 2.5);
  if (Boolean(config.killSwitchEnabled) && dailyDrawdownPct >= dailyMaxLoss) {
    return {
      allowed: false,
      reason: `Kill Switch Auto-Cierre activo: pérdida hoy -${dailyDrawdownPct.toFixed(2)}% >= límite -${dailyMaxLoss.toFixed(2)}%. Desactiva Kill Switch o sube el límite para abrir nuevas auto-entradas.`,
      adjustedConfidence: 0,
      requiredScore: config.minQuantScore,
    };
  }

  if (openPositions.some((p) => p.coin === coin)) {
    return {
      allowed: false,
      reason: `Prohibido promediar/duplicar posición abierta en ${coin} (gestión de riesgo estricta).`,
      adjustedConfidence: 0,
      requiredScore: config.minQuantScore,
    };
  }

  // Correlated directional exposure control (max 2 concurrent positions in exact same direction)
  const sameSideOpenCount = openPositions.filter((p) => p.side === side).length;
  if (sameSideOpenCount >= 2 && (deepAnalysis?.unifiedScore ?? 0) < 80) {
    return {
      allowed: false,
      reason: `Control de Correlación: ya hay ${sameSideOpenCount} posiciones ${side} abiertas. Exige Confluencia Alta (>=80 pts) para diversificar.`,
      adjustedConfidence: Math.min(decisionConfidence, 50),
      requiredScore: 80,
    };
  }

  // 1. Technical Confluence Validation (AI cannot open trades contradicting 10-strategy deep engine)
  if (!deepAnalysis) {
    return {
      allowed: false,
      reason: `${coin} sin análisis técnico multi-TF (15M+1H+L2) verificado.`,
      adjustedConfidence: 0,
      requiredScore: config.minQuantScore,
    };
  }

  const now = Date.now();
  const sameZone = recentEntryZones.find(
    (z) =>
      z.coin === coin &&
      now - z.ts < 20 * 60 * 1000 &&
      z.px > 0 &&
      Math.abs(deepAnalysis.markPx - z.px) / z.px <= 0.0045
  );
  if (sameZone) {
    return {
      allowed: false,
      reason: `Anti-Reentrada Repetida: ${coin} ya fue operado en zona $${sameZone.px.toFixed(2)} hace <20m.`,
      adjustedConfidence: Math.min(decisionConfidence, 45),
      requiredScore: config.minQuantScore,
    };
  }

  if (deepAnalysis.decisionBand === 'NO_OPERAR' || deepAnalysis.unifiedScore < 50) {
    return {
      allowed: false,
      reason: `Banda 0–49 (No Operar) en ${coin}: Score ${deepAnalysis.unifiedScore} pts insuficiente.`,
      adjustedConfidence: Math.min(decisionConfidence, 45),
      requiredScore: config.minQuantScore,
    };
  }

  if (deepAnalysis.direction !== side) {
    return {
      allowed: false,
      reason: `Bloqueado: la señal ${side} contradice el consenso técnico 15M+1H (${deepAnalysis.direction}, ${deepAnalysis.regime}).`,
      adjustedConfidence: Math.min(decisionConfidence, 45),
      requiredScore: config.minQuantScore,
    };
  }
  if (deepAnalysis.antiChaseBlocked) {
    return {
      allowed: false,
      reason: `Filtro Anti-Chasing: ${coin} está sobreextendido (>2.1×ATR). Esperando pullback a EMA21.`,
      adjustedConfidence: Math.min(decisionConfidence, 45),
      requiredScore: config.minQuantScore,
    };
  }

  // 2. Enabled Playbook Strategies Check (STRICT >=2 independent active strategies — zero blind 1-indicator trades)
  const playbookMap = new Map(playbook.map((p) => [p.strategyId, p]));
  const activeFired = Array.from(new Set(deepAnalysis.firedStrategies)).filter((id) => {
    const item = playbookMap.get(id);
    return !item || item.enabled;
  });
  if (activeFired.length < 2) {
    return {
      allowed: false,
      reason: `Confluencia insuficiente en ${coin}: solo ${activeFired.length} estrategia activa (mínimo exigido: 2).`,
      adjustedConfidence: Math.min(decisionConfidence, 48),
      requiredScore: config.minQuantScore,
    };
  }

  // 3. Risk/Reward & Tight Stop Sanity (honors user's custom SL/TP values)
  if (slPct < 0.05) {
    return {
      allowed: false,
      reason: `Stop Loss (${slPct.toFixed(2)}%) demasiado bajo (mínimo 0.05%).`,
      adjustedConfidence: Math.min(decisionConfidence, 45),
      requiredScore: config.minQuantScore,
    };
  }
  const rrRatio = slPct > 0 ? tpPct / slPct : 0;
  if (rrRatio < 1.1) {
    return {
      allowed: false,
      reason: `Ratio Riesgo/Beneficio ${rrRatio.toFixed(2)}:1 inferior al mínimo 1.10:1.`,
      adjustedConfidence: Math.min(decisionConfidence, 52),
      requiredScore: config.minQuantScore,
    };
  }
  const maxAllowedSpread = Math.min(Math.max(12, config.maxSlippageBps), 18);
  if (deepAnalysis.spreadBps > maxAllowedSpread) {
    return {
      allowed: false,
      reason: `Spread L2 abierto en ${coin} (${deepAnalysis.spreadBps.toFixed(1)} bps > ${maxAllowedSpread} bps).`,
      adjustedConfidence: Math.min(decisionConfidence, 50),
      requiredScore: config.minQuantScore,
    };
  }
  if (deepAnalysis.atrPct < 0.14 || deepAnalysis.atrPct > 8.5) {
    return {
      allowed: false,
      reason: `Volatilidad ATR (${deepAnalysis.atrPct.toFixed(2)}%) fuera de rango operable (0.14%–8.5%).`,
      adjustedConfidence: Math.min(decisionConfidence, 50),
      requiredScore: config.minQuantScore,
    };
  }

  // 4. Anti-Revenge Discipline Cooldown (10 min after a real loss on same coin)
  const COOLDOWN_MS = 10 * 60 * 1000;
  const lastFillLoss = fillsSummary.recentClosed.find(
    (f) => f.coin === coin && f.netPnl < -0.05 && now - f.time < COOLDOWN_MS
  );
  const dbCoinStat = dbHistory.coinStats.find((c) => c.coin === coin);
  const recentDbLoss =
    dbCoinStat && dbCoinStat.lastOutcome === 'LOSS' && now - dbCoinStat.lastClosedAtMs < COOLDOWN_MS;
  const recentMemLoss = memories.find(
    (m) => m.coin === coin && m.outcome === 'LOSS' && now - m.createdAtMs < COOLDOWN_MS
  );

  if (lastFillLoss || recentDbLoss || recentMemLoss) {
    const lossAgeSec = Math.max(
      10,
      Math.round(
        (now -
          Math.max(
            lastFillLoss?.time ?? 0,
            recentDbLoss ? dbCoinStat!.lastClosedAtMs : 0,
            recentMemLoss?.createdAtMs ?? 0
          )) /
          1000
      )
    );
    return {
      allowed: false,
      reason: `Enfriamiento Anti-Revancha en ${coin}: cierre en pérdida hace ${Math.round(lossAgeSec / 60)}m (esperando 10m).`,
      adjustedConfidence: Math.min(decisionConfidence, 45),
      requiredScore: 74,
    };
  }

  // 5. High-Win-Rate Discipline Bar + Mandatory RANGING_CHOP Guard + Separated SI_ENTRAR / NO_ENTRAR Enforcement
  const separated = extractSeparatedLearningRules({
    memories,
    dbHistory,
    fillsSummary,
    playbook,
  });

  let requiredScore = Math.max(20, config.minQuantScore);
  let requiredConfidence = Math.max(35, config.minConfidence);
  const notes: string[] = [];

  // Default Chop Block: never trade sideways RANGING_CHOP unless >=3 strategies + Orderflow confirm >=68 pts
  if (deepAnalysis.regime === 'RANGING_CHOP') {
    const hasSweepOrL2 =
      activeFired.includes('LIQUIDITY_SWEEP_REJECTION') ||
      activeFired.includes('L2_ORDERBOOK_IMBALANCE');
    const feeBurnRule = separated.negativeNoEntryRules.some((r) => r.coin === 'ALL');
    if (feeBurnRule || activeFired.length < 3 || !hasSweepOrL2 || deepAnalysis.unifiedScore < 68) {
      return {
        allowed: false,
        reason: `Filtro Anti-Chop: ${coin} en rango lateral (RANGING_CHOP). Solo entra con >=3 estrategias + L2/Sweep (>=68 pts).`,
        adjustedConfidence: Math.min(decisionConfidence, 44),
        requiredScore: 68,
      };
    }
    requiredScore = Math.max(requiredScore, 68);
  }

  const matchingNegativeRules = separated.negativeNoEntryRules.filter(
    (r) =>
      r.coin === coin ||
      (r.coin === 'STRATEGY' && activeFired.some((sid) => r.regime.includes(sid)))
  );
  if (matchingNegativeRules.length >= 2 || separated.negativeCoins.includes(coin)) {
    if (deepAnalysis.unifiedScore < 72 || activeFired.length < 3) {
      return {
        allowed: false,
        reason: `Regla NO ENTRAR bloquea ${coin}: historial adverso exige >=3 estrategias y >=72 pts (actual ${deepAnalysis.unifiedScore} pts).`,
        adjustedConfidence: Math.min(decisionConfidence, 46),
        requiredScore: 72,
      };
    }
    requiredScore = Math.max(requiredScore, 72);
    notes.push('Filtro NO_ENTRAR exigiendo confluencia A+');
  }

  const hasPositiveRuleMatch =
    separated.positiveCoins.includes(coin) ||
    activeFired.some((sid) => separated.positiveStrategies.includes(sid));
  if (hasPositiveRuleMatch) {
    requiredScore = Math.max(56, requiredScore - 3);
    notes.push(`SI_ENTRAR verificado en ${coin}`);
  }

  // Real Streak Tilt Protection: configurable auto-cooldown after 3 consecutive losses (auto-resumes after cooldownHours)
  let fillConsecutiveLosses = 0;
  let lastStreakLossTime = 0;
  for (const f of fillsSummary.recentClosed) {
    if (f.netPnl < -0.05) {
      fillConsecutiveLosses += 1;
      if (lastStreakLossTime === 0) lastStreakLossTime = f.time;
    } else if (f.netPnl > 0.05) {
      break;
    }
  }
  const streakLosses = Math.max(fillConsecutiveLosses, dbHistory.consecutiveRecentLosses);
  const cooldownMs = Math.max(0.5, config.streakCooldownHours || 3) * 3600 * 1000;
  const latestLossTs = Math.max(
    lastStreakLossTime,
    ...dbHistory.coinStats.filter((c) => c.lastOutcome === 'LOSS').map((c) => c.lastClosedAtMs),
    0
  );
  if (streakLosses >= 3 && latestLossTs > 0 && now - latestLossTs < cooldownMs) {
    const remainingMin = Math.max(1, Math.ceil((cooldownMs - (now - latestLossTs)) / 60000));
    return {
      allowed: false,
      reason: `Cooldown automático tras 3 pérdidas seguidas (${remainingMin}m restantes de ${(cooldownMs / 3600000).toFixed(1)}h); se reanuda solo al expirar.`,
      adjustedConfidence: 0,
      requiredScore: 74,
    };
  }
  if (streakLosses >= 2) {
    requiredScore = Math.min(76, requiredScore + 6);
    requiredConfidence = Math.min(76, requiredConfidence + 6);
    notes.push(`Racha ${streakLosses} pérdidas: elevando filtro a ${requiredScore} pts`);
  }

  // Historical coin expectancy guard
  const fillLoser = fillsSummary.losingCoins.find((c) => c.coin === coin);
  const dbLosingCoin = dbCoinStat && dbCoinStat.trades >= 2 && dbCoinStat.netPnlUsd < -1.0 ? dbCoinStat : undefined;
  if ((fillLoser && fillLoser.losses >= 2) || dbLosingCoin) {
    requiredScore = Math.max(requiredScore, 70);
    requiredConfidence = Math.max(requiredConfidence, 70);
    notes.push(`Historial negativo en ${coin}: exigiendo ${requiredScore} pts`);
  }

  const activeTraps = deepAnalysis.trapWarnings || [];
  if (
    side === 'LONG' &&
    deepAnalysis.sweepDirection !== 'LONG_SWEEP' &&
    activeTraps.some((w) => w.includes('SOPORTE FALSO') || w.includes('BARRIDA FALSA BAJISTA'))
  ) {
    return {
      allowed: false,
      reason: `Escudo Anti-Mentira en ${coin}: ${activeTraps.join(' · ')} — esperando barrida real con reclaim.`,
      adjustedConfidence: Math.min(decisionConfidence, 44),
      requiredScore: config.minQuantScore,
    };
  }
  if (
    side === 'SHORT' &&
    deepAnalysis.sweepDirection !== 'SHORT_SWEEP' &&
    activeTraps.some((w) => w.includes('RESISTENCIA FALSA') || w.includes('BARRIDA FALSA ALCISTA'))
  ) {
    return {
      allowed: false,
      reason: `Escudo Anti-Mentira en ${coin}: ${activeTraps.join(' · ')} — esperando barrida real con rechazo.`,
      adjustedConfidence: Math.min(decisionConfidence, 44),
      requiredScore: config.minQuantScore,
    };
  }

  // Strategy Playbook real expectancy check (ONLY enforce when >= MIN_ATTRIBUTABLE_TRADES = 5)
  const firedStats = activeFired
    .map((id) => playbookMap.get(id))
    .filter((item): item is StrategyPlaybookItem => Boolean(item));
  const provenLosingOnly =
    firedStats.length > 0 &&
    firedStats.every(
      (s) =>
        s.wins + s.losses >= MIN_ATTRIBUTABLE_TRADES &&
        s.wins / (s.wins + s.losses) < 0.35 &&
        s.totalPnlUsd < 0
    );
  if (provenLosingOnly) {
    return {
      allowed: false,
      reason: `Estrategias (${activeFired.join(', ')}) con <35% win-rate demostrado (>=${MIN_ATTRIBUTABLE_TRADES} ops); descartado.`,
      adjustedConfidence: Math.min(decisionConfidence, 48),
      requiredScore,
    };
  }

  // Margin sanity guard
  if (accountSummary && accountSummary.accountValue > 0) {
    const targetLev = Math.max(1, Math.min(100, Number(config.leverage ?? 10)));
    const effectiveLev = Math.max(1, Math.min(assetMaxLeverage || targetLev, targetLev));
    const estMarginNeeded = orderUsd / effectiveLev;
    if (accountSummary.withdrawable < Math.max(3, estMarginNeeded * 0.85)) {
      return {
        allowed: false,
        reason: `Margen libre insuficiente ($${accountSummary.withdrawable.toFixed(2)} USDC) para abrir ${coin}.`,
        adjustedConfidence: Math.min(decisionConfidence, 50),
        requiredScore,
      };
    }
  }

  if (deepAnalysis.unifiedScore < requiredScore || decisionConfidence < requiredConfidence) {
    return {
      allowed: false,
      reason: `Filtro Pro SÍ/NO en ${coin}: Score ${deepAnalysis.unifiedScore}/${requiredScore} o Confianza ${decisionConfidence}/${requiredConfidence}%${notes.length ? ` (${notes.join('; ')})` : ''}.`,
      adjustedConfidence: Math.min(decisionConfidence, deepAnalysis.confidence),
      requiredScore,
    };
  }

  return {
    allowed: true,
    reason: `[${formatDecisionBandLabel(deepAnalysis.decisionBand)}] Señal→Confirmación (${activeFired.length} est.)→Ejecución: Score ${deepAnalysis.unifiedScore} · SL -${slPct.toFixed(2)}% / TP1 +${(deepAnalysis.tp1Pct ?? slPct * 1.15).toFixed(2)}% / TP2 +${(deepAnalysis.tp2Pct ?? tpPct * 0.58).toFixed(2)}% / TP3 +${tpPct.toFixed(2)}% (R:R ${rrRatio.toFixed(1)}:1${deepAnalysis.sweepDirection && deepAnalysis.sweepDirection !== 'NONE' ? ` · ${deepAnalysis.sweepDirection}` : ''}${notes.length ? ` · ${notes.join(', ')}` : ''}).`,
    adjustedConfidence: Math.min(99, Math.round((decisionConfidence + deepAnalysis.confidence) / 2) + (hasPositiveRuleMatch ? 3 : 0)),
    requiredScore,
  };
}

// ---------- Decision Analyzer & Pre-Trade Position Optimizer ----------

export interface OptimizedTradeDecision {
  coin: string;
  side: 'LONG' | 'SHORT';
  optimizedNotionalUsd: number;
  slPct: number;
  tpPct: number;
  tp1Pct: number;
  tp2Pct: number;
  tp3Pct: number;
  decisionBand: DecisionBand;
  convictionTier: 'A+' | 'AGRESIVO' | 'ESTANDAR';
  optimizerSummary: string;
}

export function optimizeEntryDecision(params: {
  coin: string;
  side: 'LONG' | 'SHORT';
  deepAnalysis: DeepAssetAnalysis;
  config: BotConfigData;
  accountSummary: HlAccountSummary | null;
  asset: HlAssetMarket;
  playbook: StrategyPlaybookItem[];
  dbHistory: DbClosedHistorySummary;
  fillsSummary: FillsSummarySnapshot;
  openPositions: HlLivePosition[];
}): OptimizedTradeDecision {
  const {
    coin,
    side,
    deepAnalysis,
    config,
    accountSummary,
    asset,
    playbook,
    dbHistory,
    fillsSummary,
    openPositions,
  } = params;

  const slPct = Math.max(0.05, config.slPct > 0 ? config.slPct : deepAnalysis.recommendedSlPct || 0.85);
  const tpPct = Math.max(0.2, config.tpPct > 0 ? config.tpPct : deepAnalysis.recommendedTpPct || 3.5);
  const tp1Pct = deepAnalysis.tp1Pct ?? Number(Math.max(0.85, slPct * 1.15).toFixed(2));
  const tp2Pct = deepAnalysis.tp2Pct ?? Number(Math.max(1.75, tpPct * 0.58).toFixed(2));
  const tp3Pct = tpPct;
  const decisionBand = deepAnalysis.decisionBand ?? getDecisionBand(deepAnalysis.unifiedScore);
  const baseNotional = computeDynamicOrderNotionalUsd({
    config,
    accountSummary,
    asset,
    slPctOverride: slPct,
  });

  // Evaluate historical edge ONLY when strategies actually have >= MIN_ATTRIBUTABLE_TRADES (5)
  const dbStat = dbHistory.coinStats.find((c) => c.coin === coin);
  const fillWinner = fillsSummary.winningCoins.find((c) => c.coin === coin);
  const playbookMap = new Map(playbook.map((p) => [p.strategyId, p]));
  const provenFired = deepAnalysis.firedStrategies
    .map((id) => playbookMap.get(id))
    .filter((s): s is StrategyPlaybookItem => Boolean(s && s.wins + s.losses >= MIN_ATTRIBUTABLE_TRADES));
  const avgProvenWeight =
    provenFired.length > 0
      ? provenFired.reduce((sum, s) => sum + s.weight, 0) / provenFired.length
      : 1.0;

  let sizeMultiplier = 1.0;
  let convictionTier: 'A+' | 'AGRESIVO' | 'ESTANDAR' = 'ESTANDAR';
  const tags: string[] = [];

  if (deepAnalysis.unifiedScore >= 80 && deepAnalysis.firedStrategies.length >= 2) {
    sizeMultiplier *= 1.25;
    convictionTier = 'A+';
    tags.push('Confluencia Alta 80–100 (size 1.25x)');
  } else if (deepAnalysis.unifiedScore >= 65) {
    sizeMultiplier *= 1.0;
    convictionTier = 'ESTANDAR';
    tags.push('Señal Válida 65–79');
  } else {
    sizeMultiplier *= 0.80;
    convictionTier = 'AGRESIVO';
    tags.push('Cautela 50–64 (size 0.80x)');
  }

  if (deepAnalysis.sweepDirection && deepAnalysis.sweepDirection !== 'NONE') {
    tags.push(
      deepAnalysis.sweepDirection === 'LONG_SWEEP'
        ? 'Caza-Barrida LONG (stops liquidados)'
        : 'Caza-Barrida SHORT (trampa alcista)'
    );
  }

  if (provenFired.length > 0 && avgProvenWeight >= 1.15) {
    sizeMultiplier *= 1.1;
    tags.push(`Playbook demostrado ${avgProvenWeight.toFixed(2)}x`);
  } else if (provenFired.length === 0) {
    tags.push(`Sin muestra >=${MIN_ATTRIBUTABLE_TRADES} ops (peso neutro 1.0x)`);
  }
  if (fillWinner || (dbStat && dbStat.netPnlUsd > 0)) {
    sizeMultiplier *= 1.1;
    tags.push('Historial ganador en token');
  }

  // Protect available margin & cap slots (max 2 initial)
  const remainingSlots = Math.max(1, (config.maxOpenPositions || 2) - openPositions.length);
  const riskPctLabel = (config.riskPerTradePct ?? 0.35).toFixed(2);
  if (accountSummary && accountSummary.withdrawable > 0) {
    const targetLev = Math.max(1, Math.min(100, Number(config.leverage ?? 10)));
    const effectiveLev = Math.max(1, Math.min(asset.maxLeverage || targetLev, targetLev));
    const maxPerSlotNotional =
      (accountSummary.withdrawable * 0.88 * effectiveLev) / Math.min(remainingSlots, 2);
    const optimized = Math.max(
      11,
      Math.min(baseNotional * sizeMultiplier, maxPerSlotNotional, baseNotional * 1.45)
    );
    return {
      coin,
      side,
      optimizedNotionalUsd: Number(optimized.toFixed(2)),
      slPct,
      tpPct,
      tp1Pct,
      tp2Pct,
      tp3Pct,
      decisionBand,
      convictionTier,
      optimizerSummary: `Optimizador [${convictionTier} · Riesgo ${riskPctLabel}%]: $${optimized.toFixed(0)} USD · SL -${slPct.toFixed(2)}% / TP1 +${tp1Pct}% / TP2 +${tp2Pct}% / TP3 +${tp3Pct}% · ${tags.join(' + ')} · Slots libres ${remainingSlots}`,
    };
  }

  const optimized = Math.max(11, baseNotional * sizeMultiplier);
  return {
    coin,
    side,
    optimizedNotionalUsd: Number(optimized.toFixed(2)),
    slPct,
    tpPct,
    tp1Pct,
    tp2Pct,
    tp3Pct,
    decisionBand,
    convictionTier,
    optimizerSummary: `Optimizador [${convictionTier} · Riesgo ${riskPctLabel}%]: $${optimized.toFixed(0)} USD · SL -${slPct.toFixed(2)}% / TP1 +${tp1Pct}% / TP2 +${tp2Pct}% / TP3 +${tp3Pct}% · ${tags.join(' + ')}`,
  };
}
