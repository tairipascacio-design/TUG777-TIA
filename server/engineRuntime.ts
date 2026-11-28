import fs from 'fs';
import path from 'path';
import type { WebSocket } from 'ws';
import type {
  AiBrainDecision,
  BotConfigData,
  DeepAssetAnalysis,
  EngineStateSnapshot,
  EngineWsMessage,
  HlAccountSummary,
  HlAssetMarket,
  HlCandle,
  HlL2Level,
  HlLivePosition,
  HlNetwork,
  HlUserFill,
  OrderExecutionTelemetry,
  OrderFillStatus,
} from '../src/types/trading.ts';
import {
  DEFAULT_STRATEGY_PLAYBOOK,
  computeDynamicOrderNotionalUsd,
  evaluateOpenPositionManagement,
  evaluateProfessionalEntryGate,
  evaluateUnifiedDeepSetup,
  optimizeEntryDecision,
} from '../src/services/strategyEngine.ts';
import { computeQuantConfluence } from '../src/utils/quantConfluence.ts';
import { analyzeMarketWithBrain } from './geminiService.ts';
import { HyperliquidWsClient } from './hyperliquidWs.ts';
import {
  clampIocSlippageBps,
  getBackendSignerAddress,
  getRegisteredTugPositionMeta,
  getRegistryCounts,
  hasRegisteredTugPosition,
  isBackendSignerConfigured,
  isKnownTugOrder,
  isTugCloid,
  registerTugOrder,
  setBackendSignerKey,
  submitEntryWithNativeTpsl,
  submitReduceOnlyClose,
} from './hyperliquidExec.ts';
import {
  DEFAULT_MCLOUD_BASE_URL,
  emitMcloudEvent,
  fetchMcloudContext,
  inferWithMcloud,
  normalizeMcloudBaseUrl,
  probeMcloudHealth,
  saveMcloudKvObject,
} from './mcloudClient.ts';

const CONFIG_PATH = path.resolve(process.cwd(), 'data', 'engine-config.json');

const HL_REST_BASE: Record<HlNetwork, string> = {
  mainnet: 'https://api.hyperliquid.xyz',
  testnet: 'https://api.hyperliquid-testnet.xyz',
};

function defaultEngineConfig(): BotConfigData {
  const envNet = process.env.HL_NETWORK === 'testnet' ? 'testnet' : 'mainnet';
  return {
    ownerId: 'tug777-engine',
    mode: 'strategy_ai',
    aiEnabled: false, // ALWAYS boots PAUSED
    network: envNet,
    masterWalletAddress: (process.env.HL_MASTER_ADDRESS || '').trim(),
    mevShieldEnabled: true,
    maxSlippageBps: 15,
    maxOracleDeviationBps: 35,
    riskPerTradeUsd: 50,
    soundEnabled: true,
    aiProvider: 'gemini',
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
    sizingMode: 'equity_pct',
    capitalPctPerTrade: 15,
    maxOpenPositions: 2,
    leverage: 10,
    trailingStopEnabled: true,
    autoManagePositions: true,
    riskPerTradePct: 0.35,
    dailyMaxLossPct: 2.5,
    killSwitchEnabled: false,
    geminiModel: 'auto',
    globalBiasLock: 'AMBOS',
    pairBiasLocksJson: '{}',
    useAloEntries: false,
    minOrderUsdFloor: 12,
    streakCooldownHours: 3,
    watchlistCoinsCsv: 'BTC,ETH,SOL,HYPE',
    mcloudEnabled: true,
    mcloudUrl: normalizeMcloudBaseUrl(process.env.MCLOUD_URL || DEFAULT_MCLOUD_BASE_URL),
  };
}

function loadPersistedConfig(): BotConfigData {
  const base = defaultEngineConfig();
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) as Partial<BotConfigData>;
      return {
        ...base,
        ...parsed,
        // Safety Invariant: NEVER auto-resume trading on process boot
        aiEnabled: false,
        mcloudUrl: normalizeMcloudBaseUrl(parsed.mcloudUrl || base.mcloudUrl),
      };
    }
  } catch {
    // ignore read error
  }
  return base;
}

function saveConfigToDisk(cfg: BotConfigData) {
  try {
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify({ ...cfg, aiEnabled: false }, null, 2), 'utf8');
  } catch {
    // ignore read-only FS
  }
}

function parseWatchlist(csv: string): string[] {
  const items = (csv || 'BTC,ETH,SOL,HYPE')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  return items.length > 0 ? Array.from(new Set(items)).slice(0, 12) : ['BTC', 'ETH', 'SOL', 'HYPE'];
}

export class Tug777EngineRuntime {
  private config: BotConfigData = loadPersistedConfig();
  private enginePaused = true; // ALWAYS PAUSED on boot
  private pauseReason = 'Motor iniciado en PAUSA (solo lectura). Actívalo manualmente para operar.';
  private started = false;

  private selectedCoin = 'BTC';
  private selectedInterval: '1m' | '5m' | '15m' | '1h' | '4h' = '15m';
  private markets: HlAssetMarket[] = [];
  private l2Books = new Map<string, { bids: HlL2Level[]; asks: HlL2Level[] }>();
  private l2LastError: string | null = null;
  private l2UpdatedAtMs = 0;
  private candlesByKey = new Map<string, HlCandle[]>();
  private accountSummary: HlAccountSummary | null = null;
  private fills: HlUserFill[] = [];
  private openOrderCloidsByCoin = new Map<string, string[]>();
  private lastDecision: AiBrainDecision | null = null;

  private wsClient: HyperliquidWsClient | null = null;
  private wsConnected = false;
  private wsUrl = '';
  private wsLatencyMs = 0;
  private lastWsEventAtMs = 0;
  private hlRestFallbackMs = 0;

  private mcloudConnected = false;
  private mcloudLastStatus = 'Sin verificar';
  private streakCooldownUntilMs = 0;
  private recentEntryZones: Array<{ coin: string; px: number; ts: number }> = [];
  private positionPeaks = new Map<string, { peakMovePct: number; partialStage: number }>();

  private confirmTimesHistory: number[] = [];
  private detectExecTimesHistory: number[] = [];

  private telemetry: OrderExecutionTelemetry = {
    activeRoute: 'TUG777-ENGINE',
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
    avgConfirmMs: 0,
    minConfirmMs: 0,
    maxConfirmMs: 0,
    avgDetectToExecMs: 0,
    maxDetectToExecMs: 0,
    baselineAvgMs: 0,
    recent5AvgMs: 0,
    degradationPct: 0,
    degradationAlert: false,
    totalConfirmed: 0,
    totalFilledConfirmed: 0,
    totalAckOnly: 0,
    totalRejected: 0,
    totalMevEvaluated: 0,
    totalBlockedByMev: 0,
    lastSpreadBps: 0,
    lastOracleDiffBps: 0,
    lastDirectionalDepthUsd: 0,
    lastMevReason: 'Motor TUG777 listo en espera de activación.',
    updatedAtMs: Date.now(),
  };

