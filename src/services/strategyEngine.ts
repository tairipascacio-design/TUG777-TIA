import type {
  AiMemoryEntry,
  BotConfigData,
  DeepAssetAnalysis,
  HlAccountSummary,
  HlAssetMarket,
  HlCandle,
  HlL2Level,
  HlLivePosition,
  MarketRegime,
  PositionManagementDecision,
  StrategyPlaybookItem,
} from '../types/trading';

export const POSITION_MANAGEMENT_GUIDE_RULES = [
  '1. Stop Loss Dinámico ATR/Config: Cierra de inmediato si el precio cruza -slPct (o -1.8×ATR% en volatilidad controlada) sin promediar pérdidas.',
  '2. Breakeven Lock Automático: Cuando la posición supera +0.85% de precio favorable (o 50% del TP), protege el punto de entrada (+0.15% buffer).',
  '3. Trailing Stop Institucional: Al superar +65% del Take Profit, activa trailing stop dinámico (retroceso máximo 0.5×SL desde el pico) para dejar correr ganadores sin límite de capital.',
  '4. Invalidación por Cambio de Régimen: Si el consenso multi-estrategia 15M+1H gira en contra (>=70 pts) mientras el trade está plano o negativo, corta antes de tocar SL.',
  '5. Filtro Anti-Chasing y Orderbook L2: Prohíbe comprar velas extendidas >2.3×ATR sobre EMA21 o books con desequilibrio contrario extremo.',
  '6. Aprendizaje Continuo en Firestore: Cada cierre actualiza wins/losses/PnL y ajusta automáticamente el peso (0.25x–2.50x) de las estrategias que dispararon la entrada.',
];

export const DEFAULT_STRATEGY_PLAYBOOK: Array<
  Omit<StrategyPlaybookItem, 'ownerId' | 'wins' | 'losses' | 'totalPnlUsd' | 'updatedAtMs'>
