import { encode } from '@msgpack/msgpack';
import { Signature, Wallet, concat, keccak256 } from 'ethers';
import type {
  BotConfigData,
  EngineStateSnapshot,
  EngineWsMessage,
  HlAccountSummary,
  HlAssetMarket,
  HlCandle,
  HlExecutionRoute,
  HlL2Level,
  HlNetwork,
  HlUserFill,
  MevFilterAudit,
  MevProbeStatus,
  OrderFillStatus,
} from '../types/trading';
import { computeQuantConfluence } from '../utils/quantConfluence';

export { computeQuantConfluence };

const HL_DIRECT_BASE: Record<HlNetwork, string> = {
  mainnet: 'https://api.hyperliquid.xyz',
  testnet: 'https://api.hyperliquid-testnet.xyz',
};

const BACKEND_URL_STORAGE_KEY = 'tug777_backend_server_url';
const TUG777_CLOID_PREFIX = '0x777';

export function isMcloudWebhookOrServiceUrl(url?: string | null): boolean {
  const cleaned = (url || '').trim();
  if (!cleaned) return false;
  return /mcloud-\d+/i.test(cleaned) || /\/api\/wh\//i.test(cleaned);
}

export function getConfiguredBackendUrl(): string {
  if (typeof window === 'undefined') return '';
  try {
    const val = (localStorage.getItem(BACKEND_URL_STORAGE_KEY) || '').trim().replace(/\/$/, '');
    if (isMcloudWebhookOrServiceUrl(val)) {
      localStorage.removeItem(BACKEND_URL_STORAGE_KEY);
      return '';
    }
    return val;
  } catch {
    return '';
  }
}

export function setConfiguredBackendUrl(url: string) {
  if (typeof window === 'undefined') return;
  try {
    const cleaned = url.trim().replace(/\/$/, '');
    if (cleaned && !isMcloudWebhookOrServiceUrl(cleaned)) {
      localStorage.setItem(BACKEND_URL_STORAGE_KEY, cleaned);
    } else {
      localStorage.removeItem(BACKEND_URL_STORAGE_KEY);
    }
  } catch {
    // ignore storage limits
  }
}

export function isRunningInEmbeddedApk(): boolean {
  return (
    typeof window !== 'undefined' &&
    ((window.location.hostname === 'localhost' && window.location.port === '47777') ||
      window.location.hostname === 'gen-lang-client-0561395731.web.app' ||
      window.location.hostname === 'gen-lang-client-0561395731.firebaseapp.com')
  );
}

export function hasConfiguredBackendForApk(): boolean {
  return !isRunningInEmbeddedApk() || Boolean(getConfiguredBackendUrl());
}

export function buildBackendApiUrl(apiPath: string): string {
  const normalizedPath = apiPath.startsWith('/') ? apiPath : `/${apiPath}`;
  const customBase = getConfiguredBackendUrl();
  if (customBase) {
    return `${customBase}${normalizedPath}`;
  }
  return normalizedPath;
}

export function buildEngineWsUrl(token?: string): string {
  if (typeof window === 'undefined') return '';
  const customBase = getConfiguredBackendUrl();
  const baseHttp = customBase || window.location.origin;
  const wsBase = baseHttp.replace(/^https:/i, 'wss:').replace(/^http:/i, 'ws:').replace(/\/$/, '');
  const qs = token ? `?token=${encodeURIComponent(token)}` : '';
  return `${wsBase}/ws${qs}`;
}

export function generateTugClientCloid(): string {
  const bytes = new Uint8Array(15);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 29);
  return `${TUG777_CLOID_PREFIX}${hex}`.toLowerCase();
}

export function connectEngineWebSocket(handlers: {
  onMessage: (msg: EngineWsMessage) => void;
  onStatusChange?: (connected: boolean) => void;
  token?: string;
}): { close: () => void; sendSelectFeed: (coin: string, interval: '1m' | '5m' | '15m' | '1h' | '4h') => void } {
  let ws: WebSocket | null = null;
  let closedByCaller = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let attempt = 0;

  const clearTimers = () => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (pingTimer) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
  };

  const connect = () => {
    if (closedByCaller || typeof window === 'undefined' || !hasConfiguredBackendForApk()) return;
    const url = buildEngineWsUrl(handlers.token);
    if (!url) return;
    try {
      ws = new WebSocket(url);
    } catch {
      handlers.onStatusChange?.(false);
      return;
    }

    ws.onopen = () => {
      attempt = 0;
      handlers.onStatusChange?.(true);
      pingTimer = setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        }
      }, 20_000);
    };

    ws.onmessage = (ev) => {
      try {
        const parsed = JSON.parse(String(ev.data)) as EngineWsMessage;
        handlers.onMessage(parsed);
      } catch {
        // ignore malformed frame
      }
    };

    ws.onclose = () => {
      clearTimers();
      handlers.onStatusChange?.(false);
      if (!closedByCaller) {
        const delay = Math.min(20_000, 1200 * Math.pow(2, Math.min(attempt, 4)));
        attempt += 1;
        reconnectTimer = setTimeout(connect, delay);
      }
    };

    ws.onerror = () => {
      handlers.onStatusChange?.(false);
    };
  };

  connect();

  return {
    close: () => {
      closedByCaller = true;
      clearTimers();
      if (ws) {
        try {
          ws.close();
        } catch {
          // ignore
        }
      }
    },
    sendSelectFeed: (coin: string, interval: '1m' | '5m' | '15m' | '1h' | '4h') => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'select_feed', coin, interval }));
      }
    },
  };
}

