export type TradingMode = 'strategy' | 'ai' | 'strategy_ai';
export type HlNetwork = 'mainnet' | 'testnet';
export type BiasLockMode = 'AMBOS' | 'SOLO_LONG' | 'SOLO_SHORT' | 'PAUSA';

export interface HlAssetMarket {
  index: number;
  coin: string;
  szDecimals: number;
  maxLeverage: number;
  markPx: number;
  midPx: number;
  oraclePx: number;
  prevDayPx: number;
  change24hPct: number;
  fundingRate: number;
  annualizedFundingPct: number;
  openInterest: number;
  openInterestUsd: number;
  dayNtlVlm: number;
  premium: number;
  quantScore: number;
  quantBias: 'LONG' | 'SHORT' | 'NEUTRAL';
  quantSignals: string[];
}

export interface HlCandle {
  t: number;
  T: number;
  s: string;
  i: string;
  o: number;
  c: number;
  h: number;
  l: number;
  v: number;
  n: number;
}

export interface HlL2Level {
  px: number;
  sz: number;
  n: number;
}

export interface HlLivePosition {
  coin: string;
  szi: number;
  side: 'LONG' | 'SHORT';
  entryPx: number;
  positionValue: number;
  unrealizedPnl: number;
  returnOnEquity: number;
  leverage: number;
  liquidationPx: number | null;
  marginUsed: number;
  maxLeverage: number;
  cloid?: string;
  isExternal?: boolean;
}

export interface HlAccountSummary {
  accountValue: number;
  totalMarginUsed: number;
  totalNtlPos: number;
  withdrawable: number;
  positions: HlLivePosition[];
}

export interface HlUserFill {
  coin: string;
  px: number;
  sz: number;
  side: 'B' | 'A';
  time: number;
  closedPnl: number;
  fee: number;
  oid: number;
  hash: string;
  cloid?: string;
}

export interface BotConfigData {
  ownerId: string;
  mode: TradingMode;
  aiEnabled: boolean;
  network: HlNetwork;
  masterWalletAddress: string;
  mevShieldEnabled: boolean;
  maxSlippageBps: number;
  maxOracleDeviationBps: number;
  riskPerTradeUsd: number;
  soundEnabled: boolean;
  aiProvider: 'gemini' | 'custom_ai';
  customAiUrl: string;
  customAiModel: string;
  customSystemPrompt: string;
  scanIntervalSec: number;
  minConfidence: number;
  minQuantScore: number;
  minVolumeM: number;
  tpPct: number;
  slPct: number;
  useDeepThinking: boolean;
  useSearchGrounding: boolean;
  sizingMode: 'equity_pct' | 'fixed_usd';
  capitalPctPerTrade: number;
  maxOpenPositions: number;
  leverage?: number;
  trailingStopEnabled: boolean;
  autoManagePositions: boolean;
  riskPerTradePct: number;
  dailyMaxLossPct: number;
  killSwitchEnabled: boolean;
  geminiModel: string;
  globalBiasLock: BiasLockMode;
  pairBiasLocksJson: string;
  useAloEntries: boolean;
  minOrderUsdFloor: number;
  streakCooldownHours: number;
  watchlistCoinsCsv: string;
  mcloudEnabled: boolean;
  mcloudUrl: string;
}

export type MarketRegime =
  | 'TRENDING_BULL'
  | 'TRENDING_BEAR'
  | 'BREAKOUT_EXPANSION'
  | 'RANGING_CHOP'
  | 'HIGH_VOLATILITY_SQUEEZE';

export type StrategyCategory = 'TREND' | 'MEAN_REVERSION' | 'MOMENTUM' | 'ORDERFLOW' | 'VOLATILITY';

export interface StrategyPlaybookItem {
  strategyId: string;
  ownerId: string;
  name: string;
  category: StrategyCategory;
  preferredRegimes: string;
  entryRule: string;
  positionManagementGuide: string;
  weight: number;
  wins: number;
  losses: number;
  totalPnlUsd: number;
  enabled: boolean;
  updatedAtMs: number;
}

