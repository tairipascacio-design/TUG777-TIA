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
import { auth, signInWithGoogle, signOutUser, testFirestoreConnection } from './firebase';
import { usePWAInstall } from './hooks/usePWAInstall';
import {
  appendAiMemory,
  appendChatMessage,
  appendTradeLog,
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
  toggleStrategyPlaybookItem,
} from './services/firestoreService';
import {
  evaluateMevShield,
  executeRealHyperliquidOrder,
  fetchAllHyperliquidMarkets,
  fetchCandles,
  fetchClearinghouseState,
  fetchL2Book,
  fetchMevAndLatencyProbe,
  fetchUserFills,
  resolveMasterFromAgentKey,
} from './services/hyperliquidClient';
import {
  POSITION_MANAGEMENT_GUIDE_RULES,
  computeDynamicOrderNotionalUsd,
  evaluateOpenPositionManagement,
  evaluateUnifiedDeepSetup,
} from './services/strategyEngine';
import type {
  AiBrainDecision,
  AiMemoryEntry,
  BotConfigData,
  ChatMessageEntry,
  DeepAssetAnalysis,
  HlAccountSummary,
  HlAssetMarket,
  HlCandle,
  HlL2Level,
  HlUserFill,
  MevProbeStatus,
  PersistedPosition,
  StrategyPlaybookItem,
  TradeLogEntry,
  TradingMode,
} from './types/trading';
import { downloadAndroidApkKit } from './utils/apkPackager';
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
  maxSlippageBps: 25,
  maxOracleDeviationBps: 45,
  riskPerTradeUsd: 50,
  sizingMode: 'equity_pct',
  capitalPctPerTrade: 25,
  maxOpenPositions: 3,
  trailingStopEnabled: true,
  autoManagePositions: true,
  soundEnabled: true,
  aiProvider: 'gemini',
  customAiUrl: '',
  customAiModel: '',
  customSystemPrompt: '',
  scanIntervalSec: 180,
  minConfidence: 68,
  minQuantScore: 58,
  minVolumeM: 2,
  tpPct: 3.0,
  slPct: 1.4,
  useDeepThinking: false,
  useSearchGrounding: false,
};

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
      if (cached) return { ...INITIAL_CONFIG, ...JSON.parse(cached) };
    } catch {
      // ignore invalid JSON
    }
    return INITIAL_CONFIG;
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
  const [hlChannel, setHlChannel] = useState<string>('HL-NODE-1');
  const [mevProbe, setMevProbe] = useState<MevProbeStatus | null>(null);

  // Account & Persisted State
  const [accountSummary, setAccountSummary] = useState<HlAccountSummary | null>(null);
  const [userFills, setUserFills] = useState<HlUserFill[]>([]);
  const [syncingAccount, setSyncingAccount] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [persistedPositions, setPersistedPositions] = useState<PersistedPosition[]>([]);
  const [tradeLogs, setTradeLogs] = useState<TradeLogEntry[]>([]);
  const [aiMemories, setAiMemories] = useState<AiMemoryEntry[]>([]);
  const [strategyPlaybook, setStrategyPlaybook] = useState<StrategyPlaybookItem[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessageEntry[]>([]);

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
  const managingPositionsRef = useRef(false);

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
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      setAuthReady(true);
      if (firebaseUser) {
        try {
          const loadedCfg = await ensureUserProfileAndConfig(firebaseUser);
          setConfig(loadedCfg);
          await syncStrategyPlaybook(firebaseUser.uid);
        } catch (err) {
          console.error(err);
        }
      }
    });
    return () => unsub();
  }, []);

  // Real-time Firestore Subscriptions when authenticated
  useEffect(() => {
    if (!authReady || !user) {
      setPersistedPositions([]);
      setTradeLogs([]);
      setAiMemories([]);
      setStrategyPlaybook([]);
      setChatMessages([]);
      return;
    }

    const unsubPos = subscribePositions(user.uid, setPersistedPositions);
    const unsubLogs = subscribeTradeLogs(user.uid, setTradeLogs);
    const unsubMem = subscribeAiMemories(user.uid, setAiMemories);
    const unsubPlaybook = subscribeStrategyPlaybook(user.uid, setStrategyPlaybook);
    const unsubChat = subscribeChatMessages(user.uid, setChatMessages);

    return () => {
      unsubPos();
      unsubLogs();
      unsubMem();
      unsubPlaybook();
      unsubChat();
    };
  }, [authReady, user]);

  // Live Multi-Node Hyperliquid Scanner (every 5s)
  const refreshMarkets = useCallback(async () => {
    try {
      const res = await fetchAllHyperliquidMarkets(config.network);
      setMarkets(res.markets);
      setHlLatencyMs(res.latencyMs);
      setHlChannel(res.channel);
    } catch (err) {
      console.error('Market poll error:', err);
    }
  }, [config.network]);

  useEffect(() => {
    void refreshMarkets();
    const timer = setInterval(() => void refreshMarkets(), 5000);
    return () => clearInterval(timer);
  }, [refreshMarkets]);

  // Live Candles & L2 Orderbook for selected coin
  const refreshSelectedAssetFeed = useCallback(async () => {
    try {
      const [cData, bookData] = await Promise.all([
        fetchCandles(config.network, selectedCoin, interval, 96),
        fetchL2Book(config.network, selectedCoin),
      ]);
      setCandles(cData);
      setL2Book({ bids: bookData.bids, asks: bookData.asks });
    } catch (err) {
      console.error('Asset feed error:', err);
    }
  }, [config.network, selectedCoin, interval]);

  useEffect(() => {
    setCandlesLoading(true);
    void refreshSelectedAssetFeed().finally(() => setCandlesLoading(false));
    const timer = setInterval(() => void refreshSelectedAssetFeed(), 4000);
    return () => clearInterval(timer);
  }, [refreshSelectedAssetFeed]);

  // Multi-Node & Flashbots Protect RPC Probe (every 20s)
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
              'Tu API Wallet aún no está autorizada en Hyperliquid o no tiene Master Address asignada.',
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
            'Ingresa tu Master Wallet Address para actualizar tus posiciones de Hyperliquid.',
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
        if (manualTrigger) {
          soundEngine.tradeExecuted();
          voiceEngine.speak(
            `Posiciones actualizadas. Equity ${summary.accountValue.toFixed(0)} dólares y ${summary.positions.length} posiciones abiertas en Hyperliquid.`,
            true
          );
          setStatusNotice({
            type: 'ok',
            text: `Posiciones actualizadas (${Math.round(performance.now() - t0)} ms) · Equity $${summary.accountValue.toFixed(2)} · ${summary.positions.length} abiertas en Hyperliquid ${config.network.toUpperCase()}.`,
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('Clearinghouse error:', err);
        if (manualTrigger) {
          soundEngine.alert();
          voiceEngine.speak(`Error al actualizar posiciones: ${msg}`, true);
          setStatusNotice({
            type: 'error',
            text: `Error actualizando posiciones de Hyperliquid: ${msg}`,
          });
        }
      } finally {
        if (manualTrigger) setSyncingAccount(false);
      }
    },
    [config.network, config.masterWalletAddress, apiPrivateKey, user, refreshMarkets]
  );

  useEffect(() => {
    void refreshAccountData(false);
    const timer = setInterval(() => void refreshAccountData(false), 8000);
    return () => clearInterval(timer);
  }, [refreshAccountData]);

  const logEvent = useCallback(
    async (
      level: TradeLogEntry['level'],
      category: string,
      coin: string,
      message: string,
      latencyMs = 0
    ) => {
      if (user) {
        try {
          await appendTradeLog(user.uid, { level, category, coin, message, latencyMs });
        } catch (err) {
          console.error('Log write error:', err);
        }
      } else {
        setTradeLogs((prev) => [
          {
            id: `${Date.now()}-${Math.random()}`,
            ownerId: 'local',
            level,
            category,
            coin,
            message,
            latencyMs,
            createdAtMs: Date.now(),
          },
          ...prev.slice(0, 80),
        ]);
      }
    },
    [user]
  );

  const updateConfigPatch = async (patch: Partial<BotConfigData>) => {
    setConfig((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem('tug777_app_config', JSON.stringify(next));
      } catch {
        // ignore storage limits
      }
      return next;
    });
    if (user) {
      await saveBotConfig(user.uid, patch);
    }
  };

  const handleGoogleOAuthSignIn = async () => {
    soundEngine.click();
    setOauthLoading(true);
    try {
      const cred = await signInWithGoogle();
      soundEngine.tradeExecuted();
      const name = cred.user.displayName?.split(' ')[0] || cred.user.email || 'Trader';
      voiceEngine.speak(`Sesión iniciada. Bienvenido ${name}, el mundo es tuyo.`, true);
      setStatusNotice({
        type: 'ok',
        text: `Sesión OAuth iniciada como ${cred.user.email || cred.user.displayName || 'Trader'}. Sincronizando Firestore...`,
      });
    } catch (err) {
      soundEngine.alert();
      const msg = err instanceof Error ? err.message : String(err);
      voiceEngine.speak('Error iniciando sesión con Google.', true);
      setStatusNotice({
        type: 'error',
        text: `Error en Google OAuth: ${msg}. Verifica que los popups estén permitidos.`,
      });
    } finally {
      setOauthLoading(false);
    }
  };

  const handleSaveAppConfig = useCallback(async () => {
    soundEngine.click();
    setSavingConfig(true);
    try {
      localStorage.setItem('tug777_app_config', JSON.stringify(config));
      if (user) {
        await saveBotConfig(user.uid, config);
        soundEngine.tradeExecuted();
        voiceEngine.speak('Configuración guardada en Firestore y respaldo local.', true);
        setConfigSavedOk(true);
        setStatusNotice({
          type: 'ok',
          text: 'Configuración completa guardada en Firestore y respaldo local.',
        });
      } else {
        soundEngine.tradeExecuted();
        voiceEngine.speak('Configuración guardada localmente.', true);
        setConfigSavedOk(true);
        setStatusNotice({
          type: 'info',
          text: 'Configuración guardada localmente. Ingresa con Google OAuth para respaldarla también en Firestore.',
        });
      }
      setTimeout(() => setConfigSavedOk(false), 2500);
    } catch (err) {
      soundEngine.alert();
      voiceEngine.speak('No se pudo guardar la configuración.', true);
      setStatusNotice({
        type: 'error',
        text: `No se pudo guardar la configuración: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setSavingConfig(false);
    }
  }, [config, user]);

  // Real Order Execution Pipeline with Anti-MEV / Flashbots Guard
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
    }): Promise<boolean> => {
      const asset = marketsByCoin.get(params.coin);
      if (!asset) {
        voiceEngine.speak(`Token ${params.coin} no encontrado en Hyperliquid.`, true);
        setStatusNotice({ type: 'error', text: `Token ${params.coin} no encontrado en Hyperliquid.` });
        return false;
      }

      if (!apiPrivateKey.trim()) {
        soundEngine.alert();
        voiceEngine.speak('Ingresa tu API Wallet Private Key para ejecutar órdenes reales.', true);
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
          ? `Cerrando posición en ${params.coin}.`
          : `Verificando escudo anti MEV para ${params.side} en ${params.coin}.`
      );
      try {
        // Fetch fresh L2 book right before order signing (fail-safe for reduceOnly exits)
        let freshBook: { bids: HlL2Level[]; asks: HlL2Level[]; latencyMs: number } | null = null;
        try {
          freshBook = await fetchL2Book(config.network, params.coin);
        } catch {
          freshBook = null;
        }

        if (!params.reduceOnly) {
          if (!freshBook) {
            throw new Error(`No se pudo verificar libro L2 para abrir ${params.coin}.`);
          }
          const mevCheck = evaluateMevShield({
            enabled: config.mevShieldEnabled,
            markPx: asset.markPx,
            oraclePx: asset.oraclePx,
            bids: freshBook.bids,
            asks: freshBook.asks,
            notionalUsd: params.notionalUsd,
            maxSlippageBps: config.maxSlippageBps,
            maxOracleDeviationBps: config.maxOracleDeviationBps,
          });

          await logEvent('MEV_GUARD', 'ANTI_MEV', params.coin, mevCheck.reason, freshBook.latencyMs);

          if (!mevCheck.passed) {
            soundEngine.alert();
            voiceEngine.speak(`Orden bloqueada en ${params.coin} por escudo anti MEV. ${mevCheck.reason}`, true);
            setStatusNotice({ type: 'error', text: `Orden bloqueada por Escudo MEV: ${mevCheck.reason}` });
            return false;
          }
        } else {
          // Manual/Auto reduceOnly exits must NEVER be blocked by MEV spread/oracle gates
          await logEvent(
            'MEV_GUARD',
            'CLOSE_BYPASS',
            params.coin,
            'Salida reduceOnly prioritaria (desbloqueada para cierre inmediato)',
            freshBook?.latencyMs ?? 0
          );
        }

        // For reduceOnly market closes, anchor to live top-of-book (bestAsk for BUY-to-close, bestBid for SELL-to-close)
        // with a generous 500 bps (5%) worst-case IOC sweep cap so Hyperliquid matches resting liquidity instantly.
        const freshBestPx =
          params.reduceOnly && freshBook
            ? params.side === 'LONG'
              ? freshBook.asks[0]?.px || asset.markPx
              : freshBook.bids[0]?.px || asset.markPx
            : asset.markPx;
        const effectiveSlippageBps = params.reduceOnly
          ? Math.max(config.maxSlippageBps, 500)
          : config.maxSlippageBps;

        const sizeCoins = params.overrideSizeCoins ?? params.notionalUsd / asset.markPx;
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
        });

        const respObj = execResult.exchangeResponse as {
          status?: string;
          response?: string | { data?: { statuses?: Array<{ error?: string }> } };
        } | null;
        const nestedStatuses =
          typeof respObj?.response === 'object' && respObj?.response !== null
            ? respObj.response.data?.statuses
            : undefined;
        const orderErr =
          respObj?.status === 'err'
            ? String(respObj.response || 'Rechazo Hyperliquid')
            : Array.isArray(nestedStatuses)
            ? nestedStatuses.find((s) => Boolean(s?.error))?.error
            : undefined;

        const statusStr = JSON.stringify(execResult.exchangeResponse);
        const hasHlError = Boolean(orderErr) || statusStr.toLowerCase().includes('"error"');
        const readableErr = orderErr || statusStr;

        if (hasHlError) {
          soundEngine.alert();
          voiceEngine.speak(`Hyperliquid rechazó la orden en ${params.coin}. ${orderErr || ''}`, true);
          await logEvent(
            'ERROR',
            'HL_EXCHANGE',
            params.coin,
            `Rechazo Hyperliquid: ${readableErr}`,
            execResult.latencyMs
          );
          setStatusNotice({ type: 'error', text: `Hyperliquid rechazó la orden: ${readableErr}` });
          return false;
        }

        soundEngine.tradeExecuted();
        if (params.reduceOnly) {
          voiceEngine.speak(
            `Posición en ${params.coin} cerrada en ${execResult.latencyMs} milisegundos.`,
            true
          );
        } else {
          voiceEngine.speak(
            `Abriendo posición ${params.side} en ${params.coin} por ${params.notionalUsd.toFixed(0)} dólares a precio ${execResult.limitPxStr}.`,
            true
          );
        }
        await logEvent(
          'EXEC',
          params.reduceOnly ? 'CLOSE_REAL' : 'OPEN_REAL',
          params.coin,
          `${params.side} ${execResult.sizeStr} ${params.coin} @ $${execResult.limitPxStr} vía ${execResult.channel}`,
          execResult.latencyMs
        );

        if (user && !params.reduceOnly) {
          await createPersistedPosition(user.uid, {
            coin: params.coin,
            side: params.side,
            size: Number(execResult.sizeStr),
            entryPx: asset.markPx,
            markPx: asset.markPx,
            leverage: asset.maxLeverage,
            unrealizedPnl: 0,
            realizedPnl: 0,
            status: 'OPEN',
            mode: params.mode,
            hlOrderId: statusStr.slice(0, 120),
            thesis: params.thesis,
            strategyTag: params.strategyTag || '',
          });
        }

        setStatusNotice({
          type: 'ok',
          text: `Orden real enviada (${params.coin} ${params.side}) en ${execResult.latencyMs} ms`,
        });
        await refreshAccountData();
        return true;
      } catch (err) {
        soundEngine.alert();
        const msg = err instanceof Error ? err.message : String(err);
        voiceEngine.speak(`Error ejecutando orden en ${params.coin}: ${msg}`, true);
        await logEvent('ERROR', 'EXEC_FAIL', params.coin, msg);
        setStatusNotice({ type: 'error', text: msg });
        return false;
      } finally {
        setExecuting(false);
      }
    },
    [marketsByCoin, apiPrivateKey, config, logEvent, user, refreshAccountData]
  );

  const handleCloseLivePosition = useCallback(
    async (coin: string, side: 'LONG' | 'SHORT', size: number, customReason?: string) => {
      setClosingCoin(coin);
      try {
        const closed = await submitProtectedOrder({
          coin,
          side: side === 'LONG' ? 'SHORT' : 'LONG',
          notionalUsd: 0,
          mode: 'manual',
          thesis: customReason || 'Cierre reduceOnly en Hyperliquid',
          reduceOnly: true,
          overrideSizeCoins: size,
        });

        if (closed) {
          delete peakMoveByCoinRef.current[coin];
          const matchingOpen = persistedPositions.find((p) => p.coin === coin && p.status === 'OPEN');
          const liveMark = marketsByCoin.get(coin)?.markPx ?? matchingOpen?.markPx ?? 0;

          if (matchingOpen) {
            const realized =
              (matchingOpen.side === 'LONG'
                ? liveMark - matchingOpen.entryPx
                : matchingOpen.entryPx - liveMark) * matchingOpen.size;
            if (user) {
              await closePersistedPosition(user.uid, matchingOpen.id, liveMark, realized);
              if (matchingOpen.strategyTag) {
                await recordStrategyTradeOutcome(
                  user.uid,
                  matchingOpen.strategyTag.split(','),
                  realized
                );
              }
              await appendAiMemory(user.uid, {
                coin,
                regime: customReason ? 'Gestión Activa' : 'Cierre Real',
                outcome: realized >= 0.05 ? 'WIN' : realized <= -0.05 ? 'LOSS' : 'BREAKEVEN',
                pnlUsd: realized,
                lesson: `${customReason || 'Cierre de posición real'} (${matchingOpen.side} ${coin} PnL ${realized >= 0 ? '+' : ''}$${realized.toFixed(2)}).`,
              });
            } else {
              setPersistedPositions((prev) =>
                prev.map((p) =>
                  p.id === matchingOpen.id
                    ? { ...p, status: 'CLOSED', markPx: liveMark, realizedPnl: realized }
                    : p
                )
              );
            }
          }
        }
      } finally {
        setClosingCoin(null);
      }
    },
    [submitProtectedOrder, persistedPositions, marketsByCoin, user]
  );

  const handleCloseAllLivePositions = useCallback(async () => {
    const openPositions = accountSummary?.positions ?? [];
    if (openPositions.length === 0) {
      setStatusNotice({ type: 'info', text: 'No tienes posiciones vivas abiertas en Hyperliquid.' });
      return;
    }
    if (!apiPrivateKey.trim()) {
      soundEngine.alert();
      voiceEngine.speak('Ingresa tu Agent Private Key para cerrar todas las posiciones.', true);
      setStatusNotice({
        type: 'error',
        text: 'Ingresa tu Agent Private Key para cerrar tus posiciones en Hyperliquid.',
      });
      setApiModalOpen(true);
      return;
    }
    setClosingAll(true);
    voiceEngine.speak(`Cerrando ${openPositions.length} posiciones abiertas en Hyperliquid.`, true);
    try {
      for (const pos of openPositions) {
        await handleCloseLivePosition(pos.coin, pos.side, Math.abs(pos.szi), 'Cierre masivo 1-toque');
      }
    } finally {
      setClosingAll(false);
    }
  }, [accountSummary, apiPrivateKey, handleCloseLivePosition]);

  // Unified Brain Cycle (10-Strategy Matrix + Multi-TF Candles + L2 Depth + DB Cross-Reference)
  const runUnifiedBrainCycle = useCallback(async () => {
    if (markets.length === 0 || brainThinking) return;
    setBrainThinking(true);

    try {
      const minVolUsd = (config.minVolumeM || 2) * 1_000_000;
      const liquidByVol = [...markets].filter((m) => m.dayNtlVlm >= minVolUsd);
      const preFiltered = [...liquidByVol].sort((a, b) => {
        const turnoverA = a.openInterestUsd > 0 ? Math.min(10, a.dayNtlVlm / a.openInterestUsd) : 0;
        const turnoverB = b.openInterestUsd > 0 ? Math.min(10, b.dayNtlVlm / b.openInterestUsd) : 0;
        return b.quantScore + turnoverB - (a.quantScore + turnoverA);
      });

      // Always include BTC + top 4 highest-volume leaders + top 4 momentum/quant candidates (deduplicated, max 8)
      const scanMap = new Map<string, HlAssetMarket>();
      const btcMarket = marketsByCoin.get('BTC');
      if (btcMarket) scanMap.set('BTC', btcMarket);
      for (const m of liquidByVol.slice(0, 4)) scanMap.set(m.coin, m);
      for (const m of preFiltered.slice(0, 6)) {
        if (scanMap.size >= 8) break;
        scanMap.set(m.coin, m);
      }
      const topForDeepScan = Array.from(scanMap.values());

      if (topForDeepScan.length === 0) {
        setStatusNotice({
          type: 'info',
          text: `Ningún token supera el volumen mínimo de $${config.minVolumeM || 2}M para análisis profundo.`,
        });
        return;
      }

      // Fetch real 15m + 1h candles and L2 orderbook depth for top candidates in parallel
      const rawDeepAnalyses: DeepAssetAnalysis[] = await Promise.all(
        topForDeepScan.map(async (c) => {
          try {
            const [c15, c1h, book] = await Promise.all([
              fetchCandles(config.network, c.coin, '15m', 96),
              fetchCandles(config.network, c.coin, '1h', 60),
              fetchL2Book(config.network, c.coin),
            ]);
            return evaluateUnifiedDeepSetup({
              market: c,
              candles15m: c15,
              candles1h: c1h,
              bids: book.bids,
              asks: book.asks,
              playbook: strategyPlaybook,
              memories: aiMemories,
            });
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

      // BTC Macro Leader Alignment: penalize altcoin trades directly fighting a locked BTC trend
      const btcDeep = rawDeepAnalyses.find((d) => d.coin === 'BTC');
      const deepAnalyses: DeepAssetAnalysis[] = rawDeepAnalyses.map((d) => {
        if (d.coin === 'BTC' || d.direction === 'NEUTRAL' || !btcDeep) return d;
        const btcStrongBear = btcDeep.regime === 'TRENDING_BEAR' || btcDeep.direction === 'SHORT';
        const btcStrongBull = btcDeep.regime === 'TRENDING_BULL' || btcDeep.direction === 'LONG';
        if ((btcStrongBear && d.direction === 'LONG' && d.unifiedScore < 76) ||
            (btcStrongBull && d.direction === 'SHORT' && d.unifiedScore < 76)) {
          return {
            ...d,
            direction: 'NEUTRAL',
            unifiedScore: Math.round(d.unifiedScore * 0.7),
            confidence: Math.min(48, d.confidence),
            reasons: [...d.reasons, `Bloqueado: va en contra del líder BTC (${btcDeep.regime})`].slice(0, 5),
          };
        }
        return d;
      });

      const openPositions = accountSummary?.positions || [];
      const maxOpen = Math.max(1, config.maxOpenPositions || 3);

      // Mode 1: Pure Quantitative 10-Strategy Unified Engine
      if (config.mode === 'strategy') {
        const best = [...deepAnalyses]
          .filter(
            (d) =>
              d.direction !== 'NEUTRAL' &&
              !d.antiChaseBlocked &&
              d.unifiedScore >= config.minQuantScore &&
              !openPositions.some((p) => p.coin === d.coin && p.side === d.direction)
          )
          .sort((a, b) => b.unifiedScore - a.unifiedScore)[0];

        if (!best) {
          const topSummary = deepAnalyses[0]
            ? `${deepAnalyses[0].coin}: ${deepAnalyses[0].unifiedScore} pts (${deepAnalyses[0].regime})`
            : 'sin candidatos';
          await logEvent(
            'INFO',
            'STRATEGY',
            'SCAN',
            `Escaneo multi-TF (15M+1H+L2) en ${topForDeepScan.length} líderes: sin confluencia limpia >= ${config.minQuantScore} pts (${topSummary}).`
          );
          voiceEngine.speak(
            `Escaneo multi temporal completado en ${topForDeepScan.length} líderes, sin entrada limpia aún.`
          );
          setLastDecision({
            action: 'HOLD',
            coin: 'NONE',
            confidence: deepAnalyses[0]?.unifiedScore ?? 45,
            regime: deepAnalyses[0]?.regime || 'Sin Confluencia',
            reason: `Ningún token cumple >=2 estrategias sin sobreextensión (>=${config.minQuantScore} pts). Mejor candidato: ${topSummary}.`,
            tpPct: config.tpPct,
            slPct: config.slPct,
            modelUsed: 'TUG777 10-Strategy Matrix',
          });
          return;
        }

        const asset = marketsByCoin.get(best.coin);
        const strategyLabel = best.firedStrategies.join(', ');
        const decision: AiBrainDecision = {
          action: best.direction as 'LONG' | 'SHORT',
          coin: best.coin,
          confidence: best.confidence,
          regime: best.regime,
          reason: `[${strategyLabel}] ${best.reasons.join(' · ')}`,
          tpPct: best.recommendedTpPct,
          slPct: best.recommendedSlPct,
          strategiesUsed: best.firedStrategies,
          modelUsed: 'TUG777 10-Strategy Matrix',
        };
        setLastDecision(decision);
        voiceEngine.speak(
          `Señal multi estrategia detectada. ${decision.action} en ${best.coin} con ${decision.confidence} por ciento de confianza en régimen ${best.regime}.`,
          true
        );
        await logEvent('INFO', 'STRATEGY', best.coin, `${decision.action} (${decision.confidence}%): ${decision.reason}`);

        if (openPositions.length >= maxOpen) {
          await logEvent(
            'INFO',
            'RISK_CAP',
            best.coin,
            `Límite de ${maxOpen} posiciones simultáneas alcanzado; entrada omitida hasta cerrar una posición.`
          );
          return;
        }

        if (apiPrivateKey.trim() && asset) {
          const orderUsd = computeDynamicOrderNotionalUsd({
            config,
            accountSummary,
            asset,
          });
          await submitProtectedOrder({
            coin: best.coin,
            side: decision.action as 'LONG' | 'SHORT',
            notionalUsd: orderUsd,
            mode: 'strategy',
            thesis: decision.reason,
            strategyTag: best.firedStrategies.join(','),
          });
        }
        return;
      }

      // Mode 2 & 3: Gemini AI Brain or BYO-AI External Endpoint + Unified DB Playbook + Fills History
      let currentMacro = macroBrief;
      if (!currentMacro && config.aiProvider === 'gemini' && config.useSearchGrounding) {
        try {
          const macroRes = await fetch('/api/ai/macro-radar', {
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

      let decision: AiBrainDecision & { error?: string; quotaExceeded?: boolean };
      try {
        const aiRes = await fetch('/api/ai/analyze-market', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            mode: config.mode,
            candidates: preFiltered.slice(0, 12),
            deepAnalyses,
            playbook: strategyPlaybook,
            positionGuide: POSITION_MANAGEMENT_GUIDE_RULES,
            fillsSummary,
            memories: aiMemories.slice(0, 15),
            openPositions,
            macroBrief: currentMacro,
            deepThinking: config.useDeepThinking,
            aiProvider: config.aiProvider,
            customAiUrl: config.customAiUrl,
            customAiModel: config.customAiModel,
            customSystemPrompt: config.customSystemPrompt,
            tpPct: config.tpPct,
            slPct: config.slPct,
          }),
        });

        decision = await parseAiJson<AiBrainDecision & { error?: string; quotaExceeded?: boolean }>(aiRes);
        if (!aiRes.ok || decision.error) {
          throw new Error(decision.error || 'Error en respuesta del Cerebro IA');
        }
      } catch (aiErr) {
        const bestLocal = [...deepAnalyses]
          .filter((d) => d.direction !== 'NEUTRAL' && !d.antiChaseBlocked && d.unifiedScore >= config.minQuantScore)
          .sort((a, b) => b.unifiedScore - a.unifiedScore)[0];
        if (!bestLocal) {
          throw aiErr;
        }
        decision = {
          action: bestLocal.direction as 'LONG' | 'SHORT',
          coin: bestLocal.coin,
          confidence: bestLocal.confidence,
          regime: bestLocal.regime,
          reason: `Respaldo local 10-Estrategias [${bestLocal.firedStrategies.join(', ')}]: ${bestLocal.reasons.join(' · ')}`,
          tpPct: bestLocal.recommendedTpPct,
          slPct: bestLocal.recommendedSlPct,
          strategiesUsed: bestLocal.firedStrategies,
          modelUsed: 'TUG777 10-Strategy Matrix (Local)',
        };
      }

      if (decision.quotaExceeded) {
        setStatusNotice({
          type: 'info',
          text: 'Cuota gratuita de Gemini alcanzada (429). Se activó el Fallback de la Matriz 10-Estrategias; conecta tu IA propia en "Parámetros IA" si prefieres LLM externo.',
        });
      }

      setLastDecision(decision);
      if (decision.action === 'HOLD') {
        voiceEngine.speak(
          `Señal del cerebro unificado: mantener espera. ${decision.reason}`
        );
      } else if (decision.action === 'CLOSE') {
        voiceEngine.speak(
          `El cerebro ordena cerrar posición en ${decision.coin}. ${decision.reason}`,
          true
        );
      } else {
        voiceEngine.speak(
          `Señal de inteligencia artificial detectada. ${decision.action} en ${decision.coin} con ${decision.confidence} por ciento de confianza. ${decision.reason}`,
          true
        );
      }
      await logEvent(
        'INFO',
        'UNIFIED_BRAIN',
        decision.coin || 'ALL',
        `[${decision.modelUsed}] ${decision.action} · Confianza ${decision.confidence}% · ${decision.reason}`
      );

      // Handle explicit CLOSE decision from AI Brain on an open Hyperliquid position
      if (decision.action === 'CLOSE' && decision.coin !== 'NONE' && apiPrivateKey.trim()) {
        const openPos = openPositions.find((p) => p.coin === decision.coin);
        if (openPos) {
          await handleCloseLivePosition(
            openPos.coin,
            openPos.side,
            Math.abs(openPos.szi),
            `Cierre táctico Cerebro IA: ${decision.reason}`
          );
        }
        return;
      }

      if (
        (decision.action === 'LONG' || decision.action === 'SHORT') &&
        decision.confidence >= config.minConfidence &&
        decision.coin !== 'NONE' &&
        apiPrivateKey.trim()
      ) {
        const alreadySameSide = openPositions.some(
          (p) => p.coin === decision.coin && p.side === decision.action
        );
        if (alreadySameSide) {
          await logEvent(
            'INFO',
            'RISK_CAP',
            decision.coin,
            `Ya existe posición ${decision.action} abierta en ${decision.coin}; evitando duplicado.`
          );
          return;
        }
        if (openPositions.length >= maxOpen) {
          await logEvent(
            'INFO',
            'RISK_CAP',
            decision.coin,
            `Límite de ${maxOpen} posiciones simultáneas alcanzado; entrada omitida.`
          );
          return;
        }

        const asset = marketsByCoin.get(decision.coin);
        if (!asset) return;
        const orderUsd = computeDynamicOrderNotionalUsd({
          config,
          accountSummary,
          asset,
        });
        await submitProtectedOrder({
          coin: decision.coin,
          side: decision.action,
          notionalUsd: orderUsd,
          mode: config.mode,
          thesis: `${decision.regime}: ${decision.reason}`,
          strategyTag: decision.strategiesUsed?.join(',') || '',
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      voiceEngine.speak(`Error en análisis del cerebro: ${msg}`, true);
      await logEvent('ERROR', 'BRAIN_CYCLE', 'SYSTEM', msg);
      setStatusNotice({ type: 'error', text: msg });
    } finally {
      setBrainThinking(false);
    }
  }, [
    markets,
    marketsByCoin,
    brainThinking,
    config,
    macroBrief,
    aiMemories,
    strategyPlaybook,
    fillsSummary,
    accountSummary,
    apiPrivateKey,
    logEvent,
    submitProtectedOrder,
    handleCloseLivePosition,
  ]);

  // Auto-run cycle using configured cadence (default 180s to protect free-tier quota)
  const brainRef = useRef(runUnifiedBrainCycle);
  brainRef.current = runUnifiedBrainCycle;
  useEffect(() => {
    if (!config.aiEnabled) return;
    void brainRef.current();
    const intervalMs = Math.max(30, config.scanIntervalSec || 180) * 1000;
    const timer = setInterval(() => void brainRef.current(), intervalMs);
    return () => clearInterval(timer);
  }, [config.aiEnabled, config.scanIntervalSec]);

  // Active Live Position Management Loop (SL, TP, Breakeven Lock, Trailing Stop, Regime Invalidation)
  const runPositionManagerCycle = useCallback(async () => {
    if (
      managingPositionsRef.current ||
      !config.aiEnabled ||
      !config.autoManagePositions ||
      !apiPrivateKey.trim()
    ) {
      return;
    }
    const openPositions = accountSummary?.positions || [];
    if (openPositions.length === 0) return;

    managingPositionsRef.current = true;
    try {
      for (const pos of openPositions) {
        const asset = marketsByCoin.get(pos.coin);
        if (!asset) continue;

        const [c15, c1h, book] = await Promise.all([
          fetchCandles(config.network, pos.coin, '15m', 96),
          fetchCandles(config.network, pos.coin, '1h', 60),
          fetchL2Book(config.network, pos.coin),
        ]);

        const deep = evaluateUnifiedDeepSetup({
          market: asset,
          candles15m: c15,
          candles1h: c1h,
          bids: book.bids,
          asks: book.asks,
          playbook: strategyPlaybook,
          memories: aiMemories,
        });

        const mgr = evaluateOpenPositionManagement({
          position: pos,
          deepAnalysis: deep,
          config,
          peakMovePct: peakMoveByCoinRef.current[pos.coin] ?? 0,
        });
        peakMoveByCoinRef.current[pos.coin] = mgr.peakMovePct;

        if (mgr.action !== 'HOLD') {
          await logEvent('EXEC', mgr.action, pos.coin, mgr.reason);
          voiceEngine.speak(`Gestión activa en ${pos.coin}. ${mgr.reason}`, true);
          await handleCloseLivePosition(pos.coin, pos.side, mgr.size, mgr.reason);
        }
      }
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
    const timer = setInterval(() => void posManagerRef.current(), 15000);
    return () => clearInterval(timer);
  }, [config.aiEnabled, config.autoManagePositions]);

  // Distill Real Hyperliquid Fills History into Firestore AI Memory & Strategy Rules
  const handleLearnFromHistory = useCallback(async () => {
    if (fillsSummary.totalClosed === 0) {
      soundEngine.alert();
      voiceEngine.speak('No hay trades cerrados en el historial de Hyperliquid todavía.', true);
      setStatusNotice({
        type: 'info',
        text: 'Conecta tu Master Wallet y realiza cierres reales para que la IA analice tu historial de Hyperliquid.',
      });
      return;
    }

    setLearningHistory(true);
    soundEngine.click();
    try {
      const lessons: Array<Omit<AiMemoryEntry, 'id' | 'ownerId' | 'createdAtMs'>> = [];

      for (const bad of fillsSummary.losingCoins.slice(0, 3)) {
        lessons.push({
          coin: bad.coin,
          regime: 'Auditoría Historial Real',
          outcome: 'LOSS',
          pnlUsd: bad.netPnl,
          lesson: `Evitar sobreoperar ${bad.coin} sin confluencia MTF (>=2 estrategias): suma ${bad.losses} pérdidas (${bad.netPnl.toFixed(2)} USD neto). Exigir pullback limpio y SL estricto.`,
        });
      }

      for (const good of fillsSummary.winningCoins.slice(0, 2)) {
        lessons.push({
          coin: good.coin,
          regime: 'Auditoría Historial Real',
          outcome: 'WIN',
          pnlUsd: good.netPnl,
          lesson: `${good.coin} muestra ventaja probada (${good.wins}W/${good.losses}L, +$${good.netPnl.toFixed(2)} neto). Priorizar setups con Trailing Stop activo para dejar correr ganancias.`,
        });
      }

      if (fillsSummary.totalFeesUsd > Math.abs(fillsSummary.netPnlUsd) * 0.45 && fillsSummary.totalFeesUsd > 1) {
        lessons.push({
          coin: 'ALL',
          regime: 'Control de Fees',
          outcome: fillsSummary.netPnlUsd >= 0 ? 'BREAKEVEN' : 'LOSS',
          pnlUsd: -fillsSummary.totalFeesUsd,
          lesson: `Comisiones acumuladas altas ($${fillsSummary.totalFeesUsd.toFixed(2)}). Evitar scalps de poco recorrido (<1%) y escalar tamaño dinámico sobre equity con R:R >= 1:2.1.`,
        });
      }

      if (user) {
        for (const l of lessons) {
          await appendAiMemory(user.uid, l);
        }
      } else {
        setAiMemories((prev) => [
          ...lessons.map((l, idx) => ({
            ...l,
            id: `hist-${Date.now()}-${idx}`,
            ownerId: 'local',
            createdAtMs: Date.now(),
          })),
          ...prev,
        ]);
      }

      soundEngine.tradeExecuted();
      voiceEngine.speak(
        `Historial analizado. ${lessons.length} reglas tácticas guardadas en la base de datos a partir de ${fillsSummary.totalClosed} trades reales.`,
        true
      );
      setStatusNotice({
        type: 'ok',
        text: `Historial real de Hyperliquid (${fillsSummary.totalClosed} trades · PnL neto ${fillsSummary.netPnlUsd >= 0 ? '+' : ''}$${fillsSummary.netPnlUsd.toFixed(2)} · Fees $${fillsSummary.totalFeesUsd.toFixed(2)}) destilado en ${lessons.length} reglas en Firestore.`,
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
  }, [fillsSummary, user]);

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

    if (!user) {
      setPersistedPositions((prev) =>
        prev.map((p) => (p.id === pos.id ? { ...p, status: 'CLOSED', markPx: liveMark, realizedPnl: realized } : p))
      );
      soundEngine.tradeExecuted();
      setStatusNotice({
        type: 'ok',
        text: `Registro local de ${pos.coin} cerrado (${realized >= 0 ? '+' : ''}$${realized.toFixed(2)}).`,
      });
      return;
    }

    await closePersistedPosition(user.uid, pos.id, liveMark, realized);
    if (pos.strategyTag) {
      await recordStrategyTradeOutcome(user.uid, pos.strategyTag.split(','), realized);
    }

    try {
      const res = await fetch('/api/ai/post-trade-lesson', {
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
        await appendAiMemory(user.uid, {
          coin: pos.coin,
          regime: learned.regime,
          outcome: learned.outcome,
          pnlUsd: realized,
          lesson: learned.lesson,
        });
      }
      soundEngine.tradeExecuted();
      voiceEngine.speak(
        `Posición en ${pos.coin} cerrada con ${realized >= 0 ? 'ganancia' : 'pérdida'} de ${Math.abs(realized).toFixed(2)} dólares. Lección guardada en la base de datos.`,
        true
      );
      setStatusNotice({
        type: 'ok',
        text: `Posición ${pos.coin} cerrada y lección aprendida guardada en Firestore.`,
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
          setChatMessages((prev) => [
            ...prev,
            {
              id: `local-u-${Date.now()}`,
              ownerId: 'local',
              role: 'user',
              content: message,
              modelUsed: 'user',
              createdAtMs: Date.now(),
            },
          ]);
        }
        const res = await fetch('/api/ai/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            history: chatMessages.map((m) => ({ role: m.role, content: m.content })),
            message,
            useSearch,
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
              recentMemories: aiMemories.slice(0, 6),
            },
          }),
        });
        const data = await parseAiJson<{ reply: string; modelUsed?: string; error?: string }>(res);
        if (!res.ok) throw new Error(data?.error || 'Error en chat IA');

        if (user) {
          await appendChatMessage(user.uid, {
            role: 'assistant',
            content: data.reply,
            modelUsed: data.modelUsed || 'gemini-3.1-flash-lite',
          });
        } else {
          setChatMessages((prev) => [
            ...prev,
            {
              id: `local-a-${Date.now()}`,
              ownerId: 'local',
              role: 'assistant',
              content: data.reply,
              modelUsed: data.modelUsed || 'gemini-3.1-flash-lite',
              createdAtMs: Date.now(),
            },
          ]);
        }

        if (speakReply || voiceNarratorEnabled) {
          voiceEngine.speak(data.reply, true);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        voiceEngine.speak(`Error en copiloto: ${msg}`, true);
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
          voiceEngine.speak('Encendiendo inteligencia artificial en modo automático.', true);
          void updateConfigPatch({ aiEnabled: true });
          return;
        case 'AI_OFF':
          soundEngine.powerOff();
          voiceEngine.speak('Apagando inteligencia artificial.', true);
          void updateConfigPatch({ aiEnabled: false });
          return;
        case 'MODE_STRATEGY':
          voiceEngine.speak('Cambiando a modo Estrategia cuantitativa.', true);
          void updateConfigPatch({ mode: 'strategy' });
          return;
        case 'MODE_AI':
          voiceEngine.speak('Cambiando a modo Inteligencia Artificial.', true);
          void updateConfigPatch({ mode: 'ai' });
          return;
        case 'MODE_STRATEGY_AI':
          voiceEngine.speak('Cambiando a modo unificado Estrategia más IA.', true);
          void updateConfigPatch({ mode: 'strategy_ai' });
          return;
        case 'ANALYZE_NOW':
          voiceEngine.speak('Escaneando todo el flujo de mercado de Hyperliquid ahora mismo.', true);
          void runUnifiedBrainCycle();
          return;
        case 'NAV_TERMINAL':
          setActiveTab('terminal');
          voiceEngine.speak('Abriendo terminal principal.', true);
          return;
        case 'NAV_POSITIONS':
          setActiveTab('positions');
          voiceEngine.speak('Abriendo panel de posiciones.', true);
          return;
        case 'NAV_PNL':
          setActiveTab('pnl');
          voiceEngine.speak('Abriendo reporte de PNL y rendimiento.', true);
          return;
        case 'NAV_LOGS':
          setActiveTab('logs');
          voiceEngine.speak('Abriendo registros y memoria de aprendizaje.', true);
          return;
        case 'NAV_DROPLET':
          setActiveTab('droplet');
          voiceEngine.speak('Abriendo guía de despliegue Droplet 24 horas.', true);
          return;
        case 'SYNC_POSITIONS':
          voiceEngine.speak('Sincronizando posiciones de Hyperliquid.', true);
          void refreshAccountData(true);
          return;
        case 'SAVE_CONFIG':
          void handleSaveAppConfig();
          return;
        case 'OPEN_API_MODAL':
          setApiModalOpen(true);
          voiceEngine.speak('Abriendo configuración de API Wallet.', true);
          return;
        case 'OPEN_PARAMS_MODAL':
          setAiParamsOpen(true);
          voiceEngine.speak('Abriendo parámetros del cerebro IA.', true);
          return;
        case 'OPEN_COPILOT':
          setCopilotOpen(true);
          voiceEngine.speak('Abriendo copiloto táctico.', true);
          return;
        case 'SELECT_COIN':
          if (cmd.coin) {
            setSelectedCoin(cmd.coin);
            setActiveTab('terminal');
            voiceEngine.speak(`Cargando gráfica y libro de órdenes de ${cmd.coin}.`, true);
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
            voiceEngine.speak(`No encontré posición abierta en ${cmd.coin}.`, true);
            setStatusNotice({ type: 'info', text: `No hay posición abierta en ${cmd.coin} para cerrar.` });
          }
          return;
        case 'CLOSE_ALL': {
          const openLive = accountSummary?.positions || [];
          if (openLive.length === 0) {
            voiceEngine.speak('No tienes posiciones abiertas en Hyperliquid para cerrar.', true);
            return;
          }
          voiceEngine.speak(`Cerrando ${openLive.length} posiciones abiertas en Hyperliquid.`, true);
          for (const p of openLive) {
            await handleCloseLivePosition(p.coin, p.side, Math.abs(p.szi));
          }
          return;
        }
        case 'ASK_COPILOT':
        default:
          setCopilotOpen(true);
          voiceEngine.speak('Consultando al copiloto.', true);
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
      voiceEngine.speak('Micrófono de comandos de voz desactivado.', true);
      return;
    }
    voiceEngine.speak('Escuchando tus órdenes por voz, socio.', true);
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
    voiceEngine.speak('Descargando archivo instalador Android A P K.', true);
    await downloadAndroidApkKit(window.location.origin);
    setStatusNotice({
      type: 'ok',
      text: 'Descargando TUG777-HyperTrade.apk (APK real firmado). Ábrelo en tu Android y permite "Instalar apps desconocidas" para instalarlo.',
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
                voiceEngine.speak(`Pestaña ${tab.label}`);
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
                <span className="text-emerald-400">
                  {hlChannel}: {hlLatencyMs || '--'} ms
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  Flashbots RPC:{' '}
                  {mevProbe?.flashbotsBlockHex ? `Blk ${mevProbe.flashbotsBlockHex}` : 'Verificando...'}
                </span>
                <span aria-hidden="true">·</span>
                <span>{markets.length} Tokens en Vivo</span>
              </div>
            </div>

            {/* Unified Controls Bar: AI ON/OFF + 3 Modes + APK + Auth + Sound + Copilot */}
            <div className="flex flex-wrap items-center gap-3">
              {/* AI ON / OFF Power Button */}
              <button
                onClick={() => {
                  const next = !config.aiEnabled;
                  if (next) {
                    soundEngine.powerOn();
                    voiceEngine.speak('Inteligencia artificial encendida en piloto automático.', true);
                  } else {
                    soundEngine.powerOff();
                    voiceEngine.speak('Inteligencia artificial apagada.', true);
                  }
                  void updateConfigPatch({ aiEnabled: next });
                }}
                className={`px-4 py-2.5 rounded-md text-xs font-bold inline-flex items-center gap-2 border transition-all whitespace-nowrap shrink-0 ${
                  config.aiEnabled
                    ? 'bg-emerald-600 border-emerald-400 text-white shadow-lg shadow-emerald-950/50'
                    : 'bg-[#090B0E] border-slate-700 text-slate-300 hover:border-slate-500'
                }`}
              >
                <Power className="w-4 h-4" />
                IA {config.aiEnabled ? 'ON' : 'OFF'}
              </button>

              {/* 3 Unified Brain Modes */}
              <div className="flex items-center bg-[#090B0E] p-1 rounded-md border border-slate-800">
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
                      soundEngine.click();
                      voiceEngine.speak(`Modo ${m.label} activado`, true);
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

              {/* Manual Brain Scan Trigger */}
              <button
                disabled={brainThinking}
                onClick={() => {
                  soundEngine.click();
                  void runUnifiedBrainCycle();
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
                    voiceEngine.voiceEnabled = true;
                    voiceEngine.speak('Voz y sonidos activados.', true);
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
                  · Confianza {lastDecision.confidence}% · {lastDecision.reason}
                </span>
              ) : (
                <span className="text-slate-400">
                  En espera · Presiona &quot;Analizar Ahora&quot; o activa &quot;IA ON&quot; para escanear los {markets.length} tokens en vivo.
                </span>
              )}
            </div>

            <div className="lg:col-span-4 flex flex-wrap lg:justify-end items-center gap-3 text-[11px] font-mono-tabular text-slate-400">
              <span className="text-slate-300">
                {config.sizingMode === 'equity_pct'
                  ? `Capital ${config.capitalPctPerTrade}%`
                  : `Fijo $${config.riskPerTradeUsd}`}
                {config.autoManagePositions ? ' · Gestión Activa' : ''}
              </span>
              <span className="inline-flex items-center gap-1 text-emerald-400">
                <ShieldCheck className="w-3.5 h-3.5" />
                MEV Guard {config.mevShieldEnabled ? 'ON' : 'OFF'}
              </span>
              {mevProbe?.channels.map((ch) => (
                <span key={ch.name} className={ch.ok ? 'text-slate-300' : 'text-red-400'}>
                  {ch.name.split(' ')[0]}: {ch.latencyMs}ms
                </span>
              ))}
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
                          PnL Vivo: {totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}
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
                        <div className="flex items-center gap-1.5 text-xs">
                          <span className="font-bold text-slate-100">{pos.coin}</span>
                          <span
                            className={`font-semibold ${
                              pos.side === 'LONG' ? 'text-emerald-400' : 'text-red-400'
                            }`}
                          >
                            {pos.side}
                          </span>
                          <span className="text-slate-500 font-mono-tabular">{pos.leverage}x</span>
                        </div>
                        <div
                          className={`text-[11px] font-mono-tabular font-semibold ${
                            pos.unrealizedPnl >= 0 ? 'text-emerald-400' : 'text-red-400'
                          }`}
                        >
                          {pos.unrealizedPnl >= 0 ? '+' : ''}${pos.unrealizedPnl.toFixed(2)} ({pos.returnOnEquity.toFixed(1)}%)
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
                      defaultNotionalUsd={config.riskPerTradeUsd}
                      executing={executing}
                      activePosition={
                        activePos
                          ? {
                              side: activePos.side,
                              size: Math.abs(activePos.szi),
                              unrealizedPnl: activePos.unrealizedPnl,
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
                          thesis: `Orden manual ${side} con Escudo Anti-MEV`,
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
                voiceEngine.speak(`Seleccionando ${coin} desde el radar de ballenas.`);
              }}
            />

            {/* Full Hyperliquid Live Token Scanner */}
            <div className="bg-[#0F131A] border border-slate-800/90 rounded-lg overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="text-base font-bold text-slate-100">
                    Escáner de Flujo de Mercado en Vivo (Todos los Tokens Hyperliquid)
                  </h2>
                  <p className="text-xs text-slate-400">
                    Haz clic en cualquier perpetuo para cargar su gráfica, libro L2 y confluencia en vivo
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      placeholder="Buscar token (BTC, HYPE...)"
                      value={tokenSearch}
                      onChange={(e) => setTokenSearch(e.target.value)}
                      className="bg-[#090B0E] border border-slate-700 rounded-md pl-8 pr-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-amber-500"
                    />
                  </div>
                  <div className="flex items-center bg-[#090B0E] p-1 rounded-md border border-slate-800">
                    {(['ALL', 'LONG', 'SHORT'] as const).map((b) => (
                      <button
                        key={b}
                        onClick={() => {
                          soundEngine.click();
                          setBiasFilter(b);
                        }}
                        className={`px-2.5 py-1 text-[11px] font-semibold rounded ${
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
                            `Token ${m.coin}, señal ${m.quantBias} con puntuación ${m.quantScore}.`,
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
              if (!user) return;
              void toggleStrategyPlaybookItem(user.uid, strategyId, enabled);
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
          void updateConfigPatch({
            network: saved.network,
            masterWalletAddress: saved.masterWalletAddress,
            mevShieldEnabled: saved.mevShieldEnabled,
            maxSlippageBps: saved.maxSlippageBps,
            maxOracleDeviationBps: saved.maxOracleDeviationBps,
            riskPerTradeUsd: saved.riskPerTradeUsd,
          });
          void refreshAccountData(true, saved.masterWalletAddress, saved.apiPrivateKey);
        }}
      />

      <AiBrainParamsModal
        open={aiParamsOpen}
        onClose={() => setAiParamsOpen(false)}
        config={config}
        onSave={(patch) => {
          void updateConfigPatch(patch);
          voiceEngine.speak('Parámetros del cerebro actualizados.', true);
          setStatusNotice({
            type: 'ok',
            text:
              patch.aiProvider === 'custom_ai'
                ? `Motor cambiado a tu IA externa (${patch.customAiModel || 'endpoint personalizado'}).`
                : 'Parámetros del Cerebro IA actualizados.',
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
