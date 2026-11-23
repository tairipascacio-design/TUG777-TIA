import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  Activity,
  Bot,
  Check,
  Cpu,
  Download,
  KeyRound,
  LogIn,
  LogOut,
  MessageSquare,
  Mic,
  MicOff,
  Power,
  Radar,
  Save,
  Search,
  ShieldCheck,
  Sliders,
  Volume2,
  VolumeX,
  XCircle,
} from 'lucide-react';
import { AiBrainParamsModal } from './components/AiBrainParamsModal';
import { AiCopilotDrawer } from './components/AiCopilotDrawer';
import { ApiWalletModal } from './components/ApiWalletModal';
import { DropletDeployView } from './components/DropletDeployView';
import { LiveCandleChart } from './components/LiveCandleChart';
import { LogsAndMemoryView } from './components/LogsAndMemoryView';
import { OrderBookPanel } from './components/OrderBookPanel';
import { PnlView } from './components/PnlView';
import { PositionsView } from './components/PositionsView';
import { WhaleBonusRadar } from './components/WhaleBonusRadar';
import {
  FIREBASE_AUTH_SETTINGS_URL,
  auth,
  checkRedirectAuthResult,
  signInWithGoogle,
  signOutUser,
  testFirestoreConnection,
} from './firebase';
import { usePWAInstall } from './hooks/usePWAInstall';
import {
  appendAiMemory,
  appendChatMessage,
  appendTradeLog,
  backfillLocalArchiveToFirestore,
  closePersistedPosition,
  createPersistedPosition,
  ensureUserProfileAndConfig,
  recordStrategyTradeOutcome,
  saveBotConfig,
  subscribeAiMemories,
  subscribeChatMessages,
  subscribePositions,
  subscribeStrategyPlaybook,
  subscribeTradeLogs,
  syncStrategyPlaybook,
  updateOpenPersistedPositionSize,
  updateStrategyPlaybookItem,
} from './services/firestoreService';
import {
  appendLatencySample,
  computeLatencyStats,
  loadLocalChat,
  loadLocalLatencyHistory,
  loadLocalLogs,
  loadLocalMemories,
  loadLocalPlaybook,
  loadLocalPositions,
  memoryFingerprint,
  mergeChatAdditive,
  mergeMemoriesAdditive,
  mergePositionsAdditive,
  mergeTradeLogsAdditive,
  saveLocalChat,
  saveLocalLogs,
  saveLocalMemories,
  saveLocalPlaybook,
  saveLocalPositions,
} from './services/localArchive';
import {
  auditMevShieldFilters,
  buildBackendApiUrl,
  connectEngineWebSocket,
  controlEngine,
  evaluateMevShield,
  executeRealHyperliquidOrder,
  fetchAllHyperliquidMarkets,
  fetchAllMids,
  fetchCandles,
  fetchClearinghouseState,
  fetchEngineState,
  fetchL2Book,
  fetchMevAndLatencyProbe,
  fetchUserFills,
  getActiveExecutionRoute,
  hasConfiguredBackendForApk,
  isRunningInEmbeddedApk,
  pushEngineConfig,
  resolveMasterFromAgentKey,
} from './services/hyperliquidClient';
import {
  MIN_ATTRIBUTABLE_TRADES,
  POSITION_MANAGEMENT_GUIDE_RULES,
  buildDbTradingHistorySummary,
  computeDynamicOrderNotionalUsd,
  evaluateOpenPositionManagement,
  evaluateProfessionalEntryGate,
  evaluateUnifiedDeepSetup,
  extractSeparatedLearningRules,
  formatDecisionBandLabel,
  getDecisionBand,
  optimizeEntryDecision,
  synthesizeStructuredLearningFromHistory,
} from './services/strategyEngine';
import type {
  AiBrainDecision,
  AiMemoryEntry,
  BiasLockMode,
  BotConfigData,
  ChatMessageEntry,
  DeepAssetAnalysis,
  EngineStateSnapshot,
  HlAccountSummary,
  HlAssetMarket,
  HlCandle,
  HlL2Level,
  HlUserFill,
  LatencyHistorySample,
  MevProbeStatus,
  OrderExecutionTelemetry,
  PersistedPosition,
  StrategyPlaybookItem,
  TradeLogEntry,
  TradingMode,
} from './types/trading';
import { isTug777Fill } from './utils/accounting';
import { downloadAndroidApkKit } from './utils/apkPackager';
import { formatSignedUsd } from './utils/formatters';
import { soundEngine } from './utils/soundEngine';
import { voiceEngine, type ParsedVoiceCommand } from './utils/voiceEngine';

type ActiveTab = 'terminal' | 'positions' | 'pnl' | 'logs' | 'droplet';

const INITIAL_CONFIG: BotConfigData = {
  ownerId: '',
  mode: 'strategy_ai',
  aiEnabled: false,
  network: 'mainnet',
  masterWalletAddress: '',
  mevShieldEnabled: true,
  maxSlippageBps: 15,
  maxOracleDeviationBps: 35,
  riskPerTradeUsd: 50,
  sizingMode: 'equity_pct',
  capitalPctPerTrade: 15,
  maxOpenPositions: 2,
  trailingStopEnabled: true,
  autoManagePositions: true,
  riskPerTradePct: 0.35,
  dailyMaxLossPct: 2.5,
  killSwitchEnabled: false,
  soundEnabled: true,
  aiProvider: 'gemini',
  geminiModel: 'auto',
  customAiUrl: '',
  customAiModel: '',
  customSystemPrompt: '',
  scanIntervalSec: 45,
  minConfidence: 65,
  minQuantScore: 65,
  minVolumeM: 5,
  tpPct: 3.5,
  slPct: 0.85,
  useDeepThinking: false,
  useSearchGrounding: false,
  globalBiasLock: 'AMBOS',
  pairBiasLocksJson: '{}',
  useAloEntries: false,
  minOrderUsdFloor: 12,
  streakCooldownHours: 3,
  watchlistCoinsCsv: 'BTC,ETH,SOL,HYPE',
  mcloudEnabled: true,
  mcloudUrl: 'https://mcloud-1036926196544.us-east1.run.app',
};

const WINNING_CALIBRATION_KEY = 'tug777_quant_v34';

function applyWinningCalibrationIfNeeded(cfg: BotConfigData): { cfg: BotConfigData; upgraded: boolean } {
  if (typeof window === 'undefined') return { cfg, upgraded: false };
  try {
    // Never overwrite user-saved settings once initialized!
    if (localStorage.getItem(WINNING_CALIBRATION_KEY) === '1') {
      return { cfg, upgraded: false };
    }
    localStorage.setItem(WINNING_CALIBRATION_KEY, '1');
    return { cfg, upgraded: false };
  } catch {
    return { cfg, upgraded: false };
  }
}