export type DecisionBand =
  | 'NO_OPERAR'
  | 'ESPERAR_CONFIRMACION'
  | 'SENAL_VALIDA'
  | 'CONFLUENCIA_ALTA';

export interface DeepAssetAnalysis {
  coin: string;
  markPx: number;
  regime: MarketRegime;
  direction: 'LONG' | 'SHORT' | 'NEUTRAL';
  unifiedScore: number;
  confidence: number;
  decisionBand?: DecisionBand;
  firedStrategies: string[];
  rsi14: number;
  ema9: number;
  ema21: number;
  ema55: number;
  ema50?: number;
  ema200?: number;
  adx14?: number;
  cvdSlope?: number;
  vpPocPx?: number;
  smcBias?: 'BULL_BOS' | 'BEAR_BOS' | 'BULL_CHOCH' | 'BEAR_CHOCH' | 'NEUTRAL';
  atrPct: number;
  vwapDistPct: number;
  bbWidthPct: number;
  l2Imbalance: number;
  spreadBps: number;
  recommendedSlPct: number;
  recommendedTpPct: number;
  tp1Pct?: number;
  tp2Pct?: number;
  tp3Pct?: number;
  rrRatio?: number;
  validUntilMs?: number;
  timeframe?: string;
  antiChaseBlocked: boolean;
  sweepDirection?: 'LONG_SWEEP' | 'SHORT_SWEEP' | 'NONE';
  trapWarnings?: string[];
  reasons: string[];
}

export interface PositionManagementDecision {
  coin: string;
  side: 'LONG' | 'SHORT';
  size: number;
  action:
    | 'HOLD'
    | 'PARTIAL_TP1'
    | 'PARTIAL_TP2'
    | 'CLOSE_TP'
    | 'CLOSE_SL'
    | 'CLOSE_TRAILING'
    | 'CLOSE_INVALIDATION'
    | 'CLOSE_LIQ_GUARD';
  closeFraction?: number;
  stage?: number;
  movePct: number;
  peakMovePct: number;
  reason: string;
}