export function connectDirectHyperliquidWs(params: {
  network: HlNetwork;
  initialCoin: string;
  initialInterval: '1m' | '5m' | '15m' | '1h' | '4h';
  onStatusChange?: (connected: boolean) => void;
  onMids?: (mids: Record<string, number>, latencyMs: number) => void;
  onL2Book?: (coin: string, bids: HlL2Level[], asks: HlL2Level[]) => void;
  onCandle?: (coin: string, interval: string, candle: HlCandle) => void;
  onError?: (channel: string, message: string) => void;
}): { close: () => void; sendSelectFeed: (coin: string, interval: '1m' | '5m' | '15m' | '1h' | '4h') => void } {
  let ws: WebSocket | null = null;
  let closedByCaller = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let attempt = 0;
  let activeCoin = params.initialCoin || 'BTC';
  let activeInterval = params.initialInterval || '15m';
  let lastPingSentAt = 0;

  const wsUrl =
    params.network === 'testnet'
      ? 'wss://api.hyperliquid-testnet.xyz/ws'
      : 'wss://api.hyperliquid.xyz/ws';

  const sendSub = (method: 'subscribe' | 'unsubscribe', subscription: Record<string, unknown>) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ method, subscription }));
    }
  };

  const clearTimers = () => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (pingTimer) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
  };

  const connect = () => {
    if (closedByCaller || typeof window === 'undefined') return;
    try {
      ws = new WebSocket(wsUrl);
    } catch (err) {
      params.onStatusChange?.(false);
      params.onError?.('hlWs', err instanceof Error ? err.message : String(err));
      return;
    }

    ws.onopen = () => {
      attempt = 0;
      params.onStatusChange?.(true);
      sendSub('subscribe', { type: 'allMids' });
      sendSub('subscribe', { type: 'l2Book', coin: activeCoin });
      sendSub('subscribe', { type: 'candle', coin: activeCoin, interval: activeInterval });
      lastPingSentAt = performance.now();
      ws?.send(JSON.stringify({ method: 'ping' }));
      pingTimer = setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          lastPingSentAt = performance.now();
          ws.send(JSON.stringify({ method: 'ping' }));
        }
      }, 20_000);
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as { channel?: string; data?: unknown };
        if (msg.channel === 'pong') {
          const rtt = lastPingSentAt > 0 ? Math.max(1, Math.round(performance.now() - lastPingSentAt)) : 0;
          if (rtt > 0) params.onMids?.({}, rtt);
          return;
        }
        if (msg.channel === 'error') {
          const errText =
            typeof msg.data === 'string' ? msg.data : JSON.stringify(msg.data || 'Error WS Hyperliquid');
          params.onError?.('hlWs', errText);
          return;
        }
        if (msg.channel === 'allMids' && msg.data && typeof msg.data === 'object') {
          const rawMids = (msg.data as { mids?: Record<string, string> }).mids || {};
          const parsed: Record<string, number> = {};
          for (const [k, v] of Object.entries(rawMids)) {
            const n = Number(v);
            if (Number.isFinite(n) && n > 0) parsed[k] = n;
          }
          const rtt = lastPingSentAt > 0 ? Math.max(1, Math.round(performance.now() - lastPingSentAt)) : 0;
          params.onMids?.(parsed, rtt);
          return;
        }
        if (msg.channel === 'l2Book' && msg.data && typeof msg.data === 'object') {
          const d = msg.data as {
            coin?: string;
            levels?: [Array<{ px: string; sz: string; n: number }>, Array<{ px: string; sz: string; n: number }>];
          };
          const coin = d.coin || activeCoin;
          if (!Array.isArray(d.levels) || d.levels.length < 2) {
            params.onError?.('l2Book', `Respuesta WS l2Book inválida para ${coin}`);
            return;
          }
          const mapLevels = (arr: Array<{ px: string; sz: string; n: number }>) =>
            (arr || [])
              .map((lv) => ({ px: Number(lv.px), sz: Number(lv.sz), n: Number(lv.n || 1) }))
              .filter((lv) => Number.isFinite(lv.px) && lv.px > 0 && Number.isFinite(lv.sz) && lv.sz > 0);
          const bids = mapLevels(d.levels[0]);
          const asks = mapLevels(d.levels[1]);
          if (bids.length === 0 || asks.length === 0) {
            params.onError?.('l2Book', `Libro L2 WS vacío para ${coin} (${bids.length} bids / ${asks.length} asks)`);
            return;
          }
          params.onL2Book?.(coin, bids, asks);
          return;
        }
        if (msg.channel === 'candle' && msg.data && typeof msg.data === 'object') {
          const c = msg.data as {
            s?: string;
            i?: string;
            t?: number;
            T?: number;
            o?: string;
            h?: string;
            l?: string;
            c?: string;
            v?: string;
            n?: number;
          };
          const coin = c.s || activeCoin;
          const tf = c.i || activeInterval;
          if (c.t && c.c) {
            params.onCandle?.(coin, tf, {
              t: Number(c.t),
              T: Number(c.T || c.t),
              s: coin,
              i: tf,
              o: Number(c.o || 0),
              h: Number(c.h || 0),
              l: Number(c.l || 0),
              c: Number(c.c || 0),
              v: Number(c.v || 0),
              n: Number(c.n || 0),
            });
          }
        }
      } catch {
        // ignore malformed frame
      }
    };

    ws.onclose = () => {
      clearTimers();
      params.onStatusChange?.(false);
      if (!closedByCaller) {
        const delay = Math.min(20_000, 1200 * Math.pow(2, Math.min(attempt, 4)));
        attempt += 1;
        reconnectTimer = setTimeout(connect, delay);
      }
    };

    ws.onerror = () => {
      params.onStatusChange?.(false);
      params.onError?.('hlWs', `Error de conexión WebSocket directo (${wsUrl})`);
    };
  };

  connect();

  return {
    close: () => {
      closedByCaller = true;
      clearTimers();
      if (ws) {
        try {
          ws.close();
        } catch {
          // ignore
        }
      }
    },
    sendSelectFeed: (coin: string, interval: '1m' | '5m' | '15m' | '1h' | '4h') => {
      const nextCoin = coin || activeCoin;
      const nextInterval = interval || activeInterval;
      if (nextCoin === activeCoin && nextInterval === activeInterval) return;
      sendSub('unsubscribe', { type: 'l2Book', coin: activeCoin });
      sendSub('unsubscribe', { type: 'candle', coin: activeCoin, interval: activeInterval });
      activeCoin = nextCoin;
      activeInterval = nextInterval;
      sendSub('subscribe', { type: 'l2Book', coin: activeCoin });
      sendSub('subscribe', { type: 'candle', coin: activeCoin, interval: activeInterval });
    },
  };
}

async function parseJsonSafe<T = unknown>(res: Response): Promise<T> {
  const text = await res.text();
  const trimmed = text.trim();
  if (!trimmed || trimmed.startsWith('<')) {
    throw new Error(`Respuesta HTML/no-JSON del proxy (${res.status})`);
  }
  return JSON.parse(trimmed) as T;
}

export async function fetchEngineState(): Promise<EngineStateSnapshot | null> {
  if (!hasConfiguredBackendForApk()) return null;
  const res = await fetch(buildBackendApiUrl('/api/engine/state'), {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) return null;
  return parseJsonSafe<EngineStateSnapshot>(res);
}

export async function controlEngine(
  action: 'START' | 'PAUSE' | 'ANALYZE_NOW' | 'SELECT_FEED',
  extra?: { coin?: string; interval?: '1m' | '5m' | '15m' | '1h' | '4h'; reason?: string }
): Promise<{ ok: boolean; error?: string; snapshot?: EngineStateSnapshot }> {
  if (!hasConfiguredBackendForApk()) return { ok: false, error: 'Sin servidor backend configurado' };
  const res = await fetch(buildBackendApiUrl('/api/engine/control'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ action, ...(extra || {}) }),
  });
  return parseJsonSafe(res);
}

