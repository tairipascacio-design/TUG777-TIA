export type TradingMode = 'strategy' | 'ai' | 'strategy_ai';
export type HlNetwork = 'mainnet' | 'testnet';

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

export interface MevProbeStatus {
  channels: Array<{
    name: string;
    ok: boolean;
    latencyMs: number;
    detail: string;
  }>;
  bestHlLatencyMs: number;
  flashbotsBlockHex: string | null;
  checkedAt: number;
}

export interface AiBrainDecision {
  action: 'LONG' | 'SHORT' | 'CLOSE' | 'HOLD';
  coin: string;
  confidence: number;
  regime: string;
  reason: string;
  tpPct: number;
  slPct: number;
  modelUsed: string;
}