  private recentLogs: EngineStateSnapshot['recentLogs'] = [];
  private clients = new Set<WebSocket>();
  private scanTimer: ReturnType<typeof setInterval> | null = null;
  private accountTimer: ReturnType<typeof setInterval> | null = null;
  private mcloudTimer: ReturnType<typeof setInterval> | null = null;
  private scanInFlight = false;
  private lastMidsBroadcastAt = 0;

  public start() {
    if (this.started) return;
    this.started = true;
    this.enginePaused = true;
    this.config.aiEnabled = false;

    this.addLog(
      'INFO',
      'ENGINE_BOOT',
      'SYSTEM',
      'tug777-engine iniciado en PAUSA (solo lectura). Feed WebSocket Hyperliquid conectando...'
    );

    const watchlist = parseWatchlist(this.config.watchlistCoinsCsv);
    if (!watchlist.includes(this.selectedCoin)) {
      this.selectedCoin = watchlist[0] || 'BTC';
    }

    this.wsClient = new HyperliquidWsClient(
      {
        network: this.config.network,
        selectedCoin: this.selectedCoin,
        selectedInterval: this.selectedInterval,
        watchlistCoins: watchlist,
        userAddress: this.config.masterWalletAddress,
      },
      {
        onMids: (mids, ts) => this.handleWsMids(mids, ts),
        onL2Book: (coin, bids, asks, ts) => this.handleWsL2(coin, bids, asks, ts),
        onCandle: (coin, interval, candle, ts) => this.handleWsCandle(coin, interval, candle, ts),
        onUserEvents: (_ev, ts) => {
          this.lastWsEventAtMs = ts;
          if (this.config.masterWalletAddress) {
            void this.refreshAccountState();
          }
        },
        onStatusChange: (status) => {
          this.wsConnected = status.connected;
          this.wsUrl = status.wsUrl;
          this.wsLatencyMs = status.wsLatencyMs;
          if (!status.connected && status.reason) {
            this.l2LastError = `WS L2 desconectado: ${status.reason}`;
          }
        },
        onError: (channel, detail) => {
          const msg = `[${channel}] ${detail}`;
          if (this.l2LastError !== msg) {
            this.l2LastError = msg;
            this.addLog('WARN', 'L2_ENGINE', this.selectedCoin, msg);
          }
        },
      }
    );
    this.wsClient.start();

    void this.bootstrapRestData();
    void this.checkMcloudConnection();

    this.accountTimer = setInterval(() => {
      if (this.config.masterWalletAddress) {
        void this.refreshAccountState();
      }
      if (this.markets.length === 0) {
        void this.bootstrapRestData();
      }
    }, 15_000);

    this.mcloudTimer = setInterval(() => {
      if (this.config.mcloudEnabled) {
        void this.checkMcloudConnection();
      }
    }, 60_000);

    this.rescheduleScanLoop();
  }

  public stop() {
    this.wsClient?.stop();
    if (this.scanTimer) clearInterval(this.scanTimer);
    if (this.accountTimer) clearInterval(this.accountTimer);
    if (this.mcloudTimer) clearInterval(this.mcloudTimer);
    this.started = false;
  }

  public attachWsClient(ws: WebSocket) {
    this.clients.add(ws);
    try {
      ws.send(
        JSON.stringify({
          type: 'snapshot',
          payload: this.getSnapshot(),
          ts: Date.now(),
        } satisfies EngineWsMessage)
      );
    } catch {
      this.clients.delete(ws);
    }
    ws.on('close', () => {
      this.clients.delete(ws);
    });
  }

  private broadcast(msg: EngineWsMessage) {
    if (this.clients.size === 0) return;
    const raw = JSON.stringify(msg);
    for (const c of Array.from(this.clients)) {
      if (c.readyState === 1) {
        try {
          c.send(raw);
        } catch {
          this.clients.delete(c);
        }
      } else {
        this.clients.delete(c);
      }
    }
  }