export async function pushEngineConfig(
  config: Partial<BotConfigData>,
  apiPrivateKey?: string
): Promise<{ ok: boolean; snapshot?: EngineStateSnapshot }> {
  if (!hasConfiguredBackendForApk()) return { ok: false };
  const res = await fetch(buildBackendApiUrl('/api/engine/config'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ config, apiPrivateKey }),
  });
  return parseJsonSafe(res);
}

export async function testMcloudConnection(mcloudUrl?: string): Promise<{
  ok: boolean;
  baseUrl: string;
  healthStatus: number;
  healthLatencyMs: number;
  contextStatus: number;
  contextLatencyMs: number;
  webhookStatus: number;
  webhookLatencyMs: number;
  hmacConfigured: boolean;
  detail: string;
}> {
  const cleanBase = (mcloudUrl || 'https://mcloud-1036926196544.us-east1.run.app').trim().replace(/\/+$/, '');
  if (!hasConfiguredBackendForApk()) {
    return {
      ok: false,
      baseUrl: cleanBase,
      healthStatus: 0,
      healthLatencyMs: 0,
      contextStatus: 0,
      contextLatencyMs: 0,
      webhookStatus: 0,
      webhookLatencyMs: 0,
      hmacConfigured: false,
      detail:
        'APK sin servidor relay tug777-engine configurado: mcloud bloquea peticiones directas del navegador (CORS). Configura la URL HTTPS de tu tug777-engine arriba para enlazar mcloud desde fuera de AI Studio; Hyperliquid L1 + WS Directo siguen activos al 100%.',
    };
  }
  const res = await fetch(buildBackendApiUrl('/api/mcloud/test'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ mcloudUrl }),
  });
  return parseJsonSafe(res);
}

export async function fetchMcloudContextFromServer(mcloudUrl?: string): Promise<{
  ok: boolean;
  status: number;
  latencyMs: number;
  baseUrl: string;
  data: unknown | null;
  error?: string;
}> {
  const cleanBase = (mcloudUrl || 'https://mcloud-1036926196544.us-east1.run.app').trim().replace(/\/+$/, '');
  if (!hasConfiguredBackendForApk()) {
    return {
      ok: false,
      status: 0,
      latencyMs: 0,
      baseUrl: cleanBase,
      data: null,
      error:
        'Se requiere URL de servidor tug777-engine para leer KV de mcloud sin exponer MCLOUD_API_KEY ni chocar con CORS en el APK.',
    };
  }
  const q = mcloudUrl ? `?url=${encodeURIComponent(mcloudUrl)}` : '';
  const res = await fetch(buildBackendApiUrl(`/api/mcloud/context${q}`), {
    headers: { Accept: 'application/json' },
  });
  return parseJsonSafe(res);
}

export async function syncMcloudStateFromServer(mcloudUrl?: string): Promise<{
  ok: boolean;
  baseUrl: string;
  webhookResult: { ok: boolean; status: number; latencyMs: number; error?: string };
  kvResult: { ok: boolean; status: number; latencyMs: number; error?: string };
  snapshot?: EngineStateSnapshot;
}> {
  const cleanBase = (mcloudUrl || 'https://mcloud-1036926196544.us-east1.run.app').trim().replace(/\/+$/, '');
  if (!hasConfiguredBackendForApk()) {
    const errMsg =
      'APK sin servidor tug777-engine configurado (mcloud bloquea CORS directo). Configura tu URL tug777-engine arriba para sincronizar vía servidor.';
    return {
      ok: false,
      baseUrl: cleanBase,
      webhookResult: { ok: false, status: 0, latencyMs: 0, error: errMsg },
      kvResult: { ok: false, status: 0, latencyMs: 0, error: errMsg },
    };
  }
  const res = await fetch(buildBackendApiUrl('/api/mcloud/sync-state'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ mcloudUrl }),
  });
  return parseJsonSafe(res);
}

const shouldUseBackendProxy = () => hasConfiguredBackendForApk();

let lastDirectRttMs = 0;
let lastProxyRttMs = 0;
let directExchangeHealthy = true;

export function getActiveExecutionRoute(): HlExecutionRoute {
  if (shouldUseBackendProxy()) {
    return 'TUG777-ENGINE';
  }
  return directExchangeHealthy ? 'HL-DIRECT-L1' : 'HL-EXCHANGE-L1';
}

function normalizeHlTransportError(err: unknown, contextLabel: string, timeoutMs?: number): Error {
  if (err instanceof Error && err.name === 'AbortError') {
    return new Error(`Timeout ${timeoutMs ?? 5000}ms (${contextLabel})`);
  }
  const raw = err instanceof Error ? err.message : String(err);
  if (/aborted/i.test(raw)) {
    return new Error(`Timeout ${timeoutMs ?? 5000}ms (${contextLabel})`);
  }
  return err instanceof Error ? err : new Error(raw);
}

async function fetchDirectHlInfo<T>(network: HlNetwork, payload: Record<string, unknown>, timeoutMs = 4000) {
  const t0 = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const directRes = await fetch(`${HL_DIRECT_BASE[network]}/info`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!directRes.ok) {
      const errText = await directRes.text();
      throw new Error(`HL Direct HTTP ${directRes.status}: ${errText.slice(0, 200)}`);
    }
    const data = await parseJsonSafe<T>(directRes);
    const latencyMs = Math.round(performance.now() - t0);
    lastDirectRttMs = latencyMs;
    return {
      data,
      latencyMs,
      channel: 'HL-DIRECT-L1',
    };
  } catch (err) {
    throw normalizeHlTransportError(err, 'HL Direct', timeoutMs);
  } finally {
    clearTimeout(timer);
  }
}

async function fetchProxyHlInfo<T>(network: HlNetwork, payload: Record<string, unknown>, timeoutMs = 5000) {
  const t0 = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(buildBackendApiUrl('/api/hl/info'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ network, payload }),
      signal: controller.signal,
    });
    const json = await parseJsonSafe<{ data: T; latencyMs: number; channel: string; error?: string }>(res);
    if (!res.ok) {
      throw new Error(json?.error || `HL Proxy HTTP ${res.status}`);
    }
    const totalMs = Math.round(performance.now() - t0);
    lastProxyRttMs = totalMs;
    return {
      ...json,
      latencyMs: Math.min(totalMs, json.latencyMs || totalMs),
    };
  } catch (err) {
    throw normalizeHlTransportError(err, 'HL Proxy', timeoutMs);
  } finally {
    clearTimeout(timer);
  }
}