export interface PersistedPosition {
  id: string;
  ownerId: string;
  coin: string;
  side: 'LONG' | 'SHORT';
  size: number;
  entryPx: number;
  markPx: number;
  leverage: number;
  unrealizedPnl: number;
  realizedPnl: number;
  status: 'OPEN' | 'CLOSED';
  mode: TradingMode | 'manual';
  hlOrderId: string;
  thesis: string;
  strategyTag?: string;
  cloid?: string;
  isExternal?: boolean;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface TradeLogEntry {
  id: string;
  ownerId: string;
  level: 'INFO' | 'EXEC' | 'MEV_GUARD' | 'WARN' | 'ERROR';
  category: string;
  coin: string;
  message: string;
  latencyMs: number;
  createdAtMs: number;
}

export interface AiMemoryEntry {
  id: string;
  ownerId: string;
  coin: string;
  regime: string;
  outcome: 'WIN' | 'LOSS' | 'BREAKEVEN';
  pnlUsd: number;
  lesson: string;
  createdAtMs: number;
}

export interface ChatMessageEntry {
  id: string;
  ownerId: string;
  role: 'user' | 'assistant';
  content: string;
  modelUsed: string;
  createdAtMs: number;
}

export type HlExecutionRoute = 'HL-EXCHANGE-L1' | 'HL-DIRECT-L1' | 'TUG777-ENGINE';

export type OrderFillStatus = 'IDLE' | 'FILLED' | 'RESTING' | 'ACK_ONLY' | 'REJECTED' | 'MEV_BLOCKED';

export interface LatencyHistorySample {
  id: string;
  createdAtMs: number;
  coin: string;
  side: 'LONG' | 'SHORT';
  route: HlExecutionRoute;
  l2Ms: number;
  signMs: number;
  exchangeRttMs: number;
  e2eAckMs: number;
  fillVerifyMs: number;
  detectToSendMs?: number;
  detectToExecMs?: number;
  fillStatus: OrderFillStatus;
  outcome: 'CONFIRMED' | 'REJECTED' | 'MEV_BLOCKED';
}

export interface MevFilterAudit {
  spreadGuardOk: boolean;
  oracleGuardOk: boolean;
  depthGuardOk: boolean;
  bookSanityOk: boolean;
  lastAuditAtMs: number;
  summary: string;
}

export interface MevProbeStatus {
  channels: Array<{
    id?: string;
    name: string;
    scope?: 'HYPERLIQUID_INFO' | 'HYPERLIQUID_WS' | 'MCLOUD_API';
    ok: boolean;
    latencyMs: number;
    detail: string;
  }>;
  bestHlLatencyMs: number;
  wsConnected?: boolean;
  checkedAt: number;
}

export interface OrderExecutionTelemetry {
  activeRoute: HlExecutionRoute;
  lastCoin: string | null;
  lastSide: 'LONG' | 'SHORT' | null;
  lastStatus: 'IDLE' | 'CONFIRMED' | 'REJECTED' | 'MEV_BLOCKED';
  lastFillStatus: OrderFillStatus;
  lastL2PrecheckMs: number;
  lastSignMs: number;
  lastExchangeRttMs: number;
  lastE2eConfirmMs: number;
  lastFillVerifyMs: number;
  lastDetectToSendMs: number;
  lastDetectToExecMs: number;
  lastFilledAvgPx: number;
  lastRejectReason: string;
  avgConfirmMs: number;
  minConfirmMs: number;
  maxConfirmMs: number;
  avgDetectToExecMs: number;
  maxDetectToExecMs: number;
  baselineAvgMs: number;
  recent5AvgMs: number;
  degradationPct: number;
  degradationAlert: boolean;
  totalConfirmed: number;
  totalFilledConfirmed: number;
  totalAckOnly: number;
  totalRejected: number;
  totalMevEvaluated: number;
  totalBlockedByMev: number;
  lastSpreadBps: number;
  lastOracleDiffBps: number;
  lastDirectionalDepthUsd: number;
  lastMevReason: string;
  mevFilterAudit?: MevFilterAudit;
  updatedAtMs: number;
}

export interface AiBrainDecision {
  action: 'LONG' | 'SHORT' | 'CLOSE' | 'HOLD';
  coin: string;
  confidence: number;
  decisionBand?: DecisionBand;
  regime: string;
  reason: string;
  tpPct: number;
  slPct: number;
  tp1Pct?: number;
  tp2Pct?: number;
  tp3Pct?: number;
  modelUsed: string;
  strategiesUsed?: string[];
  optimizerNotes?: string;
  optimizedNotionalUsd?: number;
}

export interface EngineStateSnapshot {
  service: 'tug777-engine';
  enginePaused: boolean;
  pauseReason: string;
  network: HlNetwork;
  wsConnected: boolean;
  wsUrl: string;
  wsLatencyMs: number;
  lastWsEventAtMs: number;
  hlRestFallbackMs: number;
  signerConfigured: boolean;
  masterWalletAddress: string;
  mcloudConnected: boolean;
  mcloudUrl: string;
  mcloudLastStatus: string;
  streakCooldownUntilMs: number;
  scannedTokenCount: number;
  watchlistCoins: string[];
  selectedCoin: string;
  selectedInterval: '1m' | '5m' | '15m' | '1h' | '4h';
  markets: HlAssetMarket[];
  selectedL2Book: { bids: HlL2Level[]; asks: HlL2Level[] };
  l2LastError?: string | null;
  l2UpdatedAtMs?: number;
  selectedCandles: HlCandle[];
  accountSummary: HlAccountSummary | null;
  fills: HlUserFill[];
  lastDecision: AiBrainDecision | null;
  telemetry: OrderExecutionTelemetry;
  recentLogs: Array<{
    id: string;
    level: 'INFO' | 'EXEC' | 'MEV_GUARD' | 'WARN' | 'ERROR';
    category: string;
    coin: string;
    message: string;
    latencyMs: number;
    createdAtMs: number;
  }>;
  tugCloidsCount: number;
  tugOidsCount: number;
  config: BotConfigData;
  updatedAtMs: number;
}

export interface EngineWsMessage {
  type: 'snapshot' | 'mids_tick' | 'l2_tick' | 'candle_tick' | 'log' | 'pong';
  payload: unknown;
  ts: number;
}
