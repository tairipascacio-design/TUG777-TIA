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
  saveBotConfig,
  subscribeAiMemories,
  subscribeChatMessages,
  subscribePositions,
  subscribeTradeLogs,
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
import type {
  AiBrainDecision,
  AiMemoryEntry,
  BotConfigData,
  ChatMessageEntry,
  HlAccountSummary,
  HlAssetMarket,
  HlCandle,
  HlL2Level,
  HlUserFill,
  MevProbeStatus,
  PersistedPosition,
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
    return sessionStorage.getItem('tug777_hl_agent_pk') || '';
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
  const [chatMessages, setChatMessages] = useState<ChatMessageEntry[]>([]);

  // Brain & Execution State
  const [tokenSearch, setTokenSearch] = useState('');
  const [biasFilter, setBiasFilter] = useState<'ALL' | 'LONG' | 'SHORT'>('ALL');
  const [executing, setExecuting] = useState(false);
  const [closingCoin, setClosingCoin] = useState<string | null>(null);
  const [brainThinking, setBrainThinking] = useState(false);
  const [lastDecision, setLastDecision] = useState<AiBrainDecision | null>(null);
  const [macroBrief, setMacroBrief] = useState<string>('');
  const [macroSources, setMacroSources] = useState<Array<{ uri: string; title: string }>>([]);
  const [statusNotice, setStatusNotice] = useState<{ type: 'info' | 'error' | 'ok'; text: string } | null>(null);
  const [chatSending, setChatSending] = useState(false);

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
      setChatMessages([]);
      return;
    }

    const unsubPos = subscribePositions(user.uid, setPersistedPositions);
    const unsubLogs = subscribeTradeLogs(user.uid, setTradeLogs);
    const unsubMem = subscribeAiMemories(user.uid, setAiMemories);
    const unsubChat = subscribeChatMessages(user.uid, setChatMessages);

    return () => {
      unsubPos();
      unsubLogs();
      unsubMem();
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
      reduceOnly?: boolean;
      overrideSizeCoins?: number;
    }) => {
      const asset = marketsByCoin.get(params.coin);
      if (!asset) {
        voiceEngine.speak(`Token ${params.coin} no encontrado en Hyperliquid.`, true);
        setStatusNotice({ type: 'error', text: `Token ${params.coin} no encontrado en Hyperliquid.` });
        return;
      }

      if (!apiPrivateKey.trim()) {
        soundEngine.alert();
        voiceEngine.speak('Ingresa tu API Wallet Private Key para ejecutar órdenes reales.', true);
        setStatusNotice({
          type: 'error',
          text: 'Ingresa tu API Wallet Private Key para ejecutar órdenes reales en Hyperliquid.',
        });
        setApiModalOpen(true);
        return;
      }

      setExecuting(true);
      voiceEngine.speak(
        params.reduceOnly
          ? `Verificando escudo anti MEV para cerrar ${params.coin}.`
          : `Verificando escudo anti MEV para ${params.side} en ${params.coin}.`
      );
      try {
        // Fetch fresh L2 book right before order signing for strict Anti-MEV validation
        const freshBook = await fetchL2Book(config.network, params.coin);
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
          return;
        }

        const sizeCoins = params.overrideSizeCoins ?? params.notionalUsd / asset.markPx;
        const execResult = await executeRealHyperliquidOrder({
          network: config.network,
          apiPrivateKey,
          assetIndex: asset.index,
          szDecimals: asset.szDecimals,
          isBuy: params.side === 'LONG',
          referencePx: asset.markPx,
          sizeCoins,
          slippageBps: config.maxSlippageBps,
          reduceOnly: params.reduceOnly,
        });

        const statusStr = JSON.stringify(execResult.exchangeResponse);
        const hasHlError = statusStr.toLowerCase().includes('"error"');

        if (hasHlError) {
          soundEngine.alert();
          voiceEngine.speak(`Hyperliquid rechazó la orden en ${params.coin}.`, true);
          await logEvent(
            'ERROR',
            'HL_EXCHANGE',
            params.coin,
            `Rechazo Hyperliquid: ${statusStr}`,
            execResult.latencyMs
          );
          setStatusNotice({ type: 'error', text: `Hyperliquid rechazó la orden: ${statusStr}` });
          return;
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
          });
        }

        setStatusNotice({
          type: 'ok',
          text: `Orden real enviada (${params.coin} ${params.side}) en ${execResult.latencyMs} ms`,
        });
        await refreshAccountData();
      } catch (err) {
        soundEngine.alert();
        const msg = err instanceof Error ? err.message : String(err);
        voiceEngine.speak(`Error ejecutando orden en ${params.coin}: ${msg}`, true);
        await logEvent('ERROR', 'EXEC_FAIL', params.coin, msg);
        setStatusNotice({ type: 'error', text: msg });
      } finally {
        setExecuting(false);
      }
    },
    [marketsByCoin, apiPrivateKey, config, logEvent, user, refreshAccountData]
  );

  // Unified Brain Cycle (Estrategia / IA / Estrategia + IA)
  const runUnifiedBrainCycle = useCallback(async () => {
    if (markets.length === 0 || brainThinking) return;
    setBrainThinking(true);

    try {
      const minVolUsd = (config.minVolumeM || 2) * 1_000_000;
      const sortedCandidates = [...markets]
        .filter((m) => m.dayNtlVlm >= minVolUsd)
        .sort((a, b) => b.quantScore - a.quantScore);

      // Mode 1: Pure Quantitative Pro Master Unified Strategy
      if (config.mode === 'strategy') {
        const best = sortedCandidates.find(
          (c) => c.quantBias !== 'NEUTRAL' && c.quantScore >= config.minQuantScore
        );
        if (!best) {
          await logEvent(
            'INFO',
            'STRATEGY',
            'SCAN',
            `Escaneo Pro Master completado: sin confluencia >= ${config.minQuantScore} pts.`
          );
          voiceEngine.speak(
            `Escaneo de estrategia completado en ${markets.length} tokens, sin señal suficiente aún.`
          );
          setLastDecision({
            action: 'HOLD',
            coin: 'NONE',
            confidence: 45,
            regime: 'Sin Confluencia',
            reason: `Ningún token cumple el umbral cuantitativo unificado (>=${config.minQuantScore} pts).`,
            tpPct: config.tpPct,
            slPct: config.slPct,
            modelUsed: 'Pro Master Quant Engine',
          });
          return;
        }

        const decision: AiBrainDecision = {
          action: best.quantBias === 'LONG' ? 'LONG' : 'SHORT',
          coin: best.coin,
          confidence: best.quantScore,
          regime: 'Confluencia Cuantitativa',
          reason: best.quantSignals.join(' · '),
          tpPct: config.tpPct,
          slPct: config.slPct,
          modelUsed: 'Pro Master Quant Engine',
        };
        setLastDecision(decision);
        voiceEngine.speak(
          `Señal de estrategia detectada. ${decision.action} en ${best.coin} con ${decision.confidence} por ciento de confianza. ${decision.reason}`,
          true
        );
        await logEvent('INFO', 'STRATEGY', best.coin, `${decision.action} (${decision.confidence}%): ${decision.reason}`);

        if (apiPrivateKey.trim()) {
          await submitProtectedOrder({
            coin: best.coin,
            side: decision.action as 'LONG' | 'SHORT',
            notionalUsd: config.riskPerTradeUsd,
            mode: 'strategy',
            thesis: decision.reason,
          });
        }
        return;
      }

      // Mode 2 & 3: Gemini AI Brain or BYO-AI External Endpoint + Optional Search Grounding
      let currentMacro = macroBrief;
      if (!currentMacro && config.aiProvider === 'gemini' && config.useSearchGrounding) {
        const macroRes = await fetch('/api/ai/macro-radar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ coins: sortedCandidates.slice(0, 5).map((c) => c.coin) }),
        });
        if (macroRes.ok) {
          const macroData = await macroRes.json();
          currentMacro = macroData.summary || '';
          setMacroBrief(currentMacro);
          setMacroSources(macroData.sources || []);
        }
      }

      const aiRes = await fetch('/api/ai/analyze-market', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: config.mode,
          candidates: sortedCandidates.slice(0, 12),
          memories: aiMemories.slice(0, 15),
          openPositions: accountSummary?.positions || [],
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

      const decision = (await aiRes.json()) as AiBrainDecision & { error?: string; quotaExceeded?: boolean };
      if (!aiRes.ok || decision.error) {
        throw new Error(decision.error || 'Error en respuesta del Cerebro IA');
      }

      if (decision.quotaExceeded) {
        setStatusNotice({
          type: 'info',
          text: 'Cuota gratuita de Gemini alcanzada (429). Se activó el Fallback Cuantitativo automático; configura facturación en Settings > Secrets o conecta tu IA propia en "Parámetros IA".',
        });
      }

      setLastDecision(decision);
      if (decision.action === 'HOLD') {
        voiceEngine.speak(
          `Señal del cerebro unificado: mantener espera. ${decision.reason}`
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

      if (
        (decision.action === 'LONG' || decision.action === 'SHORT') &&
        decision.confidence >= config.minConfidence &&
        decision.coin !== 'NONE' &&
        apiPrivateKey.trim()
      ) {
        await submitProtectedOrder({
          coin: decision.coin,
          side: decision.action,
          notionalUsd: config.riskPerTradeUsd,
          mode: config.mode,
          thesis: `${decision.regime}: ${decision.reason}`,
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
    brainThinking,
    config,
    macroBrief,
    aiMemories,
    accountSummary,
    apiPrivateKey,
    logEvent,
    submitProtectedOrder,
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

  const handleCloseLivePosition = async (coin: string, side: 'LONG' | 'SHORT', size: number) => {
    setClosingCoin(coin);
    try {
      await submitProtectedOrder({
        coin,
        side: side === 'LONG' ? 'SHORT' : 'LONG',
        notionalUsd: 0,
        mode: 'manual',
        thesis: 'Cierre manual reduceOnly desde panel de posiciones',
        reduceOnly: true,
        overrideSizeCoins: size,
      });
    } finally {
      setClosingCoin(null);
    }
  };

  const handleClosePersistedAndLearn = async (pos: PersistedPosition) => {
    if (!user) return;
    const liveMark = marketsByCoin.get(pos.coin)?.markPx ?? pos.markPx;
    const realized = (pos.side === 'LONG' ? liveMark - pos.entryPx : pos.entryPx - liveMark) * pos.size;
    await closePersistedPosition(user.uid, pos.id, liveMark, realized);

    try {
      const res = await fetch('/api/ai/post-trade-lesson', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
        const learned = await res.json();
        await appendAiMemory(user.uid, {
          coin: pos.coin,
          regime: learned.regime,
          outcome: learned.outcome,
          pnlUsd: realized,
          lesson: learned.lesson,
        });
        soundEngine.tradeExecuted();
        voiceEngine.speak(
          `Posición en ${pos.coin} cerrada con ${realized >= 0 ? 'ganancia' : 'pérdida'} de ${Math.abs(realized).toFixed(2)} dólares. Lección guardada en la base de datos.`,
          true
        );
        setStatusNotice({
          type: 'ok',
          text: `Posición ${pos.coin} cerrada y lección aprendida guardada en Firestore.`,
        });
      }
    } catch (err) {
      console.error('Learn loop error:', err);
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
          headers: { 'Content-Type': 'application/json' },
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
        const data = await res.json();
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
    if (isInstallable) {
      voiceEngine.speak('Iniciando instalación de la aplicación en tu dispositivo.', true);
      await triggerPwaInstall();
    } else {
      voiceEngine.speak('Descargando paquete Android A P K.', true);
      await downloadAndroidApkKit(window.location.origin);
      setStatusNotice({
        type: 'ok',
        text: 'Kit Android APK descargado. También puedes instalarla directo desde Chrome Android ("Instalar aplicación").',
      });
    }
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
                <OrderBookPanel
                  asset={selectedAsset}
                  bids={l2Book.bids}
                  asks={l2Book.asks}
                  hasApiKey={Boolean(apiPrivateKey.trim())}
                  mevShieldEnabled={config.mevShieldEnabled}
                  defaultNotionalUsd={config.riskPerTradeUsd}
                  executing={executing}
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
            syncingAccount={syncingAccount}
            lastSyncedAt={lastSyncedAt}
            onRefreshAccount={() => void refreshAccountData(true)}
            onCloseLivePosition={(coin, side, sz) => void handleCloseLivePosition(coin, side, sz)}
            onClosePersistedPosition={(pos) => void handleClosePersistedAndLearn(pos)}
            onOpenApiModal={() => setApiModalOpen(true)}
          />
        )}

        {activeTab === 'pnl' && (
          <PnlView
            fills={userFills}
            persistedPositions={persistedPositions}
            accountSummary={accountSummary}
          />
        )}

        {activeTab === 'logs' && <LogsAndMemoryView logs={tradeLogs} memories={aiMemories} />}

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
          if (saved.apiPrivateKey) {
            sessionStorage.setItem('tug777_hl_agent_pk', saved.apiPrivateKey);
          } else {
            sessionStorage.removeItem('tug777_hl_agent_pk');
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