function formatHlRaceError(err: unknown, retryErr?: unknown): Error {
  const parts: string[] = [];
  const collect = (e: unknown) => {
    if (!e) return;
    if (typeof AggregateError !== 'undefined' && e instanceof AggregateError) {
      for (const sub of e.errors) {
        const m = sub instanceof Error ? sub.message : String(sub);
        if (m && !parts.includes(m)) parts.push(m);
      }
      return;
    }
    const m = e instanceof Error ? e.message : String(e);
    if (m && !parts.includes(m)) parts.push(m);
  };
  collect(err);
  collect(retryErr);
  return new Error(parts.length > 0 ? parts.join(' | ') : 'Hyperliquid no respondió');
}

export async function hlInfoRequest<T = unknown>(
  network: HlNetwork,
  payload: Record<string, unknown>
): Promise<{ data: T; latencyMs: number; channel: string }> {
  if (shouldUseBackendProxy()) {
    try {
      return await Promise.any([
        fetchDirectHlInfo<T>(network, payload, 4000),
        fetchProxyHlInfo<T>(network, payload, 5000),
      ]);
    } catch (firstErr) {
      await new Promise((r) => setTimeout(r, 250));
      try {
        return await fetchProxyHlInfo<T>(network, payload, 5000);
      } catch (retryErr) {
        throw formatHlRaceError(firstErr, retryErr);
      }
    }
  }
  try {
    return await fetchDirectHlInfo<T>(network, payload, 4500);
  } catch (err) {
    await new Promise((r) => setTimeout(r, 250));
    try {
      return await fetchDirectHlInfo<T>(network, payload, 4500);
    } catch (retryErr) {
      throw formatHlRaceError(err, retryErr);
    }
  }
}

export async function fetchMevAndLatencyProbe(network: HlNetwork): Promise<MevProbeStatus> {
  if (shouldUseBackendProxy()) {
    try {
      const res = await fetch(buildBackendApiUrl(`/api/mev/probe?network=${network}`), {
        headers: { Accept: 'application/json' },
      });
      const json = await parseJsonSafe<MevProbeStatus & { error?: string }>(res);
      if (!res.ok) {
        throw new Error(json?.error || 'Error verificando canales RPC');
      }
      return json;
    } catch {
      // Fall through to direct HL probes
    }
  }
  {
    const hlBase = HL_DIRECT_BASE[network];
    const probeDirect = async (
      id: string,
      name: string,
      scope: 'HYPERLIQUID_INFO',
      url: string,
      body: unknown
    ) => {
      const t0 = performance.now();
      try {
        const r = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const rtt = Math.round(performance.now() - t0);
        if (!r.ok) return { id, name, scope, ok: false, latencyMs: rtt, detail: `HTTP ${r.status}` };
        await r.json();
        return {
          id,
          name,
          scope,
          ok: true,
          latencyMs: rtt,
          detail: 'OK',
        };
      } catch (e) {
        return { id, name, scope, ok: false, latencyMs: Math.round(performance.now() - t0), detail: String(e) };
      }
    };

    const [hlMeta, hlMids] = await Promise.all([
      probeDirect('hl_info_meta', 'HL Info (Meta)', 'HYPERLIQUID_INFO', `${hlBase}/info`, { type: 'meta' }),
      probeDirect('hl_info_mids', 'HL Info (Mids)', 'HYPERLIQUID_INFO', `${hlBase}/info`, { type: 'allMids' }),
    ]);

    return {
      channels: [hlMeta, hlMids],
      bestHlLatencyMs: Math.min(hlMeta.latencyMs, hlMids.latencyMs),
      wsConnected: false,
      checkedAt: Date.now(),
    };
  }
}

export async function fetchAllMids(network: HlNetwork): Promise<{
  mids: Record<string, number>;
  latencyMs: number;
  channel: string;
}> {
  const { data, latencyMs, channel } = await hlInfoRequest<Record<string, string>>(network, {
    type: 'allMids',
  });
  const mids: Record<string, number> = {};
  if (data && typeof data === 'object') {
    for (const [k, v] of Object.entries(data)) {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) mids[k] = n;
    }
  }
  return { mids, latencyMs, channel };
}