async function parseAiJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  const trimmed = text.trim();
  if (!trimmed || trimmed.startsWith('<')) {
    throw new Error(`El servidor devolvió HTML en lugar de JSON (HTTP ${res.status}).`);
  }
  return JSON.parse(trimmed) as T;
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [configSavedOk, setConfigSavedOk] = useState(false);
  const [config, setConfig] = useState<BotConfigData>(() => {
    if (typeof window === 'undefined') return INITIAL_CONFIG;
    try {
      const cached = localStorage.getItem('tug777_app_config');
      const base: BotConfigData = cached
        ? { ...INITIAL_CONFIG, ...JSON.parse(cached), aiEnabled: false }
        : INITIAL_CONFIG;
      return applyWinningCalibrationIfNeeded(base).cfg;
    } catch {
      return INITIAL_CONFIG;
    }
  });
  const [apiPrivateKey, setApiPrivateKey] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    return (
      sessionStorage.getItem('tug777_hl_agent_pk') ||
      localStorage.getItem('tug777_hl_agent_pk_saved') ||
      ''
    );
  });

  const [activeTab, setActiveTab] = useState<ActiveTab>('terminal');
  const [apiModalOpen, setApiModalOpen] = useState(false);
  const [aiParamsOpen, setAiParamsOpen] = useState(false);
  const [copilotOpen, setCopilotOpen] = useState(false);

  // Market State
  const [markets, setMarkets] = useState<HlAssetMarket[]>([]);
  const [selectedCoin, setSelectedCoin] = useState<string>('BTC');
  const [interval, setIntervalTf] = useState<'1m' | '5m' | '15m' | '1h' | '4h'>('15m');
  const [candles, setCandles] = useState<HlCandle[]>([]);
  const [candlesLoading, setCandlesLoading] = useState(false);
  const [l2Book, setL2Book] = useState<{ bids: HlL2Level[]; asks: HlL2Level[] }>({ bids: [], asks: [] });
  const [hlLatencyMs, setHlLatencyMs] = useState<number>(0);
  const [hlChannel, setHlChannel] = useState<string>('TUG777-ENGINE');
  const [engineWsConnected, setEngineWsConnected] = useState(false);
  const [engineSnapshot, setEngineSnapshot] = useState<EngineStateSnapshot | null>(null);
  const engineWsHandleRef = useRef<{
    close: () => void;
    sendSelectFeed: (coin: string, interval: '1m' | '5m' | '15m' | '1h' | '4h') => void;
  } | null>(null);
  const selectedCoinRef = useRef<string>(selectedCoin);
  selectedCoinRef.current = selectedCoin;
  const intervalRef = useRef<'1m' | '5m' | '15m' | '1h' | '4h'>(interval);
  intervalRef.current = interval;
  const [mevProbe, setMevProbe] = useState<MevProbeStatus | null>(null);
  const [latencyHistory, setLatencyHistory] = useState<LatencyHistorySample[]>(() =>
    loadLocalLatencyHistory()
  );
  const [orderTelemetry, setOrderTelemetry] = useState<OrderExecutionTelemetry>(() => {
    const fallbackRoute = getActiveExecutionRoute();
    const initialSamples = loadLocalLatencyHistory();
    const stats = computeLatencyStats(initialSamples);
    const base: OrderExecutionTelemetry = {
      activeRoute: fallbackRoute,
      lastCoin: null,
      lastSide: null,
      lastStatus: 'IDLE',
      lastFillStatus: 'IDLE',
      lastL2PrecheckMs: 0,
      lastSignMs: 0,
      lastExchangeRttMs: 0,
      lastE2eConfirmMs: 0,
      lastFillVerifyMs: 0,
      lastDetectToSendMs: 0,
      lastDetectToExecMs: 0,
      lastFilledAvgPx: 0,
      lastRejectReason: '',
      avgConfirmMs: stats.avgConfirmMs,
      minConfirmMs: stats.minConfirmMs,
      maxConfirmMs: stats.maxConfirmMs,
      avgDetectToExecMs: stats.avgDetectToExecMs,
      maxDetectToExecMs: stats.maxDetectToExecMs,
      baselineAvgMs: stats.baselineAvgMs,
      recent5AvgMs: stats.recent5AvgMs,
      degradationPct: stats.degradationPct,
      degradationAlert: stats.degradationAlert,
      totalConfirmed: stats.totalConfirmed,
      totalFilledConfirmed: stats.totalFilledConfirmed,
      totalAckOnly: stats.totalAckOnly,
      totalRejected: stats.totalRejected,
      totalMevEvaluated: stats.totalMevEvaluated,
      totalBlockedByMev: stats.totalBlockedByMev,
      lastSpreadBps: 0,
      lastOracleDiffBps: 0,
      lastDirectionalDepthUsd: 0,
      lastMevReason: `Listo para validar Spread, Oracle Δ y L2 Depth en ${fallbackRoute}`,
      updatedAtMs: 0,
    };
    if (typeof window === 'undefined') return base;
    try {
      const saved = localStorage.getItem('tug777_order_telemetry_v1');
      if (!saved) return base;
      const parsed = JSON.parse(saved) as Partial<OrderExecutionTelemetry>;
      return {
        ...base,
        ...parsed,
        activeRoute: fallbackRoute,
        // Always prioritize exact persistent latency stats over stale counters
        avgConfirmMs: stats.totalConfirmed > 0 ? stats.avgConfirmMs : parsed.avgConfirmMs ?? 0,
        minConfirmMs: stats.totalConfirmed > 0 ? stats.minConfirmMs : parsed.minConfirmMs ?? 0,
        maxConfirmMs: stats.totalConfirmed > 0 ? stats.maxConfirmMs : parsed.maxConfirmMs ?? 0,
        avgDetectToExecMs: stats.totalConfirmed > 0 ? stats.avgDetectToExecMs : parsed.avgDetectToExecMs ?? 0,
        maxDetectToExecMs: stats.totalConfirmed > 0 ? stats.maxDetectToExecMs : parsed.maxDetectToExecMs ?? 0,
        baselineAvgMs: stats.baselineAvgMs,
        recent5AvgMs: stats.recent5AvgMs,
        degradationPct: stats.degradationPct,
        degradationAlert: stats.degradationAlert,
        totalConfirmed: Math.max(stats.totalConfirmed, parsed.totalConfirmed ?? 0),
        totalFilledConfirmed: Math.max(stats.totalFilledConfirmed, parsed.totalFilledConfirmed ?? 0),
        totalAckOnly: Math.max(stats.totalAckOnly, parsed.totalAckOnly ?? 0),
        totalRejected: Math.max(stats.totalRejected, parsed.totalRejected ?? 0),
        totalBlockedByMev: Math.max(stats.totalBlockedByMev, parsed.totalBlockedByMev ?? 0),
        totalMevEvaluated: Math.max(stats.totalMevEvaluated, parsed.totalMevEvaluated ?? 0),
      };
    } catch {
      return base;
    }
  });

  const updateOrderTelemetry = useCallback(
    (updater: (prev: OrderExecutionTelemetry) => OrderExecutionTelemetry) => {
      setOrderTelemetry((prev) => {
        const next = updater(prev);
        try {
          localStorage.setItem('tug777_order_telemetry_v1', JSON.stringify(next));
        } catch {
          // ignore storage limits
        }
        return next;
      });
    },
    []
  );

  // Account & Persisted State
  const [accountSummary, setAccountSummary] = useState<HlAccountSummary | null>(null);
  const [userFills, setUserFills] = useState<HlUserFill[]>([]);
  const [syncingAccount, setSyncingAccount] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [persistedPositions, setPersistedPositions] = useState<PersistedPosition[]>(() =>
    loadLocalPositions()
  );
  const [tradeLogs, setTradeLogs] = useState<TradeLogEntry[]>(() => loadLocalLogs());
  const [aiMemories, setAiMemories] = useState<AiMemoryEntry[]>(() => loadLocalMemories());
  const [strategyPlaybook, setStrategyPlaybook] = useState<StrategyPlaybookItem[]>(() =>
    loadLocalPlaybook()
  );
  const [chatMessages, setChatMessages] = useState<ChatMessageEntry[]>(() => loadLocalChat());

  // Brain & Execution State
  const [tokenSearch, setTokenSearch] = useState('');
  const [biasFilter, setBiasFilter] = useState<'ALL' | 'LONG' | 'SHORT'>('ALL');
  const [executing, setExecuting] = useState(false);
  const [closingCoin, setClosingCoin] = useState<string | null>(null);
  const [closingAll, setClosingAll] = useState(false);
  const [brainThinking, setBrainThinking] = useState(false);
  const [learningHistory, setLearningHistory] = useState(false);
  const [lastDecision, setLastDecision] = useState<AiBrainDecision | null>(null);
  const [macroBrief, setMacroBrief] = useState<string>('');
  const [macroSources, setMacroSources] = useState<Array<{ uri: string; title: string }>>([]);
  const [statusNotice, setStatusNotice] = useState<{ type: 'info' | 'error' | 'ok'; text: string } | null>(null);
  const [chatSending, setChatSending] = useState(false);
  const peakMoveByCoinRef = useRef<Record<string, number>>({});
  const partialStageByCoinRef = useRef<Record<string, number>>({});
  const recentEntryZoneByCoinRef = useRef<Array<{ coin: string; px: number; ts: number }>>([]);
  const consecutiveExecErrorsRef = useRef<number>(0);
  const lastOrderSubmitMsRef = useRef<number>(0);
  const reconciledIdsRef = useRef<Set<string>>(new Set());
  const managingPositionsRef = useRef(false);
  const spokenMilestoneRef = useRef<Record<string, { breakeven: boolean; trailing: boolean }>>({});
  const candleCacheRef = useRef<Record<string, { ts: number; c15: HlCandle[]; c1h: HlCandle[] }>>({});
  const lastDeepAnalysesRef = useRef<Record<string, DeepAssetAnalysis>>({});
  const [killSwitchState, setKillSwitchState] = useState<{
    active: boolean;
    reason: string;
    triggeredAtMs: number;
  } | null>(null);

  // Voice Narrator (TTS) & Hands-Free Voice Commands (SpeechRecognition)
  const [voiceNarratorEnabled, setVoiceNarratorEnabled] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    const saved = localStorage.getItem('tug777_voice_narrator');
    return saved === null ? true : saved === 'true';
  });
  const [listeningVoice, setListeningVoice] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState('');
  const [voiceCommandLabel, setVoiceCommandLabel] = useState('');

  const { isInstallable, install: triggerPwaInstall } = usePWAInstall();

  const marketsByCoin = useMemo(() => {
    const map = new Map<string, HlAssetMarket>();
    markets.forEach((m) => map.set(m.coin, m));
    return map;
  }, [markets]);

  const selectedAsset = marketsByCoin.get(selectedCoin);

  const fillsSummary = useMemo(() => {
    const closed = userFills.filter((f) => Math.abs(f.closedPnl) > 0.0001);
    const totalFeesUsd = userFills.reduce((acc, f) => acc + f.fee, 0);
    const coinMap = new Map<string, { coin: string; netPnl: number; trades: number; wins: number; losses: number }>();
    let winsCount = 0;
    let netPnlUsd = 0;

    for (const f of closed) {
      const net = f.closedPnl - f.fee;
      netPnlUsd += net;
      if (net > 0) winsCount += 1;
      const cur = coinMap.get(f.coin) || { coin: f.coin, netPnl: 0, trades: 0, wins: 0, losses: 0 };
      cur.netPnl += net;
      cur.trades += 1;
      if (net > 0) cur.wins += 1;
      else cur.losses += 1;
      coinMap.set(f.coin, cur);
    }

    const coinStats = Array.from(coinMap.values());
    const losingCoins = [...coinStats]
      .filter((c) => c.netPnl < 0)
      .sort((a, b) => a.netPnl - b.netPnl)
      .slice(0, 5)
      .map((c) => ({ ...c, netPnl: Number(c.netPnl.toFixed(2)) }));
    const winningCoins = [...coinStats]
      .filter((c) => c.netPnl > 0)
      .sort((a, b) => b.netPnl - a.netPnl)
      .slice(0, 5)
      .map((c) => ({ ...c, netPnl: Number(c.netPnl.toFixed(2)) }));

    return {
      totalClosed: closed.length,
      winRatePct: closed.length > 0 ? Number(((winsCount / closed.length) * 100).toFixed(1)) : 0,
      netPnlUsd: Number(netPnlUsd.toFixed(2)),
      totalFeesUsd: Number(totalFeesUsd.toFixed(2)),
      losingCoins,
      winningCoins,
      recentClosed: closed.slice(0, 10).map((f) => ({
        coin: f.coin,
        side: f.side,
        netPnl: Number((f.closedPnl - f.fee).toFixed(2)),
        px: f.px,
        time: f.time,
      })),
    };
  }, [userFills]);

  const dbClosedHistory = useMemo(
    () =>
      buildDbTradingHistorySummary({
        persistedPositions,
        aiMemories,
        strategyPlaybook,
      }),
    [persistedPositions, aiMemories, strategyPlaybook]
  );

  // Daily Drawdown % (Realized since local midnight + Live Unrealized PnL vs Equity)
  const dailyDrawdownPct = useMemo(() => {
    const equity = accountSummary?.accountValue ?? 0;
    if (equity <= 0) return 0;
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const startMs = startOfDay.getTime();
    const todayFills = userFills.filter(
      (f) => f.time >= startMs && Math.abs(f.closedPnl) > 0.0001
    );
    const realizedToday =
      todayFills.length > 0
        ? todayFills.reduce((sum, f) => sum + (f.closedPnl - f.fee), 0)
        : persistedPositions
            .filter((p) => p.status === 'CLOSED' && p.updatedAtMs >= startMs)
            .reduce((sum, p) => sum + Number(p.realizedPnl || 0), 0);
    const unrealizedLive = (accountSummary?.positions || []).reduce(
      (sum, p) => sum + p.unrealizedPnl,
      0
    );
    const todayNet = realizedToday + unrealizedLive;
    if (todayNet >= 0) return 0;
    return Number(((Math.abs(todayNet) / equity) * 100).toFixed(2));
  }, [accountSummary, userFills, persistedPositions]);

  // Ref mirrors for stable intervals & auto-reconciliation
  const persistedPositionsRef = useRef(persistedPositions);
  persistedPositionsRef.current = persistedPositions;
  const marketsByCoinRef = useRef(marketsByCoin);
  marketsByCoinRef.current = marketsByCoin;

  // Sync Kill Switch state immediately whenever user disables Kill Switch or raises daily limit above current drawdown
  useEffect(() => {
    if (!config.killSwitchEnabled) {
      consecutiveExecErrorsRef.current = 0;
      setKillSwitchState((prev) => (prev ? null : prev));
      return;
    }
    const maxLoss = Math.max(0.1, config.dailyMaxLossPct ?? 1.8);
    if (killSwitchState?.active && dailyDrawdownPct < maxLoss && !killSwitchState.reason.includes('errores')) {
      setKillSwitchState(null);
    }
  }, [config.killSwitchEnabled, config.dailyMaxLossPct, dailyDrawdownPct, killSwitchState]);

  // Sync audio & voice preferences + known Hyperliquid tickers
  useEffect(() => {
    soundEngine.enabled = config.soundEnabled;
  }, [config.soundEnabled]);

  useEffect(() => {
    voiceEngine.voiceEnabled = voiceNarratorEnabled;
    try {
      localStorage.setItem('tug777_voice_narrator', String(voiceNarratorEnabled));
    } catch {
      // ignore storage errors
    }
    if (!voiceNarratorEnabled) {
      voiceEngine.stopSpeaking();
    }
  }, [voiceNarratorEnabled]);

  useEffect(() => {
    if (markets.length > 0) {
      voiceEngine.setKnownCoins(markets.map((m) => m.coin));
    }
  }, [markets]);

  useEffect(() => {
    return () => {
      voiceEngine.stopListening();
      voiceEngine.stopSpeaking();
    };
  }, []);

  // Firebase Connection & Auth Listener
  useEffect(() => {
    void testFirestoreConnection();
    void checkRedirectAuthResult();
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      setAuthReady(true);
      if (firebaseUser) {
        try {
          const loadedCfg = await ensureUserProfileAndConfig(firebaseUser);
          const calibratedLoaded = applyWinningCalibrationIfNeeded(loadedCfg);
          const finalLoadedCfg: BotConfigData = { ...calibratedLoaded.cfg, aiEnabled: false };
          setConfig(finalLoadedCfg);
          if (hasConfiguredBackendForApk()) {
            void pushEngineConfig(finalLoadedCfg, apiPrivateKey).catch(() => {});
          }
          if (calibratedLoaded.upgraded) {
            void saveBotConfig(firebaseUser.uid, {
              slPct: finalLoadedCfg.slPct,
              tpPct: finalLoadedCfg.tpPct,
              minConfidence: finalLoadedCfg.minConfidence,
              minQuantScore: finalLoadedCfg.minQuantScore,
              minVolumeM: finalLoadedCfg.minVolumeM,
              maxSlippageBps: finalLoadedCfg.maxSlippageBps,
              maxOracleDeviationBps: finalLoadedCfg.maxOracleDeviationBps,
              capitalPctPerTrade: finalLoadedCfg.capitalPctPerTrade,
              maxOpenPositions: finalLoadedCfg.maxOpenPositions,
              trailingStopEnabled: true,
              autoManagePositions: true,
            });
          }
          await syncStrategyPlaybook(firebaseUser.uid);
        } catch (err) {
          console.error(err);
        }
      }
    });
    return () => unsub();
  }, []);

  // Real-time Firestore Subscriptions with Additive Merge (never wipes previously saved positions or learnings)
  useEffect(() => {
    if (!authReady || !user) {
      return;
    }

    void backfillLocalArchiveToFirestore(
      user.uid,
      loadLocalPositions(),
      loadLocalMemories()
    ).catch((err) => console.error('Backfill archive error:', err));

    const unsubPos = subscribePositions(user.uid, (cloud) => {
      setPersistedPositions((prev) => {
        const merged = mergePositionsAdditive(cloud, prev);
        saveLocalPositions(merged);
        return merged;
      });
    });
    const unsubLogs = subscribeTradeLogs(user.uid, (cloud) => {
      setTradeLogs((prev) => {
        const merged = mergeTradeLogsAdditive(cloud, prev);
        saveLocalLogs(merged);
        return merged;
      });
    });
    const unsubMem = subscribeAiMemories(user.uid, (cloud) => {
      setAiMemories((prev) => {
        const merged = mergeMemoriesAdditive(cloud, prev);
        saveLocalMemories(merged);
        return merged;
      });
    });
    const unsubPlaybook = subscribeStrategyPlaybook(user.uid, (cloud) => {
      if (cloud.length > 0) {
        saveLocalPlaybook(cloud);
        setStrategyPlaybook(cloud);
      }
    });
    const unsubChat = subscribeChatMessages(user.uid, (cloud) => {
      setChatMessages((prev) => {
        const merged = mergeChatAdditive(cloud, prev);
        saveLocalChat(merged);
        return merged;
      });
    });

    return () => {
      unsubPos();
      unsubLogs();
      unsubMem();
      unsubPlaybook();
      unsubChat();
    };
  }, [authReady, user]);

  // Thin-Client Engine WebSocket & Snapshot Hydration (replaces 2.5s HTTP polling when connected)
  const applyEngineSnapshot = useCallback((snap: EngineStateSnapshot) => {
    setEngineSnapshot(snap);
    if (snap.markets && snap.markets.length > 0) {
      setMarkets(snap.markets);
    }
    if (snap.wsLatencyMs > 0) {
      setHlLatencyMs(snap.wsLatencyMs);
    } else if (snap.hlRestFallbackMs > 0) {
      setHlLatencyMs(snap.hlRestFallbackMs);
    }
    setHlChannel(snap.wsConnected ? 'HL-WS-LIVE' : 'TUG777-ENGINE');

    if (snap.selectedCoin === selectedCoinRef.current) {
      if (snap.selectedL2Book?.bids?.length || snap.selectedL2Book?.asks?.length) {
        setL2Book(snap.selectedL2Book);
      }
      if (snap.selectedInterval === intervalRef.current && snap.selectedCandles?.length) {
        setCandles(snap.selectedCandles);
        setCandlesLoading(false);
      }
    }
    if (snap.accountSummary) {
      setAccountSummary(snap.accountSummary);
      setLastSyncedAt(snap.updatedAtMs);
    }
    if (snap.fills && snap.fills.length > 0) {
      setUserFills(snap.fills);
    }
    if (snap.lastDecision) {
      setLastDecision(snap.lastDecision);
    }
    setConfig((prev) => {
      const nextAi = !snap.enginePaused && Boolean(snap.config?.aiEnabled);
      if (prev.aiEnabled === nextAi) return prev;
      return { ...prev, aiEnabled: nextAi };
    });
  }, []);

  useEffect(() => {
    if (!hasConfiguredBackendForApk()) return;
    let active = true;

    void fetchEngineState()
      .then((snap) => {
        if (active && snap) applyEngineSnapshot(snap);
      })
      .catch(() => {});

    const handle = connectEngineWebSocket({
      onStatusChange: (connected) => {
        if (active) setEngineWsConnected(connected);
      },
      onMessage: (msg) => {
        if (!active) return;
        if (msg.type === 'snapshot' && msg.payload) {
          applyEngineSnapshot(msg.payload as EngineStateSnapshot);
        } else if (msg.type === 'mids_tick' && msg.payload) {
          const mids = msg.payload as Record<string, number>;
          setMarkets((prev) =>
            prev.map((m) => {
              const px = mids[m.coin];
              if (!px || px <= 0) return m;
              const change24hPct = m.prevDayPx > 0 ? ((px - m.prevDayPx) / m.prevDayPx) * 100 : m.change24hPct;
              return { ...m, markPx: px, midPx: px, change24hPct };
            })
          );
          setAccountSummary((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              positions: prev.positions.map((pos) => {
                const px = mids[pos.coin];
                if (!px || px <= 0 || pos.entryPx <= 0) return pos;
                const unrealizedPnl =
                  (pos.side === 'LONG' ? px - pos.entryPx : pos.entryPx - px) * Math.abs(pos.szi);
                return { ...pos, unrealizedPnl };
              }),
            };
          });
        } else if (msg.type === 'l2_tick' && msg.payload) {
          const p = msg.payload as { coin: string; bids: HlL2Level[]; asks: HlL2Level[] };
          if (p.coin === selectedCoinRef.current) {
            setL2Book({ bids: p.bids || [], asks: p.asks || [] });
          }
        } else if (msg.type === 'candle_tick' && msg.payload) {
          const p = msg.payload as { coin: string; interval: string; candle: HlCandle };
          if (p.coin === selectedCoinRef.current && p.interval === intervalRef.current && p.candle) {
            setCandles((prev) => {
              const idx = prev.findIndex((c) => c.t === p.candle.t);
              if (idx >= 0) {
                const next = [...prev];
                next[idx] = p.candle;
                return next;
              }
              return [...prev, p.candle].sort((a, b) => a.t - b.t).slice(-120);
            });
          }
        } else if (msg.type === 'log' && msg.payload) {
          const l = msg.payload as {
            id: string;
            level: TradeLogEntry['level'];
            category: string;
            coin: string;
            message: string;
            latencyMs: number;
            createdAtMs: number;
          };
          setTradeLogs((prev) => {
            const entry: TradeLogEntry = { ...l, ownerId: 'tug777-engine' };
            const merged = mergeTradeLogsAdditive([entry], prev);
            saveLocalLogs(merged);
            return merged;
          });
        }
      },
    });
    engineWsHandleRef.current = handle;

    return () => {
      active = false;
      engineWsHandleRef.current = null;
      handle.close();
    };
  }, [applyEngineSnapshot]);

  // Propagate selected coin / interval to persistent engine WS feed
  useEffect(() => {
    engineWsHandleRef.current?.sendSelectFeed(selectedCoin, interval);
  }, [selectedCoin, interval]);

  // Fallback Hyperliquid Scanner (runs once on boot & every 15s only if engine WS is disconnected)
  const refreshMarkets = useCallback(async () => {
    try {
      const res = await fetchAllHyperliquidMarkets(config.network);
      setMarkets(res.markets);
      setHlLatencyMs(res.latencyMs);
      setHlChannel(res.channel);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn('Market poll transient retry:', msg);
    }
  }, [config.network]);

  useEffect(() => {
    if (!engineWsConnected) {
      void refreshMarkets();
    }
    const timer = setInterval(() => {
      if (!engineWsConnected) void refreshMarkets();
    }, 10000);
    return () => clearInterval(timer);
  }, [refreshMarkets, engineWsConnected]);

  // Live Candles & L2 Orderbook for selected coin (on coin/tf switch + fallback when WS disconnected)
  const refreshSelectedAssetFeed = useCallback(async () => {
    try {
      const [cData, bookData] = await Promise.all([
        fetchCandles(config.network, selectedCoin, interval, 96),
        fetchL2Book(config.network, selectedCoin),
      ]);
      setCandles(cData);
      setL2Book({ bids: bookData.bids, asks: bookData.asks });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn('Asset feed transient retry:', msg);
    }
  }, [config.network, selectedCoin, interval]);

  useEffect(() => {
    setCandlesLoading(true);
    void refreshSelectedAssetFeed().finally(() => setCandlesLoading(false));
    const timer = setInterval(() => {
      if (!engineWsConnected) void refreshSelectedAssetFeed();
    }, 6000);
    return () => clearInterval(timer);
  }, [refreshSelectedAssetFeed, engineWsConnected]);

  // Multi-Node Hyperliquid WS + Montana Cloud Probe (every 20s)
  useEffect(() => {
    const runProbe = async () => {
      try {
        const p = await fetchMevAndLatencyProbe(config.network);
        setMevProbe(p);
      } catch (err) {
        console.error('Probe error:', err);
      }
    };
    void runProbe();
    const timer = setInterval(() => void runProbe(), 20000);
    return () => clearInterval(timer);
  }, [config.network]);

  // Live Clearinghouse Account & Fills Sync (auto-resolves Master Address from Agent Key if needed)
  const refreshAccountData = useCallback(
    async (manualTrigger = false, overrideMasterAddress?: string, overridePrivKey?: string) => {
      let addr = (overrideMasterAddress ?? config.masterWalletAddress).trim();
      const keyToUse = (overridePrivKey ?? apiPrivateKey).trim();

      if ((!addr || !addr.startsWith('0x')) && keyToUse) {
        try {
          const resolved = await resolveMasterFromAgentKey(config.network, keyToUse);
          if (resolved.masterAddress) {
            addr = resolved.masterAddress;
            setConfig((prev) => {
              const next = { ...prev, masterWalletAddress: addr };
              try {
                localStorage.setItem('tug777_app_config', JSON.stringify(next));
              } catch {
                // ignore
              }
              return next;
            });
            if (user) {
              void saveBotConfig(user.uid, { masterWalletAddress: addr });
            }
          } else if (manualTrigger) {
            soundEngine.alert();
            voiceEngine.speak(
              'Oye chico, esa API Wallet todavía no tiene luz verde en Hyperliquid ni Master Address asignada.',
              true
            );
            setStatusNotice({
              type: 'info',
              text: `Tu API Wallet (${resolved.agentAddress.slice(0, 8)}...) aún no está autorizada en Hyperliquid o no tiene Master Address asignada. Ingrésala manualmente en "Conectar API Wallet".`,
            });
            setApiModalOpen(true);
            return;
          }
        } catch (err) {
          if (manualTrigger) {
            setStatusNotice({
              type: 'error',
              text: `No se pudo derivar Master Address: ${err instanceof Error ? err.message : String(err)}`,
            });
          }
        }
      }

      if (!addr || !addr.startsWith('0x')) {
        setAccountSummary(null);
        setUserFills([]);
        if (manualTrigger) {
          soundEngine.alert();
          voiceEngine.speak(
            'Pon tu Master Wallet Address primero, socio, si no cómo contamos la plata de Hyperliquid.',
            true
          );
          setStatusNotice({
            type: 'info',
            text: 'Ingresa tu Master Wallet Address (0x...) en "Conectar API Wallet" para actualizar tus posiciones de Hyperliquid.',
          });
          setApiModalOpen(true);
        }
        return;
      }

      if (manualTrigger) setSyncingAccount(true);
      const t0 = performance.now();
      try {
        const [summary, fills] = await Promise.all([
          fetchClearinghouseState(config.network, addr),
          fetchUserFills(config.network, addr),
          refreshMarkets(),
        ]);
        setAccountSummary(summary);
        setUserFills(fills);
        setLastSyncedAt(Date.now());

        // Auto-Reconcile OPEN persistedPositions that vanished from live Hyperliquid positions (e.g. external fill / liquidation / manual web close)
        if (Date.now() - lastOrderSubmitMsRef.current > 20_000) {
          const liveCoins = new Set(summary.positions.map((lp) => lp.coin));
          const vanishedOpen = persistedPositionsRef.current.filter(
            (p) =>
              p.status === 'OPEN' &&
              !liveCoins.has(p.coin) &&
              !reconciledIdsRef.current.has(p.id) &&
              Date.now() - p.createdAtMs > 25_000
          );

          for (const vPos of vanishedOpen) {
            reconciledIdsRef.current.add(vPos.id);
            const matchedFills = fills.filter(
              (f) => f.coin === vPos.coin && f.time >= vPos.createdAtMs - 10_000 && Math.abs(f.closedPnl) > 0.0001
            );
            const exitPx =
              matchedFills[0]?.px ??
              marketsByCoinRef.current.get(vPos.coin)?.markPx ??
              vPos.markPx;
            const realized =
              matchedFills.length > 0
                ? matchedFills.reduce((sum, f) => sum + (f.closedPnl - f.fee), 0)
                : (vPos.side === 'LONG' ? exitPx - vPos.entryPx : vPos.entryPx - exitPx) * vPos.size;

            delete partialStageByCoinRef.current[vPos.coin];
            delete peakMoveByCoinRef.current[vPos.coin];
            delete spokenMilestoneRef.current[vPos.coin];

            if (user && !vPos.id.startsWith('local-')) {
              void closePersistedPosition(user.uid, vPos.id, exitPx, realized);
            }
            setPersistedPositions((prev) => {
              const updated = prev.map((p) =>
                p.id === vPos.id
                  ? {
                      ...p,
                      status: 'CLOSED' as const,
                      markPx: exitPx,
                      realizedPnl: realized,
                      unrealizedPnl: 0,
                      updatedAtMs: Date.now(),
                    }
                  : p
              );
              saveLocalPositions(updated);
              return updated;
            });

            if (vPos.strategyTag) {
              const stratIds = vPos.strategyTag.split(',').filter(Boolean);
              if (user) {
                void recordStrategyTradeOutcome(user.uid, stratIds, realized);
              }
            }

            const isW = realized >= 0.05;
            const isL = realized <= -0.05;
            const deepSnap = lastDeepAnalysesRef.current[vPos.coin];
            const lesson7Pts = [
              `1) Motivo entrada: ${vPos.side} ${vPos.coin} (${vPos.thesis.slice(0, 60)})`,
              `2) Condiciones: ${deepSnap ? `${deepSnap.regime} RSI ${deepSnap.rsi14.toFixed(0)} ADX ${deepSnap.adx14 ?? '--'}` : 'Mercado vivo HL'}`,
              `3) Estrategia: ${vPos.strategyTag || 'N/A'}`,
              `4) Precio entrada→salida: $${vPos.entryPx.toFixed(4)} → $${exitPx.toFixed(4)}`,
              `5) Razón cierre: Reconciliación automática HL (fill externo/exchange)`,
              `6) PnL: ${realized >= 0 ? '+' : ''}$${realized.toFixed(2)}`,
              `7) Mejora: ${isL ? 'Exigir banda >=65 pts + confirmación CVD/L2.' : 'Mantener gestión TP1/TP2 + trailing.'}`,
            ].join(' | ');
            const memEntry: Omit<AiMemoryEntry, 'id' | 'ownerId' | 'createdAtMs'> = {
              coin: vPos.coin,
              regime: isL ? 'NO_ENTRAR: Reconciliado Pérdida' : isW ? 'SI_ENTRAR: Reconciliado Win' : 'Reconciliado BE',
              outcome: isW ? 'WIN' : isL ? 'LOSS' : 'BREAKEVEN',
              pnlUsd: Number(realized.toFixed(2)),
              lesson: lesson7Pts.slice(0, 320),
            };
            if (user) {
              void appendAiMemory(user.uid, memEntry);
            }
            const localRec: AiMemoryEntry = {
              id: `rec-mem-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              ownerId: user?.uid || 'local',
              ...memEntry,
              createdAtMs: Date.now(),
            };
            setAiMemories((prev) => {
              const merged = mergeMemoriesAdditive([localRec], prev);
              saveLocalMemories(merged);
              return merged;
            });
          }
        }

        if (manualTrigger) {
          soundEngine.tradeExecuted();
          voiceEngine.speak(
            `¡Listo socio! Cuentas cuadradas: ${summary.accountValue.toFixed(0)} dólares de capital y ${summary.positions.length} posiciones vivas en Hyperliquid.`,
            true
          );
          setStatusNotice({
            type: 'ok',
            text: `Posiciones actualizadas (${Math.round(performance.now() - t0)} ms) · Equity $${summary.accountValue.toFixed(2)} · ${summary.positions.length} abiertas en Hyperliquid ${config.network.toUpperCase()}.`,
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (manualTrigger) {
          console.error('Clearinghouse error:', msg);
          soundEngine.alert();
          voiceEngine.speak(`¡Qué desastre chico! Falló al bajar las posiciones: ${msg}`, true);
          setStatusNotice({
            type: 'error',
            text: `Error actualizando posiciones de Hyperliquid: ${msg}`,
          });
        } else {
          console.warn('Clearinghouse transient retry:', msg);
        }
      } finally {
        if (manualTrigger) setSyncingAccount(false);
      }
    },
    [config.network, config.masterWalletAddress, apiPrivateKey, user, refreshMarkets]
  );

  useEffect(() => {
    void refreshAccountData(false);
    const timer = setInterval(() => {
      if (!engineWsConnected) void refreshAccountData(false);
    }, 10000);
    return () => clearInterval(timer);
  }, [refreshAccountData, engineWsConnected]);

  const logEvent = useCallback(
    async (
      level: TradeLogEntry['level'],
      category: string,
      coin: string,
      message: string,
      latencyMs = 0
    ) => {
      const localEntry: TradeLogEntry = {
        id: `local-log-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        ownerId: user?.uid || 'local',
        level,
        category,
        coin,
        message,
        latencyMs,
        createdAtMs: Date.now(),
      };
      setTradeLogs((prev) => {
        const merged = mergeTradeLogsAdditive([localEntry], prev);
        saveLocalLogs(merged);
        return merged;
      });
      if (user) {
        try {
          await appendTradeLog(user.uid, { level, category, coin, message, latencyMs });
        } catch (err) {
          console.error('Log write error:', err);
        }
      }
    },
    [user]
  );

  const handleSetEngineActive = useCallback(
    async (nextActive: boolean) => {
      const nextCfg = { ...config, aiEnabled: nextActive };
      setConfig(nextCfg);
      try {
        localStorage.setItem('tug777_app_config', JSON.stringify(nextCfg));
      } catch {
        // ignore
      }
      if (hasConfiguredBackendForApk()) {
        try {
          const ctrl = await controlEngine(nextActive ? 'START' : 'PAUSE');
          if (ctrl.snapshot) {
            applyEngineSnapshot(ctrl.snapshot);
          }
          if (!ctrl.ok && ctrl.error) {
            setStatusNotice({ type: 'error', text: ctrl.error });
          }
        } catch (err) {
          console.error('Engine control error:', err);
        }
      }
      if (user) {
        void saveBotConfig(user.uid, { aiEnabled: nextActive }).catch(() => {});
      }
    },
    [config, user, applyEngineSnapshot]
  );

  const updateConfigPatch = async (patch: Partial<BotConfigData>) => {
    // Safety invariant: saving configuration resets trading to PAUSED until explicit activation
    const isOnlySound =
      Object.keys(patch).length === 1 && typeof patch.soundEnabled === 'boolean';
    const nextPatch: Partial<BotConfigData> = isOnlySound
      ? patch
      : { ...patch, aiEnabled: false };

    let nextFull: BotConfigData = { ...config, ...nextPatch };
    setConfig((prev) => {
      nextFull = { ...prev, ...nextPatch };
      try {
        localStorage.setItem('tug777_app_config', JSON.stringify(nextFull));
      } catch {
        // ignore storage limits
      }
      return nextFull;
    });
    if (!isOnlySound && hasConfiguredBackendForApk()) {
      void pushEngineConfig(nextPatch, apiPrivateKey)
        .then((res) => {
          if (res?.snapshot) applyEngineSnapshot(res.snapshot);
        })
        .catch((err) => console.error('Engine config sync warning:', err));
    }
    if (user) {
      try {
        await saveBotConfig(user.uid, nextPatch);
      } catch (err) {
        console.error('Firestore config sync warning:', err);
      }
    }
  };

  const handleGoogleOAuthSignIn = async () => {
    soundEngine.click();
    setOauthLoading(true);
    try {
      const cred = await signInWithGoogle();
      if (!cred) return;
      soundEngine.tradeExecuted();
      const name = cred.user.displayName?.split(' ')[0] || cred.user.email || 'Socio';
      voiceEngine.speak(`¡Bienvenido ${name}! Ya estás adentro, chico. El mundo es tuyo.`, true);
      setStatusNotice({
        type: 'ok',
        text: `Sesión OAuth iniciada como ${cred.user.email || cred.user.displayName || 'Trader'}. Sincronizando Firestore...`,
      });
    } catch (err) {
      soundEngine.alert();
      const msg = err instanceof Error ? err.message : String(err);
      const currentHost = typeof window !== 'undefined' ? window.location.hostname : '';
      if (msg.includes('auth/unauthorized-domain')) {
        voiceEngine.speak(
          `¡Oye socio! El dominio ${currentHost} no tiene permiso en Firebase Auth.`,
          true
        );
        setStatusNotice({
          type: 'error',
          text: `Dominio "${currentHost}" no autorizado en Firebase Auth. Si usas Droplet/dominio propio, agrégalo en Firebase Console > Authentication > Settings > Authorized domains (${FIREBASE_AUTH_SETTINGS_URL}). Si estás en AI Studio, recarga la página e intenta de nuevo.`,
        });
      } else {
        voiceEngine.speak('¡Maldita sea! Falló la entrada con Google, socio.', true);
        setStatusNotice({
          type: 'error',
          text: `Error en Google OAuth: ${msg}. Verifica que los popups estén permitidos.`,
        });
      }
    } finally {
      setOauthLoading(false);
    }
  };

  const handleSaveAppConfig = useCallback(async () => {
    soundEngine.click();
    setSavingConfig(true);
    try {
      const safeConfig: BotConfigData = { ...config, aiEnabled: false };
      setConfig(safeConfig);
      localStorage.setItem('tug777_app_config', JSON.stringify(safeConfig));
      saveLocalPositions(persistedPositions);
      saveLocalMemories(aiMemories);
      saveLocalPlaybook(strategyPlaybook);
      if (hasConfiguredBackendForApk()) {
        const res = await pushEngineConfig(safeConfig, apiPrivateKey).catch(() => null);
        if (res?.snapshot) applyEngineSnapshot(res.snapshot);
      }
      if (user) {
        await saveBotConfig(user.uid, safeConfig);
        const synced = await backfillLocalArchiveToFirestore(
          user.uid,
          persistedPositions,
          aiMemories
        );
        soundEngine.tradeExecuted();
        voiceEngine.speak('¡Todo sellado en la bóveda de Firestore y el motor puesto en pausa segura, socio!', true);
        setConfigSavedOk(true);
        const extraNote =
          synced.addedPositions + synced.addedMemories > 0
            ? ` (+${synced.addedPositions} posiciones y +${synced.addedMemories} lecciones adheridas a Firestore)`
            : ' (posiciones y aprendizajes previos intactos)';
        setStatusNotice({
          type: 'ok',
          text: `Configuración guardada en Firestore + tug777-engine en PAUSA segura${extraNote}. Activa el motor cuando estés listo.`,
        });
      } else {
        soundEngine.tradeExecuted();
        voiceEngine.speak('¡Guardado aquí en el búnker local y motor en pausa segura, chico!', true);
        setConfigSavedOk(true);
        setStatusNotice({
          type: 'info',
          text: `Configuración (${persistedPositions.length} posiciones · ${aiMemories.length} lecciones) guardada + motor en PAUSA. Actívalo manualmente para operar.`,
        });
      }
      setTimeout(() => setConfigSavedOk(false), 2500);
    } catch (err) {
      soundEngine.alert();
      voiceEngine.speak('¡Caramba! No se pudo guardar la configuración, revisa la conexión.', true);
      setStatusNotice({
        type: 'error',
        text: `No se pudo guardar la configuración: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setSavingConfig(false);
    }
  }, [config, user, persistedPositions, aiMemories, strategyPlaybook, apiPrivateKey, applyEngineSnapshot]);

  const handleUpdateStrategy = useCallback(
    (strategyId: string, patch: { enabled?: boolean; weight?: number }) => {
      setStrategyPlaybook((prev) => {
        const next = prev.map((s) =>
          s.strategyId === strategyId
            ? {
                ...s,
                ...(typeof patch.enabled === 'boolean' ? { enabled: patch.enabled } : {}),
                ...(typeof patch.weight === 'number'
                  ? { weight: Number(Math.max(0.3, Math.min(2.5, patch.weight)).toFixed(2)) }
                  : {}),
                updatedAtMs: Date.now(),
              }
            : s
        );
        saveLocalPlaybook(next);
        return next;
      });
      if (user) {
        void updateStrategyPlaybookItem(user.uid, strategyId, patch);
      }
    },
    [user]
  );

  const handleAutoCalibrateStrategies = useCallback(() => {
    let calibratedCount = 0;
    let skippedLowSample = 0;
    setStrategyPlaybook((prev) => {
      const next = prev.map((s) => {
        const total = s.wins + s.losses;
        // Honest weight discipline: never calibrate 0W/0L or <5 attributable trades as proven edge!
        if (total < MIN_ATTRIBUTABLE_TRADES) {
          skippedLowSample += 1;
          if (s.weight !== 1.0) {
            if (user) {
              void updateStrategyPlaybookItem(user.uid, s.strategyId, { weight: 1.0 });
            }
            return { ...s, weight: 1.0, updatedAtMs: Date.now() };
          }
          return s;
        }
        calibratedCount += 1;
        const wr = s.wins / total;
        if (wr < 0.35 && s.totalPnlUsd < 0) {
          if (user) {
            void updateStrategyPlaybookItem(user.uid, s.strategyId, { weight: 0.45, enabled: false });
          }
          return { ...s, weight: 0.45, enabled: false, updatedAtMs: Date.now() };
        }
        const pnlBias = s.totalPnlUsd >= 0 ? 0.12 : -0.14;
        const rawWeight = 0.85 + wr * 0.70 + pnlBias;
        const calibrated = Number(Math.max(0.4, Math.min(2.0, rawWeight)).toFixed(2));
        if (user) {
          void updateStrategyPlaybookItem(user.uid, s.strategyId, { weight: calibrated });
        }
        return { ...s, weight: calibrated, updatedAtMs: Date.now() };
      });
      saveLocalPlaybook(next);
      return next;
    });
    soundEngine.tradeExecuted();
    voiceEngine.speak(
      calibratedCount > 0
        ? `¡Calibración honesta lista, socio! ${calibratedCount} estrategias demostradas ajustadas y ${skippedLowSample} quedan en peso neutro hasta juntar cinco trades.`
        : '¡Oye chico! Ninguna estrategia tiene cinco operaciones atribuibles todavía; todas siguen en peso neutro uno punto cero.',
      true
    );
    setStatusNotice({
      type: calibratedCount > 0 ? 'ok' : 'info',
      text:
        calibratedCount > 0
          ? `Calibración honesta: ${calibratedCount} estrategia(s) con >=${MIN_ATTRIBUTABLE_TRADES} ops ajustadas · ${skippedLowSample} mantenidas en 1.00x (muestra insuficiente).`
          : `Sin cambios agresivos: las estrategias requieren >=${MIN_ATTRIBUTABLE_TRADES} trades atribuibles para calibrar su peso real (actualmente en 1.00x neutro).`,
    });
  }, [user]);

  const handleResetStrategyWeights = useCallback(() => {
    setStrategyPlaybook((prev) => {
      const next = prev.map((s) => {
        if (user) {
          void updateStrategyPlaybookItem(user.uid, s.strategyId, { weight: 1.0, enabled: true });
        }
        return { ...s, weight: 1.0, enabled: true, updatedAtMs: Date.now() };
      });
      saveLocalPlaybook(next);
      return next;
    });
    soundEngine.click();
    voiceEngine.speak('Todas las estrategias reiniciadas en peso uno punto cero, listas para pelear.', true);
  }, [user]);

  const handleAuditMevFilters = useCallback(async () => {
    soundEngine.click();
    const asset = marketsByCoin.get(selectedCoin);
    if (!asset) return;
    let freshBids = l2Book.bids;
    let freshAsks = l2Book.asks;
    try {
      const fresh = await fetchL2Book(config.network, selectedCoin);
      freshBids = fresh.bids;
      freshAsks = fresh.asks;
    } catch {
      // use cached L2 book
    }
    const audit = auditMevShieldFilters({
      enabled: config.mevShieldEnabled,
      executionRoute: orderTelemetry.activeRoute,
      markPx: asset.markPx,
      oraclePx: asset.oraclePx,
      bids: freshBids,
      asks: freshAsks,
      notionalUsd: computeDynamicOrderNotionalUsd({ config, accountSummary, asset }),
      maxSlippageBps: config.maxSlippageBps,
      maxOracleDeviationBps: config.maxOracleDeviationBps,
    });
    updateOrderTelemetry((prev) => ({
      ...prev,
      mevFilterAudit: audit,
      updatedAtMs: Date.now(),
    }));
    await logEvent('MEV_GUARD', 'MEV_AUDIT', selectedCoin, audit.summary);
    voiceEngine.speak(`Auditoría anti M E V en ${selectedCoin} lista, socio: ${audit.summary}`, true);
    setStatusNotice({ type: config.mevShieldEnabled ? 'ok' : 'info', text: audit.summary });
  }, [
    marketsByCoin,
    selectedCoin,
    l2Book,
    config,
    orderTelemetry.activeRoute,
    accountSummary,
    updateOrderTelemetry,
    logEvent,
  ]);

  // Persistent latency history recorder (append-only up to 500 samples) + degradation detector
  const recordOrderLatencyMetric = useCallback(
    (sample: Omit<LatencyHistorySample, 'id' | 'createdAtMs'>) => {
      const fullSample: LatencyHistorySample = {
        id: `lat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        createdAtMs: Date.now(),
        ...sample,
      };
      const updatedSamples = appendLatencySample(loadLocalLatencyHistory(), fullSample);
      setLatencyHistory(updatedSamples);
      return computeLatencyStats(updatedSamples);
    },
    []
  );

  // Real Order Execution Pipeline with Anti-MEV Guard + Detect->Send->Exec Latency Measurement
  const submitProtectedOrder = useCallback(
    async (params: {
      coin: string;
      side: 'LONG' | 'SHORT';
      notionalUsd: number;
      mode: TradingMode | 'manual';
      thesis: string;
      strategyTag?: string;
      reduceOnly?: boolean;
      overrideSizeCoins?: number;
      detectedPerfNow?: number;
      skipL2Precheck?: boolean;
      overrideRefPx?: number;
    }): Promise<boolean> => {
      const originPerfNow = params.detectedPerfNow ?? performance.now();
      const asset = marketsByCoin.get(params.coin);
      if (!asset) {
        voiceEngine.speak(`¡Oye socio! El token ${params.coin} no aparece en Hyperliquid.`, true);
        setStatusNotice({ type: 'error', text: `Token ${params.coin} no encontrado en Hyperliquid.` });
        return false;
      }

      if (!apiPrivateKey.trim()) {
        soundEngine.alert();
        voiceEngine.speak('¡Chico! Mete tu llave privada de API Wallet para disparar órdenes reales.', true);
        setStatusNotice({
          type: 'error',
          text: 'Ingresa tu API Wallet Private Key para ejecutar órdenes reales en Hyperliquid.',
        });
        setApiModalOpen(true);
        return false;
      }

      setExecuting(true);
      voiceEngine.speak(
        params.reduceOnly
          ? `¡Cerrando posición en ${params.coin}, socio! Vamos por esa plata.`
          : `Checando el escudo anti M E V para meter ${params.side} en ${params.coin}.`
      );
      try {
        const activeRoute = getActiveExecutionRoute();
        let freshBook: { bids: HlL2Level[]; asks: HlL2Level[]; latencyMs: number } | null = null;
        if (!(params.reduceOnly && params.skipL2Precheck)) {
          try {
            freshBook = await fetchL2Book(config.network, params.coin);
          } catch {
            freshBook = null;
          }
        }

        let lastSpreadBps = 0;
        let lastOracleDiffBps = 0;
        let lastDirectionalDepthUsd = 0;
        let lastMevReason = `Ruta ${activeRoute} · Salida reduceOnly prioritaria`;

        if (!params.reduceOnly) {
          if (!freshBook) {
            throw new Error(`No se pudo verificar libro L2 en ${activeRoute} para abrir ${params.coin}.`);
          }
          const mevCheck = evaluateMevShield({
            enabled: config.mevShieldEnabled,
            side: params.side,
            executionRoute: activeRoute,
            markPx: asset.markPx,
            oraclePx: asset.oraclePx,
            bids: freshBook.bids,
            asks: freshBook.asks,
            notionalUsd: params.notionalUsd,
            maxSlippageBps: config.maxSlippageBps,
            maxOracleDeviationBps: config.maxOracleDeviationBps,
          });

          lastSpreadBps = mevCheck.spreadBps;
          lastOracleDiffBps = mevCheck.oracleDiffBps;
          lastDirectionalDepthUsd = mevCheck.directionalDepthUsd;
          lastMevReason = mevCheck.reason;

          await logEvent('MEV_GUARD', 'ANTI_MEV', params.coin, mevCheck.reason, freshBook.latencyMs);

          if (!mevCheck.passed) {
            const blockedDetectMs = Math.max(1, Math.round(performance.now() - originPerfNow));
            const nextSamplesStats = recordOrderLatencyMetric({
              coin: params.coin,
              side: params.side,
              e2eAckMs: freshBook.latencyMs,
              exchangeRttMs: 0,
              l2Ms: freshBook.latencyMs,
              signMs: 0,
              fillVerifyMs: 0,
              detectToSendMs: blockedDetectMs,
              detectToExecMs: blockedDetectMs,
              outcome: 'MEV_BLOCKED',
              fillStatus: 'MEV_BLOCKED',
              route: activeRoute,
            });
            updateOrderTelemetry((prev) => ({
              ...prev,
              activeRoute,
              lastCoin: params.coin,
              lastSide: params.side,
              lastStatus: 'MEV_BLOCKED',
              lastFillStatus: 'IDLE',
              lastL2PrecheckMs: freshBook?.latencyMs ?? 0,
              lastDetectToSendMs: blockedDetectMs,
              lastDetectToExecMs: blockedDetectMs,
              avgDetectToExecMs: nextSamplesStats.avgDetectToExecMs,
              maxDetectToExecMs: nextSamplesStats.maxDetectToExecMs,
              lastRejectReason: mevCheck.reason,
              totalMevEvaluated: prev.totalMevEvaluated + 1,
              totalBlockedByMev: prev.totalBlockedByMev + 1,
              baselineAvgMs: nextSamplesStats.baselineAvgMs,
              recent5AvgMs: nextSamplesStats.recent5AvgMs,
              degradationPct: nextSamplesStats.degradationPct,
              degradationAlert: nextSamplesStats.degradationAlert,
              lastSpreadBps: mevCheck.spreadBps,
              lastOracleDiffBps: mevCheck.oracleDiffBps,
              lastDirectionalDepthUsd: mevCheck.directionalDepthUsd,
              lastMevReason: mevCheck.reason,
              updatedAtMs: Date.now(),
            }));
            soundEngine.alert();
            voiceEngine.speak(
              `¡Alto ahí socio! Escudo M E V bloqueó ${params.coin}, no vamos a regalarle ni un centavo a los tiburones.`,
              true
            );
            setStatusNotice({ type: 'error', text: `Orden bloqueada por Escudo MEV: ${mevCheck.reason}` });
            return false;
          }
          voiceEngine.speak(
            `Escudo M E V limpio en ${params.coin}. ¡Disparando ${params.side} al mercado, chico!`
          );
        } else {
          await logEvent(
            'MEV_GUARD',
            'CLOSE_BYPASS',
            params.coin,
            `[${activeRoute}] Salida reduceOnly prioritaria${params.skipL2Precheck ? ' (express sin bloqueo L2)' : ''}`,
            freshBook?.latencyMs ?? 0
          );
        }

        const fallbackPx = params.overrideRefPx && params.overrideRefPx > 0 ? params.overrideRefPx : asset.markPx;
        const freshBestPx = freshBook
          ? params.side === 'LONG'
            ? freshBook.asks[0]?.px || fallbackPx
            : freshBook.bids[0]?.px || fallbackPx
          : fallbackPx;
        const effectiveSlippageBps = Math.max(100, Math.min(150, Math.round(config.maxSlippageBps || 120)));

        const sizeCoins = params.overrideSizeCoins ?? params.notionalUsd / freshBestPx;
        const detectToSendMs = Math.max(1, Math.round(performance.now() - originPerfNow));
        lastOrderSubmitMsRef.current = Date.now();
        const execResult = await executeRealHyperliquidOrder({
          network: config.network,
          apiPrivateKey,
          assetIndex: asset.index,
          szDecimals: asset.szDecimals,
          isBuy: params.side === 'LONG',
          referencePx: freshBestPx,
          sizeCoins,
          slippageBps: effectiveSlippageBps,
          reduceOnly: params.reduceOnly,
          useAlo: Boolean(config.useAloEntries) && !params.reduceOnly,
          nativeTpsl:
            !params.reduceOnly && config.slPct > 0 && config.tpPct > 0
              ? { slPct: config.slPct, tpPct: config.tpPct }
              : undefined,
        });
        const detectToExecMs = Math.max(detectToSendMs, Math.round(performance.now() - originPerfNow));

        const hasHlError = execResult.fillStatus === 'REJECTED' || Boolean(execResult.rejectReason);
        const readableErr = execResult.rejectReason || JSON.stringify(execResult.exchangeResponse);

        if (hasHlError) {
          if (!params.reduceOnly && Boolean(config.killSwitchEnabled)) {
            consecutiveExecErrorsRef.current += 1;
            if (consecutiveExecErrorsRef.current >= 3) {
              const ksReason = `Kill Switch ejecutado: 3 rechazos consecutivos en Hyperliquid (${params.coin}: ${readableErr.slice(0, 70)}). Puedes desactivar Kill Switch en 1 toque.`;
              setKillSwitchState({ active: true, reason: ksReason, triggeredAtMs: Date.now() });
              voiceEngine.speak(
                '¡Ojo socio! Tres errores seguidos en Hyperliquid. Aviso de Kill Switch listo, tú decides si sigues o cierras.',
                true
              );
            }
          }
          const stats = recordOrderLatencyMetric({
            coin: params.coin,
            side: params.side,
            e2eAckMs: execResult.e2eAckMs,
            exchangeRttMs: execResult.exchangeRttMs,
            l2Ms: freshBook?.latencyMs ?? 0,
            signMs: execResult.signMs,
            fillVerifyMs: execResult.fillVerifyMs,
            detectToSendMs,
            detectToExecMs,
            outcome: 'REJECTED',
            fillStatus: 'REJECTED',
            route: execResult.channel,
          });
          updateOrderTelemetry((prev) => ({
            ...prev,
            activeRoute: execResult.channel,
            lastCoin: params.coin,
            lastSide: params.side,
            lastStatus: 'REJECTED',
            lastFillStatus: 'REJECTED',
            lastL2PrecheckMs: freshBook?.latencyMs ?? 0,
            lastSignMs: execResult.signMs,
            lastExchangeRttMs: execResult.exchangeRttMs,
            lastE2eConfirmMs: execResult.e2eAckMs,
            lastFillVerifyMs: execResult.fillVerifyMs,
            lastDetectToSendMs: detectToSendMs,
            lastDetectToExecMs: detectToExecMs,
            avgDetectToExecMs: stats.avgDetectToExecMs || prev.avgDetectToExecMs,
            maxDetectToExecMs: Math.max(stats.maxDetectToExecMs, prev.maxDetectToExecMs),
            lastRejectReason: readableErr,
            avgConfirmMs: stats.avgConfirmMs || prev.avgConfirmMs,
            minConfirmMs: stats.minConfirmMs || prev.minConfirmMs,
            maxConfirmMs: Math.max(stats.maxConfirmMs, prev.maxConfirmMs),
            baselineAvgMs: stats.baselineAvgMs,
            recent5AvgMs: stats.recent5AvgMs,
            degradationPct: stats.degradationPct,
            degradationAlert: stats.degradationAlert,
            totalMevEvaluated: params.reduceOnly ? prev.totalMevEvaluated : prev.totalMevEvaluated + 1,
            totalRejected: prev.totalRejected + 1,
            lastSpreadBps,
            lastOracleDiffBps,
            lastDirectionalDepthUsd,
            lastMevReason,
            updatedAtMs: Date.now(),
          }));
          soundEngine.alert();
          voiceEngine.speak(
            `¡Maldita sea! Hyperliquid rechazó la orden en ${params.coin}, socio. ${execResult.rejectReason || ''}`,
            true
          );
          await logEvent(
            'ERROR',
            'HL_EXCHANGE',
            params.coin,
            `[${execResult.channel}] Rechazo HL (Detect→Envío ${detectToSendMs}ms · Detect→Exec ${detectToExecMs}ms · E2E ${execResult.e2eAckMs}ms): ${readableErr}`,
            detectToExecMs
          );
          setStatusNotice({ type: 'error', text: `Hyperliquid rechazó la orden: ${readableErr}` });
          return false;
        }
        consecutiveExecErrorsRef.current = 0;

        const prevDegraded = orderTelemetry.degradationAlert;
        const stats = recordOrderLatencyMetric({
          coin: params.coin,
          side: params.side,
          e2eAckMs: execResult.e2eAckMs,
          exchangeRttMs: execResult.exchangeRttMs,
          l2Ms: freshBook?.latencyMs ?? 0,
          signMs: execResult.signMs,
          fillVerifyMs: execResult.fillVerifyMs,
          detectToSendMs,
          detectToExecMs,
          outcome: 'CONFIRMED',
          fillStatus: execResult.fillStatus,
          route: execResult.channel,
        });

        updateOrderTelemetry((prev) => ({
          ...prev,
          activeRoute: execResult.channel,
          lastCoin: params.coin,
          lastSide: params.side,
          lastStatus: 'CONFIRMED',
          lastFillStatus: execResult.fillStatus,
          lastL2PrecheckMs: freshBook?.latencyMs ?? 0,
          lastSignMs: execResult.signMs,
          lastExchangeRttMs: execResult.exchangeRttMs,
          lastE2eConfirmMs: execResult.e2eAckMs,
          lastFillVerifyMs: execResult.fillVerifyMs,
          lastDetectToSendMs: detectToSendMs,
          lastDetectToExecMs: detectToExecMs,
          lastFilledAvgPx: execResult.filledAvgPx,
          lastRejectReason: '',
          avgConfirmMs: stats.avgConfirmMs,
          minConfirmMs: stats.minConfirmMs,
          maxConfirmMs: stats.maxConfirmMs,
          avgDetectToExecMs: stats.avgDetectToExecMs,
          maxDetectToExecMs: stats.maxDetectToExecMs,
          baselineAvgMs: stats.baselineAvgMs,
          recent5AvgMs: stats.recent5AvgMs,
          degradationPct: stats.degradationPct,
          degradationAlert: stats.degradationAlert,
          totalConfirmed: prev.totalConfirmed + 1,
          totalFilledConfirmed:
            prev.totalFilledConfirmed + (execResult.fillStatus === 'FILLED' ? 1 : 0),
          totalAckOnly:
            prev.totalAckOnly + (execResult.fillStatus !== 'FILLED' ? 1 : 0),
          totalMevEvaluated: params.reduceOnly ? prev.totalMevEvaluated : prev.totalMevEvaluated + 1,
          lastSpreadBps,
          lastOracleDiffBps,
          lastDirectionalDepthUsd,
          lastMevReason,
          updatedAtMs: Date.now(),
        }));

        if (stats.degradationAlert && !prevDegraded) {
          await logEvent(
            'WARN',
            'LATENCY_DEGRADATION',
            params.coin,
            `Degradación de latencia detectada: últimas 5 órdenes promedian ${stats.recent5AvgMs}ms vs baseline ${stats.baselineAvgMs}ms (+${stats.degradationPct}% · Máx histórico ${stats.maxConfirmMs}ms · Detect→Exec máx ${stats.maxDetectToExecMs}ms).`,
            stats.recent5AvgMs
          );
          voiceEngine.speak(
            `¡Ojo socio! La latencia se disparó ${stats.degradationPct} por ciento a ${stats.recent5AvgMs} milisegundos.`,
            true
          );
        }

        const fillLabel =
          execResult.fillStatus === 'FILLED'
            ? `FILL CONFIRMADO a ${execResult.filledAvgPx > 0 ? `$${execResult.filledAvgPx.toFixed(4)}` : execResult.limitPxStr}`
            : `ACK RECIBIDO (${execResult.fillStatus}, pendiente fill)`;

        soundEngine.tradeExecuted();
        if (params.reduceOnly) {
          voiceEngine.speak(
            `¡Posición en ${params.coin} liquidada y en el bolsillo! ${execResult.fillStatus === 'FILLED' ? 'Fill completo' : 'ACK confirmado'} en ${detectToExecMs} milisegundos totales, socio.`,
            true
          );
        } else {
          voiceEngine.speak(
            `¡Adentro como un jefe! ${params.side} en ${params.coin} por ${params.notionalUsd.toFixed(0)} dólares. ${execResult.fillStatus === 'FILLED' ? 'Fill confirmado' : 'ACK recibido'}, el mundo es tuyo.`,
            true
          );
        }
        await logEvent(
          'EXEC',
          params.reduceOnly ? 'CLOSE_REAL' : 'OPEN_REAL',
          params.coin,
          `${params.side} ${execResult.sizeStr} ${params.coin} @ $${execResult.limitPxStr} [${fillLabel}] vía ${execResult.channel} (Detect→Envío ${detectToSendMs}ms · Detect→Exec ${detectToExecMs}ms · Sign ${execResult.signMs}ms · HL RTT ${execResult.exchangeRttMs}ms · E2E ${execResult.e2eAckMs}ms · Hist Prom/Max ${stats.avgConfirmMs}/${stats.maxConfirmMs}ms)`,
          detectToExecMs
        );

        if (!params.reduceOnly) {
          const entryRef = execResult.filledAvgPx > 0 ? execResult.filledAvgPx : freshBestPx;
          recentEntryZoneByCoinRef.current = [
            { coin: params.coin, px: entryRef, ts: Date.now() },
            ...recentEntryZoneByCoinRef.current,
          ].slice(0, 30);
          partialStageByCoinRef.current[params.coin] = 0;
          const newPosPayload = {
            coin: params.coin,
            side: params.side,
            size: execResult.filledSz > 0 ? execResult.filledSz : Number(execResult.sizeStr),
            entryPx: entryRef,
            markPx: asset.markPx,
            leverage: asset.maxLeverage,
            unrealizedPnl: 0,
            realizedPnl: 0,
            status: 'OPEN' as const,
            mode: params.mode,
            hlOrderId: String(execResult.oid || JSON.stringify(execResult.exchangeResponse)).slice(0, 120),
            thesis: params.thesis,
            strategyTag: params.strategyTag || '',
          };
          const createdId = user
            ? await createPersistedPosition(user.uid, newPosPayload)
            : `local-pos-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
          const nowMs = Date.now();
          const newRecord: PersistedPosition = {
            id: createdId,
            ownerId: user?.uid || 'local',
            ...newPosPayload,
            createdAtMs: nowMs,
            updatedAtMs: nowMs,
          };
          setPersistedPositions((prev) => {
            const merged = mergePositionsAdditive([newRecord], prev);
            saveLocalPositions(merged);
            return merged;
          });
        }

        setStatusNotice({
          type: 'ok',
          text: `${fillLabel} (${params.coin} ${params.side}) vía ${execResult.channel} · Detect→Exec ${detectToExecMs} ms (Envío ${detectToSendMs} ms · HL RTT ${execResult.exchangeRttMs} ms · Prom/Max hist ${stats.avgConfirmMs}/${stats.maxConfirmMs} ms)`,
        });
        await refreshAccountData();
        return true;
      } catch (err) {
        soundEngine.alert();
        const msg = err instanceof Error ? err.message : String(err);
        if (!params.reduceOnly && Boolean(config.killSwitchEnabled)) {
          consecutiveExecErrorsRef.current += 1;
          if (consecutiveExecErrorsRef.current >= 3) {
            setKillSwitchState({
              active: true,
              reason: `Kill Switch aviso: 3 errores consecutivos de ejecución (${msg.slice(0, 70)}). Desactívalo en 1 clic cuando quieras.`,
              triggeredAtMs: Date.now(),
            });
          }
        }
        voiceEngine.speak(`¡Problemas ejecutando en ${params.coin}, chico! ${msg}`, true);
        await logEvent('ERROR', 'EXEC_FAIL', params.coin, msg);
        setStatusNotice({ type: 'error', text: msg });
        return false;
      } finally {
        setExecuting(false);
      }
    },
    [
      marketsByCoin,
      apiPrivateKey,
      config,
      logEvent,
      user,
      refreshAccountData,
      updateOrderTelemetry,
      recordOrderLatencyMetric,
      orderTelemetry.degradationAlert,
    ]
  );

  const handleCloseLivePosition = useCallback(
    async (
      coin: string,
      side: 'LONG' | 'SHORT',
      size: number,
      customReason?: string,
      options?: {
        detectedPerfNow?: number;
        skipL2Precheck?: boolean;
        overrideRefPx?: number;
        partialFraction?: number;
        nextStage?: number;
      }
    ) => {
      setClosingCoin(coin);
      try {
        const livePosSnapshot = accountSummary?.positions.find((p) => p.coin === coin);
        const closed = await submitProtectedOrder({
          coin,
          side: side === 'LONG' ? 'SHORT' : 'LONG',
          notionalUsd: 0,
          mode: 'manual',
          thesis: customReason || 'Cierre reduceOnly en Hyperliquid',
          reduceOnly: true,
          overrideSizeCoins: size,
          detectedPerfNow: options?.detectedPerfNow,
          skipL2Precheck: options?.skipL2Precheck,
          overrideRefPx: options?.overrideRefPx,
        });

        if (closed) {
          const matchingOpen = persistedPositions.find((p) => p.coin === coin && p.status === 'OPEN');
          const liveMark =
            options?.overrideRefPx ??
            marketsByCoin.get(coin)?.markPx ??
            matchingOpen?.markPx ??
            livePosSnapshot?.entryPx ??
            0;
          const entryRef = matchingOpen?.entryPx ?? livePosSnapshot?.entryPx ?? liveMark;
          const peakSeen = peakMoveByCoinRef.current[coin] ?? 0;

          // Partial Take Profit (TP1 30% or TP2 30%): keep runner OPEN + advance stage + protect Breakeven
          if (options?.partialFraction && options.partialFraction > 0 && options.partialFraction < 0.99) {
            const nextStageVal = options.nextStage ?? 1;
            partialStageByCoinRef.current[coin] = nextStageVal;
            const prevQty = livePosSnapshot ? Math.abs(livePosSnapshot.szi) : matchingOpen?.size ?? size;
            const remainingQty = Number(Math.max(0, prevQty - size).toFixed(6));
            const partialRealized =
              (side === 'LONG' ? liveMark - entryRef : entryRef - liveMark) * size;

            if (matchingOpen) {
              if (user && !matchingOpen.id.startsWith('local-')) {
                await updateOpenPersistedPositionSize(
                  user.uid,
                  matchingOpen.id,
                  remainingQty,
                  liveMark,
                  livePosSnapshot?.unrealizedPnl ?? 0
                );
              }
              setPersistedPositions((prev) => {
                const updated = prev.map((p) =>
                  p.id === matchingOpen.id
                    ? {
                        ...p,
                        size: remainingQty,
                        markPx: liveMark,
                        unrealizedPnl: livePosSnapshot?.unrealizedPnl ?? p.unrealizedPnl,
                        updatedAtMs: Date.now(),
                      }
                    : p
                );
                saveLocalPositions(updated);
                return updated;
              });
            }

            const partialMem: Omit<AiMemoryEntry, 'id' | 'ownerId' | 'createdAtMs'> = {
              coin,
              regime: `SI_ENTRAR: Parcial TP${nextStageVal}`,
              outcome: partialRealized >= 0 ? 'WIN' : 'BREAKEVEN',
              pnlUsd: Number(partialRealized.toFixed(2)),
              lesson: `Parcial TP${nextStageVal} en ${coin} (${side}): cerrado ${Math.round(options.partialFraction * 100)}% @ $${liveMark.toFixed(4)} (+$${partialRealized.toFixed(2)}), runner restante ${remainingQty} con BE activo.`,
            };
            if (user) await appendAiMemory(user.uid, partialMem);
            setAiMemories((prev) => {
              const merged = mergeMemoriesAdditive(
                [
                  {
                    id: `tp-mem-${Date.now()}`,
                    ownerId: user?.uid || 'local',
                    ...partialMem,
                    createdAtMs: Date.now(),
                  },
                ],
                prev
              );
              saveLocalMemories(merged);
              return merged;
            });
            return;
          }

          delete partialStageByCoinRef.current[coin];
          delete peakMoveByCoinRef.current[coin];
          delete spokenMilestoneRef.current[coin];

          const realized = matchingOpen
            ? (matchingOpen.side === 'LONG' ? liveMark - matchingOpen.entryPx : matchingOpen.entryPx - liveMark) *
              matchingOpen.size
            : livePosSnapshot
            ? livePosSnapshot.unrealizedPnl
            : (side === 'LONG' ? liveMark - entryRef : entryRef - liveMark) * size;

          const fallbackStratTag =
            matchingOpen?.strategyTag ||
            (lastDeepAnalysesRef.current[coin]?.firedStrategies?.join(',') ?? '');

          if (matchingOpen) {
            reconciledIdsRef.current.add(matchingOpen.id);
            if (user && !matchingOpen.id.startsWith('local-')) {
              await closePersistedPosition(user.uid, matchingOpen.id, liveMark, realized);
            }
            setPersistedPositions((prev) => {
              const updated = prev.map((p) =>
                p.id === matchingOpen.id
                  ? { ...p, status: 'CLOSED' as const, markPx: liveMark, realizedPnl: realized, unrealizedPnl: 0, updatedAtMs: Date.now() }
                  : p
              );
              saveLocalPositions(updated);
              return updated;
            });
            if (fallbackStratTag) {
              const stratIds = fallbackStratTag.split(',').filter(Boolean);
              if (user) {
                await recordStrategyTradeOutcome(user.uid, stratIds, realized);
              } else {
                const isWin = realized > 0.05;
                const isLoss = realized < -0.05;
                const delta = isWin ? 0.08 : isLoss ? -0.09 : 0;
                setStrategyPlaybook((prev) => {
                  const next = prev.map((s) => {
                    if (!stratIds.includes(s.strategyId)) return s;
                    const nextWins = s.wins + (isWin ? 1 : 0);
                    const nextLosses = s.losses + (isLoss ? 1 : 0);
                    const nextTotal = nextWins + nextLosses;
                    return {
                      ...s,
                      wins: nextWins,
                      losses: nextLosses,
                      totalPnlUsd: Number((s.totalPnlUsd + realized).toFixed(4)),
                      weight:
                        nextTotal >= MIN_ATTRIBUTABLE_TRADES
                          ? Number(Math.max(0.3, Math.min(2.5, s.weight + delta)).toFixed(2))
                          : 1.0,
                      updatedAtMs: Date.now(),
                    };
                  });
                  saveLocalPlaybook(next);
                  return next;
                });
              }
            }
          } else {
            const closedPayload = {
              coin,
              side,
              size,
              entryPx: entryRef,
              markPx: liveMark,
              leverage: livePosSnapshot?.leverage ?? marketsByCoin.get(coin)?.maxLeverage ?? 5,
              unrealizedPnl: 0,
              realizedPnl: realized,
              status: 'CLOSED' as const,
              mode: 'manual' as const,
              hlOrderId: `hl-close-${Date.now()}`,
              thesis: customReason || 'Cierre en vivo sincronizado para historial y aprendizaje',
              strategyTag: fallbackStratTag,
            };
            const createdId = user
              ? await createPersistedPosition(user.uid, closedPayload)
              : `local-pos-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
            reconciledIdsRef.current.add(createdId);
            const nowMs = Date.now();
            const newClosedRecord: PersistedPosition = {
              id: createdId,
              ownerId: user?.uid || 'local',
              ...closedPayload,
              createdAtMs: nowMs,
              updatedAtMs: nowMs,
            };
            setPersistedPositions((prev) => {
              const merged = mergePositionsAdditive([newClosedRecord], prev);
              saveLocalPositions(merged);
              return merged;
            });
          }

          const isRealizedWin = realized >= 0.05;
          const isRealizedLoss = realized <= -0.05;
          const deepSnap = lastDeepAnalysesRef.current[coin];
          const sevenPointLesson = [
            `1) Motivo entrada: ${matchingOpen?.thesis?.slice(0, 65) || `${side} ${coin}`}`,
            `2) Condiciones: ${deepSnap ? `${deepSnap.regime} RSI ${deepSnap.rsi14.toFixed(0)} ADX ${deepSnap.adx14 ?? '--'}` : 'Sesión HL'}`,
            `3) Estrategias: ${fallbackStratTag || 'Manual'}`,
            `4) Pico post-entrada: +${peakSeen.toFixed(2)}% ($${entryRef.toFixed(4)}→$${liveMark.toFixed(4)})`,
            `5) Razón cierre: ${customReason || 'Cierre manual/exchange'}`,
            `6) PnL: ${realized >= 0 ? '+' : ''}$${realized.toFixed(2)}`,
            `7) Mejora: ${isRealizedLoss ? 'Filtrar chop/falsa ruptura y exigir confluencia >=65 pts.' : 'Repetir entrada limpia y escalar TP1/TP2.'}`,
          ].join(' | ');

          const lessonEntry: Omit<AiMemoryEntry, 'id' | 'ownerId' | 'createdAtMs'> = {
            coin,
            regime: isRealizedLoss
              ? `NO_ENTRAR: ${customReason ? 'Gestión SL' : 'Cierre Pérdida'}`
              : isRealizedWin
              ? `SI_ENTRAR: ${customReason ? 'Gestión TP/Trail' : 'Cierre Ganador'}`
              : 'Cierre Breakeven',
            outcome: isRealizedWin ? 'WIN' : isRealizedLoss ? 'LOSS' : 'BREAKEVEN',
            pnlUsd: realized,
            lesson: sevenPointLesson.slice(0, 340),
          };
          if (user) {
            await appendAiMemory(user.uid, lessonEntry);
          }
          const localMem: AiMemoryEntry = {
            id: `local-mem-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            ownerId: user?.uid || 'local',
            ...lessonEntry,
            createdAtMs: Date.now(),
          };
          setAiMemories((prev) => {
            const merged = mergeMemoriesAdditive([localMem], prev);
            saveLocalMemories(merged);
            return merged;
          });
        }
      } finally {
        setClosingCoin(null);
      }
    },
    [submitProtectedOrder, persistedPositions, marketsByCoin, user, accountSummary]
  );

  const handleCloseAllLivePositions = useCallback(
    async (onlyTugOwned = false) => {
      const openPositions = (accountSummary?.positions ?? []).filter(
        (p) => !onlyTugOwned || !p.isExternal
      );
      if (openPositions.length === 0) {
        setStatusNotice({
          type: 'info',
          text: onlyTugOwned
            ? 'No tienes posiciones TUG777 abiertas (las marcadas [EXTERNA] se respetan intactas).'
            : 'No tienes posiciones vivas abiertas en Hyperliquid.',
        });
        return;
      }
      if (!apiPrivateKey.trim()) {
        soundEngine.alert();
        voiceEngine.speak('¡Oye chico! Mete tu Agent Private Key para liquidar todas las posiciones.', true);
        setStatusNotice({
          type: 'error',
          text: 'Ingresa tu Agent Private Key para cerrar tus posiciones en Hyperliquid.',
        });
        setApiModalOpen(true);
        return;
      }
      setClosingAll(true);
      voiceEngine.speak(
        `¡Say hello to my little friend! Cerrando ${openPositions.length} posiciones abiertas, socio.`,
        true
      );
      try {
        for (const pos of openPositions) {
          await handleCloseLivePosition(pos.coin, pos.side, Math.abs(pos.szi), 'Cierre masivo 1-toque');
        }
      } finally {
        setClosingAll(false);
      }
    },
    [accountSummary, apiPrivateKey, handleCloseLivePosition]
  );

  // Unified Brain Cycle (10-Strategy Matrix + Multi-TF Candles + L2 Depth + DB Cross-Reference)
  const runUnifiedBrainCycle = useCallback(async (manualTrigger = false) => {
    if (markets.length === 0 || brainThinking) return;

    const maxDailyLoss = Math.max(0.1, config.dailyMaxLossPct ?? 2.5);
    if (Boolean(config.killSwitchEnabled) && !manualTrigger && dailyDrawdownPct >= maxDailyLoss) {
      const openPosList = (accountSummary?.positions ?? []).filter((p) => !p.isExternal);
      const alreadyNotified = Boolean(killSwitchState?.active);
      const ksReason =
        openPosList.length > 0
          ? `Kill Switch Auto-Cierre disparado (-${dailyDrawdownPct.toFixed(2)}% >= límite -${maxDailyLoss.toFixed(2)}%): cerrando ${openPosList.length} posición(es) TUG777 para proteger capital.`
          : `Kill Switch Auto-Cierre (-${dailyDrawdownPct.toFixed(2)}% >= límite -${maxDailyLoss.toFixed(2)}%): sin posiciones TUG777 abiertas.`;
      if (!alreadyNotified) {
        setKillSwitchState({ active: true, reason: ksReason, triggeredAtMs: Date.now() });
        soundEngine.alert();
        voiceEngine.speak(
          openPosList.length > 0
            ? '¡Kill Switch ejecutado, socio! Cerrando posiciones de TUG777 para salvar la plata. Tu app sigue libre cuando tú mandes.'
            : '¡Límite del Kill Switch alcanzado, socio! Apágalo cuando quieras seguir en automático.',
          true
        );
        await logEvent('WARN', 'KILL_SWITCH', 'SYSTEM', ksReason);
        if (openPosList.length > 0 && apiPrivateKey.trim()) {
          await handleCloseAllLivePositions(true);
        }
      }
      return;
    }

    setBrainThinking(true);

    try {
      const minVolUsd = (config.minVolumeM || 2) * 1_000_000;
      const liquidByVol = [...markets].filter((m) => m.dayNtlVlm >= minVolUsd);
      const preFiltered = [...liquidByVol].sort((a, b) => {
        const turnoverA = a.openInterestUsd > 0 ? Math.min(10, a.dayNtlVlm / a.openInterestUsd) : 0;
        const turnoverB = b.openInterestUsd > 0 ? Math.min(10, b.dayNtlVlm / b.openInterestUsd) : 0;
        return b.quantScore + turnoverB - (a.quantScore + turnoverA);
      });

      // Always include BTC + top 5 highest-volume leaders + top momentum/quant candidates (max 12)
      const scanMap = new Map<string, HlAssetMarket>();
      const btcMarket = marketsByCoin.get('BTC');
      if (btcMarket) scanMap.set('BTC', btcMarket);
      for (const m of liquidByVol.slice(0, 5)) scanMap.set(m.coin, m);
      for (const m of preFiltered.slice(0, 10)) {
        if (scanMap.size >= 12) break;
        scanMap.set(m.coin, m);
      }
      const topForDeepScan = Array.from(scanMap.values());

      if (topForDeepScan.length === 0) {
        voiceEngine.speak(
          `¡Tranquilo chico! Ningún par pasa el volumen mínimo de ${config.minVolumeM || 2} millones.`
        );
        setStatusNotice({
          type: 'info',
          text: `Ningún token supera el volumen mínimo de $${config.minVolumeM || 2}M para análisis profundo.`,
        });
        return;
      }

      voiceEngine.speak(
        `¡Oye socio! Escaneando ${topForDeepScan.length} pares duros en Hyperliquid con nuestras diez estrategias.`
      );

      // Fetch real 15m + 1h candles and L2 orderbook depth for top candidates in parallel
      const scanOriginPerfNow = performance.now();
      const rawDeepAnalyses: DeepAssetAnalysis[] = await Promise.all(
        topForDeepScan.map(async (c) => {
          try {
            const [c15, c1h, book] = await Promise.all([
              fetchCandles(config.network, c.coin, '15m', 96),
              fetchCandles(config.network, c.coin, '1h', 60),
              fetchL2Book(config.network, c.coin),
            ]);
            candleCacheRef.current[c.coin] = { ts: Date.now(), c15, c1h };
            const evaluated = evaluateUnifiedDeepSetup({
              market: c,
              candles15m: c15,
              candles1h: c1h,
              bids: book.bids,
              asks: book.asks,
              playbook: strategyPlaybook,
              memories: aiMemories,
            });
            lastDeepAnalysesRef.current[c.coin] = evaluated;
            return evaluated;
          } catch {
            return evaluateUnifiedDeepSetup({
              market: c,
              candles15m: [],
              candles1h: [],
              bids: [],
              asks: [],
              playbook: strategyPlaybook,
              memories: aiMemories,
            });
          }
        })
      );

      // BTC Macro Leader Alignment: guard altcoins against fighting a strong BTC trend unless triple A+ confluence
      const btcDeep = rawDeepAnalyses.find((d) => d.coin === 'BTC');
      const deepAnalyses: DeepAssetAnalysis[] = rawDeepAnalyses.map((d) => {
        if (d.coin === 'BTC' || d.direction === 'NEUTRAL' || !btcDeep) return d;
        const btcStrongBear = btcDeep.regime === 'TRENDING_BEAR' && btcDeep.unifiedScore >= 58;
        const btcStrongBull = btcDeep.regime === 'TRENDING_BULL' && btcDeep.unifiedScore >= 58;
        const isEliteTriple = d.unifiedScore >= 76 && d.firedStrategies.length >= 3;
        if (
          ((btcStrongBear && d.direction === 'LONG') || (btcStrongBull && d.direction === 'SHORT')) &&
          !isEliteTriple
        ) {
          return {
            ...d,
            direction: 'NEUTRAL',
            unifiedScore: Math.round(d.unifiedScore * 0.72),
            confidence: Math.min(45, d.confidence),
            reasons: [...d.reasons, `Evitado: contra tendencia BTC (${btcDeep.regime})`].slice(0, 5),
          };
        }
        return d;
      });

      const separatedRules = extractSeparatedLearningRules({
        memories: aiMemories,
        dbHistory: dbClosedHistory,
        fillsSummary,
        playbook: strategyPlaybook,
      });

      const openPositions = (accountSummary?.positions || []).filter((p) => !p.isExternal);
      const maxOpen = Math.max(1, config.maxOpenPositions || 2);
      const effectiveSl = config.slPct > 0 ? config.slPct : 0.85;
      const effectiveTp = config.tpPct > 0 ? config.tpPct : 3.5;

      // Helper to evaluate + optimize + execute additional favorable setups across open slots
      const evaluateOptimizedSetups = (excludeCoins: Set<string>) => {
        const ordered = [...deepAnalyses]
          .filter(
            (d) =>
              !excludeCoins.has(d.coin) &&
              d.direction !== 'NEUTRAL' &&
              !d.antiChaseBlocked &&
              d.unifiedScore >= config.minQuantScore &&
              !openPositions.some((p) => p.coin === d.coin && p.side === d.direction)
          )
          .sort((a, b) => b.unifiedScore - a.unifiedScore);

        const approved: Array<{
          deep: DeepAssetAnalysis;
          plan: ReturnType<typeof optimizeEntryDecision>;
          gateReason: string;
        }> = [];
        let lastRejectReason = '';

        for (const cand of ordered) {
          const candAsset = marketsByCoin.get(cand.coin);
          if (!candAsset) continue;
          const plan = optimizeEntryDecision({
            coin: cand.coin,
            side: cand.direction as 'LONG' | 'SHORT',
            deepAnalysis: cand,
            config,
            accountSummary,
            asset: candAsset,
            playbook: strategyPlaybook,
            dbHistory: dbClosedHistory,
            fillsSummary,
            openPositions,
          });
          const gate = evaluateProfessionalEntryGate({
            coin: cand.coin,
            side: cand.direction as 'LONG' | 'SHORT',
            decisionConfidence: cand.confidence,
            tpPct: effectiveTp,
            slPct: effectiveSl,
            deepAnalysis: cand,
            config,
            playbook: strategyPlaybook,
            dbHistory: dbClosedHistory,
            fillsSummary,
            memories: aiMemories,
            openPositions,
            accountSummary,
            orderUsd: plan.optimizedNotionalUsd,
            assetMaxLeverage: candAsset.maxLeverage,
            dailyDrawdownPct,
            recentEntryZones: recentEntryZoneByCoinRef.current,
          });
          if (gate.allowed) {
            approved.push({ deep: cand, plan, gateReason: gate.reason });
          } else {
            lastRejectReason = gate.reason;
          }
        }
        return { approved, lastRejectReason };
      };

      // Mode 1: Aggressive 10-Strategy Unified Optimizer + Multi-Position Continuous Monitoring
      if (config.mode === 'strategy') {
        const { approved, lastRejectReason } = evaluateOptimizedSetups(new Set());

        if (approved.length === 0) {
          const topSummary = deepAnalyses[0]
            ? `${deepAnalyses[0].coin}: ${deepAnalyses[0].unifiedScore} pts (${deepAnalyses[0].regime})`
            : 'sin candidatos';
          const holdMsg =
            lastRejectReason ||
            `Monitoreo activo en ${topForDeepScan.length} líderes (slots ${openPositions.length}/${maxOpen}): esperando ruptura >= ${config.minQuantScore} pts (${topSummary}).`;
          await logEvent('INFO', 'PRO_GATE', 'SCAN', holdMsg);
          voiceEngine.speak(
            lastRejectReason
              ? `¡Paciencia de hierro, socio! No regalamos plata: ${lastRejectReason}`
              : `Escaneo de ${topForDeepScan.length} líderes listo, esperando la mordida limpia, chico.`
          );
          setLastDecision({
            action: 'HOLD',
            coin: 'NONE',
            confidence: deepAnalyses[0]?.unifiedScore ?? 45,
            decisionBand: deepAnalyses[0]?.decisionBand ?? getDecisionBand(deepAnalyses[0]?.unifiedScore ?? 45),
            regime: deepAnalyses[0]?.regime || 'Monitoreo Activo',
            reason: holdMsg,
            tpPct: effectiveTp,
            slPct: effectiveSl,
            modelUsed: 'TUG777 10-Estrategias [Guía + SÍ/NO Entrar]',
          });
          return;
        }

        const primary = approved[0];
        const slotsLeft = Math.max(0, maxOpen - openPositions.length);
        // Sniper discipline: max 1 highest-conviction setup per cycle to prevent correlated double-losses
        const batchToOpen = approved.slice(0, Math.min(1, slotsLeft));

        const primaryDecision: AiBrainDecision = {
          action: primary.deep.direction as 'LONG' | 'SHORT',
          coin: primary.deep.coin,
          confidence: primary.deep.confidence,
          decisionBand: primary.deep.decisionBand ?? getDecisionBand(primary.deep.unifiedScore),
          regime: primary.deep.regime,
          reason: `[${primary.deep.firedStrategies.join(', ')}] ${primary.deep.reasons.join(' · ')}`,
          tpPct: primary.plan.tpPct,
          slPct: primary.plan.slPct,
          tp1Pct: primary.plan.tp1Pct,
          tp2Pct: primary.plan.tp2Pct,
          tp3Pct: primary.plan.tp3Pct,
          strategiesUsed: primary.deep.firedStrategies,
          modelUsed: 'TUG777 10-Estrategias [Guía + SÍ/NO Entrar]',
          optimizerNotes: primary.plan.optimizerSummary,
          optimizedNotionalUsd: primary.plan.optimizedNotionalUsd,
        };
        setLastDecision(primaryDecision);
        voiceEngine.speak(
          `¡Ahí está el billete, socio! ${primaryDecision.action} en ${primary.deep.coin}, S L ${effectiveSl} por ciento y T P ${effectiveTp} por ciento. Tirando el mejor tiro limpio.`,
          true
        );

        if (slotsLeft === 0) {
          voiceEngine.speak(
            `¡Slots llenos en ${openPositions.length} de ${maxOpen}, chico! ${primary.deep.coin} queda en la mira.`
          );
          await logEvent(
            'INFO',
            'RISK_CAP',
            primary.deep.coin,
            `Slots llenos (${openPositions.length}/${maxOpen}). Señal ${primaryDecision.action} ${primary.deep.coin} lista en cola hasta liberar margen.`
          );
          return;
        }

        for (const item of batchToOpen) {
          await logEvent(
            'INFO',
            'OPTIMIZER',
            item.deep.coin,
            `${item.deep.direction} (${item.deep.confidence}%) · ${item.plan.optimizerSummary}`
          );
          if (apiPrivateKey.trim()) {
            await submitProtectedOrder({
              coin: item.deep.coin,
              side: item.deep.direction as 'LONG' | 'SHORT',
              notionalUsd: item.plan.optimizedNotionalUsd,
              mode: 'strategy',
              thesis: `${item.plan.optimizerSummary} | ${item.deep.reasons.join(' · ')}`,
              strategyTag: item.deep.firedStrategies.join(','),
              detectedPerfNow: scanOriginPerfNow,
            });
          }
        }
        return;
      }

      // Mode 2 & 3: Gemini AI Brain or BYO-AI (same guide + SI/NO history!) OR clean Motor Local in APK
      const backendAvailable = hasConfiguredBackendForApk();
      let currentMacro = macroBrief;
      if (backendAvailable && !currentMacro && config.aiProvider === 'gemini' && config.useSearchGrounding) {
        try {
          const macroRes = await fetch(buildBackendApiUrl('/api/ai/macro-radar'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ coins: topForDeepScan.slice(0, 5).map((c) => c.coin) }),
          });
          if (macroRes.ok) {
            const macroData = await parseAiJson<{
              summary?: string;
              sources?: Array<{ uri: string; title: string }>;
            }>(macroRes);
            currentMacro = macroData.summary || '';
            setMacroBrief(currentMacro);
            setMacroSources(macroData.sources || []);
          }
        } catch {
          // macro grounding is optional
        }
      }

      const runCleanLocalFallback = (extraContext?: string) => {
        const { approved, lastRejectReason } = evaluateOptimizedSetups(new Set());
        const bestLocal = approved[0];
        if (!bestLocal) {
          const topCand = deepAnalyses[0];
          const localDetail = lastRejectReason
            ? lastRejectReason
            : topCand
            ? `Líder actual ${topCand.coin} (${topCand.unifiedScore} pts, ${topCand.regime}) esperando >= ${config.minQuantScore} pts.`
            : 'Esperando ruptura limpia.';
          const fallbackDecision: AiBrainDecision = {
            action: 'HOLD',
            coin: 'NONE',
            confidence: topCand?.unifiedScore ?? 45,
            regime: topCand?.regime || 'Motor Local 10-Estrategias',
            reason: `${extraContext ? `${extraContext} · ` : ''}Motor Local 10-Estrategias [Guía + SÍ/NO Entrar] monitoreando ${topForDeepScan.length} pares (SL ${effectiveSl}% / TP ${effectiveTp}%): ${localDetail}`,
            tpPct: effectiveTp,
            slPct: effectiveTp > 0 ? effectiveSl : 0.1,
            strategiesUsed: [],
            modelUsed: 'Motor Local 10-Estrategias [Guía + SÍ/NO Entrar]',
          };
          fallbackDecision.slPct = effectiveSl;
          return fallbackDecision;
        }
        return {
          action: bestLocal.deep.direction as 'LONG' | 'SHORT',
          coin: bestLocal.deep.coin,
          confidence: bestLocal.deep.confidence,
          regime: bestLocal.deep.regime,
          reason: `[${bestLocal.deep.firedStrategies.join(', ')}] ${bestLocal.deep.reasons.join(' · ')}`,
          tpPct: bestLocal.plan.tpPct,
          slPct: bestLocal.plan.slPct,
          strategiesUsed: bestLocal.deep.firedStrategies,
          modelUsed: 'Motor Local 10-Estrategias [Guía + SÍ/NO Entrar]',
          optimizerNotes: bestLocal.plan.optimizerSummary,
          optimizedNotionalUsd: bestLocal.plan.optimizedNotionalUsd,
        } satisfies AiBrainDecision;
      };

      let decision: AiBrainDecision & { error?: string; quotaExceeded?: boolean };
      if (!backendAvailable) {
        // Standalone APK with no remote backend URL configured: operate natively on-device with zero 404 HTML errors
        decision = runCleanLocalFallback(
          'Modo APK Autónomo (para IA en nube conecta tu URL en Parámetros IA)'
        );
      } else {
        try {
          const aiRes = await fetch(buildBackendApiUrl('/api/ai/analyze-market'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({
              mode: config.mode,
              candidates: preFiltered.slice(0, 12),
              deepAnalyses,
              playbook: strategyPlaybook,
              positionGuide: POSITION_MANAGEMENT_GUIDE_RULES,
              positiveEntryRules: separatedRules.positiveEntryRules,
              negativeNoEntryRules: separatedRules.negativeNoEntryRules,
              dbClosedHistory,
              fillsSummary,
              memories: aiMemories.slice(0, 18),
              openPositions,
              macroBrief: currentMacro,
              deepThinking: config.useDeepThinking,
              geminiModel: config.geminiModel || 'auto',
              aiProvider: config.aiProvider,
              customAiUrl: config.customAiUrl,
              customAiModel: config.customAiModel,
              customSystemPrompt: config.customSystemPrompt,
              tpPct: effectiveTp,
              slPct: effectiveSl,
            }),
          });

          decision = await parseAiJson<AiBrainDecision & { error?: string; quotaExceeded?: boolean }>(aiRes);
          if (!aiRes.ok || decision.error) {
            throw new Error(decision.error || 'Respuesta inválida del Cerebro IA');
          }
        } catch {
          decision = runCleanLocalFallback('Conmutación automática por caída/cuota del modelo remoto');
        }
      }

      if (decision.quotaExceeded) {
        setStatusNotice({
          type: 'info',
          text: 'Cuota gratuita de Gemini alcanzada (429). Respaldo automático con misma Guía Unificada y reglas SÍ/NO activo.',
        });
      }

      // Handle explicit CLOSE decision from AI Brain on an open Hyperliquid position
      if (decision.action === 'CLOSE' && decision.coin !== 'NONE') {
        setLastDecision(decision);
        voiceEngine.speak(
          `¡Órale socio! El cerebro manda cerrar posición en ${decision.coin}. ${decision.reason}`,
          true
        );
        await logEvent(
          'INFO',
          'UNIFIED_BRAIN',
          decision.coin,
          `[${decision.modelUsed}] CLOSE · ${decision.reason}`
        );
        if (apiPrivateKey.trim()) {
          const openPos = openPositions.find((p) => p.coin === decision.coin);
          if (openPos) {
            await handleCloseLivePosition(
              openPos.coin,
              openPos.side,
              Math.abs(openPos.szi),
              `Cierre optimizador Cerebro IA: ${decision.reason}`
            );
          }
        }
        return;
      }

      const openedCoinsThisCycle = new Set<string>();
      let slotsRemaining = Math.max(0, maxOpen - openPositions.length);

      if (decision.action === 'LONG' || decision.action === 'SHORT') {
        const asset = marketsByCoin.get(decision.coin);
        const matchedDeep = deepAnalyses.find((d) => d.coin === decision.coin);
        const alreadySameSide = openPositions.some(
          (p) => p.coin === decision.coin && p.side === decision.action
        );

        const plan =
          asset && matchedDeep
            ? optimizeEntryDecision({
                coin: decision.coin,
                side: decision.action,
                deepAnalysis: matchedDeep,
                config,
                accountSummary,
                asset,
                playbook: strategyPlaybook,
                dbHistory: dbClosedHistory,
                fillsSummary,
                openPositions,
              })
            : null;
        const estOrderUsd =
          plan?.optimizedNotionalUsd ??
          (asset
            ? computeDynamicOrderNotionalUsd({ config, accountSummary, asset })
            : config.riskPerTradeUsd || 50);

        const proGate = evaluateProfessionalEntryGate({
          coin: decision.coin,
          side: decision.action,
          decisionConfidence: decision.confidence,
          tpPct: effectiveTp,
          slPct: effectiveSl,
          deepAnalysis: matchedDeep,
          config,
          playbook: strategyPlaybook,
          dbHistory: dbClosedHistory,
          fillsSummary,
          memories: aiMemories,
          openPositions,
          accountSummary,
          orderUsd: estOrderUsd,
          assetMaxLeverage: asset?.maxLeverage ?? 5,
          dailyDrawdownPct,
          recentEntryZones: recentEntryZoneByCoinRef.current,
        });

        if (!proGate.allowed || alreadySameSide) {
          const skipReason = alreadySameSide
            ? `${decision.coin} ya tiene posición ${decision.action}; buscando otra oportunidad a favor.`
            : proGate.reason;
          voiceEngine.speak(`¡Nada de burradas, chico! Descartamos ${decision.coin}: ${skipReason}`);
          await logEvent('INFO', 'PRO_GATE', decision.coin || 'ALL', skipReason);
        } else {
          const enrichedDecision: AiBrainDecision = {
            ...decision,
            decisionBand:
              decision.decisionBand ??
              matchedDeep?.decisionBand ??
              getDecisionBand(matchedDeep?.unifiedScore ?? decision.confidence),
            tpPct: effectiveTp,
            slPct: effectiveSl,
            tp1Pct: plan?.tp1Pct ?? decision.tp1Pct,
            tp2Pct: plan?.tp2Pct ?? decision.tp2Pct,
            tp3Pct: plan?.tp3Pct ?? decision.tp3Pct ?? effectiveTp,
            optimizerNotes: plan?.optimizerSummary || proGate.reason,
            optimizedNotionalUsd: estOrderUsd,
          };
          setLastDecision(enrichedDecision);
          voiceEngine.speak(
            `¡Luz verde socio! ${decision.action} en ${decision.coin} al ${decision.confidence} por ciento, S L ${effectiveSl} y T P ${effectiveTp}. Vamos con todo.`,
            true
          );
          await logEvent(
            'INFO',
            'OPTIMIZER',
            decision.coin || 'ALL',
            `[${decision.modelUsed}] ${decision.action} · ${plan?.optimizerSummary || proGate.reason}`
          );

          if (apiPrivateKey.trim() && asset && slotsRemaining > 0) {
            await submitProtectedOrder({
              coin: decision.coin,
              side: decision.action,
              notionalUsd: estOrderUsd,
              mode: config.mode,
              thesis: `${plan?.optimizerSummary || decision.regime}: ${decision.reason}`,
              strategyTag:
                decision.strategiesUsed?.join(',') ||
                matchedDeep?.firedStrategies.join(',') ||
                '',
              detectedPerfNow: scanOriginPerfNow,
            });
            openedCoinsThisCycle.add(decision.coin);
            slotsRemaining -= 1;
          }
        }
      }

      // Single best setup per cycle fallback (never open 2 correlated trades at once)
      if (slotsRemaining > 0 && openedCoinsThisCycle.size === 0) {
        const { approved: extraSetups } = evaluateOptimizedSetups(openedCoinsThisCycle);
        const maxExtra = Math.min(1, slotsRemaining);
        for (const extra of extraSetups.slice(0, maxExtra)) {
          const extraDecision: AiBrainDecision = {
            action: extra.deep.direction as 'LONG' | 'SHORT',
            coin: extra.deep.coin,
            confidence: extra.deep.confidence,
            decisionBand: extra.deep.decisionBand ?? getDecisionBand(extra.deep.unifiedScore),
            regime: extra.deep.regime,
            reason: `Setup A+ Seleccionado [${extra.deep.firedStrategies.join(', ')}]: ${extra.deep.reasons.join(' · ')}`,
            tpPct: extra.plan.tpPct,
            slPct: extra.plan.slPct,
            tp1Pct: extra.plan.tp1Pct,
            tp2Pct: extra.plan.tp2Pct,
            tp3Pct: extra.plan.tp3Pct,
            strategiesUsed: extra.deep.firedStrategies,
            modelUsed: 'TUG777 Sniper Optimizer',
            optimizerNotes: extra.plan.optimizerSummary,
            optimizedNotionalUsd: extra.plan.optimizedNotionalUsd,
          };
          setLastDecision(extraDecision);
          voiceEngine.speak(
            `¡Oportunidad dorada, socio! Entrando ${extraDecision.action} en ${extra.deep.coin}.`,
            true
          );
          await logEvent(
            'INFO',
            'OPTIMIZER',
            extra.deep.coin,
            `Entrada A+ seleccionada · ${extra.plan.optimizerSummary}`
          );
          if (apiPrivateKey.trim()) {
            await submitProtectedOrder({
              coin: extra.deep.coin,
              side: extra.deep.direction as 'LONG' | 'SHORT',
              notionalUsd: extra.plan.optimizedNotionalUsd,
              mode: config.mode,
              thesis: `${extra.plan.optimizerSummary} | ${extra.deep.reasons.join(' · ')}`,
              strategyTag: extra.deep.firedStrategies.join(','),
              detectedPerfNow: scanOriginPerfNow,
            });
            openedCoinsThisCycle.add(extra.deep.coin);
            slotsRemaining -= 1;
          }
        }
      }

      if (openedCoinsThisCycle.size === 0 && decision.action === 'HOLD') {
        setLastDecision({ ...decision, tpPct: effectiveTp, slPct: effectiveSl });
        voiceEngine.speak(`Vigilando el terreno, socio. ${decision.reason}`);
        await logEvent(
          'INFO',
          'UNIFIED_BRAIN',
          decision.coin || 'ALL',
          `[${decision.modelUsed}] HOLD · Confianza ${decision.confidence}% · ${decision.reason}`
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      voiceEngine.speak(`¡Falla en el radar del cerebro, chico! ${msg}`, true);
      await logEvent('ERROR', 'BRAIN_CYCLE', 'SYSTEM', msg);
      setStatusNotice({ type: 'error', text: msg });
    } finally {
      setBrainThinking(false);
    }
  }, [
    markets,
    marketsByCoin,
    brainThinking,
    killSwitchState,
    dailyDrawdownPct,
    config,
    macroBrief,
    aiMemories,
    strategyPlaybook,
    dbClosedHistory,
    fillsSummary,
    accountSummary,
    apiPrivateKey,
    logEvent,
    submitProtectedOrder,
    handleCloseLivePosition,
    handleCloseAllLivePositions,
  ]);

  // Auto-run continuous multi-position scan cycle (default 45s in aggressive mode)
  const brainRef = useRef(runUnifiedBrainCycle);
  brainRef.current = runUnifiedBrainCycle;
  useEffect(() => {
    if (!config.aiEnabled) return;
    void brainRef.current();
    const intervalMs = Math.max(15, config.scanIntervalSec || 45) * 1000;
    const timer = setInterval(() => void brainRef.current(), intervalMs);
    return () => clearInterval(timer);
  }, [config.aiEnabled, config.scanIntervalSec]);

  // Ultra-Fast Live Position Management Loop (2.5s fetchAllMids + Cached Candles + Express SL/TP/Trailing Exits)
  const runPositionManagerCycle = useCallback(async () => {
    if (
      managingPositionsRef.current ||
      !config.aiEnabled ||
      !config.autoManagePositions ||
      !apiPrivateKey.trim()
    ) {
      return;
    }
    const openPositions = (accountSummary?.positions || []).filter((p) => !p.isExternal);
    if (openPositions.length === 0) return;

    managingPositionsRef.current = true;
    const cycleDetectPerfNow = performance.now();
    try {
      let liveMids: Record<string, number> = {};
      if (!engineWsConnected) {
        try {
          const midsRes = await fetchAllMids(config.network);
          liveMids = midsRes.mids;
        } catch {
          // fallback to marketsByCoin markPx
        }
      }

      await Promise.all(
        openPositions.map(async (pos) => {
          if (pos.isExternal) return;
          const baseAsset = marketsByCoin.get(pos.coin);
          if (!baseAsset) return;
          const liveMidPx = liveMids[pos.coin] > 0 ? liveMids[pos.coin] : baseAsset.markPx;
          const freshAsset: HlAssetMarket = { ...baseAsset, markPx: liveMidPx };

          const now = Date.now();
          const cached = candleCacheRef.current[pos.coin];
          let c15: HlCandle[] = cached?.c15 ?? [];
          let c1h: HlCandle[] = cached?.c1h ?? [];

          if (!cached || now - cached.ts > 25000) {
            try {
              const [fetched15, fetched1h] = await Promise.all([
                fetchCandles(config.network, pos.coin, '15m', 96),
                fetchCandles(config.network, pos.coin, '1h', 60),
              ]);
              c15 = fetched15;
              c1h = fetched1h;
              candleCacheRef.current[pos.coin] = { ts: Date.now(), c15, c1h };
            } catch {
              // keep cached candles if transient fetch error
            }
          }

          const deep = evaluateUnifiedDeepSetup({
            market: freshAsset,
            candles15m: c15,
            candles1h: c1h,
            bids: [],
            asks: [],
            playbook: strategyPlaybook,
            memories: aiMemories,
          });
          lastDeepAnalysesRef.current[pos.coin] = deep;

          const mgr = evaluateOpenPositionManagement({
            position: pos,
            deepAnalysis: deep,
            config,
            peakMovePct: peakMoveByCoinRef.current[pos.coin] ?? 0,
            partialStage: partialStageByCoinRef.current[pos.coin] ?? 0,
          });
          peakMoveByCoinRef.current[pos.coin] = mgr.peakMovePct;

          const milestoneState = spokenMilestoneRef.current[pos.coin] || { breakeven: false, trailing: false };
          if (mgr.action === 'HOLD') {
            if (!milestoneState.trailing && mgr.peakMovePct >= 1.1 && config.trailingStopEnabled) {
              milestoneState.trailing = true;
              milestoneState.breakeven = true;
              spokenMilestoneRef.current[pos.coin] = milestoneState;
              voiceEngine.speak(
                `¡Trailing stop armado en ${pos.coin}, socio! Llevamos ${mgr.peakMovePct.toFixed(2)} por ciento de ganancia, a proteger esa plata.`
              );
            } else if (!milestoneState.breakeven && mgr.peakMovePct >= 0.55) {
              milestoneState.breakeven = true;
              spokenMilestoneRef.current[pos.coin] = milestoneState;
              voiceEngine.speak(
                `¡Posición en ${pos.coin} blindada con comisiones pagadas! Ya nadie nos quita este tiro, chico.`
              );
            }
          }

          if (mgr.action === 'PARTIAL_TP1' || mgr.action === 'PARTIAL_TP2') {
            const partialQty = Number((mgr.size * (mgr.closeFraction ?? 0.3)).toFixed(6));
            await logEvent('EXEC', mgr.action, pos.coin, mgr.reason);
            voiceEngine.speak(`¡Cobrando parcial en ${pos.coin}, socio! ${mgr.reason}`, true);
            await handleCloseLivePosition(pos.coin, pos.side, partialQty, mgr.reason, {
              detectedPerfNow: cycleDetectPerfNow,
              skipL2Precheck: true,
              overrideRefPx: liveMidPx,
              partialFraction: mgr.closeFraction,
              nextStage: mgr.stage,
            });
          } else if (mgr.action !== 'HOLD') {
            const isExpress =
              mgr.action === 'CLOSE_SL' ||
              mgr.action === 'CLOSE_TP' ||
              mgr.action === 'CLOSE_TRAILING' ||
              mgr.action === 'CLOSE_LIQ_GUARD';
            await logEvent('EXEC', mgr.action, pos.coin, mgr.reason);
            voiceEngine.speak(`¡Cortando jugada en ${pos.coin}! ${mgr.reason}`, true);
            await handleCloseLivePosition(pos.coin, pos.side, mgr.size, mgr.reason, {
              detectedPerfNow: cycleDetectPerfNow,
              skipL2Precheck: isExpress,
              overrideRefPx: liveMidPx,
            });
          }
        })
      );
    } catch (err) {
      console.error('Position manager cycle error:', err);
    } finally {
      managingPositionsRef.current = false;
    }
  }, [
    config,
    apiPrivateKey,
    accountSummary,
    marketsByCoin,
    strategyPlaybook,
    aiMemories,
    logEvent,
    handleCloseLivePosition,
  ]);

  const posManagerRef = useRef(runPositionManagerCycle);
  posManagerRef.current = runPositionManagerCycle;
  useEffect(() => {
    if (!config.aiEnabled || !config.autoManagePositions) return;
    const timer = setInterval(() => void posManagerRef.current(), 2500);
    return () => clearInterval(timer);
  }, [config.aiEnabled, config.autoManagePositions]);

  // Synthesize & distill separated SI_ENTRAR vs NO_ENTRAR rules STRICTLY from TUG777 0x777 fills + DB positions
  const handleLearnFromHistory = useCallback(async () => {
    const knownCloids = new Set(
      persistedPositions.map((p) => (p.cloid || '').toLowerCase()).filter(Boolean)
    );
    const knownOids = new Set(
      persistedPositions.map((p) => Number(p.hlOrderId)).filter((n) => Number.isFinite(n) && n > 0)
    );
    const tugClosedFills = userFills.filter(
      (f) => Math.abs(f.closedPnl) > 0.0001 && isTug777Fill(f, knownOids, knownCloids)
    );
    const tugFillsSummary = (() => {
      if (tugClosedFills.length === 0) {
        return {
          totalClosed: 0,
          winRatePct: 0,
          netPnlUsd: 0,
          totalFeesUsd: 0,
          losingCoins: [] as Array<{ coin: string; netPnl: number; trades: number; wins: number; losses: number }>,
          winningCoins: [] as Array<{ coin: string; netPnl: number; trades: number; wins: number; losses: number }>,
          recentClosed: [] as Array<{ coin: string; side: string; netPnl: number; px: number; time: number }>,
        };
      }
      const coinMap = new Map<string, { coin: string; netPnl: number; trades: number; wins: number; losses: number }>();
      let wins = 0;
      let netUsd = 0;
      let feesUsd = 0;
      for (const f of tugClosedFills) {
        const net = f.closedPnl - f.fee;
        netUsd += net;
        feesUsd += f.fee;
        if (net > 0) wins += 1;
        const cur = coinMap.get(f.coin) || { coin: f.coin, netPnl: 0, trades: 0, wins: 0, losses: 0 };
        cur.netPnl += net;
        cur.trades += 1;
        if (net > 0) cur.wins += 1;
        else cur.losses += 1;
        coinMap.set(f.coin, cur);
      }
      const stats = Array.from(coinMap.values());
      return {
        totalClosed: tugClosedFills.length,
        winRatePct: Number(((wins / tugClosedFills.length) * 100).toFixed(1)),
        netPnlUsd: Number(netUsd.toFixed(2)),
        totalFeesUsd: Number(feesUsd.toFixed(2)),
        losingCoins: [...stats].filter((c) => c.netPnl < 0).sort((a, b) => a.netPnl - b.netPnl).slice(0, 5),
        winningCoins: [...stats].filter((c) => c.netPnl > 0).sort((a, b) => b.netPnl - a.netPnl).slice(0, 5),
        recentClosed: tugClosedFills.slice(0, 10).map((f) => ({
          coin: f.coin,
          side: f.side,
          netPnl: Number((f.closedPnl - f.fee).toFixed(2)),
          px: f.px,
          time: f.time,
        })),
      };
    })();

    const closedPositions = persistedPositions.filter((p) => p.status === 'CLOSED' && !p.isExternal);
    if (tugFillsSummary.totalClosed === 0 && closedPositions.length === 0) {
      soundEngine.alert();
      voiceEngine.speak('¡Todavía no hay historial propio 0x777 cerrado, socio! Los fills externos se ignoran.', true);
      setStatusNotice({
        type: 'info',
        text: 'Sin fills propios de TUG777 (cloid 0x777...) para destilar. Los fills externos de la cuenta se filtran automáticamente.',
      });
      return;
    }

    setLearningHistory(true);
    soundEngine.click();
    try {
      const candidateLessons = synthesizeStructuredLearningFromHistory({
        fillsSummary: tugFillsSummary,
        closedPositions,
        playbook: strategyPlaybook,
      });

      const existingFps = new Set(aiMemories.map((m) => memoryFingerprint(m)));
      const newLessons = candidateLessons.filter((l) => {
        const fp = memoryFingerprint(l);
        if (existingFps.has(fp)) return false;
        existingFps.add(fp);
        return true;
      });

      if (user) {
        for (const l of newLessons) {
          await appendAiMemory(user.uid, l);
        }
      }

      if (newLessons.length > 0) {
        const nowMs = Date.now();
        const localNew: AiMemoryEntry[] = newLessons.map((l, idx) => ({
          ...l,
          id: `hist-${nowMs}-${idx}`,
          ownerId: user?.uid || 'local',
          createdAtMs: nowMs + idx,
        }));
        setAiMemories((prev) => {
          const merged = mergeMemoriesAdditive(localNew, prev);
          saveLocalMemories(merged);
          return merged;
        });
      }

      const siCount = newLessons.filter((l) => l.regime.startsWith('SI_ENTRAR')).length;
      const noCount = newLessons.filter((l) => l.regime.startsWith('NO_ENTRAR')).length;
      const totalCount = aiMemories.length + newLessons.length;
      soundEngine.tradeExecuted();
      voiceEngine.speak(
        newLessons.length > 0
          ? `¡Aprendizaje limpio solo de 0x777, socio! Destilamos ${siCount} reglas SÍ entrar y ${noCount} reglas NO entrar. Total: ${totalCount}.`
          : `¡Todo tu código de la calle 0x777 ya está aprendido, chico! Total intacto: ${totalCount} reglas.`,
        true
      );
      setStatusNotice({
        type: 'ok',
        text:
          newLessons.length > 0
            ? `+${newLessons.length} reglas destiladas solo de órdenes TUG777 (0x777) (+${siCount} SÍ ENTRAR · +${noCount} NO ENTRAR). Total: ${totalCount}.`
            : `Memoria al día: las ${totalCount} reglas SÍ ENTRAR / NO ENTRAR (solo TUG777 0x777) siguen intactas.`,
      });
    } catch (err) {
      soundEngine.alert();
      setStatusNotice({
        type: 'error',
        text: `Error analizando historial: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setLearningHistory(false);
    }
  }, [userFills, persistedPositions, strategyPlaybook, aiMemories, user]);

  const handleClosePersistedAndLearn = async (pos: PersistedPosition) => {
    const liveMatch = accountSummary?.positions.find((p) => p.coin === pos.coin);
    if (liveMatch) {
      await handleCloseLivePosition(
        liveMatch.coin,
        liveMatch.side,
        Math.abs(liveMatch.szi),
        'Cierre unificado desde Posiciones Persistidas'
      );
      return;
    }

    const liveMark = marketsByCoin.get(pos.coin)?.markPx ?? pos.markPx;
    const realized = (pos.side === 'LONG' ? liveMark - pos.entryPx : pos.entryPx - liveMark) * pos.size;
    const isWin = realized >= 0.05;
    const isLoss = realized <= -0.05;
    const structuredRegime = isLoss
      ? `NO_ENTRAR: Cierre ${pos.mode}`
      : isWin
      ? `SI_ENTRAR: Cierre ${pos.mode}`
      : `Cierre ${pos.mode}`;

    setPersistedPositions((prev) => {
      const updated = prev.map((p) =>
        p.id === pos.id
          ? { ...p, status: 'CLOSED' as const, markPx: liveMark, realizedPnl: realized, unrealizedPnl: 0, updatedAtMs: Date.now() }
          : p
      );
      saveLocalPositions(updated);
      return updated;
    });

    if (!user) {
      const localMem: AiMemoryEntry = {
        id: `local-mem-${Date.now()}`,
        ownerId: 'local',
        coin: pos.coin,
        regime: structuredRegime,
        outcome: isWin ? 'WIN' : isLoss ? 'LOSS' : 'BREAKEVEN',
        pnlUsd: realized,
        lesson: `${isLoss ? 'Evitar repetir entrada similar: ' : 'Patrón validado: '}${pos.side} en ${pos.coin} (${realized >= 0 ? '+' : ''}$${realized.toFixed(2)}). ${pos.thesis.slice(0, 180)}`,
        createdAtMs: Date.now(),
      };
      setAiMemories((prev) => {
        const merged = mergeMemoriesAdditive([localMem], prev);
        saveLocalMemories(merged);
        return merged;
      });
      soundEngine.tradeExecuted();
      voiceEngine.speak(
        `¡Cerrado en ${pos.coin}, socio! Regla ${isLoss ? 'de NO entrar' : 'ganadora'} guardada.`,
        true
      );
      setStatusNotice({
        type: 'ok',
        text: `Registro local de ${pos.coin} cerrado y regla adherida (${realized >= 0 ? '+' : ''}$${realized.toFixed(2)}).`,
      });
      return;
    }

    if (!pos.id.startsWith('local-')) {
      await closePersistedPosition(user.uid, pos.id, liveMark, realized);
    }
    if (pos.strategyTag) {
      await recordStrategyTradeOutcome(user.uid, pos.strategyTag.split(','), realized);
    }

    try {
      let learnedRegime = structuredRegime;
      let learnedOutcome: 'WIN' | 'LOSS' | 'BREAKEVEN' = isWin ? 'WIN' : isLoss ? 'LOSS' : 'BREAKEVEN';
      let learnedLesson = `${isLoss ? 'NO repetir setup sin filtro: ' : 'Setup SÍ ENTRAR validado: '}${pos.side} en ${pos.coin} ($${realized.toFixed(2)}).`;

      if (hasConfiguredBackendForApk()) {
        const res = await fetch(buildBackendApiUrl('/api/ai/post-trade-lesson'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            coin: pos.coin,
            side: pos.side,
            entryPx: pos.entryPx,
            exitPx: liveMark,
            pnlUsd: realized,
            mode: pos.mode,
            thesis: pos.thesis,
            geminiModel: config.geminiModel || 'auto',
            aiProvider: config.aiProvider,
            customAiUrl: config.customAiUrl,
            customAiModel: config.customAiModel,
          }),
        });
        if (res.ok) {
          const learned = await parseAiJson<{
            regime: string;
            outcome: 'WIN' | 'LOSS' | 'BREAKEVEN';
            lesson: string;
          }>(res);
          const prefix = learned.outcome === 'LOSS' ? 'NO_ENTRAR: ' : 'SI_ENTRAR: ';
          learnedRegime = learned.regime.startsWith('SI_ENTRAR') || learned.regime.startsWith('NO_ENTRAR')
            ? learned.regime
            : `${prefix}${learned.regime}`.slice(0, 62);
          learnedOutcome = learned.outcome;
          learnedLesson = learned.lesson;
        }
      }

      await appendAiMemory(user.uid, {
        coin: pos.coin,
        regime: learnedRegime,
        outcome: learnedOutcome,
        pnlUsd: realized,
        lesson: learnedLesson,
      });

      soundEngine.tradeExecuted();
      voiceEngine.speak(
        `¡Posición en ${pos.coin} cerrada con ${realized >= 0 ? 'ganancia' : 'pérdida'} de ${Math.abs(realized).toFixed(2)} dólares, socio! Lección adherida al libro.`,
        true
      );
      setStatusNotice({
        type: 'ok',
        text: `Posición ${pos.coin} cerrada y lección adherida en Firestore sin borrar historial previo.`,
      });
    } catch (err) {
      console.error('Learn loop error:', err);
      setStatusNotice({
        type: 'ok',
        text: `Posición ${pos.coin} cerrada en Firestore.`,
      });
    }
  };

  const handleSendChat = useCallback(
    async (message: string, useSearch: boolean, speakReply = false) => {
      setChatSending(true);
      try {
        if (user) {
          await appendChatMessage(user.uid, { role: 'user', content: message, modelUsed: 'user' });
        } else {
          setChatMessages((prev) => {
            const next: ChatMessageEntry[] = [
              ...prev,
              {
                id: `local-u-${Date.now()}`,
                ownerId: 'local',
                role: 'user',
                content: message,
                modelUsed: 'user',
                createdAtMs: Date.now(),
              },
            ];
            saveLocalChat(next);
            return next;
          });
        }

        const separated = extractSeparatedLearningRules({
          memories: aiMemories,
          dbHistory: dbClosedHistory,
          fillsSummary,
          playbook: strategyPlaybook,
        });

        let replyText = '';
        let replyModel = 'Motor Local TUG777 (Tony Montana Mode)';

        if (!hasConfiguredBackendForApk()) {
          const openCount = accountSummary?.positions.length ?? 0;
          const activeStrats = strategyPlaybook.filter((s) => s.enabled).length;
          replyText = `¡Órale socio! Aquí en la APK estamos corriendo en modo autónomo con la Guía Unificada y tus ${activeStrats}/10 estrategias activas. ${selectedCoin} cotiza en $${selectedAsset?.markPx?.toFixed(4) ?? '--'} (score ${selectedAsset?.quantScore ?? 0}, ${selectedAsset?.quantBias ?? 'NEUTRAL'}). Tienes ${openCount} posiciones vivas, ${separated.positiveEntryRules.length} reglas SÍ ENTRAR y ${separated.negativeNoEntryRules.length} reglas NO ENTRAR protegiendo la plata. Si quieres usar Gemini o DeepSeek desde tu teléfono, nomás pon tu URL del servidor Droplet en Parámetros IA → Conexión Backend.`;
        } else {
          const res = await fetch(buildBackendApiUrl('/api/ai/chat'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({
              history: chatMessages.map((m) => ({ role: m.role, content: m.content })),
              message,
              useSearch,
              geminiModel: config.geminiModel || 'auto',
              aiProvider: config.aiProvider,
              customAiUrl: config.customAiUrl,
              customAiModel: config.customAiModel,
              customSystemPrompt: config.customSystemPrompt,
              marketContext: {
                selectedCoin,
                selectedMarkPx: selectedAsset?.markPx,
                topSignals: markets.slice(0, 8).map((m) => ({
                  coin: m.coin,
                  markPx: m.markPx,
                  change24hPct: Number(m.change24hPct.toFixed(2)),
                  fundingApr: Number(m.annualizedFundingPct.toFixed(1)),
                  quantScore: m.quantScore,
                  quantBias: m.quantBias,
                })),
                openPositions: accountSummary?.positions || [],
                recentMemories: aiMemories.slice(0, 20),
                positiveEntryRules: separated.positiveEntryRules,
                negativeNoEntryRules: separated.negativeNoEntryRules,
              },
            }),
          });
          const data = await parseAiJson<{ reply: string; modelUsed?: string; error?: string }>(res);
          if (!res.ok) throw new Error(data?.error || 'Error en chat IA');
          replyText = data.reply;
          replyModel = data.modelUsed || 'gemini-3.1-flash-lite';
        }

        if (user) {
          await appendChatMessage(user.uid, {
            role: 'assistant',
            content: replyText,
            modelUsed: replyModel,
          });
        } else {
          setChatMessages((prev) => {
            const next: ChatMessageEntry[] = [
              ...prev,
              {
                id: `local-a-${Date.now()}`,
                ownerId: 'local',
                role: 'assistant',
                content: replyText,
                modelUsed: replyModel,
                createdAtMs: Date.now(),
              },
            ];
            saveLocalChat(next);
            return next;
          });
        }

        if (speakReply || voiceNarratorEnabled) {
          voiceEngine.speak(replyText, true);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        voiceEngine.speak(`¡Falla en el copiloto, socio! ${msg}`, true);
        setStatusNotice({ type: 'error', text: msg });
      } finally {
        setChatSending(false);
      }
    },
    [
      user,
      chatMessages,
      config,
      selectedCoin,
      selectedAsset,
      markets,
      accountSummary,
      aiMemories,
      dbClosedHistory,
      fillsSummary,
      strategyPlaybook,
      voiceNarratorEnabled,
    ]
  );

  // Hands-free voice command dispatcher (uses ref so SpeechRecognition keeps live state)
  const handleVoiceCommand = useCallback(
    async (cmd: ParsedVoiceCommand) => {
      soundEngine.click();
      setVoiceCommandLabel(cmd.type);

      switch (cmd.type) {
        case 'MUTE_VOICE':
          setVoiceNarratorEnabled(false);
          voiceEngine.stopSpeaking();
          setStatusNotice({ type: 'info', text: 'Voz narradora silenciada por comando de voz.' });
          return;
        case 'AI_ON':
          soundEngine.powerOn();
          voiceEngine.speak('¡Máquina encendida, socio! Vamos por todo el dinero del mercado.', true);
          void handleSetEngineActive(true);
          return;
        case 'AI_OFF':
          soundEngine.powerOff();
          voiceEngine.speak('Bajando las armas por ahora, chico. Motor en pausa.', true);
          void handleSetEngineActive(false);
          return;
        case 'MODE_STRATEGY':
          voiceEngine.speak('¡Puro músculo de la calle! Modo diez estrategias activado.', true);
          void updateConfigPatch({ mode: 'strategy' });
          return;
        case 'MODE_AI':
          voiceEngine.speak('Modo Inteligencia Artificial pura al mando, socio.', true);
          void updateConfigPatch({ mode: 'ai' });
          return;
        case 'MODE_STRATEGY_AI':
          voiceEngine.speak('¡Modo unificado Estrategia más IA encendido! Nadie nos para, chico.', true);
          void updateConfigPatch({ mode: 'strategy_ai' });
          return;
        case 'ANALYZE_NOW':
          voiceEngine.speak('¡Escaneando todo Hyperliquid ahora mismo, socio!', true);
          void runUnifiedBrainCycle(true);
          return;
        case 'NAV_TERMINAL':
          setActiveTab('terminal');
          voiceEngine.speak('Abriendo terminal de combate.', true);
          return;
        case 'NAV_POSITIONS':
          setActiveTab('positions');
          voiceEngine.speak('Viendo nuestras posiciones vivas, chico.', true);
          return;
        case 'NAV_PNL':
          setActiveTab('pnl');
          voiceEngine.speak('Contando los billetes en el P N L.', true);
          return;
        case 'NAV_LOGS':
          setActiveTab('logs');
          voiceEngine.speak('Abriendo bitácora y código de la calle.', true);
          return;
        case 'NAV_DROPLET':
          setActiveTab('droplet');
          voiceEngine.speak('Abriendo el cuartel veinticuatro siete en Droplet.', true);
          return;
        case 'SYNC_POSITIONS':
          voiceEngine.speak('Sincronizando cuentas con Hyperliquid, socio.', true);
          void refreshAccountData(true);
          return;
        case 'SAVE_CONFIG':
          void handleSaveAppConfig();
          return;
        case 'OPEN_API_MODAL':
          setApiModalOpen(true);
          voiceEngine.speak('Abriendo bóveda de API Wallet.', true);
          return;
        case 'OPEN_PARAMS_MODAL':
          setAiParamsOpen(true);
          voiceEngine.speak('Abriendo panel de parámetros y estrategias.', true);
          return;
        case 'OPEN_COPILOT':
          setCopilotOpen(true);
          voiceEngine.speak('¿Qué necesitas, socio? Copiloto listo.', true);
          return;
        case 'SELECT_COIN':
          if (cmd.coin) {
            setSelectedCoin(cmd.coin);
            setActiveTab('terminal');
            voiceEngine.speak(`Poniendo la mira en ${cmd.coin}, chico.`, true);
          }
          return;
        case 'OPEN_TRADE':
          if (cmd.coin && cmd.side) {
            setSelectedCoin(cmd.coin);
            await submitProtectedOrder({
              coin: cmd.coin,
              side: cmd.side,
              notionalUsd: cmd.notionalUsd ?? config.riskPerTradeUsd,
              mode: 'manual',
              thesis: `Orden por comando de voz: "${cmd.rawText}"`,
            });
          }
          return;
        case 'CLOSE_TRADE':
          if (cmd.coin) {
            const livePos = accountSummary?.positions.find((p) => p.coin === cmd.coin);
            if (livePos) {
              await handleCloseLivePosition(livePos.coin, livePos.side, Math.abs(livePos.szi));
              return;
            }
            const dbPos = persistedPositions.find((p) => p.coin === cmd.coin && p.status === 'OPEN');
            if (dbPos) {
              await handleClosePersistedAndLearn(dbPos);
              return;
            }
            voiceEngine.speak(`No veo ninguna posición abierta en ${cmd.coin}, socio.`, true);
            setStatusNotice({ type: 'info', text: `No hay posición abierta en ${cmd.coin} para cerrar.` });
          }
          return;
        case 'CLOSE_ALL': {
          const openLive = accountSummary?.positions || [];
          if (openLive.length === 0) {
            voiceEngine.speak('No tienes ni una posición abierta para cerrar, chico.', true);
            return;
          }
          voiceEngine.speak(`¡Liquidando las ${openLive.length} posiciones abiertas, socio!`, true);
          for (const p of openLive) {
            await handleCloseLivePosition(p.coin, p.side, Math.abs(p.szi));
          }
          return;
        }
        case 'ASK_COPILOT':
        default:
          setCopilotOpen(true);
          voiceEngine.speak('Consultando al copiloto, socio.', true);
          void handleSendChat(cmd.rawText, config.useSearchGrounding, true);
          return;
      }
    },
    [
      config,
      accountSummary,
      persistedPositions,
      runUnifiedBrainCycle,
      refreshAccountData,
      handleSaveAppConfig,
      submitProtectedOrder,
      handleCloseLivePosition,
      handleSendChat,
    ]
  );

  const voiceCmdRef = useRef(handleVoiceCommand);
  voiceCmdRef.current = handleVoiceCommand;

  const toggleVoiceMic = () => {
    soundEngine.click();
    if (listeningVoice) {
      voiceEngine.stopListening();
      setListeningVoice(false);
      voiceEngine.speak('Micrófono apagado, socio.', true);
      return;
    }
    voiceEngine.speak('¡Habla claro chico, te escucho al cien!', true);
    voiceEngine.startListening(
      (cmd) => {
        void voiceCmdRef.current(cmd);
      },
      (status) => {
        setListeningVoice(status.listening);
        if (status.transcript) setVoiceTranscript(status.transcript);
        if (status.error) {
          setStatusNotice({ type: 'error', text: status.error });
        }
      }
    );
  };

  const handleApkAction = async () => {
    soundEngine.tradeExecuted();
    voiceEngine.speak('¡Descargando el A P K de T U G 777 para tu teléfono, socio! El mundo es tuyo.', true);
    await downloadAndroidApkKit(window.location.origin);
    setStatusNotice({
      type: 'ok',
      text: 'Descargando TUG777-HyperTrade.apk (APK real firmado v3.4.0). Ábrelo en tu Android y permite "Instalar apps desconocidas" para instalarlo.',
    });
  };

  const filteredMarkets = useMemo(() => {
    const q = tokenSearch.trim().toUpperCase();
    return markets.filter((m) => {
      if (q && !m.coin.includes(q)) return false;
      if (biasFilter !== 'ALL' && m.quantBias !== biasFilter) return false;
      return true;
    });
  }, [markets, tokenSearch, biasFilter]);

  return (
    <div className="min-h-screen bg-[#090B0E] text-slate-100 flex flex-col">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-40 bg-[#090B0E]/95 backdrop-blur-md border-b border-slate-800/80 px-4 lg:px-8 py-3.5 flex items-center justify-between gap-8">
        {/* Zone 1: Corner Seal TUG777 */}
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            soundEngine.tabSwitch();
            setActiveTab('terminal');
          }}
          className="flex items-center gap-2.5 whitespace-nowrap shrink-0"
        >
          <span className="w-7 h-7 rounded bg-amber-500 text-slate-950 font-black text-xs flex items-center justify-center tracking-tighter">
            777
          </span>
          <span className="text-lg font-extrabold tracking-tight text-slate-100">TUG777</span>
        </a>

        {/* Zone 2: Clean Single-Line Navigation Links (including separate Droplet 24/7 tab) */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium">
          {(
            [
              { id: 'terminal', label: 'Terminal' },
              { id: 'positions', label: 'Posiciones' },
              { id: 'pnl', label: 'PnL' },
              { id: 'logs', label: 'Logs' },
              { id: 'droplet', label: 'Droplet 24/7' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              onClick={() => {
                soundEngine.tabSwitch();
                setActiveTab(tab.id);
                voiceEngine.speak(`Viendo ${tab.label}, socio.`);
              }}
              className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                activeTab === tab.id
                  ? 'border-amber-400 text-slate-100'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        {/* Zone 3: Primary Action CTA (API Wallet) */}
        <div className="shrink-0">
          <button
            onClick={() => {
              soundEngine.click();
              setApiModalOpen(true);
            }}
            className={`px-4 py-2 rounded-md text-xs font-bold inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 ${
              apiPrivateKey
                ? 'bg-emerald-600/20 border border-emerald-500/50 text-emerald-300 hover:bg-emerald-600/30'
                : 'bg-amber-500 hover:bg-amber-400 text-slate-950'
            }`}
          >
            <KeyRound className="w-3.5 h-3.5" />
            {apiPrivateKey ? 'API Conectada' : 'Conectar API Wallet'}
          </button>
        </div>
      </header>

      {/* Mobile Tab Strip */}
      <div className="md:hidden flex items-center gap-2 overflow-x-auto px-4 py-2 border-b border-slate-800/80 bg-[#0C1016]">
        {(
          [
            { id: 'terminal', label: 'Terminal' },
            { id: 'positions', label: 'Posiciones' },
            { id: 'pnl', label: 'PnL' },
            { id: 'logs', label: 'Logs' },
            { id: 'droplet', label: 'Droplet 24/7' },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            onClick={() => {
              soundEngine.tabSwitch();
              setActiveTab(tab.id);
              voiceEngine.speak(`Pestaña ${tab.label}`);
            }}
            className={`px-3 py-1.5 rounded text-xs font-medium whitespace-nowrap shrink-0 ${
              activeTab === tab.id ? 'bg-amber-500/20 text-amber-300' : 'text-slate-400'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Main Content Container */}
      <main className="flex-1 w-full max-w-[1440px] mx-auto px-4 lg:px-8 py-6 space-y-6">
        {/* OAuth Sign-In Banner when unauthenticated */}
        {authReady && !user && (
          <section className="bg-[#0F131A] border border-amber-500/40 rounded-lg px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-0.5">
              <h2 className="text-sm font-bold text-slate-100">
                Acceso OAuth — Inicia sesión para persistir posiciones, logs y aprendizaje IA
              </h2>
              <p className="text-xs text-slate-400">
                Conecta tu cuenta con Google OAuth (Firebase Auth) para sincronizar tu configuración y memoria de trades en Firestore.
              </p>
            </div>
            <button
              disabled={oauthLoading}
              onClick={() => void handleGoogleOAuthSignIn()}
              className="px-4 py-2.5 rounded-md bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 text-xs font-bold inline-flex items-center justify-center gap-2 transition-colors whitespace-nowrap shrink-0"
            >
              <LogIn className="w-4 h-4" />
              {oauthLoading ? 'Conectando OAuth...' : 'Ingresar con Google OAuth'}
            </button>
          </section>
        )}

        {/* Hero Welcome Banner ("THE WORLD IS YOURS W") + Unified Brain Controls */}
        <section className="bg-[#0F131A] border border-slate-800/90 rounded-lg p-5 lg:p-6 space-y-5">
          <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-6">
            {/* Cursive Welcome Phrase */}
            <div className="space-y-1">
              <h1 className="font-cursive-welcome text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-slate-100 leading-none">
                THE WORLD IS YOURS <span className="text-amber-400">W</span>
              </h1>
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400 font-mono-tabular pt-1">
                <span>Hyperliquid {config.network.toUpperCase()}</span>
                <span aria-hidden="true">·</span>
                <span className={engineWsConnected ? 'text-emerald-400' : 'text-amber-300'}>
                  WS {engineWsConnected ? 'Persistente' : 'Fallback'}: {hlLatencyMs || '--'} ms
                </span>
                <span aria-hidden="true">·</span>
                <span className="text-amber-300">
                  Ruta ({orderTelemetry.activeRoute}):{' '}
                  {orderTelemetry.lastE2eConfirmMs > 0
                    ? `${orderTelemetry.lastE2eConfirmMs} ms`
                    : 'Sin órdenes'}
                </span>
                <span aria-hidden="true">·</span>
                <span className={engineSnapshot?.mcloudConnected ? 'text-sky-400' : 'text-slate-400'}>
                  Montana Cloud: {engineSnapshot?.mcloudConnected ? 'CONECTADA' : config.mcloudEnabled ? 'ESPERA' : 'OFF'}
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  Escaneados: {engineSnapshot?.scannedTokenCount || markets.length} · Watchlist:{' '}
                  {(config.watchlistCoinsCsv || 'BTC,ETH,SOL,HYPE').split(',').filter(Boolean).length}
                </span>
              </div>
            </div>

            {/* Unified Controls Bar: Engine PAUSED/ACTIVE + Bias Lock + 3 Modes + APK + Auth + Sound + Copilot */}
            <div className="flex flex-wrap items-center gap-2.5">
              {/* Engine PAUSED / ACTIVE Power Button */}
              <button
                onClick={() => {
                  voiceEngine.unlockFromUserGesture();
                  const next = !config.aiEnabled;
                  if (next) {
                    soundEngine.powerOn();
                    voiceEngine.speak('¡Motor 24/7 activado, socio! El mundo es tuyo, vamos por la plata.', true);
                  } else {
                    soundEngine.powerOff();
                    voiceEngine.speak('Motor en pausa segura, chico. Modo solo lectura.', true);
                  }
                  void handleSetEngineActive(next);
                }}
                className={`px-3.5 py-2.5 rounded-md text-xs font-bold inline-flex items-center gap-2 border transition-all whitespace-nowrap shrink-0 ${
                  config.aiEnabled
                    ? 'bg-emerald-600 border-emerald-400 text-white shadow-lg shadow-emerald-950/50'
                    : 'bg-[#090B0E] border-amber-500/50 text-amber-300 hover:border-amber-400'
                }`}
              >
                <Power className="w-4 h-4" />
                {config.aiEnabled ? 'MOTOR ACTIVO' : 'PAUSADO (Solo Lectura)'}
              </button>

              {/* Bias Lock Quick Selector */}
              <select
                aria-label="Sesgo direccional global"
                value={config.globalBiasLock || 'AMBOS'}
                onChange={(e) => {
                  soundEngine.click();
                  void updateConfigPatch({ globalBiasLock: e.target.value as BiasLockMode });
                }}
                className="px-2.5 py-2.5 rounded-md bg-[#090B0E] border border-slate-700 text-xs font-semibold text-slate-200 focus:outline-none focus:border-amber-500"
              >
                <option value="AMBOS">Bias: AMBOS</option>
                <option value="SOLO_LONG">Bias: SOLO LONG</option>
                <option value="SOLO_SHORT">Bias: SOLO SHORT</option>
                <option value="PAUSA">Bias: PAUSA</option>
              </select>

              {/* Kill Switch ON / OFF Toggle (Closes Positions, NEVER Locks App) */}
              <button
                type="button"
                title="Activa o desactiva el Auto-Cierre del Kill Switch (nunca bloquea tu app)"
                onClick={() => {
                  voiceEngine.unlockFromUserGesture();
                  const next = !Boolean(config.killSwitchEnabled);
                  soundEngine.click();
                  consecutiveExecErrorsRef.current = 0;
                  if (!next) {
                    setKillSwitchState(null);
                    voiceEngine.speak('¡Kill Switch apagado, socio! Aquí tú mandas, cero bloqueos.', true);
                  } else {
                    voiceEngine.speak(
                      `¡Kill Switch encendido al menos ${(config.dailyMaxLossPct ?? 2.5).toFixed(1)} por ciento, chico! Si toca ese límite, cierra posiciones TUG777 en automático.`,
                      true
                    );
                  }
                  void updateConfigPatch({ killSwitchEnabled: next });
                }}
                className={`px-3.5 py-2.5 rounded-md text-xs font-bold inline-flex items-center gap-1.5 border transition-all whitespace-nowrap shrink-0 ${
                  config.killSwitchEnabled
                    ? 'bg-red-600/85 border-red-400 text-white shadow-md shadow-red-950/40'
                    : 'bg-[#090B0E] border-slate-700 text-slate-300 hover:border-slate-500'
                }`}
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                Kill Switch {config.killSwitchEnabled ? `ON (-${config.dailyMaxLossPct ?? 2.5}%)` : 'OFF'}
              </button>

              {/* Emergency 1-Click Kill Switch: Close All Open Positions */}
              {(accountSummary?.positions?.length ?? 0) > 0 && (
                <button
                  type="button"
                  disabled={closingAll}
                  onClick={() => {
                    voiceEngine.unlockFromUserGesture();
                    soundEngine.alert();
                    void handleCloseAllLivePositions();
                  }}
                  className="px-3.5 py-2.5 rounded-md bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-xs font-bold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                >
                  <XCircle className="w-3.5 h-3.5" />
                  {closingAll ? 'Cerrando Posiciones...' : `Cerrar Todo (${accountSummary?.positions?.length})`}
                </button>
              )}

              {/* 3 Unified Brain Modes */}
              <div className="flex flex-wrap items-center bg-[#090B0E] p-1 rounded-md border border-slate-800">
                {(
                  [
                    { id: 'strategy', label: 'Estrategia' },
                    { id: 'ai', label: 'IA' },
                    { id: 'strategy_ai', label: 'Estrategia + IA' },
                  ] as const
                ).map((m) => (
                  <button
                    key={m.id}
                    onClick={() => {
                      voiceEngine.unlockFromUserGesture();
                      soundEngine.click();
                      voiceEngine.speak(`¡Modo ${m.label} activado, chico!`, true);
                      void updateConfigPatch({ mode: m.id });
                    }}
                    className={`px-3 py-1.5 rounded text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                      config.mode === m.id
                        ? 'bg-amber-500 text-slate-950'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>

              {/* Manual Brain Scan Trigger (NEVER blocked) */}
              <button
                disabled={brainThinking}
                onClick={() => {
                  voiceEngine.unlockFromUserGesture();
                  soundEngine.click();
                  void runUnifiedBrainCycle(true);
                }}
                className="px-3.5 py-2.5 rounded-md bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-xs font-semibold text-slate-100 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <Cpu className="w-3.5 h-3.5 text-amber-400" />
                {brainThinking ? 'Analizando...' : 'Analizar Ahora'}
              </button>

              {/* Parámetros IA / BYO-AI Button */}
              <button
                onClick={() => {
                  soundEngine.click();
                  setAiParamsOpen(true);
                }}
                className="px-3.5 py-2.5 rounded-md bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-100 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <Sliders className="w-3.5 h-3.5 text-amber-400" />
                Parámetros IA
              </button>

              {/* Copiloto IA Button */}
              <button
                onClick={() => {
                  soundEngine.click();
                  setCopilotOpen(true);
                }}
                className="px-3.5 py-2.5 rounded-md bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-100 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <MessageSquare className="w-3.5 h-3.5 text-sky-400" />
                Copiloto IA
              </button>

              {/* Download APK Button */}
              <button
                onClick={handleApkAction}
                className="px-3.5 py-2.5 rounded-md bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-amber-300 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <Download className="w-3.5 h-3.5" />
                Descargar APK
              </button>

              {/* Hands-Free Voice Command Mic Toggle */}
              <button
                onClick={toggleVoiceMic}
                className={`px-3.5 py-2.5 rounded-md text-xs font-bold inline-flex items-center gap-1.5 border transition-colors whitespace-nowrap shrink-0 ${
                  listeningVoice
                    ? 'bg-red-600/20 border-red-500 text-red-300'
                    : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-100'
                }`}
              >
                {listeningVoice ? <Mic className="w-3.5 h-3.5 text-red-400" /> : <MicOff className="w-3.5 h-3.5 text-slate-400" />}
                {listeningVoice ? 'Voz Activa' : 'Manos Libres'}
              </button>

              {/* Voice Narrator & FX Audio Toggle */}
              <button
                aria-label="Alternar voz y sonido"
                title="Alternar Voz Narradora y Sonidos"
                onClick={() => {
                  const next = !voiceNarratorEnabled;
                  setVoiceNarratorEnabled(next);
                  soundEngine.enabled = next;
                  if (next) {
                    soundEngine.click();
                    voiceEngine.testVoice(
                      '¡Oye socio! Voz de T U G 777 activada con toda la actitud. Vamos por todo, chico.'
                    );
                  } else {
                    voiceEngine.stopSpeaking();
                  }
                  void updateConfigPatch({ soundEnabled: next });
                }}
                className="px-3 py-2.5 rounded-md bg-[#090B0E] border border-slate-800 text-xs text-slate-300 hover:text-white inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                {voiceNarratorEnabled ? (
                  <Volume2 className="w-4 h-4 text-amber-400" />
                ) : (
                  <VolumeX className="w-4 h-4 text-slate-500" />
                )}
                <span>{voiceNarratorEnabled ? 'Voz ON' : 'Voz OFF'}</span>
              </button>

              {/* Test Voice Button */}
              {voiceNarratorEnabled && (
                <button
                  type="button"
                  title="Probar salida de voz en este dispositivo"
                  onClick={() => {
                    soundEngine.click();
                    const modeLabel = voiceEngine.hasNativeBridge() ? 'motor nativo Android' : 'audio web';
                    voiceEngine.testVoice(
                      `¡Say hello to my little friend! Voz al cien con ${modeLabel}, socio. Escuchando cada jugada en Hyperliquid.`
                    );
                  }}
                  className="px-2.5 py-2.5 rounded-md bg-amber-500/10 border border-amber-500/30 text-[11px] font-semibold text-amber-300 hover:bg-amber-500/20 inline-flex items-center gap-1 whitespace-nowrap shrink-0"
                >
                  <Volume2 className="w-3.5 h-3.5" />
                  <span>Probar Voz</span>
                </button>
              )}

              {/* Save App Configuration Button */}
              <button
                disabled={savingConfig}
                onClick={() => void handleSaveAppConfig()}
                className={`px-3.5 py-2.5 rounded-md text-xs font-bold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 ${
                  configSavedOk
                    ? 'bg-emerald-600 text-white'
                    : 'bg-amber-500/15 border border-amber-500/50 text-amber-300 hover:bg-amber-500/25'
                }`}
              >
                {configSavedOk ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
                {savingConfig ? 'Guardando...' : configSavedOk ? 'Config Guardada' : 'Guardar Config'}
              </button>

              {/* Google OAuth Auth Sync */}
              {user ? (
                <button
                  onClick={() => {
                    soundEngine.click();
                    void signOutUser();
                  }}
                  title={user.email || 'Cerrar sesión'}
                  className="px-3 py-2.5 rounded-md bg-[#090B0E] border border-slate-800 hover:border-slate-700 text-xs text-slate-300 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                >
                  <LogOut className="w-3.5 h-3.5 text-emerald-400" />
                  {user.displayName?.split(' ')[0] || user.email?.split('@')[0] || 'OAuth Activo'}
                </button>
              ) : (
                <button
                  disabled={oauthLoading}
                  onClick={() => void handleGoogleOAuthSignIn()}
                  className="px-3.5 py-2.5 rounded-md bg-slate-100 hover:bg-white disabled:opacity-50 text-slate-950 text-xs font-bold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                >
                  <LogIn className="w-3.5 h-3.5" />
                  {oauthLoading ? 'Conectando...' : 'Ingresar OAuth'}
                </button>
              )}
            </div>
          </div>

          {/* Voice Hands-Free Transcript Strip */}
          {(listeningVoice || voiceTranscript) && (
            <div className="px-4 py-2.5 rounded-md bg-[#090B0E] border border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2 text-slate-200">
                <Mic className={`w-3.5 h-3.5 ${listeningVoice ? 'text-red-400' : 'text-slate-500'}`} />
                <span className="font-semibold text-amber-400">
                  {listeningVoice ? 'Escuchando comandos:' : 'Último comando de voz:'}
                </span>
                <span className="text-slate-300">
                  {voiceTranscript || 'Di por ejemplo: "Abre long BTC 50 dólares", "Analiza el mercado", "Modo estrategia más IA" o "Actualiza posiciones"'}
                </span>
              </div>
              {voiceCommandLabel && (
                <span className="font-mono-tabular text-[11px] text-emerald-400">{voiceCommandLabel}</span>
              )}
            </div>
          )}

          {/* Status Feedback Banner */}
          {statusNotice && (
            <div
              className={`px-4 py-2.5 rounded-md text-xs flex items-center justify-between border ${
                statusNotice.type === 'error'
                  ? 'bg-red-500/10 border-red-500/40 text-red-300'
                  : statusNotice.type === 'ok'
                  ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-300'
                  : 'bg-sky-500/10 border-sky-500/40 text-sky-300'
              }`}
            >
              <span>{statusNotice.text}</span>
              <button onClick={() => setStatusNotice(null)} className="text-slate-400 hover:text-white ml-4">
                Cerrar
              </button>
            </div>
          )}

          {/* Kill Switch Alert Banner */}
          {killSwitchState?.active && (
            <div className="px-4 py-3 rounded-md bg-red-600/15 border border-red-500/60 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="text-red-200">
                <strong className="text-red-400">KILL SWITCH:</strong> {killSwitchState.reason}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {(accountSummary?.positions?.length ?? 0) > 0 && (
                  <button
                    type="button"
                    disabled={closingAll}
                    onClick={() => {
                      soundEngine.alert();
                      void handleCloseAllLivePositions();
                    }}
                    className="px-3 py-1.5 rounded bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-bold text-[11px]"
                  >
                    {closingAll ? 'Cerrando...' : 'Cerrar Posiciones Ahora'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    soundEngine.click();
                    consecutiveExecErrorsRef.current = 0;
                    setKillSwitchState(null);
                    void updateConfigPatch({ killSwitchEnabled: false });
                    voiceEngine.speak('¡Kill switch desactivado, socio! Operando libre al cien.', true);
                  }}
                  className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-600 text-white font-bold text-[11px]"
                >
                  Desactivar Kill Switch (OFF)
                </button>
              </div>
            </div>
          )}

          {/* Unified Brain Latest Verdict + Multi-Channel Latency Strip */}
          <div className="pt-4 border-t border-slate-800/80 grid grid-cols-1 lg:grid-cols-12 gap-4 items-center">
            <div className="lg:col-span-8 flex flex-wrap items-center gap-3 text-xs">
              <span className="inline-flex items-center gap-1.5 font-semibold text-amber-400">
                <Bot className="w-4 h-4" />
                Cerebro Unificado ({config.mode}):
              </span>
              {lastDecision ? (
                <span className="text-slate-200">
                  <strong
                    className={
                      lastDecision.action === 'LONG'
                        ? 'text-emerald-400'
                        : lastDecision.action === 'SHORT'
                        ? 'text-red-400'
                        : 'text-amber-300'
                    }
                  >
                    {lastDecision.action} {lastDecision.coin !== 'NONE' ? lastDecision.coin : ''}
                  </strong>{' '}
                  {lastDecision.decisionBand ? (
                    <span className="text-[11px] text-sky-300 font-semibold">
                      [{formatDecisionBandLabel(lastDecision.decisionBand)}]
                    </span>
                  ) : null}{' '}
                  · Confianza {lastDecision.confidence}% · {lastDecision.reason}
                  {lastDecision.tp1Pct ? (
                    <span className="block text-[11px] font-mono-tabular text-emerald-300/90 mt-0.5">
                      Niveles: SL -{lastDecision.slPct}% · TP1 +{lastDecision.tp1Pct}% (30%+BE) · TP2 +{lastDecision.tp2Pct ?? Number((lastDecision.tpPct * 0.58).toFixed(2))}% (30%) · TP3 +{lastDecision.tp3Pct ?? lastDecision.tpPct}% (40% Trail)
                    </span>
                  ) : null}
                  {lastDecision.optimizerNotes ? (
                    <span className="block text-[11px] text-amber-300/90 mt-0.5">
                      {lastDecision.optimizerNotes}
                    </span>
                  ) : null}
                </span>
              ) : (
                <span className="text-slate-400">
                  En espera · Presiona &quot;Analizar Ahora&quot; o activa &quot;IA ON&quot; para escanear los {markets.length} tokens en vivo.
                </span>
              )}
            </div>

            <div className="lg:col-span-4 flex flex-wrap lg:justify-end items-center gap-3 text-[11px] font-mono-tabular text-slate-400">
              <span className="text-amber-300 font-semibold">
                SL {config.slPct}% / TP3 {config.tpPct}% · Slots {accountSummary?.positions.length ?? 0}/{config.maxOpenPositions}
              </span>
              <span className={config.killSwitchEnabled && dailyDrawdownPct >= (config.dailyMaxLossPct ?? 1.8) * 0.7 ? 'text-red-400 font-semibold' : 'text-slate-300'}>
                Riesgo {config.riskPerTradePct ?? 0.35}% · Hoy -{dailyDrawdownPct.toFixed(2)}% · KS {config.killSwitchEnabled ? `ON (-${config.dailyMaxLossPct ?? 1.8}%)` : 'OFF'}
                {config.autoManagePositions ? ' · 2.5s' : ''}
              </span>
              <span className="inline-flex items-center gap-1 text-emerald-400">
                <ShieldCheck className="w-3.5 h-3.5" />
                MEV Guard {config.mevShieldEnabled ? `ON (${orderTelemetry.activeRoute})` : 'OFF'}
              </span>
            </div>
          </div>

          {/* Separated Latency & MEV Route Telemetry Strip */}
          <div className="pt-3 border-t border-slate-800/60 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 text-[11px] font-mono-tabular">
            {/* 1. Hyperliquid Market Feed (WS + /info fallback) */}
            <div className="bg-[#090B0E] border border-slate-800/80 rounded-md px-3 py-2 space-y-1 min-w-0">
              <div className="flex flex-wrap items-center justify-between gap-1 text-slate-400">
                <span className="font-semibold text-slate-200">1. Feed Hyperliquid</span>
                <span className="text-emerald-400">{hlLatencyMs || '--'} ms</span>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-slate-400">
                {(mevProbe?.channels || [])
                  .filter((ch) => ch.scope === 'HYPERLIQUID_INFO' || ch.scope === 'HYPERLIQUID_WS' || ch.name.startsWith('HL'))
                  .map((ch) => (
                    <span key={ch.id || ch.name} className={ch.ok ? 'text-slate-300' : 'text-red-400'}>
                      {ch.name.replace('HL Info ', '')}: {ch.latencyMs}ms
                    </span>
                  ))}
                <span className="text-slate-500">Canal: {hlChannel}</span>
              </div>
            </div>

            {/* 2. Honest Detect -> Send -> Exec + E2E ACK vs Fill + Historical Degradation */}
            <div className="bg-[#090B0E] border border-slate-800/80 rounded-md px-3 py-2 space-y-1 min-w-0">
              <div className="flex flex-wrap items-center justify-between gap-1 text-slate-400">
                <span className="font-semibold text-slate-200">2. Detect→Envío→Exec (/exchange)</span>
                <span
                  className={
                    orderTelemetry.degradationAlert
                      ? 'text-red-400 font-bold'
                      : orderTelemetry.lastStatus === 'CONFIRMED'
                      ? 'text-emerald-400'
                      : orderTelemetry.lastStatus === 'REJECTED' || orderTelemetry.lastStatus === 'MEV_BLOCKED'
                      ? 'text-red-400'
                      : 'text-amber-300'
                  }
                >
                  {orderTelemetry.lastDetectToExecMs > 0
                    ? `D→E ${orderTelemetry.lastDetectToExecMs}ms · ${orderTelemetry.lastFillStatus}`
                    : orderTelemetry.lastE2eConfirmMs > 0
                    ? `ACK ${orderTelemetry.lastE2eConfirmMs}ms · ${orderTelemetry.lastFillStatus}`
                    : 'Sin órdenes'}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-slate-400">
                <span>
                  Envío: {orderTelemetry.lastDetectToSendMs > 0 ? `${orderTelemetry.lastDetectToSendMs}ms` : '--'}
                </span>
                <span>
                  HL RTT: {orderTelemetry.lastExchangeRttMs > 0 ? `${orderTelemetry.lastExchangeRttMs}ms` : '--'}
                </span>
                <span>
                  Hist D→E Prom/Max:{' '}
                  {orderTelemetry.avgDetectToExecMs > 0
                    ? `${orderTelemetry.avgDetectToExecMs}/${orderTelemetry.maxDetectToExecMs}ms`
                    : orderTelemetry.avgConfirmMs > 0
                    ? `${orderTelemetry.avgConfirmMs}/${orderTelemetry.maxConfirmMs}ms`
                    : '--'}
                </span>
                <span className="text-slate-500">
                  ({latencyHistory.length} muestras · Fill {orderTelemetry.totalFilledConfirmed} / ACK {orderTelemetry.totalAckOnly})
                </span>
              </div>
              {orderTelemetry.lastFilledAvgPx > 0 && (
                <div className="text-[10px] text-emerald-400/90">
                  Último Fill real: ${orderTelemetry.lastFilledAvgPx.toFixed(4)}
                </div>
              )}
              {orderTelemetry.degradationAlert ? (
                <div className="text-[10px] text-red-400 font-semibold">
                  DEGRADACIÓN +{orderTelemetry.degradationPct}%: recientes {orderTelemetry.recent5AvgMs}ms vs base {orderTelemetry.baselineAvgMs}ms
                </div>
              ) : null}
            </div>

            {/* 3. MEV Shield Audit (0 blocks != 0 exposure) */}
            <div className="bg-[#090B0E] border border-slate-800/80 rounded-md px-3 py-2 space-y-1 min-w-0">
              <div className="flex flex-wrap items-center justify-between gap-2 text-slate-400">
                <span className="font-semibold text-slate-200 truncate">3. Auditoría Escudo MEV</span>
                <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                  <span className={config.mevShieldEnabled ? 'text-emerald-400' : 'text-amber-400'}>
                    Eval {orderTelemetry.totalMevEvaluated} · Bloq {orderTelemetry.totalBlockedByMev} · Rech {orderTelemetry.totalRejected}
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleAuditMevFilters()}
                    className="px-1.5 py-0.5 rounded bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-amber-300 text-[10px] font-semibold whitespace-nowrap"
                  >
                    Auditar MEV
                  </button>
                </div>
              </div>
              <div className="text-slate-400 truncate" title={orderTelemetry.mevFilterAudit?.summary || orderTelemetry.lastMevReason}>
                {orderTelemetry.mevFilterAudit?.summary ||
                  (config.mevShieldEnabled
                    ? `0 bloq. ≠ 0 exposición · audita filtros y rechazos (${orderTelemetry.activeRoute})`
                    : 'Escudo desactivado · audita filtros y rechazos')}
              </div>
              {orderTelemetry.lastRejectReason ? (
                <div className="text-[10px] text-red-400 truncate" title={orderTelemetry.lastRejectReason}>
                  Último rechazo: {orderTelemetry.lastRejectReason}
                </div>
              ) : null}
            </div>

            {/* 4. Hyperliquid WS Persistente + Montana Cloud (mcloud) */}
            <div className="bg-[#090B0E] border border-slate-800/80 rounded-md px-3 py-2 space-y-1 min-w-0">
              {(() => {
                const mc = (mevProbe?.channels || []).find(
                  (c) => c.scope === 'MCLOUD_API' || c.id === 'mcloud_health'
                );
                const wsOk = engineSnapshot?.wsConnected || engineWsConnected;
                return (
                  <>
                    <div className="flex flex-wrap items-center justify-between gap-1 text-slate-400">
                      <span className="font-semibold text-slate-200">4. HL WS + Montana Cloud</span>
                      <span className={wsOk ? 'text-emerald-400' : 'text-amber-300'}>
                        {wsOk ? `WS OK (${engineSnapshot?.wsLatencyMs || hlLatencyMs || 0}ms)` : 'WS Conectando'}
                      </span>
                    </div>
                    <div className="text-slate-400 truncate" title={engineSnapshot?.mcloudLastStatus || mc?.detail}>
                      mcloud: {engineSnapshot?.mcloudConnected || mc?.ok ? `OK (${mc?.latencyMs ?? '--'}ms)` : mc?.detail || 'En espera'} · cloids {engineSnapshot?.tugCloidsCount ?? 0}
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        </section>

        {/* Active Tab Viewport */}
        {activeTab === 'terminal' && (
          <div className="space-y-6">
            {/* Macro Grounding Brief if available */}
            {macroBrief && (
              <div className="bg-[#0F131A] border border-slate-800/90 rounded-lg p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-sky-400 inline-flex items-center gap-1.5">
                    <Radar className="w-4 h-4" />
                    Radar Macro en Vivo (Google Search Grounding)
                  </span>
                  <span className="text-[11px] text-slate-500">{macroSources.length} fuentes verificadas</span>
                </div>
                <p className="text-xs text-slate-300 whitespace-pre-line leading-relaxed">{macroBrief}</p>
                {macroSources.length > 0 && (
                  <div className="flex flex-wrap gap-3 pt-1">
                    {macroSources.slice(0, 4).map((s, idx) => (
                      <a
                        key={idx}
                        href={s.uri}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[11px] text-sky-400 hover:underline truncate max-w-[240px]"
                      >
                        {s.title || s.uri}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* 1-Tap Live Open Positions Quick-Close Strip (Zero Tab-Switching) */}
            {accountSummary && accountSummary.positions.length > 0 && (
              <div className="bg-[#0F131A] border border-slate-800/90 rounded-lg p-3.5 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-3 text-xs">
                    <span className="font-bold text-slate-100">
                      Posiciones Abiertas ({accountSummary.positions.length})
                    </span>
                    {(() => {
                      const totalPnl = accountSummary.positions.reduce((s, p) => s + p.unrealizedPnl, 0);
                      return (
                        <span
                          className={`font-mono-tabular font-semibold ${
                            totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'
                          }`}
                        >
                          PnL Vivo: {formatSignedUsd(totalPnl)}
                        </span>
                      );
                    })()}
                  </div>
                  <button
                    type="button"
                    disabled={closingAll}
                    onClick={() => {
                      soundEngine.click();
                      void handleCloseAllLivePositions();
                    }}
                    className="px-3 py-1.5 rounded-md bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-[11px] font-bold inline-flex items-center gap-1.5 transition-colors"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    {closingAll
                      ? 'Cerrando Todas...'
                      : apiPrivateKey.trim()
                      ? 'Cerrar Todas (1 Toque)'
                      : 'Key + Cerrar Todas'}
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {accountSummary.positions.map((pos) => (
                    <div
                      key={pos.coin}
                      className="flex items-center justify-between gap-2 px-3 py-2 rounded-md bg-[#090B0E] border border-slate-800/80"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          soundEngine.click();
                          setSelectedCoin(pos.coin);
                        }}
                        className="text-left min-w-0"
                      >
                        <div className="flex flex-wrap items-center gap-1.5 text-xs">
                          <span className="font-bold text-slate-100">{pos.coin}</span>
                          <span
                            className={`font-semibold ${
                              pos.side === 'LONG' ? 'text-emerald-400' : 'text-red-400'
                            }`}
                          >
                            {pos.side}
                          </span>
                          <span className="text-slate-500 font-mono-tabular">{pos.leverage}x</span>
                          {pos.isExternal && (
                            <span className="text-[10px] font-mono-tabular px-1 rounded bg-slate-800 text-slate-300 border border-slate-700">
                              [EXTERNA]
                            </span>
                          )}
                        </div>
                        <div
                          className={`text-[11px] font-mono-tabular font-semibold ${
                            pos.unrealizedPnl >= 0 ? 'text-emerald-400' : 'text-red-400'
                          }`}
                        >
                          {formatSignedUsd(pos.unrealizedPnl)} ({pos.returnOnEquity.toFixed(1)}%)
                        </div>
                      </button>
                      <button
                        type="button"
                        disabled={closingCoin === pos.coin || closingAll}
                        onClick={() => {
                          soundEngine.click();
                          void handleCloseLivePosition(pos.coin, pos.side, Math.abs(pos.szi));
                        }}
                        className="px-2.5 py-1.5 rounded bg-red-600/25 hover:bg-red-600 text-red-200 hover:text-white border border-red-500/50 disabled:opacity-40 text-[11px] font-bold inline-flex items-center gap-1 shrink-0 transition-colors"
                      >
                        <XCircle className="w-3 h-3" />
                        {closingCoin === pos.coin ? 'Cerrando...' : 'Cerrar'}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Chart + L2 Orderbook & Execution Split */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
              <div className="lg:col-span-8">
                <LiveCandleChart
                  coin={selectedCoin}
                  candles={candles}
                  interval={interval}
                  onIntervalChange={setIntervalTf}
                  markPx={selectedAsset?.markPx ?? 0}
                  loading={candlesLoading}
                />
              </div>
              <div className="lg:col-span-4">
                {(() => {
                  const activePos = accountSummary?.positions.find((p) => p.coin === selectedCoin);
                  return (
                    <OrderBookPanel
                      asset={selectedAsset}
                      bids={l2Book.bids}
                      asks={l2Book.asks}
                      hasApiKey={Boolean(apiPrivateKey.trim())}
                      mevShieldEnabled={config.mevShieldEnabled}
                      activeRoute={orderTelemetry.activeRoute}
                      defaultNotionalUsd={config.riskPerTradeUsd}
                      executing={executing}
                      useAloEntries={Boolean(config.useAloEntries)}
                      onToggleAlo={(nextAlo) => void updateConfigPatch({ useAloEntries: nextAlo })}
                      activePosition={
                        activePos
                          ? {
                              side: activePos.side,
                              size: Math.abs(activePos.szi),
                              unrealizedPnl: activePos.unrealizedPnl,
                              isExternal: activePos.isExternal,
                            }
                          : null
                      }
                      closingActive={closingCoin === selectedCoin || closingAll}
                      onQuickClose={
                        activePos
                          ? () =>
                              void handleCloseLivePosition(
                                activePos.coin,
                                activePos.side,
                                Math.abs(activePos.szi)
                              )
                          : undefined
                      }
                      onOpenApiModal={() => setApiModalOpen(true)}
                      onManualOrder={(side, usd) =>
                        void submitProtectedOrder({
                          coin: selectedCoin,
                          side,
                          notionalUsd: usd,
                          mode: 'manual',
                          thesis: `Orden manual ${side} (${config.useAloEntries ? 'ALO' : 'IOC'})`,
                        })
                      }
                    />
                  );
                })()}
              </div>
            </div>

            {/* Regalo Plus TUG777: Whale Funding & OI Turnover Radar */}
            <WhaleBonusRadar
              markets={markets}
              selectedCoin={selectedCoin}
              onSelectCoin={(coin) => {
                setSelectedCoin(coin);
                voiceEngine.speak(`Poniendo ojo en ${coin} desde el radar de ballenas, socio.`);
              }}
            />

            {/* Full Hyperliquid Live Token Scanner */}
            <div className="bg-[#0F131A] border border-slate-800/90 rounded-lg overflow-hidden">
              <div className="px-4 sm:px-5 py-4 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-base font-bold text-slate-100">
                    Escáner de Flujo de Mercado en Vivo (Hyperliquid)
                  </h2>
                  <p className="text-xs text-slate-400">
                    Escaneados: {markets.length} tokens · Watchlist activa: {config.watchlistCoinsCsv || 'BTC,ETH,SOL,HYPE'}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2.5 w-full sm:w-auto">
                  <div className="relative flex-1 sm:flex-initial min-w-[180px]">
                    <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      placeholder="Buscar token (BTC, HYPE...)"
                      value={tokenSearch}
                      onChange={(e) => setTokenSearch(e.target.value)}
                      className="w-full bg-[#090B0E] border border-slate-700 rounded-md pl-8 pr-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-amber-500"
                    />
                  </div>
                  <div className="flex flex-wrap items-center bg-[#090B0E] p-1 rounded-md border border-slate-800 shrink-0">
                    {(['ALL', 'LONG', 'SHORT'] as const).map((b) => (
                      <button
                        key={b}
                        onClick={() => {
                          soundEngine.click();
                          setBiasFilter(b);
                        }}
                        className={`px-2.5 py-1 text-[11px] font-semibold rounded whitespace-nowrap ${
                          biasFilter === b ? 'bg-amber-500 text-slate-950' : 'text-slate-400'
                        }`}
                      >
                        {b === 'ALL' ? 'Todos' : b}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto max-h-[460px]">
                <table className="w-full text-left border-collapse">
                  <thead className="sticky top-0 bg-[#0C1016] z-10">
                    <tr className="border-b border-slate-800 text-[11px] text-slate-400">
                      <th className="py-3 px-4 font-medium">Token</th>
                      <th className="py-3 px-4 font-medium text-right">Mark Price</th>
                      <th className="py-3 px-4 font-medium text-right">Cambio 24h</th>
                      <th className="py-3 px-4 font-medium text-right">Funding APR</th>
                      <th className="py-3 px-4 font-medium text-right">Volumen 24h</th>
                      <th className="py-3 px-4 font-medium text-right">Open Interest</th>
                      <th className="py-3 px-4 font-medium text-right">Señal Estrategia</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 text-xs font-mono-tabular">
                    {filteredMarkets.slice(0, 80).map((m) => (
                      <tr
                        key={m.coin}
                        onClick={() => {
                          soundEngine.click();
                          setSelectedCoin(m.coin);
                          voiceEngine.speak(
                            `Token ${m.coin}, señal ${m.quantBias} con fuerza de ${m.quantScore}, chico.`,
                            true
                          );
                        }}
                        className={`cursor-pointer transition-colors ${
                          selectedCoin === m.coin ? 'bg-amber-500/10' : 'hover:bg-slate-800/35'
                        }`}
                      >
                        <td className="py-2.5 px-4 font-sans">
                          <span className="font-bold text-slate-100">{m.coin}</span>{' '}
                          <span className="text-slate-500">· {m.maxLeverage}x</span>
                        </td>
                        <td className="py-2.5 px-4 text-right text-slate-100">
                          ${m.markPx >= 1000 ? m.markPx.toFixed(2) : m.markPx >= 1 ? m.markPx.toFixed(4) : m.markPx.toPrecision(4)}
                        </td>
                        <td
                          className={`py-2.5 px-4 text-right font-semibold ${
                            m.change24hPct >= 0 ? 'text-emerald-400' : 'text-red-400'
                          }`}
                        >
                          {m.change24hPct >= 0 ? '+' : ''}
                          {m.change24hPct.toFixed(2)}%
                        </td>
                        <td
                          className={`py-2.5 px-4 text-right ${
                            m.annualizedFundingPct >= 0 ? 'text-amber-300' : 'text-emerald-400'
                          }`}
                        >
                          {m.annualizedFundingPct >= 0 ? '+' : ''}
                          {m.annualizedFundingPct.toFixed(1)}%
                        </td>
                        <td className="py-2.5 px-4 text-right text-slate-300">
                          ${(m.dayNtlVlm / 1e6).toFixed(2)}M
                        </td>
                        <td className="py-2.5 px-4 text-right text-slate-400">
                          ${(m.openInterestUsd / 1e6).toFixed(2)}M
                        </td>
                        <td className="py-2.5 px-4 text-right">
                          <span
                            className={`font-semibold ${
                              m.quantBias === 'LONG'
                                ? 'text-emerald-400'
                                : m.quantBias === 'SHORT'
                                ? 'text-red-400'
                                : 'text-slate-500'
                            }`}
                          >
                            {m.quantBias} ({m.quantScore})
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'positions' && (
          <PositionsView
            accountSummary={accountSummary}
            persistedPositions={persistedPositions}
            marketsByCoin={marketsByCoin}
            masterWalletAddress={config.masterWalletAddress}
            hasApiKey={Boolean(apiPrivateKey.trim())}
            executingCoin={closingCoin}
            closingAll={closingAll}
            syncingAccount={syncingAccount}
            lastSyncedAt={lastSyncedAt}
            partialStagesByCoin={partialStageByCoinRef.current}
            onRefreshAccount={() => void refreshAccountData(true)}
            onCloseLivePosition={(coin, side, sz) => void handleCloseLivePosition(coin, side, sz)}
            onCloseAllPositions={() => void handleCloseAllLivePositions()}
            onClosePersistedPosition={(pos) => void handleClosePersistedAndLearn(pos)}
            onOpenApiModal={() => setApiModalOpen(true)}
          />
        )}

        {activeTab === 'pnl' && (
          <PnlView
            fills={userFills}
            persistedPositions={persistedPositions}
            accountSummary={accountSummary}
            onLearnFromHistory={() => void handleLearnFromHistory()}
            learningHistory={learningHistory}
          />
        )}

        {activeTab === 'logs' && (
          <LogsAndMemoryView
            logs={tradeLogs}
            memories={aiMemories}
            playbook={strategyPlaybook}
            onToggleStrategy={(strategyId, enabled) => {
              handleUpdateStrategy(strategyId, { enabled });
            }}
            onUpdateStrategy={(strategyId, patch) => {
              handleUpdateStrategy(strategyId, patch);
            }}
          />
        )}

        {activeTab === 'droplet' && (
          <DropletDeployView
            isInstallable={isInstallable}
            onTriggerPwaInstall={() => void triggerPwaInstall()}
          />
        )}
      </main>

      {/* Modals & Drawers */}
      <ApiWalletModal
        open={apiModalOpen}
        onClose={() => setApiModalOpen(false)}
        config={config}
        apiPrivateKey={apiPrivateKey}
        onSave={(saved) => {
          setApiPrivateKey(saved.apiPrivateKey);
          localStorage.setItem('tug777_remember_pk', saved.rememberKey ? 'true' : 'false');
          if (saved.apiPrivateKey) {
            sessionStorage.setItem('tug777_hl_agent_pk', saved.apiPrivateKey);
            if (saved.rememberKey) {
              localStorage.setItem('tug777_hl_agent_pk_saved', saved.apiPrivateKey);
            } else {
              localStorage.removeItem('tug777_hl_agent_pk_saved');
            }
          } else {
            sessionStorage.removeItem('tug777_hl_agent_pk');
            localStorage.removeItem('tug777_hl_agent_pk_saved');
          }
          const walletPatch: Partial<BotConfigData> = {
            network: saved.network,
            masterWalletAddress: saved.masterWalletAddress,
            mevShieldEnabled: saved.mevShieldEnabled,
            maxSlippageBps: saved.maxSlippageBps,
            maxOracleDeviationBps: saved.maxOracleDeviationBps,
            riskPerTradeUsd: saved.riskPerTradeUsd,
            aiEnabled: false,
          };
          void updateConfigPatch(walletPatch);
          if (hasConfiguredBackendForApk()) {
            void pushEngineConfig(walletPatch, saved.apiPrivateKey).catch(() => {});
          }
          void refreshAccountData(true, saved.masterWalletAddress, saved.apiPrivateKey);
        }}
      />

      <AiBrainParamsModal
        open={aiParamsOpen}
        onClose={() => setAiParamsOpen(false)}
        config={config}
        playbook={strategyPlaybook}
        onUpdateStrategy={handleUpdateStrategy}
        onAutoCalibrateStrategies={handleAutoCalibrateStrategies}
        onResetStrategyWeights={handleResetStrategyWeights}
        onSave={(patch) => {
          void updateConfigPatch({ ...patch, aiEnabled: false });
          voiceEngine.speak(
            '¡Parámetros guardados y motor en pausa segura, socio! Actívalo cuando quieras operar.',
            true
          );
          setStatusNotice({
            type: 'ok',
            text:
              patch.aiProvider === 'custom_ai'
                ? `Motor cambiado a ${patch.customAiModel || 'endpoint personalizado'} · Motor en PAUSA segura hasta activación.`
                : `Parámetros guardados (${patch.geminiModel || 'auto'} · Montana Cloud ${patch.mcloudEnabled ? 'ON' : 'OFF'}) · Motor en PAUSA segura hasta activación.`,
          });
        }}
      />

      <AiCopilotDrawer
        open={copilotOpen}
        onClose={() => setCopilotOpen(false)}
        messages={chatMessages}
        sending={chatSending}
        onSendMessage={(msg, useSearch) => void handleSendChat(msg, useSearch)}
      />

      <footer className="border-t border-slate-800/70 px-6 py-4 text-center text-xs text-slate-500 flex flex-wrap items-center justify-between gap-2 max-w-[1440px] mx-auto w-full">
        <span>TUG777 HyperTrade · REALG4LIFE Institutional Interface</span>
        <span className="inline-flex items-center gap-1.5 text-slate-400">
          <Activity className="w-3.5 h-3.5 text-emerald-400" />
          Datos 100% en vivo vía Hyperliquid L1 &amp; Firestore
        </span>
      </footer>
    </div>
  );
}