> = [
  {
    strategyId: 'EMA_RIBBON_PULLBACK',
    name: 'EMA 9/21/55 Trend Pullback',
    category: 'TREND',
    preferredRegimes: 'TRENDING_BULL,TRENDING_BEAR',
    entryRule: 'Alineación EMA9>EMA21>EMA55 en 15M y tendencia 1H confirmada; entra en retroceso limpio a EMA21 sin sobreextensión.',
    positionManagementGuide: 'Mantener mientras EMA9 no cruce EMA21 en 15M; mover SL a breakeven tras +1R.',
    weight: 1.25,
    enabled: true,
  },
  {
    strategyId: 'SUPERTREND_REGIME_RIDER',
    name: 'Supertrend MTF (15M + 1H)',
    category: 'TREND',
    preferredRegimes: 'TRENDING_BULL,TRENDING_BEAR,BREAKOUT_EXPANSION',
    entryRule: 'Acuerdo estricto de Supertrend ATR(10,3.0) en 15M y 1H para cabalgar tendencias limpias.',
    positionManagementGuide: 'Usar trailing stop ATR y dejar correr ganadores por encima del capital inicial.',
    weight: 1.2,
    enabled: true,
  },
  {
    strategyId: 'BOLLINGER_SQUEEZE_BREAKOUT',
    name: 'Bollinger Squeeze + Volumen',
    category: 'VOLATILITY',
    preferredRegimes: 'HIGH_VOLATILITY_SQUEEZE,BREAKOUT_EXPANSION',
    entryRule: 'Compresión BBWidth(20,2) seguida de ruptura con expansión de volumen >1.45x promedio de 20 velas.',
    positionManagementGuide: 'Si falla en sostener la banda media en 2 velas, salir por invalidación.',
    weight: 1.15,
    enabled: true,
  },
  {
    strategyId: 'VWAP_MEAN_REVERSION',
    name: 'VWAP + Z-Score Mean Reversion',
    category: 'MEAN_REVERSION',
    preferredRegimes: 'RANGING_CHOP',
    entryRule: 'Desviación extrema |Z-Score| >= 1.85 respecto al VWAP de sesión con vela de giro y RSI extremo.',
    positionManagementGuide: 'Tomar ganancia al regresar al VWAP; no esperar expansión infinita en mercado lateral.',
    weight: 1.1,
    enabled: true,
  },
  {
    strategyId: 'RSI_DIVERGENCE_REVERSAL',
    name: 'RSI(14) Divergencia & Agotamiento',
    category: 'MOMENTUM',
    preferredRegimes: 'RANGING_CHOP,TRENDING_BULL,TRENDING_BEAR',
    entryRule: 'Divergencia alcista/bajista en RSI(14) o cruce desde <30 / >70 confirmando giro real de estructura.',
    positionManagementGuide: 'SL ajustado detrás del último swing extremo; TP escalonado en resistencia/soporte EMA55.',
    weight: 1.15,
    enabled: true,
  },
  {
    strategyId: 'MACD_MOMENTUM_CROSS',
    name: 'MACD(12,26,9) Histograma Acelerado',
    category: 'MOMENTUM',
    preferredRegimes: 'TRENDING_BULL,TRENDING_BEAR,BREAKOUT_EXPANSION',
    entryRule: 'Cruce y expansión creciente del histograma MACD alineado con pendiente de EMA21 en 1H.',
    positionManagementGuide: 'Salir o apretar trailing cuando el histograma pierde pendiente por 3 velas consecutivas.',
    weight: 1.0,
    enabled: true,
  },
  {
    strategyId: 'ATR_DONCHIAN_BREAKOUT',
    name: 'Donchian(20) Structure Breakout',
    category: 'TREND',
    preferredRegimes: 'BREAKOUT_EXPANSION,TRENDING_BULL,TRENDING_BEAR',
    entryRule: 'Ruptura real de máximo/mínimo de 20 velas con cuerpo sólido (>55% del rango) y ATR expandiéndose.',
    positionManagementGuide: 'Cerrar rápido si el precio vuelve a entrar dentro del canal de 20 velas (falsa ruptura).',
    weight: 1.1,
    enabled: true,
  },
  {
    strategyId: 'LIQUIDITY_SWEEP_REJECTION',
    name: 'Liquidity Sweep / Stop Hunt Wick',
    category: 'ORDERFLOW',
    preferredRegimes: 'RANGING_CHOP,HIGH_VOLATILITY_SQUEEZE',
    entryRule: 'Barrida de liquidez sobre swing high/low previo con mecha de rechazo >=45% cerrando dentro del rango.',
    positionManagementGuide: 'Alta asimetría: SL justo detrás de la mecha de barrida y objetivo al extremo opuesto.',
    weight: 1.25,
    enabled: true,
  },
  {
    strategyId: 'L2_ORDERBOOK_IMBALANCE',
    name: 'Orderbook L2 Depth Imbalance',
    category: 'ORDERFLOW',
    preferredRegimes: 'TRENDING_BULL,TRENDING_BEAR,RANGING_CHOP,BREAKOUT_EXPANSION',
    entryRule: 'Desequilibrio real en los 10 mejores niveles del libro L2 (>24% presión neta) + spread <15 bps.',
    positionManagementGuide: 'Monitorear absorción de muros L2; salir si la presión del libro se invierte >30%.',
    weight: 1.1,
    enabled: true,
  },
  {
    strategyId: 'FUNDING_OI_SQUEEZE',
    name: 'Hyperliquid Funding Squeeze + OI Flow',
    category: 'ORDERFLOW',
    preferredRegimes: 'BREAKOUT_EXPANSION,TRENDING_BULL,TRENDING_BEAR',
    entryRule: 'Funding anualizado extremo (<-22% para Long Squeeze o >+42% para Short) combinado con alta rotación OI/Vol.',
    positionManagementGuide: 'Capturar cascada de liquidaciones y asegurar ganancias con trailing tras pico de volumen.',
    weight: 1.05,
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
  const ema55Arr = calcEmaSeries(closes15, 55);
  const ema9 = ema9Arr[ema9Arr.length - 1] ?? px;
  const ema21 = ema21Arr[ema21Arr.length - 1] ?? px;
  const ema55 = ema55Arr[ema55Arr.length - 1] ?? px;

  const ema21_1hArr = calcEmaSeries(closes1h, 21);
  const ema55_1hArr = calcEmaSeries(closes1h, 55);
  const ema21_1h = ema21_1hArr[ema21_1hArr.length - 1] ?? px;
  const ema55_1h = ema55_1hArr[ema55_1hArr.length - 1] ?? px;
  const trend1hUp = px > ema21_1h && ema21_1h >= ema55_1h * 0.998;
  const trend1hDown = px < ema21_1h && ema21_1h <= ema55_1h * 1.002;

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

  const bb = calcBollinger(closes15, 20, 2.0);
  const prevBb = calcBollinger(closes15.slice(0, -3), 20, 2.0);
  const vwapInfo = calcVwapAndZScore(c15);

  const supertrend15 = calcSupertrendDirection(c15, 10, 3.0);
  const supertrend1h = calcSupertrendDirection(c1h, 10, 3.0);

  const volSlice = c15.slice(-22, -2).map((k) => k.v);
  const avgVol = volSlice.length > 0 ? volSlice.reduce((a, b) => a + b, 0) / volSlice.length : prevCandle.v || 1;
  // Project live 15m candle volume or use last closed candle so a fresh candle doesn't distort volRatio
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

  // Detect Market Regime
  let regime: MarketRegime = 'RANGING_CHOP';
  if (bb.widthPct < 1.35 && prevBb.widthPct < 1.35) {
    regime = 'HIGH_VOLATILITY_SQUEEZE';
  } else if (volRatio >= 1.45 && (px > bb.upper || px < bb.lower)) {
    regime = 'BREAKOUT_EXPANSION';
  } else if (ema9 > ema21 && ema21 > ema55 && trend1hUp) {
    regime = 'TRENDING_BULL';
  } else if (ema9 < ema21 && ema21 < ema55 && trend1hDown) {
    regime = 'TRENDING_BEAR';
  }

  // Higher-Timeframe structural lock: forbids counter-trend fades into active 1H+15M trends
  const htfBullLocked =
    regime === 'TRENDING_BULL' ||
    (supertrend1h === 'LONG' && supertrend15 === 'LONG') ||
    (trend1hUp && ema9 > ema21 && px > ema21);
  const htfBearLocked =
    regime === 'TRENDING_BEAR' ||
    (supertrend1h === 'SHORT' && supertrend15 === 'SHORT') ||
    (trend1hDown && ema9 < ema21 && px < ema21);

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
    // Hard guard: NEVER let mean-reversion / counter-trend oscillators fight an intact 15M+1H trend!
    if (side === 'SHORT' && htfBullLocked && isCounterTrend) return;
    if (side === 'LONG' && htfBearLocked && isCounterTrend) return;

    const cfg = playbookMap.get(strategyId);
    if (cfg && !cfg.enabled) return;
    const learnedWeight = cfg?.weight ?? 1.0;
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

  // 1. EMA Ribbon Pullback Sniper (trend-following pullback, never chasing)
  const distFromEma21Atr = atr > 0 ? (px - ema21) / atr : 0;
  if (ema9 > ema21 && ema21 > ema55 && trend1hUp && distFromEma21Atr >= -0.8 && distFromEma21Atr <= 1.6) {
    vote('EMA_RIBBON_PULLBACK', 'LONG', 22, 'Pullback alcista limpio en EMA21 (15M+1H)');
  } else if (
    ema9 < ema21 &&
    ema21 < ema55 &&
    trend1hDown &&
    distFromEma21Atr <= 0.8 &&
    distFromEma21Atr >= -1.6
  ) {
    vote('EMA_RIBBON_PULLBACK', 'SHORT', 22, 'Pullback bajista limpio en EMA21 (15M+1H)');
  }

  // 2. Supertrend MTF Rider
  if (supertrend15 === 'LONG' && supertrend1h === 'LONG') {
    vote('SUPERTREND_REGIME_RIDER', 'LONG', 20, 'Supertrend 15M+1H alineado LONG');
  } else if (supertrend15 === 'SHORT' && supertrend1h === 'SHORT') {
    vote('SUPERTREND_REGIME_RIDER', 'SHORT', 20, 'Supertrend 15M+1H alineado SHORT');
  }

  // 3. Bollinger Squeeze + Volume Expansion (with 1H alignment)
  if (prevBb.widthPct < 1.9 && volRatio >= 1.3 && px > bb.upper && sigCandle.c > sigCandle.o && !htfBearLocked) {
    vote('BOLLINGER_SQUEEZE_BREAKOUT', 'LONG', 22, `Ruptura alcista squeeze BB + vol ${volRatio.toFixed(1)}x`);
  } else if (prevBb.widthPct < 1.9 && volRatio >= 1.3 && px < bb.lower && sigCandle.c < sigCandle.o && !htfBullLocked) {
    vote('BOLLINGER_SQUEEZE_BREAKOUT', 'SHORT', 22, `Ruptura bajista squeeze BB + vol ${volRatio.toFixed(1)}x`);
  }

  // 4. VWAP + Z-Score Mean Reversion (STRICTLY counter-trend-gated: only in RANGING/chop, NEVER vs locked HTF trend)
  if (vwapInfo.zScore <= -1.75 && sigCandle.c > sigCandle.o && rsi14 < 40) {
    vote('VWAP_MEAN_REVERSION', 'LONG', 17, `Reversión VWAP Z=${vwapInfo.zScore.toFixed(2)}`, true);
  } else if (vwapInfo.zScore >= 1.75 && sigCandle.c < sigCandle.o && rsi14 > 60) {
    vote('VWAP_MEAN_REVERSION', 'SHORT', 17, `Reversión VWAP Z=+${vwapInfo.zScore.toFixed(2)}`, true);
  }

  // 5. RSI Divergence & Momentum Exhaustion (counter-trend-gated against locked HTF trend)
  const lookbackLow = Math.min(...c15.slice(-14, -2).map((k) => k.l));
  const lookbackHigh = Math.max(...c15.slice(-14, -2).map((k) => k.h));
  if ((rsi14 <= 32 && sigCandle.c > sigPrev.c) || (sigCandle.l <= lookbackLow && rsi14 > prevRsi + 3.5)) {
    vote('RSI_DIVERGENCE_REVERSAL', 'LONG', 16, `RSI(${rsi14.toFixed(0)}) divergencia/giro alcista`, true);
  } else if (
    (rsi14 >= 68 && sigCandle.c < sigPrev.c) ||
    (sigCandle.h >= lookbackHigh && rsi14 < prevRsi - 3.5)
  ) {
    vote('RSI_DIVERGENCE_REVERSAL', 'SHORT', 16, `RSI(${rsi14.toFixed(0)}) divergencia/giro bajista`, true);
  }

  // 6. MACD Histogram Acceleration (aligned with 1H trend)
  if (histNow > 0 && histNow > histPrev && trend1hUp) {
    vote('MACD_MOMENTUM_CROSS', 'LONG', 18, 'MACD histograma positivo acelerando con 1H');
  } else if (histNow < 0 && histNow < histPrev && trend1hDown) {
    vote('MACD_MOMENTUM_CROSS', 'SHORT', 18, 'MACD histograma negativo acelerando con 1H');
  }

  // 7. Donchian(20) Structure Breakout
  const high20 = Math.max(...c15.slice(-22, -2).map((k) => k.h));
  const low20 = Math.min(...c15.slice(-22, -2).map((k) => k.l));
  const candleRange = Math.max(sigCandle.h - sigCandle.l, 1e-8);
  const bodyRatio = Math.abs(sigCandle.c - sigCandle.o) / candleRange;
  if (sigCandle.c > high20 && bodyRatio >= 0.45 && volRatio >= 1.15 && !htfBearLocked) {
    vote('ATR_DONCHIAN_BREAKOUT', 'LONG', 20, 'Ruptura estructura 20 velas alcista');
  } else if (sigCandle.c < low20 && bodyRatio >= 0.45 && volRatio >= 1.15 && !htfBullLocked) {
    vote('ATR_DONCHIAN_BREAKOUT', 'SHORT', 20, 'Ruptura estructura 20 velas bajista');
  }

  // 8. Liquidity Sweep / Stop Hunt Wick Rejection (gated against locked HTF trend unless 1H also neutral)
  const lowerWickRatio = (Math.min(sigCandle.o, sigCandle.c) - sigCandle.l) / candleRange;
  const upperWickRatio = (sigCandle.h - Math.max(sigCandle.o, sigCandle.c)) / candleRange;
  if (sigCandle.l < lookbackLow && sigCandle.c > lookbackLow && lowerWickRatio >= 0.42) {
    vote('LIQUIDITY_SWEEP_REJECTION', 'LONG', 19, 'Barrida de stops inferior + rechazo alcista', true);
  } else if (sigCandle.h > lookbackHigh && sigCandle.c < lookbackHigh && upperWickRatio >= 0.42) {
    vote('LIQUIDITY_SWEEP_REJECTION', 'SHORT', 19, 'Barrida de stops superior + rechazo bajista', true);
  }

  // 9. L2 Orderbook Imbalance & Spread Filter (only counts with trend or in range, never fades strong trend alone)
  if (spreadBps <= 16 && l2Imbalance >= 0.24) {
    vote('L2_ORDERBOOK_IMBALANCE', 'LONG', 15, `Libro L2 comprador +${(l2Imbalance * 100).toFixed(0)}%`, true);
  } else if (spreadBps <= 16 && l2Imbalance <= -0.24) {
    vote('L2_ORDERBOOK_IMBALANCE', 'SHORT', 15, `Libro L2 vendedor ${(l2Imbalance * 100).toFixed(0)}%`, true);
  }

  // 10. Hyperliquid Funding Squeeze + OI Turnover (requires extreme funding + flow, gated against HTF trend)
  const turnover = market.openInterestUsd > 0 ? market.dayNtlVlm / market.openInterestUsd : 0;
  if (market.annualizedFundingPct <= -22 && (turnover >= 1.5 || l2Imbalance > 0)) {
    vote(
      'FUNDING_OI_SQUEEZE',
      'LONG',
      16,
      `Funding squeeze ${market.annualizedFundingPct.toFixed(0)}% APR`,
      !trend1hUp
    );
  } else if (market.annualizedFundingPct >= 65 && (turnover >= 1.5 || l2Imbalance < 0)) {
    vote(
      'FUNDING_OI_SQUEEZE',
      'SHORT',
      16,
      `Crowding long ${market.annualizedFundingPct.toFixed(0)}% APR`,
      !trend1hDown
    );
  }

  // Cross-reference Firestore AI Memories (penalize repeat mistakes, boost proven edges)
  const coinMemories = memories.filter((m) => m.coin === market.coin).slice(0, 6);
  const recentLosses = coinMemories.filter((m) => m.outcome === 'LOSS').length;
  const recentWins = coinMemories.filter((m) => m.outcome === 'WIN').length;
  if (recentLosses >= 2 && recentWins === 0) {
    longPts *= 0.82;
    shortPts *= 0.82;
  } else if (recentWins > recentLosses) {
    longPts *= 1.08;
    shortPts *= 1.08;
  }

  // Higher-Timeframe alignment bonus (rewards clean trend-following setups)
  if (trend1hUp && supertrend1h === 'LONG' && longPts > 0) {
    longPts += 14;
    reasonsLong.push('Alineación estructural 1H alcista');
  }
  if (trend1hDown && supertrend1h === 'SHORT' && shortPts > 0) {
    shortPts += 14;
    reasonsShort.push('Alineación estructural 1H bajista');
  }

  const net = longPts - shortPts;
  let direction: 'LONG' | 'SHORT' | 'NEUTRAL' = 'NEUTRAL';
  let firedStrategies: string[] = [];
  let chosenReasons: string[] = [];
  let rawScore = 0;

  // Require net dominance AND at least 2 distinct aligned strategies
  if (net >= 20 && firedLong.length >= 2 && !htfBearLocked) {
    direction = 'LONG';
    firedStrategies = firedLong;
    chosenReasons = reasonsLong;
    rawScore = longPts - shortPts * 0.4;
  } else if (net <= -20 && firedShort.length >= 2 && !htfBullLocked) {
    direction = 'SHORT';
    firedStrategies = firedShort;
    chosenReasons = reasonsShort;
    rawScore = shortPts - longPts * 0.4;
  } else {
    rawScore = Math.max(longPts, shortPts) * 0.55;
    chosenReasons = longPts >= shortPts ? reasonsLong : reasonsShort;
  }

  // Anti-chasing shield: NEVER flip direction; instead block entry as NEUTRAL until pullback!
  let antiChaseBlocked = false;
  if (direction === 'LONG' && distFromEma21Atr > 2.3) {
    antiChaseBlocked = true;
    direction = 'NEUTRAL';
    rawScore = Math.min(rawScore, 45);
    chosenReasons.push('Espera: sobreextendido alcista (>2.3×ATR), esperando pullback a EMA21');
  } else if (direction === 'SHORT' && distFromEma21Atr < -2.3) {
    antiChaseBlocked = true;
    direction = 'NEUTRAL';
    rawScore = Math.min(rawScore, 45);
    chosenReasons.push('Espera: sobreextendido bajista (<-2.3×ATR), esperando rebote a EMA21');
  }

  const unifiedScore = Math.max(10, Math.min(98, Math.round(rawScore)));
  const confidence =
    direction === 'NEUTRAL'
      ? Math.min(54, unifiedScore)
      : Math.max(
          20,
          Math.min(97, Math.round(unifiedScore * (firedStrategies.length >= 3 ? 1.05 : 0.96)))
        );

  // ATR-adaptive SL / TP (minimum 1:2.1 R:R ratio)
  const recommendedSlPct = Number(Math.max(0.75, Math.min(3.5, atrPct * 1.65)).toFixed(2));
  const recommendedTpPct = Number(Math.max(recommendedSlPct * 2.1, Math.min(12.0, atrPct * 3.6)).toFixed(2));

  return {
    coin: market.coin,
    markPx: px,
    regime,
    direction,
    unifiedScore,
    confidence,
    firedStrategies,
    rsi14: Number(rsi14.toFixed(1)),
    ema9,
    ema21,
    ema55,
    atrPct: Number(atrPct.toFixed(2)),
    vwapDistPct: Number(vwapInfo.distPct.toFixed(2)),
    bbWidthPct: Number(bb.widthPct.toFixed(2)),
    l2Imbalance: Number(l2Imbalance.toFixed(2)),
    spreadBps: Number(spreadBps.toFixed(1)),
    recommendedSlPct,
    recommendedTpPct,
    antiChaseBlocked,
    reasons: chosenReasons.slice(0, 5),
  };
}

// ---------- Dynamic Capital & Leverage Position Sizing ----------

export function computeDynamicOrderNotionalUsd(params: {
  config: BotConfigData;
  accountSummary: HlAccountSummary | null;
  asset: HlAssetMarket;
}): number {
  const { config, accountSummary, asset } = params;
  if (config.sizingMode !== 'equity_pct' || !accountSummary || accountSummary.accountValue <= 0) {
    return Math.max(11, config.riskPerTradeUsd || 50);
  }

  const equity = accountSummary.accountValue;
  const pct = Math.max(5, Math.min(100, config.capitalPctPerTrade || 25)) / 100;
  // Scale margin slice by Hyperliquid's native max leverage capped sensibly at 5x effective unless user configured high leverage, never blocking equity growth!
  const effectiveLev = Math.max(1, Math.min(asset.maxLeverage || 5, 5));
  const desiredNotional = equity * pct * effectiveLev;

  // Respect only real Hyperliquid available margin so Hyperliquid doesn't reject the order
  const maxSafeNotional = Math.max(11, accountSummary.withdrawable * Math.max(1, asset.maxLeverage * 0.85));
  return Math.max(11, Math.min(desiredNotional, maxSafeNotional));
}

// ---------- Active Position Management Engine (Guía Maestra en Vivo) ----------

export function evaluateOpenPositionManagement(params: {
  position: HlLivePosition;
  deepAnalysis: DeepAssetAnalysis;
  config: BotConfigData;
  peakMovePct: number;
}): PositionManagementDecision {
  const { position, deepAnalysis, config, peakMovePct } = params;
  const markPx = deepAnalysis.markPx || position.entryPx;
  const rawMovePct =
    position.entryPx > 0
      ? ((position.side === 'LONG' ? markPx - position.entryPx : position.entryPx - markPx) /
          position.entryPx) *
        100
      : 0;

  const updatedPeak = Math.max(peakMovePct, rawMovePct);
  const slPct = Math.max(0.4, config.slPct || deepAnalysis.recommendedSlPct);
  const tpPct = Math.max(0.8, config.tpPct || deepAnalysis.recommendedTpPct);
  const size = Math.abs(position.szi);

  // 1. Hard Stop Loss
  if (rawMovePct <= -slPct) {
    return {
      coin: position.coin,
      side: position.side,
      size,
      action: 'CLOSE_SL',
      movePct: rawMovePct,
      peakMovePct: updatedPeak,
      reason: `Stop Loss ejecutado (${rawMovePct.toFixed(2)}% <= -${slPct.toFixed(2)}%) para proteger capital.`,
    };
  }

  // 2. Take Profit Target (if trailing disabled, close at TP; if trailing enabled, let runners go past TP until trail triggers!)
  if (!config.trailingStopEnabled && rawMovePct >= tpPct) {
    return {
      coin: position.coin,
      side: position.side,
      size,
      action: 'CLOSE_TP',
      movePct: rawMovePct,
      peakMovePct: updatedPeak,
      reason: `Take Profit alcanzado (+${rawMovePct.toFixed(2)}% >= +${tpPct.toFixed(2)}%).`,
    };
  }

  // 3. Breakeven Lock + Dynamic Trailing Stop (lets winners grow beyond capital)
  if (config.trailingStopEnabled) {
    const breakevenTrigger = Math.max(0.8, tpPct * 0.45);
    const trailStartTrigger = Math.max(1.2, tpPct * 0.65);

    if (updatedPeak >= trailStartTrigger) {
      const trailGap = Math.max(0.45, slPct * 0.55);
      const trailFloor = updatedPeak - trailGap;
      if (rawMovePct <= trailFloor) {
        return {
          coin: position.coin,
          side: position.side,
          size,
          action: 'CLOSE_TRAILING',
          movePct: rawMovePct,
          peakMovePct: updatedPeak,
          reason: `Trailing Stop asegurado (+${rawMovePct.toFixed(2)}% desde pico +${updatedPeak.toFixed(2)}%).`,
        };
      }
    } else if (updatedPeak >= breakevenTrigger && rawMovePct <= 0.12) {
      return {
        coin: position.coin,
        side: position.side,
        size,
        action: 'CLOSE_TRAILING',
        movePct: rawMovePct,
        peakMovePct: updatedPeak,
        reason: `Breakeven Lock activado tras pico de +${updatedPeak.toFixed(2)}% para no perder lo ganado.`,
      };
    }
  }

  // 4. Regime / Multi-Strategy Thesis Invalidation (cuts losers early before SL)
  const oppositeSide = position.side === 'LONG' ? 'SHORT' : 'LONG';
  if (
    deepAnalysis.direction === oppositeSide &&
    deepAnalysis.unifiedScore >= 68 &&
    rawMovePct < 0.25
  ) {
    return {
      coin: position.coin,
      side: position.side,
      size,
      action: 'CLOSE_INVALIDATION',
      movePct: rawMovePct,
      peakMovePct: updatedPeak,
      reason: `Invalidación de tesis: 15M+1H giraron a ${oppositeSide} (${deepAnalysis.unifiedScore} pts) en régimen ${deepAnalysis.regime}.`,
    };
  }

  return {
    coin: position.coin,
    side: position.side,
    size,
    action: 'HOLD',
    movePct: rawMovePct,
    peakMovePct: updatedPeak,
    reason: `En gestión activa (${rawMovePct >= 0 ? '+' : ''}${rawMovePct.toFixed(2)}% | pico +${updatedPeak.toFixed(2)}%).`,
  };
}