export async function fetchAllHyperliquidMarkets(network: HlNetwork): Promise<{
  markets: HlAssetMarket[];
  latencyMs: number;
  channel: string;
}> {
  type MetaCtxResponse = [
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

  const { data, latencyMs, channel } = await hlInfoRequest<MetaCtxResponse>(network, {
    type: 'metaAndAssetCtxs',
  });

  const [meta, ctxs] = data;
  const markets: HlAssetMarket[] = [];

  meta.universe.forEach((asset, index) => {
    if (asset.isDelisted) return;
    const ctx = ctxs[index];
    if (!ctx) return;

    const markPx = Number(ctx.markPx || 0);
    const midPx = Number(ctx.midPx || ctx.markPx || 0);
    const oraclePx = Number(ctx.oraclePx || markPx);
    const prevDayPx = Number(ctx.prevDayPx || markPx);
    const fundingRate = Number(ctx.funding || 0);
    const openInterest = Number(ctx.openInterest || 0);
    const dayNtlVlm = Number(ctx.dayNtlVlm || 0);
    const premium = Number(ctx.premium || 0);

    if (markPx <= 0) return;

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

    markets.push({
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

  markets.sort((a, b) => b.dayNtlVlm - a.dayNtlVlm);
  return { markets, latencyMs, channel };
}

export async function fetchCandles(
  network: HlNetwork,
  coin: string,
  interval: '1m' | '5m' | '15m' | '1h' | '4h' = '15m',
  limit = 96
): Promise<HlCandle[]> {
  const intervalMsMap = {
    '1m': 60_000,
    '5m': 300_000,
    '15m': 900_000,
    '1h': 3_600_000,
    '4h': 14_400_000,
  };
  const endTime = Date.now();
  const startTime = endTime - intervalMsMap[interval] * limit;

  const { data } = await hlInfoRequest<
    Array<{ t: number; T: number; s: string; i: string; o: string; c: string; h: string; l: string; v: string; n: number }>
  >(network, {
    type: 'candleSnapshot',
    req: { coin, interval, startTime, endTime },
  });

  return (data || [])
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
}

export async function fetchL2Book(
  network: HlNetwork,
  coin: string
): Promise<{ bids: HlL2Level[]; asks: HlL2Level[]; latencyMs: number; channel: string }> {
  type L2Response = {
    levels?: [
      Array<{ px: string; sz: string; n: number }>,
      Array<{ px: string; sz: string; n: number }>
    ];
  } | null;
  const { data, latencyMs, channel } = await hlInfoRequest<L2Response>(network, { type: 'l2Book', coin });
  if (!data || !Array.isArray(data.levels)) {
    throw new Error(`Libro L2 nulo o inválido para ${coin} en Hyperliquid (${network}).`);
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
    throw new Error(`Libro L2 vacío (0 bids / 0 asks) para ${coin} en Hyperliquid (${network}).`);
  }
  return { bids, asks, latencyMs, channel };
}

export async function resolveMasterFromAgentKey(
  network: HlNetwork,
  apiPrivateKey: string
): Promise<{ agentAddress: string; masterAddress: string | null; role: string }> {
  const wallet = new Wallet(apiPrivateKey.trim());
  const { data } = await hlInfoRequest<{ role: string; data?: { user?: string } }>(network, {
    type: 'userRole',
    user: wallet.address,
  });
  return {
    agentAddress: wallet.address,
    role: data?.role || 'unknown',
    masterAddress: data?.role === 'agent' && data?.data?.user ? data.data.user : null,
  };
}

export async function fetchClearinghouseState(
  network: HlNetwork,
  userAddress: string
): Promise<HlAccountSummary> {
  type ClearinghouseResp = {
    marginSummary: {
      accountValue: string;
      totalMarginUsed: string;
      totalNtlPos: string;
    };
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

  type OpenOrderResp = Array<{ coin: string; oid: number; cloid?: string }>;

  const [chRes, openRes] = await Promise.all([
    hlInfoRequest<ClearinghouseResp>(network, {
      type: 'clearinghouseState',
      user: userAddress,
    }),
    hlInfoRequest<OpenOrderResp>(network, {
      type: 'openOrders',
      user: userAddress,
    }).catch(() => ({ data: [] as OpenOrderResp })),
  ]);

  const data = chRes.data;
  const openCloidsByCoin = new Map<string, string[]>();
  for (const oo of openRes.data || []) {
    if (oo.cloid) {
      const arr = openCloidsByCoin.get(oo.coin) || [];
      arr.push(oo.cloid);
      openCloidsByCoin.set(oo.coin, arr);
    }
  }

  const positions = (data?.assetPositions || [])
    .map((ap) => ap.position)
    .filter((p) => Math.abs(Number(p.szi)) > 0)
    .map((p) => {
      const szi = Number(p.szi);
      const cloids = openCloidsByCoin.get(p.coin) || [];
      const tugCloid = cloids.find((c) => c.toLowerCase().startsWith(TUG777_CLOID_PREFIX));
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
        ...(tugCloid ? { cloid: tugCloid } : {}),
      };
    });

  return {
    accountValue: Number(data?.marginSummary?.accountValue || 0),
    totalMarginUsed: Number(data?.marginSummary?.totalMarginUsed || 0),
    totalNtlPos: Number(data?.marginSummary?.totalNtlPos || 0),
    withdrawable: Number(data?.withdrawable || 0),
    positions,
  };
}

export async function fetchUserFills(network: HlNetwork, userAddress: string): Promise<HlUserFill[]> {
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
  const { data } = await hlInfoRequest<RawFill[]>(network, {
    type: 'userFills',
    user: userAddress,
  });
  return (data || []).slice(0, 120).map((f) => ({
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
}

export function formatHlPrice(price: number, szDecimals: number): string {
  if (!Number.isFinite(price) || price <= 0) return '0';
  const maxDecimals = Math.max(0, 6 - szDecimals);
  const roundedSig = Number(price.toPrecision(5));
  const fixed = roundedSig.toFixed(Math.min(maxDecimals, 6));
  return fixed.replace(/\.?0+$/, '');
}

export function formatHlSize(size: number, szDecimals: number, isReduceOnly = false): string {
  if (!Number.isFinite(size) || size <= 0) return '0';
  const factor = Math.pow(10, szDecimals);
  const scaled = isReduceOnly ? Math.round(size * factor) : Math.floor((size + 1e-12) * factor);
  const rounded = scaled / factor;
  return rounded.toFixed(szDecimals).replace(/\.?0+$/, '') || '0';
}

export function evaluateMevShield(params: {
  enabled: boolean;
  side?: 'LONG' | 'SHORT';
  executionRoute?: HlExecutionRoute;
  markPx: number;
  oraclePx: number;
  bids: HlL2Level[];
  asks: HlL2Level[];
  notionalUsd: number;
  maxSlippageBps: number;
  maxOracleDeviationBps: number;
}): {
  passed: boolean;
  spreadBps: number;
  oracleDiffBps: number;
  topDepthUsd: number;
  directionalDepthUsd: number;
  estimatedImpactBps: number;
  executionRoute: HlExecutionRoute;
  reason: string;
} {
  const executionRoute = params.executionRoute ?? getActiveExecutionRoute();
  const hasBids = params.bids.length > 0 && params.bids[0].px > 0;
  const hasAsks = params.asks.length > 0 && params.asks[0].px > 0;
  const bestBid = hasBids ? params.bids[0].px : params.markPx;
  const bestAsk = hasAsks ? params.asks[0].px : params.markPx;
  const mid = (bestBid + bestAsk) / 2 || params.markPx;
  const spreadBps = mid > 0 ? ((bestAsk - bestBid) / mid) * 10000 : 0;
  const oracleDiffBps = params.oraclePx > 0 ? (Math.abs(params.markPx - params.oraclePx) / params.oraclePx) * 10000 : 0;

  const top3BidUsd = params.bids.slice(0, 3).reduce((acc, l) => acc + l.px * l.sz, 0);
  const top3AskUsd = params.asks.slice(0, 3).reduce((acc, l) => acc + l.px * l.sz, 0);
  const topDepthUsd = hasBids && hasAsks ? Math.min(top3BidUsd, top3AskUsd) : 0;
  const directionalLevels = params.side === 'LONG' ? params.asks : params.side === 'SHORT' ? params.bids : null;
  const directionalDepthUsd =
    params.side === 'LONG' ? top3AskUsd : params.side === 'SHORT' ? top3BidUsd : topDepthUsd;

  let estimatedImpactBps = spreadBps / 2;
  if (directionalLevels && directionalLevels.length > 0 && params.notionalUsd > 0 && mid > 0) {
    let remainingUsd = params.notionalUsd;
    let totalCostUsd = 0;
    let totalCoins = 0;
    for (const lvl of directionalLevels) {
      const lvlUsd = lvl.px * lvl.sz;
      if (lvlUsd <= 0) continue;
      const takeUsd = Math.min(remainingUsd, lvlUsd);
      totalCostUsd += takeUsd;
      totalCoins += takeUsd / lvl.px;
      remainingUsd -= takeUsd;
      if (remainingUsd <= 0.01) break;
    }
    if (totalCoins > 0) {
      const vwap = totalCostUsd / totalCoins;
      estimatedImpactBps = (Math.abs(vwap - mid) / mid) * 10000;
    }
  }

  if (!params.enabled) {
    return {
      passed: true,
      spreadBps,
      oracleDiffBps,
      topDepthUsd,
      directionalDepthUsd,
      estimatedImpactBps,
      executionRoute,
      reason: `Escudo MEV desactivado manualmente (ruta ${executionRoute})`,
    };
  }

  if (!hasBids || !hasAsks || bestAsk <= bestBid) {
    return {
      passed: false,
      spreadBps,
      oracleDiffBps,
      topDepthUsd,
      directionalDepthUsd,
      estimatedImpactBps,
      executionRoute,
      reason: `Libro L2 inválido o vacío en ruta ${executionRoute} (Bid ${bestBid} / Ask ${bestAsk}).`,
    };
  }

  if (spreadBps > params.maxSlippageBps) {
    return {
      passed: false,
      spreadBps,
      oracleDiffBps,
      topDepthUsd,
      directionalDepthUsd,
      estimatedImpactBps,
      executionRoute,
      reason: `[${executionRoute}] Spread ${spreadBps.toFixed(1)} bps excede límite anti-sandwich (${params.maxSlippageBps} bps).`,
    };
  }

  if (oracleDiffBps > params.maxOracleDeviationBps) {
    return {
      passed: false,
      spreadBps,
      oracleDiffBps,
      topDepthUsd,
      directionalDepthUsd,
      estimatedImpactBps,
      executionRoute,
      reason: `[${executionRoute}] Desviación Mark/Oracle ${oracleDiffBps.toFixed(1)} bps excede escudo (${params.maxOracleDeviationBps} bps).`,
    };
  }

  const minRequiredDepth = Math.max(params.notionalUsd * 0.75, 10);
  if (params.notionalUsd > 0 && directionalDepthUsd < minRequiredDepth) {
    return {
      passed: false,
      spreadBps,
      oracleDiffBps,
      topDepthUsd,
      directionalDepthUsd,
      estimatedImpactBps,
      executionRoute,
      reason: `[${executionRoute}] Liquidez L2 insuficiente ($${directionalDepthUsd.toFixed(0)} < $${minRequiredDepth.toFixed(0)} requeridos).`,
    };
  }

  if (estimatedImpactBps > params.maxSlippageBps) {
    return {
      passed: false,
      spreadBps,
      oracleDiffBps,
      topDepthUsd,
      directionalDepthUsd,
      estimatedImpactBps,
      executionRoute,
      reason: `[${executionRoute}] Impacto L2 estimado ${estimatedImpactBps.toFixed(1)} bps excede límite (${params.maxSlippageBps} bps).`,
    };
  }

  return {
    passed: true,
    spreadBps,
    oracleDiffBps,
    topDepthUsd,
    directionalDepthUsd,
    estimatedImpactBps,
    executionRoute,
    reason: `[${executionRoute}] Protegido · Spread ${spreadBps.toFixed(1)} bps · Impacto ${estimatedImpactBps.toFixed(1)} bps · Oracle Δ ${oracleDiffBps.toFixed(1)} bps · L2 $${directionalDepthUsd.toFixed(0)}`,
  };
}

export function auditMevShieldFilters(params: {
  enabled: boolean;
  executionRoute?: HlExecutionRoute;
  markPx: number;
  oraclePx: number;
  bids: HlL2Level[];
  asks: HlL2Level[];
  notionalUsd: number;
  maxSlippageBps: number;
  maxOracleDeviationBps: number;
}): MevFilterAudit {
  const longCheck = evaluateMevShield({ ...params, side: 'LONG' });
  const shortCheck = evaluateMevShield({ ...params, side: 'SHORT' });

  const bestBid = params.bids[0]?.px ?? 0;
  const bestAsk = params.asks[0]?.px ?? 0;
  const bookSanityOk = params.bids.length > 0 && params.asks.length > 0 && bestAsk > bestBid;
  const spreadGuardOk = params.enabled && longCheck.spreadBps <= params.maxSlippageBps;
  const oracleGuardOk = params.enabled && params.oraclePx > 0 && longCheck.oracleDiffBps <= params.maxOracleDeviationBps;
  const minDepth = Math.max(params.notionalUsd * 0.75, 10);
  const depthGuardOk =
    params.enabled && longCheck.directionalDepthUsd >= minDepth && shortCheck.directionalDepthUsd >= minDepth;

  const passedCount = [bookSanityOk, spreadGuardOk, oracleGuardOk, depthGuardOk].filter(Boolean).length;
  const summary = !params.enabled
    ? 'Escudo MEV APAGADO: exposición sin filtro anti-sandwich.'
    : `Auditoría ${passedCount}/4 filtros OK · Spread ${longCheck.spreadBps.toFixed(1)}bps/${params.maxSlippageBps} · OracleΔ ${longCheck.oracleDiffBps.toFixed(1)}bps/${params.maxOracleDeviationBps} · L2 $${Math.min(longCheck.directionalDepthUsd, shortCheck.directionalDepthUsd).toFixed(0)}`;

  return {
    spreadGuardOk,
    oracleGuardOk,
    depthGuardOk,
    bookSanityOk,
    lastAuditAtMs: Date.now(),
    summary,
  };
}

let lastHlOrderNonce = 0;

function nextMonotonicHlNonce(): number {
  let persisted = 0;
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      persisted = Number(window.sessionStorage.getItem('tug777_last_hl_nonce') || '0');
    }
  } catch {
    persisted = 0;
  }
  const base = Math.max(Date.now(), lastHlOrderNonce + 1, Number.isFinite(persisted) ? persisted + 1 : 0);
  lastHlOrderNonce = base;
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      window.sessionStorage.setItem('tug777_last_hl_nonce', String(base));
    }
  } catch {
    // ignore storage limits
  }
  return base;
}

const clientLeverageSyncCache = new Map<string, number>();

async function signHlExchangeAction(network: HlNetwork, wallet: Wallet, action: Record<string, unknown>) {
  const nonce = nextMonotonicHlNonce();
  const msgPackBytes = encode(action);
  const nonceBytes = new Uint8Array(8);
  const view = new DataView(nonceBytes.buffer);
  view.setBigUint64(0, BigInt(nonce), false);
  const vaultFlag = new Uint8Array([0x00]);
  const connectionId = keccak256(concat([msgPackBytes, nonceBytes, vaultFlag]));

  const domain = {
    name: 'Exchange',
    version: '1',
    chainId: 1337,
    verifyingContract: '0x0000000000000000000000000000000000000000',
  };
  const types = {
    Agent: [
      { name: 'source', type: 'string' },
      { name: 'connectionId', type: 'bytes32' },
    ],
  };
  const message = {
    source: network === 'mainnet' ? 'a' : 'b',
    connectionId,
  };

  const signStartedAt = performance.now();
  const rawSig = await wallet.signTypedData(domain, types, message);
  const sig = Signature.from(rawSig);
  const signMs = Math.max(1, Math.round(performance.now() - signStartedAt));

  return {
    signMs,
    signedPayload: {
      action,
      nonce,
      signature: {
        r: sig.r,
        s: sig.s,
        v: sig.v,
      },
    },
  };
}

export async function syncClientHyperliquidLeverage(params: {
  network: HlNetwork;
  apiPrivateKey: string;
  assetIndex: number;
  leverage: number;
  maxLeverage?: number;
  isCross?: boolean;
}): Promise<{ ok: boolean; appliedLeverage: number; error?: string }> {
  const wallet = new Wallet(params.apiPrivateKey.trim());
  const maxAllowed = Math.max(1, Math.min(100, Math.round(params.maxLeverage || 50)));
  const clamped = Math.max(1, Math.min(maxAllowed, Math.round(params.leverage || 10)));
  const cacheKey = `${params.network}:${wallet.address}:${params.assetIndex}`;
  if (clientLeverageSyncCache.get(cacheKey) === clamped) {
    return { ok: true, appliedLeverage: clamped };
  }
  const { signedPayload } = await signHlExchangeAction(params.network, wallet, {
    type: 'updateLeverage',
    asset: params.assetIndex,
    isCross: params.isCross !== false,
    leverage: clamped,
  });
  try {
    const res = await fetch(`${HL_DIRECT_BASE[params.network]}/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(signedPayload),
    });
    if (res.ok) {
      const json = (await res.json()) as { status?: string; response?: string };
      if (json?.status === 'err') {
        return { ok: false, appliedLeverage: clamped, error: String(json.response || 'Error updateLeverage') };
      }
      clientLeverageSyncCache.set(cacheKey, clamped);
      return { ok: true, appliedLeverage: clamped };
    }
  } catch {
    // Fall through to backend relay if available
  }
  if (shouldUseBackendProxy()) {
    try {
      const proxyRes = await fetch(buildBackendApiUrl('/api/hl/exchange'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ network: params.network, signedPayload }),
      });
      if (proxyRes.ok) {
        clientLeverageSyncCache.set(cacheKey, clamped);
        return { ok: true, appliedLeverage: clamped };
      }
    } catch {
      // ignore fallback failure
    }
  }
  return { ok: false, appliedLeverage: clamped, error: 'No se pudo actualizar apalancamiento en Hyperliquid' };
}

export async function executeRealHyperliquidOrder(params: {
  network: HlNetwork;
  apiPrivateKey: string;
  assetIndex: number;
  szDecimals: number;
  isBuy: boolean;
  referencePx: number;
  sizeCoins: number;
  slippageBps: number;
  reduceOnly?: boolean;
  useAlo?: boolean;
  targetLeverage?: number;
  maxLeverage?: number;
  nativeTpsl?: { slPct: number; tpPct: number };
}) {
  const wallet = new Wallet(params.apiPrivateKey.trim());
  if (!params.reduceOnly && params.targetLeverage && params.targetLeverage >= 1) {
    await syncClientHyperliquidLeverage({
      network: params.network,
      apiPrivateKey: params.apiPrivateKey,
      assetIndex: params.assetIndex,
      leverage: params.targetLeverage,
      maxLeverage: params.maxLeverage,
      isCross: true,
    });
  }
  // Clamp IOC slippage strictly to 100-150 bps (1.0% - 1.5%)
  const clampedSlipBps = Math.max(100, Math.min(150, Math.round(params.slippageBps || 120)));
  const useAlo = Boolean(params.useAlo) && !params.reduceOnly;
  const slipFactor = useAlo
    ? params.isBuy
      ? 0.9994
      : 1.0006
    : params.isBuy
    ? 1 + clampedSlipBps / 10000
    : Math.max(0.05, 1 - clampedSlipBps / 10000);

  const limitPxStr = formatHlPrice(params.referencePx * slipFactor, params.szDecimals);
  const sizeStr = formatHlSize(params.sizeCoins, params.szDecimals, Boolean(params.reduceOnly));
  const sizeNum = Number(sizeStr);
  const notionalUsd = sizeNum * params.referencePx;

  if (sizeNum <= 0) {
    throw new Error('Tamaño de orden demasiado pequeño tras redondeo de decimales Hyperliquid.');
  }
  if (!params.reduceOnly && notionalUsd < 10.0) {
    throw new Error(
      `Validación pre-envío abortada antes de /exchange: nocional $${notionalUsd.toFixed(2)} < mínimo $10.0 USD Hyperliquid.`
    );
  }

  const entryCloid = generateTugClientCloid();
  const orders: Array<Record<string, unknown>> = [
    {
      a: params.assetIndex,
      b: params.isBuy,
      p: limitPxStr,
      s: sizeStr,
      r: Boolean(params.reduceOnly),
      t: { limit: { tif: useAlo ? 'Alo' : 'Ioc' } },
      c: entryCloid,
    },
  ];

  let grouping: 'na' | 'normalTpsl' = 'na';
  if (!params.reduceOnly && params.nativeTpsl && params.nativeTpsl.slPct > 0 && params.nativeTpsl.tpPct > 0) {
    grouping = 'normalTpsl';
    const slFrac = Math.max(0.001, params.nativeTpsl.slPct / 100);
    const tpFrac = Math.max(0.002, params.nativeTpsl.tpPct / 100);
    const slTrig = params.isBuy ? params.referencePx * (1 - slFrac) : params.referencePx * (1 + slFrac);
    const slLim = params.isBuy ? slTrig * 0.985 : slTrig * 1.015;
    const tpTrig = params.isBuy ? params.referencePx * (1 + tpFrac) : params.referencePx * (1 - tpFrac);
    const tpLim = params.isBuy ? tpTrig * 0.99 : tpTrig * 1.01;

    orders.push({
      a: params.assetIndex,
      b: !params.isBuy,
      p: formatHlPrice(slLim, params.szDecimals),
      s: sizeStr,
      r: true,
      t: { trigger: { isMarket: true, triggerPx: formatHlPrice(slTrig, params.szDecimals), tpsl: 'sl' } },
      c: generateTugClientCloid(),
    });
    orders.push({
      a: params.assetIndex,
      b: !params.isBuy,
      p: formatHlPrice(tpLim, params.szDecimals),
      s: sizeStr,
      r: true,
      t: { trigger: { isMarket: true, triggerPx: formatHlPrice(tpTrig, params.szDecimals), tpsl: 'tp' } },
      c: generateTugClientCloid(),
    });
  }

  const action = {
    type: 'order',
    orders,
    grouping,
  };

  const nonce = nextMonotonicHlNonce();
  const msgPackBytes = encode(action);
  const nonceBytes = new Uint8Array(8);
  const view = new DataView(nonceBytes.buffer);
  view.setBigUint64(0, BigInt(nonce), false);
  const vaultFlag = new Uint8Array([0x00]);
  const connectionId = keccak256(concat([msgPackBytes, nonceBytes, vaultFlag]));

  const domain = {
    name: 'Exchange',
    version: '1',
    chainId: 1337,
    verifyingContract: '0x0000000000000000000000000000000000000000',
  };
  const types = {
    Agent: [
      { name: 'source', type: 'string' },
      { name: 'connectionId', type: 'bytes32' },
    ],
  };
  const message = {
    source: params.network === 'mainnet' ? 'a' : 'b',
    connectionId,
  };

  const signStartedAt = performance.now();
  const rawSig = await wallet.signTypedData(domain, types, message);
  const sig = Signature.from(rawSig);
  const signMs = Math.max(1, Math.round(performance.now() - signStartedAt));

  const signedPayload = {
    action,
    nonce,
    signature: {
      r: sig.r,
      s: sig.s,
      v: sig.v,
    },
  };

  const parseExchangeFillStatus = (
    exchangeResponse: unknown
  ): {
    fillStatus: OrderFillStatus;
    filledSz: number;
    filledAvgPx: number;
    oid: number | null;
    rejectReason: string;
  } => {
    const resp = exchangeResponse as {
      status?: string;
      response?: string | { data?: { statuses?: Array<{ error?: string; filled?: { totalSz?: string; avgPx?: string; oid?: number }; resting?: { oid?: number } }> } };
    } | null;
    if (!resp || resp.status === 'err') {
      return {
        fillStatus: 'REJECTED',
        filledSz: 0,
        filledAvgPx: 0,
        oid: null,
        rejectReason: String(resp?.response || 'Rechazo Hyperliquid'),
      };
    }
    const statuses =
      typeof resp.response === 'object' && resp.response !== null ? resp.response.data?.statuses : undefined;
    const first = Array.isArray(statuses) ? statuses[0] : undefined;
    if (first?.error) {
      return {
        fillStatus: 'REJECTED',
        filledSz: 0,
        filledAvgPx: 0,
        oid: null,
        rejectReason: first.error,
      };
    }
    if (first?.filled) {
      return {
        fillStatus: 'FILLED',
        filledSz: Number(first.filled.totalSz || 0),
        filledAvgPx: Number(first.filled.avgPx || 0),
        oid: typeof first.filled.oid === 'number' ? first.filled.oid : null,
        rejectReason: '',
      };
    }
    if (first?.resting) {
      return {
        fillStatus: 'RESTING',
        filledSz: 0,
        filledAvgPx: 0,
        oid: typeof first.resting.oid === 'number' ? first.resting.oid : null,
        rejectReason: '',
      };
    }
    const rawStr = JSON.stringify(exchangeResponse || {});
    if (rawStr.toLowerCase().includes('"error"')) {
      return {
        fillStatus: 'REJECTED',
        filledSz: 0,
        filledAvgPx: 0,
        oid: null,
        rejectReason: rawStr.slice(0, 180),
      };
    }
    return {
      fillStatus: 'ACK_ONLY',
      filledSz: 0,
      filledAvgPx: 0,
      oid: null,
      rejectReason: '',
    };
  };

  const sendViaDirectL1 = async () => {
    const t0 = performance.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5500);
    try {
      const directRes = await fetch(`${HL_DIRECT_BASE[params.network]}/exchange`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(signedPayload),
        signal: controller.signal,
      });
      const data = await parseJsonSafe(directRes);
      const directMs = Math.round(performance.now() - t0);
      if (!directRes.ok) {
        throw new Error(`Error enviando orden firmada directamente a Hyperliquid (${directRes.status})`);
      }
      directExchangeHealthy = true;
      const parsedFill = parseExchangeFillStatus(data);
      const fillVerifyMs = parsedFill.fillStatus === 'FILLED' ? directMs : 0;
      return {
        exchangeResponse: data,
        latencyMs: directMs,
        e2eAckMs: directMs,
        exchangeRttMs: directMs,
        signMs,
        fillVerifyMs,
        fillStatus: parsedFill.fillStatus,
        filledSz: parsedFill.filledSz,
        filledAvgPx: parsedFill.filledAvgPx,
        oid: parsedFill.oid,
        cloid: entryCloid,
        rejectReason: parsedFill.rejectReason,
        channel: 'HL-DIRECT-L1' as HlExecutionRoute,
        agentAddress: wallet.address,
        limitPxStr,
        sizeStr,
      };
    } finally {
      clearTimeout(timer);
    }
  };

  const sendViaProxyRelay = async () => {
    const e2eStartedAt = performance.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6500);
    try {
      const res = await fetch(buildBackendApiUrl('/api/hl/exchange'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          network: params.network,
          signedPayload,
        }),
        signal: controller.signal,
      });

      const json = await parseJsonSafe<{ data: unknown; latencyMs: number; channel: string; error?: string }>(res);
      const e2eAckMs = Math.round(performance.now() - e2eStartedAt);
      if (!res.ok) {
        throw new Error(json?.error || 'Error enviando orden firmada a Hyperliquid');
      }

      const parsedFill = parseExchangeFillStatus(json.data);
      const fillVerifyMs = parsedFill.fillStatus === 'FILLED' ? e2eAckMs : 0;

      return {
        exchangeResponse: json.data,
        latencyMs: e2eAckMs,
        e2eAckMs,
        exchangeRttMs: json.latencyMs,
        signMs,
        fillVerifyMs,
        fillStatus: parsedFill.fillStatus,
        filledSz: parsedFill.filledSz,
        filledAvgPx: parsedFill.filledAvgPx,
        oid: parsedFill.oid,
        cloid: entryCloid,
        rejectReason: parsedFill.rejectReason,
        channel: 'HL-EXCHANGE-L1' as HlExecutionRoute,
        agentAddress: wallet.address,
        limitPxStr,
        sizeStr,
      };
    } finally {
      clearTimeout(timer);
    }
  };

  const preferDirect =
    !shouldUseBackendProxy() ||
    directExchangeHealthy ||
    (lastDirectRttMs > 0 && (lastProxyRttMs === 0 || lastDirectRttMs <= lastProxyRttMs));

  if (preferDirect) {
    try {
      return await sendViaDirectL1();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isNetworkOrCors =
        msg.includes('Failed to fetch') ||
        msg.includes('NetworkError') ||
        msg.includes('AbortError') ||
        msg.includes('aborted');
      if (isNetworkOrCors && shouldUseBackendProxy()) {
        directExchangeHealthy = false;
        return await sendViaProxyRelay();
      }
      throw err;
    }
  }

  return await sendViaProxyRelay();
}