  private addLog(
    level: 'INFO' | 'EXEC' | 'MEV_GUARD' | 'WARN' | 'ERROR',
    category: string,
    coin: string,
    message: string,
    latencyMs = 0
  ) {
    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      level,
      category,
      coin,
      message,
      latencyMs,
      createdAtMs: Date.now(),
    };
    this.recentLogs = [entry, ...this.recentLogs].slice(0, 120);
    this.broadcast({ type: 'log', payload: entry, ts: entry.createdAtMs });
  }

  private async postHlInfo<T>(payload: Record<string, unknown>): Promise<{ data: T; latencyMs: number }> {
    const base = HL_REST_BASE[this.config.network] || HL_REST_BASE.mainnet;
    const t0 = performance.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch(`${base}/info`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`HL Info HTTP ${res.status}`);
      }
      const data = (await res.json()) as T;
      return { data, latencyMs: Math.round(performance.now() - t0) };
    } finally {
      clearTimeout(timer);
    }
  }

  public async bootstrapRestData() {
    try {
      type MetaResp = [
        { universe: Array<{ name: string; szDecimals: number; maxLeverage: number; isDelisted?: boolean }> },
        Array<{
          funding: string;
          openInterest: string;
          prevDayPx: string;
          dayNtlVlm: string;
          premium: string;
          oraclePx: string;
          markPx: string;
          midPx: string | null;
        }>
      ];
      const { data, latencyMs } = await this.postHlInfo<MetaResp>({ type: 'metaAndAssetCtxs' });
      this.hlRestFallbackMs = latencyMs;
      const [meta, ctxs] = data;
      const nextMarkets: HlAssetMarket[] = [];
      meta.universe.forEach((asset, index) => {
        if (asset.isDelisted) return;
        const ctx = ctxs[index];
        if (!ctx) return;
        const markPx = Number(ctx.markPx || 0);
        if (markPx <= 0) return;
        const midPx = Number(ctx.midPx || markPx);
        const oraclePx = Number(ctx.oraclePx || markPx);
        const prevDayPx = Number(ctx.prevDayPx || markPx);
        const fundingRate = Number(ctx.funding || 0);
        const openInterest = Number(ctx.openInterest || 0);
        const dayNtlVlm = Number(ctx.dayNtlVlm || 0);
        const premium = Number(ctx.premium || 0);
        const change24hPct = prevDayPx > 0 ? ((markPx - prevDayPx) / prevDayPx) * 100 : 0;
        const annualizedFundingPct = fundingRate * 24 * 365 * 100;
        const openInterestUsd = openInterest * markPx;
        const { quantScore, quantBias, quantSignals } = computeQuantConfluence({
          change24hPct,
          annualizedFundingPct,
          openInterestUsd,
          dayNtlVlm,
          markPx,
          oraclePx,
        });
        nextMarkets.push({
          index,
          coin: asset.name,
          szDecimals: asset.szDecimals,
          maxLeverage: asset.maxLeverage,
          markPx,
          midPx,
          oraclePx,
          prevDayPx,
          change24hPct,
          fundingRate,
          annualizedFundingPct,
          openInterest,
          openInterestUsd,
          dayNtlVlm,
          premium,
          quantScore,
          quantBias,
          quantSignals,
        });
      });
      nextMarkets.sort((a, b) => b.dayNtlVlm - a.dayNtlVlm);
      this.markets = nextMarkets;

      await Promise.all([
        this.hydrateCandles(this.selectedCoin, this.selectedInterval),
        this.hydrateL2Book(this.selectedCoin),
      ]);

      if (this.config.masterWalletAddress) {
        await this.refreshAccountState();
      }
      this.broadcast({ type: 'snapshot', payload: this.getSnapshot(), ts: Date.now() });
    } catch (err) {
      this.addLog(
        'WARN',
        'HL_BOOTSTRAP',
        this.selectedCoin,
        `Error hidratando mercados iniciales: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  private async hydrateCandles(coin: string, interval: '1m' | '5m' | '15m' | '1h' | '4h') {
    const intervalMsMap = {
      '1m': 60_000,
      '5m': 300_000,
      '15m': 900_000,
      '1h': 3_600_000,
      '4h': 14_400_000,
    };
    const endTime = Date.now();
    const startTime = endTime - intervalMsMap[interval] * 96;
    try {
      const { data } = await this.postHlInfo<
        Array<{ t: number; T: number; s: string; i: string; o: string; c: string; h: string; l: string; v: string; n: number }>
      >({
        type: 'candleSnapshot',
        req: { coin, interval, startTime, endTime },
      });
      const parsed = (data || [])
        .map((k) => ({
          t: k.t,
          T: k.T,
          s: k.s,
          i: k.i,
          o: Number(k.o),
          c: Number(k.c),
          h: Number(k.h),
          l: Number(k.l),
          v: Number(k.v),
          n: k.n,
        }))
        .sort((a, b) => a.t - b.t);
      this.candlesByKey.set(`${coin}:${interval}`, parsed);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.addLog('WARN', 'HL_CANDLES', coin, `Error cargando velas (${interval}): ${msg}`);
    }
  }

  private async hydrateL2Book(coin: string) {
    try {
      const { data, latencyMs } = await this.postHlInfo<{
        levels?: [
          Array<{ px: string; sz: string; n: number }>,
          Array<{ px: string; sz: string; n: number }>
        ];
      } | null>({ type: 'l2Book', coin });
      if (!data || !Array.isArray(data.levels)) {
        const msg = `Respuesta L2 nula/inválida de Hyperliquid para ${coin}`;
        if (coin === this.selectedCoin && this.l2LastError !== msg) {
          this.l2LastError = msg;
          this.addLog('WARN', 'L2_ENGINE', coin, msg, latencyMs);
        }
        return;
      }
      const bids = (data.levels[0] || [])
        .slice(0, 12)
        .map((l) => ({
          px: Number(l.px),
          sz: Number(l.sz),
          n: l.n,
        }))
        .filter((l) => Number.isFinite(l.px) && l.px > 0 && Number.isFinite(l.sz) && l.sz > 0);
      const asks = (data.levels[1] || [])
        .slice(0, 12)
        .map((l) => ({
          px: Number(l.px),
          sz: Number(l.sz),
          n: l.n,
        }))
        .filter((l) => Number.isFinite(l.px) && l.px > 0 && Number.isFinite(l.sz) && l.sz > 0);
      if (bids.length === 0 && asks.length === 0) {
        const msg = `Libro L2 vacío (0 bids / 0 asks) en Hyperliquid para ${coin}`;
        if (coin === this.selectedCoin && this.l2LastError !== msg) {
          this.l2LastError = msg;
          this.addLog('WARN', 'L2_ENGINE', coin, msg, latencyMs);
        }
        return;
      }
      this.l2Books.set(coin, { bids, asks });
      if (coin === this.selectedCoin) {
        this.l2LastError = null;
        this.l2UpdatedAtMs = Date.now();
      }
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      const msg = `Error REST L2 (${coin}): ${raw}`;
      if (coin === this.selectedCoin && this.l2LastError !== msg) {
        this.l2LastError = msg;
        this.addLog('WARN', 'L2_ENGINE', coin, msg);
      }
    }
  }

  public async refreshAccountState() {
    const user = this.config.masterWalletAddress.trim();
    if (!user) return;
    try {
      type ClearinghouseResp = {
        marginSummary: { accountValue: string; totalMarginUsed: string; totalNtlPos: string };
        withdrawable: string;
        assetPositions: Array<{
          position: {
            coin: string;
            szi: string;
            entryPx: string | null;
            positionValue: string;
            unrealizedPnl: string;
            returnOnEquity: string;
            leverage: { value: number };
            liquidationPx: string | null;
            marginUsed: string;
            maxLeverage: number;
          };
        }>;
      };
      type RawFill = {
        coin: string;
        px: string;
        sz: string;
        side: 'B' | 'A';
        time: number;
        closedPnl: string;
        fee: string;
        oid: number;
        hash: string;
        cloid?: string;
      };
      type OpenOrderResp = Array<{ coin: string; oid: number; cloid?: string }>;

      const [ch, fillsRes, openOrdersRes] = await Promise.all([
        this.postHlInfo<ClearinghouseResp>({ type: 'clearinghouseState', user }),
        this.postHlInfo<RawFill[]>({ type: 'userFills', user }),
        this.postHlInfo<OpenOrderResp>({ type: 'openOrders', user }),
      ]);

      const nextOpenCloids = new Map<string, string[]>();
      for (const oo of openOrdersRes.data || []) {
        if (oo.cloid) {
          const arr = nextOpenCloids.get(oo.coin) || [];
          arr.push(oo.cloid);
          nextOpenCloids.set(oo.coin, arr);
        }
      }
      this.openOrderCloidsByCoin = nextOpenCloids;

      const parsedFills: HlUserFill[] = (fillsRes.data || []).slice(0, 120).map((f) => ({
        coin: f.coin,
        px: Number(f.px),
        sz: Number(f.sz),
        side: f.side,
        time: f.time,
        closedPnl: Number(f.closedPnl || 0),
        fee: Number(f.fee || 0),
        oid: f.oid,
        hash: f.hash,
        ...(f.cloid ? { cloid: f.cloid } : {}),
      }));
      this.fills = parsedFills;

      // Determine which open coins belong to TUG777 vs External
      const tugFillCoins = new Set<string>();
      for (const f of parsedFills) {
        if (isKnownTugOrder(f.cloid, f.oid)) {
          tugFillCoins.add(f.coin.toUpperCase());
        }
      }

      const positions: HlLivePosition[] = (ch.data?.assetPositions || [])
        .map((ap) => ap.position)
        .filter((p) => Math.abs(Number(p.szi)) > 0)
        .map((p) => {
          const szi = Number(p.szi);
          const coinUp = p.coin.toUpperCase();
          const cloids = nextOpenCloids.get(p.coin) || [];
          const hasTugOpenOrder = cloids.some((c) => isTugCloid(c));
          const isTugOwned =
            hasRegisteredTugPosition(coinUp) || hasTugOpenOrder || tugFillCoins.has(coinUp);
          const meta = getRegisteredTugPositionMeta(coinUp);
          return {
            coin: p.coin,
            szi,
            side: (szi >= 0 ? 'LONG' : 'SHORT') as 'LONG' | 'SHORT',
            entryPx: Number(p.entryPx || 0),
            positionValue: Number(p.positionValue || 0),
            unrealizedPnl: Number(p.unrealizedPnl || 0),
            returnOnEquity: Number(p.returnOnEquity || 0) * 100,
            leverage: p.leverage?.value ?? 1,
            liquidationPx: p.liquidationPx ? Number(p.liquidationPx) : null,
            marginUsed: Number(p.marginUsed || 0),
            maxLeverage: p.maxLeverage,
            ...(meta?.cloid ? { cloid: meta.cloid } : {}),
            isExternal: !isTugOwned,
          };
        });

      this.accountSummary = {
        accountValue: Number(ch.data?.marginSummary?.accountValue || 0),
        totalMarginUsed: Number(ch.data?.marginSummary?.totalMarginUsed || 0),
        totalNtlPos: Number(ch.data?.marginSummary?.totalNtlPos || 0),
        withdrawable: Number(ch.data?.withdrawable || 0),
        positions,
      };
    } catch {
      // ignore transient account fetch
    }
  }

  private handleWsMids(mids: Record<string, number>, ts: number) {
    this.lastWsEventAtMs = ts;
    for (const m of this.markets) {
      const nextMid = mids[m.coin];
      if (nextMid && nextMid > 0) {
        m.midPx = nextMid;
        m.markPx = nextMid;
        m.change24hPct = m.prevDayPx > 0 ? ((nextMid - m.prevDayPx) / m.prevDayPx) * 100 : m.change24hPct;
      }
    }
    // Also update unrealized PnL estimates on live positions for responsive UI
    if (this.accountSummary) {
      for (const pos of this.accountSummary.positions) {
        const px = mids[pos.coin];
        if (px && px > 0 && pos.entryPx > 0) {
          pos.unrealizedPnl = (pos.side === 'LONG' ? px - pos.entryPx : pos.entryPx - px) * Math.abs(pos.szi);
        }
      }
    }
    if (ts - this.lastMidsBroadcastAt >= 450) {
      this.lastMidsBroadcastAt = ts;
      const watchlist = parseWatchlist(this.config.watchlistCoinsCsv);
      const compact: Record<string, number> = {};
      for (const m of this.markets.slice(0, 30)) {
        compact[m.coin] = m.markPx;
      }
      for (const w of watchlist) {
        if (mids[w]) compact[w] = mids[w];
      }
      if (mids[this.selectedCoin]) compact[this.selectedCoin] = mids[this.selectedCoin];
      this.broadcast({ type: 'mids_tick', payload: compact, ts });
    }
  }

  private handleWsL2(coin: string, bids: HlL2Level[], asks: HlL2Level[], ts: number) {
    this.lastWsEventAtMs = ts;
    this.l2Books.set(coin, { bids, asks });
    if (coin === this.selectedCoin) {
      this.l2LastError = null;
      this.l2UpdatedAtMs = ts;
      this.broadcast({ type: 'l2_tick', payload: { coin, bids, asks }, ts });
    }
  }

  private handleWsCandle(coin: string, interval: string, candle: HlCandle, ts: number) {
    this.lastWsEventAtMs = ts;
    const key = `${coin}:${interval}`;
    const existing = this.candlesByKey.get(key) || [];
    const idx = existing.findIndex((c) => c.t === candle.t);
    let next: HlCandle[];
    if (idx >= 0) {
      next = [...existing];
      next[idx] = candle;
    } else {
      next = [...existing, candle].sort((a, b) => a.t - b.t).slice(-120);
    }
    this.candlesByKey.set(key, next);
    if (coin === this.selectedCoin && interval === this.selectedInterval) {
      this.broadcast({ type: 'candle_tick', payload: { coin, interval, candle }, ts });
    }
  }

  public async checkMcloudConnection() {
    if (!this.config.mcloudEnabled) {
      this.mcloudConnected = false;
      this.mcloudLastStatus = 'Desactivado por usuario';
      return null;
    }
    const res = await probeMcloudHealth(this.config.mcloudUrl);
    this.mcloudConnected = res.ok;
    this.mcloudLastStatus = `${res.ok ? 'OK' : 'OFFLINE'} · ${res.detail}`;
    return res;
  }

  public updateMcloudProbeStatus(res: { ok: boolean; detail: string }) {
    this.mcloudConnected = res.ok;
    this.mcloudLastStatus = `${res.ok ? 'OK' : 'OFFLINE'} · ${res.detail}`;
  }

  public async syncSnapshotToMcloud(overrideUrl?: string) {
    const targetUrl = overrideUrl || this.config.mcloudUrl;
    const summary: Record<string, unknown> = {
      service: 'tug777-engine',
      network: this.config.network,
      enginePaused: this.enginePaused,
      aiEnabled: this.config.aiEnabled,
      wsConnected: this.wsConnected,
      wsLatencyMs: this.wsLatencyMs,
      selectedCoin: this.selectedCoin,
      leverage: this.config.leverage ?? 10,
      scannedTokenCount: this.markets.length,
      openPositionsCount: this.accountSummary?.positions?.length ?? 0,
      accountValueUsd: this.accountSummary?.accountValue ?? 0,
      updatedAtMs: Date.now(),
    };
    const [webhookResult, kvResult] = await Promise.all([
      emitMcloudEvent('tug777_engine_sync', summary, targetUrl),
      saveMcloudKvObject('tug777', 'engine_state', summary, targetUrl),
    ]);
    const ok = webhookResult.ok || kvResult.ok;
    this.mcloudConnected = ok;
    this.mcloudLastStatus = `${ok ? 'SYNC_OK' : 'SYNC_ERR'} · wh=${webhookResult.status || 'ERR'}(${webhookResult.latencyMs}ms) · kv=${kvResult.status || 'ERR'}(${kvResult.latencyMs}ms)`;
    this.addLog(
      ok ? 'INFO' : 'WARN',
      'MCLOUD_SYNC',
      this.selectedCoin,
      `Sincronización manual a mcloud (${normalizeMcloudBaseUrl(targetUrl)}): ${this.mcloudLastStatus}`,
      Math.max(webhookResult.latencyMs, kvResult.latencyMs)
    );
    return { ok, baseUrl: normalizeMcloudBaseUrl(targetUrl), webhookResult, kvResult };
  }

  public getSnapshot(): EngineStateSnapshot {
    const watchlist = parseWatchlist(this.config.watchlistCoinsCsv);
    const counts = getRegistryCounts();
    return {
      service: 'tug777-engine',
      enginePaused: this.enginePaused,
      pauseReason: this.pauseReason,
      network: this.config.network,
      wsConnected: this.wsConnected,
      wsUrl: this.wsClient?.getWsUrl() || this.wsUrl,
      wsLatencyMs: this.wsLatencyMs,
      lastWsEventAtMs: this.lastWsEventAtMs,
      hlRestFallbackMs: this.hlRestFallbackMs,
      signerConfigured: isBackendSignerConfigured(),
      masterWalletAddress: this.config.masterWalletAddress,
      mcloudConnected: this.mcloudConnected,
      mcloudUrl: (this.config.mcloudUrl || normalizeMcloudBaseUrl()).replace(/\/api\/health\/?$/i, ''),
      mcloudLastStatus: this.mcloudLastStatus,
      streakCooldownUntilMs: this.streakCooldownUntilMs,
      scannedTokenCount: this.markets.length,
      watchlistCoins: watchlist,
      selectedCoin: this.selectedCoin,
      selectedInterval: this.selectedInterval,
      markets: this.markets.slice(0, 80),
      selectedL2Book: this.l2Books.get(this.selectedCoin) || { bids: [], asks: [] },
      l2LastError: this.l2LastError,
      l2UpdatedAtMs: this.l2UpdatedAtMs,
      selectedCandles: this.candlesByKey.get(`${this.selectedCoin}:${this.selectedInterval}`) || [],
      accountSummary: this.accountSummary,
      fills: this.fills,
      lastDecision: this.lastDecision,
      telemetry: this.telemetry,
      recentLogs: this.recentLogs.slice(0, 60),
      tugCloidsCount: counts.cloidsCount,
      tugOidsCount: counts.oidsCount,
      config: { ...this.config, aiEnabled: !this.enginePaused && this.config.aiEnabled },
      updatedAtMs: Date.now(),
    };
  }

  public setFeedSelection(coin?: string, interval?: '1m' | '5m' | '15m' | '1h' | '4h') {
    let changed = false;
    if (coin && coin.toUpperCase() !== this.selectedCoin) {
      this.selectedCoin = coin.toUpperCase();
      changed = true;
    }
    if (interval && interval !== this.selectedInterval) {
      this.selectedInterval = interval;
      changed = true;
    }
    if (changed) {
      this.wsClient?.updateFeedConfig({
        selectedCoin: this.selectedCoin,
        selectedInterval: this.selectedInterval,
        watchlistCoins: parseWatchlist(this.config.watchlistCoinsCsv),
      });
      void Promise.all([
        this.hydrateCandles(this.selectedCoin, this.selectedInterval),
        this.hydrateL2Book(this.selectedCoin),
      ]).then(() => {
        this.broadcast({ type: 'snapshot', payload: this.getSnapshot(), ts: Date.now() });
      });
    }
    return this.getSnapshot();
  }

  public updateConfig(patch: Partial<BotConfigData>, apiPrivateKey?: string) {
    if (typeof apiPrivateKey === 'string' && apiPrivateKey.trim()) {
      setBackendSignerKey(apiPrivateKey.trim());
    }
    const prevNet = this.config.network;
    const prevMaster = this.config.masterWalletAddress;

    this.config = {
      ...this.config,
      ...patch,
      mcloudUrl:
        String(patch.mcloudUrl ?? this.config.mcloudUrl ?? '')
          .trim()
          .replace(/\/api\/health\/?$/i, '')
          .replace(/\/+$/, '') || normalizeMcloudBaseUrl(),
      // SAFETY INVARIANT: Saving config ALWAYS puts engine back into PAUSED until user activates explicitly
      aiEnabled: false,
    };
    this.enginePaused = true;
    this.pauseReason = 'Configuración guardada: motor en PAUSA hasta activación explícita del operador.';
    saveConfigToDisk(this.config);

    const watchlist = parseWatchlist(this.config.watchlistCoinsCsv);
    this.wsClient?.updateFeedConfig({
      network: this.config.network,
      watchlistCoins: watchlist,
      userAddress: this.config.masterWalletAddress,
    });

    if (prevNet !== this.config.network || prevMaster !== this.config.masterWalletAddress) {
      void this.bootstrapRestData();
    }
    void this.checkMcloudConnection();
    this.rescheduleScanLoop();
    this.addLog('INFO', 'CONFIG_SAVED', 'SYSTEM', this.pauseReason);
    this.broadcast({ type: 'snapshot', payload: this.getSnapshot(), ts: Date.now() });
    return this.getSnapshot();
  }

  public controlEngine(action: 'START' | 'PAUSE' | 'ANALYZE_NOW', reason?: string) {
    if (action === 'PAUSE') {
      this.enginePaused = true;
      this.config.aiEnabled = false;
      this.pauseReason = reason || 'Motor pausado manualmente por el operador (solo lectura).';
      this.addLog('INFO', 'ENGINE_PAUSE', 'SYSTEM', this.pauseReason);
      this.broadcast({ type: 'snapshot', payload: this.getSnapshot(), ts: Date.now() });
      return { ok: true, snapshot: this.getSnapshot() };
    }

    if (action === 'START') {
      if (this.config.globalBiasLock === 'PAUSA') {
        this.enginePaused = true;
        this.pauseReason = 'Bloqueo Direccional Global está en PAUSA. Cámbialo a AMBOS/SOLO_LONG/SOLO_SHORT para operar.';
        return { ok: false, error: this.pauseReason, snapshot: this.getSnapshot() };
      }
      this.enginePaused = false;
      this.config.aiEnabled = true;
      this.pauseReason = '';
      this.addLog(
        'EXEC',
        'ENGINE_START',
        'SYSTEM',
        `Motor tug777-engine ACTIVADO (${this.config.network.toUpperCase()} · Signer ${
          isBackendSignerConfigured() ? getBackendSignerAddress()?.slice(0, 8) : 'SIN KEY'
        })`
      );
      void this.emitTelemetryEvent('engine_started', {
        network: this.config.network,
        biasLock: this.config.globalBiasLock,
      });
      this.broadcast({ type: 'snapshot', payload: this.getSnapshot(), ts: Date.now() });
      void this.runSingleEvaluationCycle(false);
      return { ok: true, snapshot: this.getSnapshot() };
    }

    if (action === 'ANALYZE_NOW') {
      void this.runSingleEvaluationCycle(true);
      return { ok: true, snapshot: this.getSnapshot() };
    }

    return { ok: false, error: 'Acción inválida', snapshot: this.getSnapshot() };
  }

  private rescheduleScanLoop() {
    if (this.scanTimer) clearInterval(this.scanTimer);
    const intervalMs = Math.max(15_000, Math.min(300_000, (this.config.scanIntervalSec || 45) * 1000));
    this.scanTimer = setInterval(() => {
      if (!this.enginePaused && this.config.aiEnabled) {
        void this.runSingleEvaluationCycle(false);
      }
    }, intervalMs);
  }

  private recordExecutionTelemetry(params: {
    coin: string;
    side: 'LONG' | 'SHORT';
    signMs: number;
    exchangeRttMs: number;
    e2eAckMs: number;
    detectToSendMs: number;
    detectToExecMs: number;
    fillStatus: OrderFillStatus;
    filledAvgPx: number;
    rejectReason: string;
    spreadBps?: number;
    oracleDiffBps?: number;
  }) {
    const isRejected = params.fillStatus === 'REJECTED';
    if (!isRejected) {
      this.confirmTimesHistory = [...this.confirmTimesHistory.slice(-49), params.e2eAckMs];
      if (params.detectToExecMs > 0) {
        this.detectExecTimesHistory = [...this.detectExecTimesHistory.slice(-49), params.detectToExecMs];
      }
    }
    const avg =
      this.confirmTimesHistory.length > 0
        ? Math.round(this.confirmTimesHistory.reduce((a, b) => a + b, 0) / this.confirmTimesHistory.length)
        : 0;
    const min = this.confirmTimesHistory.length > 0 ? Math.min(...this.confirmTimesHistory) : 0;
    const max = this.confirmTimesHistory.length > 0 ? Math.max(...this.confirmTimesHistory) : 0;
    const avgD2E =
      this.detectExecTimesHistory.length > 0
        ? Math.round(this.detectExecTimesHistory.reduce((a, b) => a + b, 0) / this.detectExecTimesHistory.length)
        : 0;
    const maxD2E = this.detectExecTimesHistory.length > 0 ? Math.max(...this.detectExecTimesHistory) : 0;

    this.telemetry = {
      ...this.telemetry,
      activeRoute: 'TUG777-ENGINE',
      lastCoin: params.coin,
      lastSide: params.side,
      lastStatus: isRejected ? 'REJECTED' : 'CONFIRMED',
      lastFillStatus: params.fillStatus,
      lastSignMs: params.signMs,
      lastExchangeRttMs: params.exchangeRttMs,
      lastE2eConfirmMs: params.e2eAckMs,
      lastFillVerifyMs: params.fillStatus === 'FILLED' ? params.e2eAckMs : 0,
      lastDetectToSendMs: params.detectToSendMs,
      lastDetectToExecMs: params.detectToExecMs,
      lastFilledAvgPx: params.filledAvgPx,
      lastRejectReason: params.rejectReason,
      avgConfirmMs: avg,
      minConfirmMs: min,
      maxConfirmMs: max,
      avgDetectToExecMs: avgD2E,
      maxDetectToExecMs: maxD2E,
      totalConfirmed: this.telemetry.totalConfirmed + (isRejected ? 0 : 1),
      totalFilledConfirmed: this.telemetry.totalFilledConfirmed + (params.fillStatus === 'FILLED' ? 1 : 0),
      totalAckOnly: this.telemetry.totalAckOnly + (params.fillStatus === 'ACK_ONLY' ? 1 : 0),
      totalRejected: this.telemetry.totalRejected + (isRejected ? 1 : 0),
      lastSpreadBps: params.spreadBps ?? this.telemetry.lastSpreadBps,
      lastOracleDiffBps: params.oracleDiffBps ?? this.telemetry.lastOracleDiffBps,
      updatedAtMs: Date.now(),
    };
  }

  private async emitTelemetryEvent(eventType: string, data: Record<string, unknown>) {
    if (!this.config.mcloudEnabled) return;
    await emitMcloudEvent(eventType, data, this.config.mcloudUrl);
  }

  public async executeManualOrder(params: {
    coin: string;
    side: 'LONG' | 'SHORT';
    notionalUsd: number;
    useAlo?: boolean;
  }) {
    const asset = this.markets.find((m) => m.coin === params.coin.toUpperCase());
    if (!asset) {
      throw new Error(`Token ${params.coin} no encontrado en mercados de Hyperliquid.`);
    }
    if (!isBackendSignerConfigured()) {
      throw new Error('Configura tu API Wallet Private Key antes de ejecutar órdenes en el engine.');
    }

    const detectedAtMs = Date.now();
    const res = await submitEntryWithNativeTpsl({
      network: this.config.network,
      coin: asset.coin,
      assetIndex: asset.index,
      szDecimals: asset.szDecimals,
      isBuy: params.side === 'LONG',
      referencePx: asset.markPx,
      desiredNotionalUsd: params.notionalUsd,
      minOrderUsdFloor: this.config.minOrderUsdFloor,
      slippageBps: clampIocSlippageBps(this.config.maxSlippageBps || 120),
      slPct: this.config.slPct || 0.85,
      tpPct: this.config.tpPct || 3.5,
      useAloEntries: typeof params.useAlo === 'boolean' ? params.useAlo : Boolean(this.config.useAloEntries),
      targetLeverage: this.config.leverage ?? 10,
      maxLeverage: asset.maxLeverage,
      strategyTag: 'MANUAL_ENGINE',
    });

    const finishedMs = Date.now();
    this.recordExecutionTelemetry({
      coin: asset.coin,
      side: params.side,
      signMs: res.signMs,
      exchangeRttMs: res.exchangeRttMs,
      e2eAckMs: res.exchangeRttMs,
      detectToSendMs: Math.max(1, finishedMs - detectedAtMs - res.exchangeRttMs),
      detectToExecMs: finishedMs - detectedAtMs,
      fillStatus: res.fillStatus,
      filledAvgPx: res.filledAvgPx,
      rejectReason: res.rejectReason,
    });

    this.addLog(
      res.ok ? 'EXEC' : 'ERROR',
      res.abortedPreSend ? 'PRE_SEND_GUARD' : 'MANUAL_ORDER',
      asset.coin,
      res.ok
        ? `Manual ${params.side} $${res.effectiveNotionalUsd} (${res.sizeStr} ${asset.coin}) · cloid ${res.entryCloid} · ${res.fillStatus} · normalTpsl ${res.scaledTpUsed ? '3-TP' : '1-TP+SL'}`
        : `Abortada/Rechazada ${params.side}: ${res.rejectReason}`,
      res.exchangeRttMs
    );

    void this.emitTelemetryEvent('manual_order', {
      coin: asset.coin,
      side: params.side,
      ok: res.ok,
      cloid: res.entryCloid,
      oid: res.oid,
      fillStatus: res.fillStatus,
      notionalUsd: res.effectiveNotionalUsd,
      rejectReason: res.rejectReason,
    });

    if (res.ok) {
      await this.refreshAccountState();
    }
    this.broadcast({ type: 'snapshot', payload: this.getSnapshot(), ts: Date.now() });
    return res;
  }

  public async closePosition(coin: string) {
    if (!this.accountSummary) {
      await this.refreshAccountState();
    }
    const pos = this.accountSummary?.positions.find((p) => p.coin.toUpperCase() === coin.toUpperCase());
    if (!pos) {
      throw new Error(`No hay posición abierta en ${coin}.`);
    }
    const asset = this.markets.find((m) => m.coin === pos.coin);
    if (!asset) {
      throw new Error(`Metadata de mercado no disponible para ${pos.coin}.`);
    }
    const res = await submitReduceOnlyClose({
      network: this.config.network,
      coin: asset.coin,
      assetIndex: asset.index,
      szDecimals: asset.szDecimals,
      isBuyToClose: pos.side === 'SHORT',
      referencePx: asset.markPx,
      sizeCoins: Math.abs(pos.szi),
      slippageBps: clampIocSlippageBps(this.config.maxSlippageBps || 120),
    });

    this.addLog(
      res.ok ? 'EXEC' : 'ERROR',
      'CLOSE_POSITION',
      asset.coin,
      res.ok
        ? `Cierre ${pos.side} ${asset.coin} (${Math.abs(pos.szi)}) · cloid ${res.cloid} · ${res.fillStatus}`
        : `Error cerrando ${asset.coin}: ${res.rejectReason}`,
      res.exchangeRttMs
    );

    void this.emitTelemetryEvent('position_closed', {
      coin: asset.coin,
      side: pos.side,
      ok: res.ok,
      cloid: res.cloid,
      oid: res.oid,
      fillStatus: res.fillStatus,
    });

    await this.refreshAccountState();
    this.broadcast({ type: 'snapshot', payload: this.getSnapshot(), ts: Date.now() });
    return res;
  }

  public async closeAllTugPositions(includeExternal = false) {
    await this.refreshAccountState();
    const positions = (this.accountSummary?.positions || []).filter(
      (p) => includeExternal || !p.isExternal
    );
    const results: Array<{ coin: string; ok: boolean; reason?: string }> = [];
    for (const pos of positions) {
      try {
        const res = await this.closePosition(pos.coin);
        results.push({ coin: pos.coin, ok: res.ok, reason: res.rejectReason });
      } catch (err) {
        results.push({ coin: pos.coin, ok: false, reason: String(err) });
      }
    }
    return results;
  }

  public async runSingleEvaluationCycle(forceAnalyzeOnly: boolean) {
    if (this.scanInFlight) return;
    if (!forceAnalyzeOnly && (this.enginePaused || !this.config.aiEnabled)) return;
    this.scanInFlight = true;
    const cycleStart = Date.now();

    try {
      const watchlist = parseWatchlist(this.config.watchlistCoinsCsv);
      const candidateCoins = Array.from(
        new Set([...watchlist, ...this.markets.slice(0, 6).map((m) => m.coin)])
      ).slice(0, 6);

      const playbook = DEFAULT_STRATEGY_PLAYBOOK.map((d) => ({
        ...d,
        ownerId: 'engine',
        wins: 0,
        losses: 0,
        totalPnlUsd: 0,
        updatedAtMs: Date.now(),
      }));

      const analyses: DeepAssetAnalysis[] = [];
      for (const coin of candidateCoins) {
        const market = this.markets.find((m) => m.coin === coin);
        if (!market || market.dayNtlVlm < (this.config.minVolumeM || 5) * 1_000_000) continue;
        if (!this.candlesByKey.has(`${coin}:15m`)) await this.hydrateCandles(coin, '15m');
        if (!this.candlesByKey.has(`${coin}:1h`)) await this.hydrateCandles(coin, '1h');
        if (!this.l2Books.has(coin)) await this.hydrateL2Book(coin);
        const c15 = this.candlesByKey.get(`${coin}:15m`) || [];
        const c1h = this.candlesByKey.get(`${coin}:1h`) || c15;
        const book = this.l2Books.get(coin) || { bids: [], asks: [] };
        if (book.bids.length === 0 || book.asks.length === 0) {
          this.addLog(
            'WARN',
            'L2_ENGINE',
            coin,
            this.l2LastError || `Libro L2 incompleto para ${coin} (bids=${book.bids.length}, asks=${book.asks.length}) durante análisis`
          );
        }
        if (c15.length < 20) continue;
        analyses.push(
          evaluateUnifiedDeepSetup({
            market,
            candles15m: c15,
            candles1h: c1h,
            bids: book.bids,
            asks: book.asks,
            playbook,
            memories: [],
          })
        );
      }

      // Ask Montana Cloud / Gemini for inference if enabled
      let mcloudCtxText = '';
      if (this.config.mcloudEnabled) {
        const ctxRes = await fetchMcloudContext(this.config.mcloudUrl);
        if (ctxRes.ok && ctxRes.data) {
          mcloudCtxText = JSON.stringify(ctxRes.data).slice(0, 600);
          this.mcloudConnected = true;
        }
      }

      let brainDecision: AiBrainDecision | null = null;
      if (this.config.mcloudEnabled) {
        const mcloudRes = await inferWithMcloud(
          {
            network: this.config.network,
            mode: this.config.mode,
            globalBiasLock: this.config.globalBiasLock,
            slPct: this.config.slPct,
            tpPct: this.config.tpPct,
            deepAnalyses: analyses.slice(0, 6),
          },
          this.config.mcloudUrl
        );
        if (mcloudRes.ok && mcloudRes.data && typeof mcloudRes.data.action === 'string') {
          brainDecision = {
            action: mcloudRes.data.action as AiBrainDecision['action'],
            coin: String(mcloudRes.data.coin || 'NONE'),
            confidence: Number(mcloudRes.data.confidence || 50),
            regime: String(mcloudRes.data.regime || 'MCLOUD'),
            reason: String(mcloudRes.data.reason || 'Inferencia Montana Cloud'),
            tpPct: Number(mcloudRes.data.tpPct || this.config.tpPct),
            slPct: Number(mcloudRes.data.slPct || this.config.slPct),
            modelUsed: String(mcloudRes.data.modelUsed || 'mcloud-infer'),
            strategiesUsed: Array.isArray(mcloudRes.data.strategiesUsed)
              ? (mcloudRes.data.strategiesUsed as string[])
              : [],
          };
        }
      }

      if (!brainDecision) {
        try {
          const gemRes = await analyzeMarketWithBrain({
            mode: this.config.mode,
            candidates: this.markets.slice(0, 8).map((m) => ({
              coin: m.coin,
              markPx: m.markPx,
              oraclePx: m.oraclePx,
              prevDayPx: m.prevDayPx,
              change24hPct: m.change24hPct,
              fundingRate: m.fundingRate,
              annualizedFundingPct: m.annualizedFundingPct,
              openInterestUsd: m.openInterestUsd,
              dayNtlVlm: m.dayNtlVlm,
              maxLeverage: m.maxLeverage,
              quantScore: m.quantScore,
              quantBias: m.quantBias,
              quantSignals: m.quantSignals,
            })),
            deepAnalyses: analyses,
            playbook,
            memories: [],
            openPositions: (this.accountSummary?.positions || [])
              .filter((p) => !p.isExternal)
              .map((p) => ({
                coin: p.coin,
                side: p.side,
                size: Math.abs(p.szi),
                entryPx: p.entryPx,
                unrealizedPnl: p.unrealizedPnl,
                returnOnEquity: p.returnOnEquity,
              })),
            macroBrief: mcloudCtxText || undefined,
            geminiModel: this.config.geminiModel,
            aiProvider: this.config.aiProvider,
            customAiUrl: this.config.customAiUrl,
            customAiModel: this.config.customAiModel,
            customSystemPrompt: this.config.customSystemPrompt,
            tpPct: this.config.tpPct,
            slPct: this.config.slPct,
          });
          brainDecision = gemRes as AiBrainDecision;
        } catch {
          const best = [...analyses]
            .filter((d) => d.direction !== 'NEUTRAL' && !d.antiChaseBlocked)
            .sort((a, b) => b.unifiedScore - a.unifiedScore)[0];
          const bestAction: 'LONG' | 'SHORT' | 'HOLD' =
            best && (best.direction === 'LONG' || best.direction === 'SHORT')
              ? best.direction
              : 'HOLD';
          brainDecision = best && bestAction !== 'HOLD'
            ? {
                action: bestAction,
                coin: best.coin,
                confidence: best.confidence,
                decisionBand: best.decisionBand,
                regime: best.regime,
                reason: best.reasons.slice(0, 2).join(' · ') || 'Motor cuantitativo local',
                tpPct: this.config.tpPct,
                slPct: this.config.slPct,
                modelUsed: 'tug777-local-quant',
                strategiesUsed: best.firedStrategies,
              }
            : {
                action: 'HOLD',
                coin: 'NONE',
                confidence: 42,
                regime: 'Monitoreo',
                reason: 'Sin confluencia >= 65 pts en tokens vigilados.',
                tpPct: this.config.tpPct,
                slPct: this.config.slPct,
                modelUsed: 'tug777-local-quant',
                strategiesUsed: [],
              };
        }
      }

      this.lastDecision = brainDecision;

      // Never execute real entries if paused, analyze-only, or lacking signer
      if (
        forceAnalyzeOnly ||
        this.enginePaused ||
        !this.config.aiEnabled ||
        !isBackendSignerConfigured() ||
        !brainDecision ||
        (brainDecision.action !== 'LONG' && brainDecision.action !== 'SHORT')
      ) {
        return;
      }

      const targetAsset = this.markets.find((m) => m.coin === brainDecision!.coin);
      const targetDeep = analyses.find((a) => a.coin === brainDecision!.coin);
      if (!targetAsset || !targetDeep) return;

      // Strictly exclude [EXTERNA] positions when managing/counting autonomous slots unless counting total margin
      const tugOpenPositions = (this.accountSummary?.positions || []).filter((p) => !p.isExternal);
      if (tugOpenPositions.length >= (this.config.maxOpenPositions || 2)) {
        this.addLog(
          'INFO',
          'SLOT_CAP',
          targetAsset.coin,
          `Máximo de posiciones TUG777 alcanzado (${tugOpenPositions.length}/${this.config.maxOpenPositions}).`
        );
        return;
      }

      const closedFromFills = this.fills
        .filter((f) => Math.abs(f.closedPnl) > 0.0001 && isKnownTugOrder(f.cloid, f.oid))
        .map((f) => ({
          coin: f.coin,
          side: f.side,
          netPnl: f.closedPnl - f.fee,
          px: f.px,
          time: f.time,
        }));

      const fillsSummary = {
        totalClosed: closedFromFills.length,
        winRatePct: 0,
        netPnlUsd: closedFromFills.reduce((s, f) => s + f.netPnl, 0),
        totalFeesUsd: this.fills.reduce((s, f) => s + f.fee, 0),
        losingCoins: [],
        winningCoins: [],
        recentClosed: closedFromFills.slice(0, 20),
      };
      const dbHistory = {
        totalDbClosed: 0,
        dbWinRatePct: 0,
        dbNetPnlUsd: 0,
        consecutiveRecentLosses: 0,
        coinStats: [],
        topStrategies: [],
      };

      const orderUsd = computeDynamicOrderNotionalUsd({
        config: this.config,
        accountSummary: this.accountSummary,
        asset: targetAsset,
        slPctOverride: this.config.slPct,
      });

      const gate = evaluateProfessionalEntryGate({
        coin: targetAsset.coin,
        side: brainDecision.action,
        decisionConfidence: brainDecision.confidence,
        tpPct: this.config.tpPct,
        slPct: this.config.slPct,
        deepAnalysis: targetDeep,
        config: this.config,
        playbook,
        dbHistory,
        fillsSummary,
        memories: [],
        openPositions: this.accountSummary?.positions || [],
        accountSummary: this.accountSummary,
        orderUsd,
        assetMaxLeverage: targetAsset.maxLeverage,
        recentEntryZones: this.recentEntryZones,
      });

      if (!gate.allowed) {
        this.addLog('MEV_GUARD', 'ENTRY_GATE', targetAsset.coin, gate.reason);
        void this.emitTelemetryEvent('signal_blocked', {
          coin: targetAsset.coin,
          side: brainDecision.action,
          reason: gate.reason,
        });
        return;
      }

      const opt = optimizeEntryDecision({
        coin: targetAsset.coin,
        side: brainDecision.action,
        deepAnalysis: targetDeep,
        config: this.config,
        accountSummary: this.accountSummary,
        asset: targetAsset,
        playbook,
        dbHistory,
        fillsSummary,
        openPositions: tugOpenPositions,
      });

      const execRes = await submitEntryWithNativeTpsl({
        network: this.config.network,
        coin: targetAsset.coin,
        assetIndex: targetAsset.index,
        szDecimals: targetAsset.szDecimals,
        isBuy: brainDecision.action === 'LONG',
        referencePx: targetAsset.markPx,
        desiredNotionalUsd: opt.optimizedNotionalUsd,
        minOrderUsdFloor: this.config.minOrderUsdFloor,
        slippageBps: clampIocSlippageBps(this.config.maxSlippageBps || 120),
        slPct: opt.slPct,
        tpPct: opt.tpPct,
        tp1Pct: opt.tp1Pct,
        tp2Pct: opt.tp2Pct,
        useAloEntries: Boolean(this.config.useAloEntries),
        targetLeverage: this.config.leverage ?? 10,
        maxLeverage: targetAsset.maxLeverage,
        strategyTag: (brainDecision.strategiesUsed || targetDeep.firedStrategies).join('+'),
        strategies: brainDecision.strategiesUsed || targetDeep.firedStrategies,
      });

      const now = Date.now();
      this.recordExecutionTelemetry({
        coin: targetAsset.coin,
        side: brainDecision.action,
        signMs: execRes.signMs,
        exchangeRttMs: execRes.exchangeRttMs,
        e2eAckMs: execRes.exchangeRttMs,
        detectToSendMs: Math.max(1, now - cycleStart - execRes.exchangeRttMs),
        detectToExecMs: now - cycleStart,
        fillStatus: execRes.fillStatus,
        filledAvgPx: execRes.filledAvgPx,
        rejectReason: execRes.rejectReason,
      });

      if (execRes.ok) {
        this.recentEntryZones = [
          { coin: targetAsset.coin, px: targetAsset.markPx, ts: now },
          ...this.recentEntryZones,
        ].slice(0, 20);
        this.addLog(
          'EXEC',
          'AUTO_ENTRY_TPSL',
          targetAsset.coin,
          `Auto ${brainDecision.action} $${execRes.effectiveNotionalUsd} · cloid ${execRes.entryCloid} · normalTpsl (${execRes.scaledTpUsed ? '3-TP' : '1-TP+SL'}) · ${execRes.fillStatus}`,
          execRes.exchangeRttMs
        );
        await this.refreshAccountState();
      } else {
        this.addLog(
          'WARN',
          execRes.abortedPreSend ? 'PRE_SEND_ABORT' : 'EXEC_REJECTED',
          targetAsset.coin,
          execRes.rejectReason,
          execRes.exchangeRttMs
        );
      }

      void this.emitTelemetryEvent('order_executed', {
        coin: targetAsset.coin,
        side: brainDecision.action,
        ok: execRes.ok,
        abortedPreSend: execRes.abortedPreSend,
        cloid: execRes.entryCloid,
        oid: execRes.oid,
        fillStatus: execRes.fillStatus,
        notionalUsd: execRes.effectiveNotionalUsd,
        scaledTpUsed: execRes.scaledTpUsed,
        rejectReason: execRes.rejectReason,
      });
    } finally {
      this.scanInFlight = false;
      this.broadcast({ type: 'snapshot', payload: this.getSnapshot(), ts: Date.now() });
    }
  }
}

export const engineRuntime = new Tug777EngineRuntime();
