import WebSocket from 'ws';
import type { HlCandle, HlL2Level, HlNetwork } from '../src/types/trading.ts';

export interface HyperliquidWsCallbacks {
  onMids: (mids: Record<string, number>, ts: number) => void;
  onL2Book: (coin: string, bids: HlL2Level[], asks: HlL2Level[], ts: number) => void;
  onCandle: (coin: string, interval: string, candle: HlCandle, ts: number) => void;
  onUserEvents: (events: unknown, ts: number) => void;
  onStatusChange: (status: { connected: boolean; wsUrl: string; wsLatencyMs: number; reason?: string }) => void;
  onError?: (channel: string, detail: string, ts: number) => void;
}

export class HyperliquidWsClient {
  private network: HlNetwork;
  private selectedCoin: string;
  private selectedInterval: '1m' | '5m' | '15m' | '1h' | '4h';
  private watchlistCoins: string[];
  private userAddress: string;
  private callbacks: HyperliquidWsCallbacks;

  private ws: WebSocket | null = null;
  private stopped = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lastPingSentAt = 0;
  private wsLatencyMs = 0;
  private connected = false;
  private activeSubs = new Set<string>();

  constructor(
    initial: {
      network: HlNetwork;
      selectedCoin: string;
      selectedInterval: '1m' | '5m' | '15m' | '1h' | '4h';
      watchlistCoins: string[];
      userAddress: string;
    },
    callbacks: HyperliquidWsCallbacks
  ) {
    this.network = initial.network;
    this.selectedCoin = initial.selectedCoin;
    this.selectedInterval = initial.selectedInterval;
    this.watchlistCoins = initial.watchlistCoins;
    this.userAddress = initial.userAddress;
    this.callbacks = callbacks;
  }

  public getWsUrl(): string {
    return this.network === 'testnet'
      ? 'wss://api.hyperliquid-testnet.xyz/ws'
      : 'wss://api.hyperliquid.xyz/ws';
  }

  public isConnected(): boolean {
    return this.connected;
  }

  public getLatencyMs(): number {
    return this.wsLatencyMs;
  }

  public start() {
    this.stopped = false;
    this.connect();
  }

  public stop() {
    this.stopped = true;
    this.clearTimers();
    this.activeSubs.clear();
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore close error
      }
      this.ws = null;
    }
    this.connected = false;
  }

  public updateFeedConfig(next: {
    network?: HlNetwork;
    selectedCoin?: string;
    selectedInterval?: '1m' | '5m' | '15m' | '1h' | '4h';
    watchlistCoins?: string[];
    userAddress?: string;
  }) {
    const networkChanged = Boolean(next.network && next.network !== this.network);
    if (next.network) this.network = next.network;
    if (next.selectedCoin) this.selectedCoin = next.selectedCoin;
    if (next.selectedInterval) this.selectedInterval = next.selectedInterval;
    if (next.watchlistCoins) this.watchlistCoins = next.watchlistCoins;
    if (typeof next.userAddress === 'string') this.userAddress = next.userAddress.trim();

    if (networkChanged) {
      this.reconnectAttempt = 0;
      if (this.ws) {
        try {
          this.ws.close();
        } catch {
          // ignore
        }
      }
      return;
    }
    if (this.connected) {
      this.syncSubscriptions();
    }
  }

  private clearTimers() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private connect() {
    if (this.stopped) return;
    this.clearTimers();
    this.activeSubs.clear();

    const wsUrl = this.getWsUrl();
    const socket = new WebSocket(wsUrl);
    this.ws = socket;

    socket.on('open', () => {
      if (this.stopped || this.ws !== socket) return;
      this.connected = true;
      this.reconnectAttempt = 0;
      this.callbacks.onStatusChange({
        connected: true,
        wsUrl,
        wsLatencyMs: this.wsLatencyMs,
      });
      this.syncSubscriptions();

      this.lastPingSentAt = Date.now();
      this.sendJson({ method: 'ping' });
      this.heartbeatTimer = setInterval(() => {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        this.lastPingSentAt = Date.now();
        this.sendJson({ method: 'ping' });
      }, 20000);
    });

    socket.on('message', (raw) => {
      if (this.stopped || this.ws !== socket) return;
      const now = Date.now();
      let msg: { channel?: string; data?: unknown };
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (msg.channel === 'pong') {
        if (this.lastPingSentAt > 0) {
          this.wsLatencyMs = Math.max(1, now - this.lastPingSentAt);
          this.callbacks.onStatusChange({
            connected: true,
            wsUrl,
            wsLatencyMs: this.wsLatencyMs,
          });
        }
        return;
      }

      if (msg.channel === 'allMids') {
        const payload = msg.data as { mids?: Record<string, string> } | undefined;
        const rawMids = payload?.mids || (msg.data as Record<string, string>);
        if (rawMids && typeof rawMids === 'object') {
          const parsed: Record<string, number> = {};
          for (const [coin, pxStr] of Object.entries(rawMids)) {
            const val = Number(pxStr);
            if (Number.isFinite(val) && val > 0) parsed[coin] = val;
          }
          if (Object.keys(parsed).length > 0) {
            this.callbacks.onMids(parsed, now);
          }
        }
        return;
      }

      if (msg.channel === 'error') {
        const detail = typeof msg.data === 'string' ? msg.data : JSON.stringify(msg.data ?? 'WS error');
        this.callbacks.onError?.('ws', detail, now);
        return;
      }

      if (msg.channel === 'l2Book') {
        const d = msg.data as {
          coin?: string;
          levels?: [
            Array<{ px: string; sz: string; n: number }>,
            Array<{ px: string; sz: string; n: number }>
          ];
        };
        if (d?.coin && Array.isArray(d.levels)) {
          const bids = (d.levels[0] || [])
            .slice(0, 12)
            .map((l) => ({
              px: Number(l.px),
              sz: Number(l.sz),
              n: l.n,
            }))
            .filter((l) => Number.isFinite(l.px) && l.px > 0 && Number.isFinite(l.sz) && l.sz > 0);
          const asks = (d.levels[1] || [])
            .slice(0, 12)
            .map((l) => ({
              px: Number(l.px),
              sz: Number(l.sz),
              n: l.n,
            }))
            .filter((l) => Number.isFinite(l.px) && l.px > 0 && Number.isFinite(l.sz) && l.sz > 0);
          if (bids.length === 0 && asks.length === 0) {
            this.callbacks.onError?.('l2Book', `Libro L2 WS vacío (0 bids / 0 asks) para ${d.coin}.`, now);
          } else {
            this.callbacks.onL2Book(d.coin, bids, asks, now);
          }
        } else {
          this.callbacks.onError?.(
            'l2Book',
            `Frame l2Book inválido desde Hyperliquid WS${d?.coin ? ` (${d.coin})` : ''}.`,
            now
          );
        }
        return;
      }

      if (msg.channel === 'candle') {
        const rawCandles = Array.isArray(msg.data) ? msg.data : [msg.data];
        for (const item of rawCandles) {
          const k = item as {
            t?: number;
            T?: number;
            s?: string;
            i?: string;
            o?: string | number;
            c?: string | number;
            h?: string | number;
            l?: string | number;
            v?: string | number;
            n?: number;
          };
          if (!k || !k.s || !k.t) continue;
          this.callbacks.onCandle(
            k.s,
            String(k.i || this.selectedInterval),
            {
              t: Number(k.t),
              T: Number(k.T || k.t),
              s: k.s,
              i: String(k.i || this.selectedInterval),
              o: Number(k.o || 0),
              c: Number(k.c || 0),
              h: Number(k.h || 0),
              l: Number(k.l || 0),
              v: Number(k.v || 0),
              n: Number(k.n || 0),
            },
            now
          );
        }
        return;
      }

      if (msg.channel === 'userEvents' || msg.channel === 'userFills') {
        this.callbacks.onUserEvents(msg.data, now);
      }
    });

    socket.on('close', (code) => {
      if (this.ws === socket) {
        this.ws = null;
      }
      this.connected = false;
      this.clearTimers();
      this.activeSubs.clear();
      this.callbacks.onStatusChange({
        connected: false,
        wsUrl,
        wsLatencyMs: this.wsLatencyMs,
        reason: `WS closed (${code})`,
      });
      if (!this.stopped) {
        this.scheduleReconnect();
      }
    });

    socket.on('error', (err) => {
      this.callbacks.onStatusChange({
        connected: false,
        wsUrl,
        wsLatencyMs: this.wsLatencyMs,
        reason: err.message,
      });
    });
  }

  private scheduleReconnect() {
    if (this.stopped || this.reconnectTimer) return;
    const delayMs = Math.min(30_000, 1000 * Math.pow(2, Math.min(this.reconnectAttempt, 5)));
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delayMs);
  }

  private sendJson(payload: unknown) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(JSON.stringify(payload));
    } catch {
      // ignore send errors on closing socket
    }
  }

  private buildDesiredSubs(): Array<{ key: string; subscription: Record<string, unknown> }> {
    const desired: Array<{ key: string; subscription: Record<string, unknown> }> = [
      { key: 'allMids', subscription: { type: 'allMids' } },
    ];

    const l2Coins = Array.from(
      new Set([this.selectedCoin, ...this.watchlistCoins.slice(0, 6)].filter(Boolean))
    ).slice(0, 6);
    for (const coin of l2Coins) {
      desired.push({
        key: `l2Book:${coin}`,
        subscription: { type: 'l2Book', coin },
      });
    }

    if (this.selectedCoin) {
      desired.push({
        key: `candle:${this.selectedCoin}:${this.selectedInterval}`,
        subscription: { type: 'candle', coin: this.selectedCoin, interval: this.selectedInterval },
      });
    }

    if (this.userAddress && this.userAddress.startsWith('0x') && this.userAddress.length >= 40) {
      desired.push({
        key: `userEvents:${this.userAddress.toLowerCase()}`,
        subscription: { type: 'userEvents', user: this.userAddress },
      });
    }

    return desired;
  }

  private syncSubscriptions() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const desired = this.buildDesiredSubs();
    const desiredKeys = new Set(desired.map((d) => d.key));

    for (const existingKey of Array.from(this.activeSubs)) {
      if (!desiredKeys.has(existingKey)) {
        const [type, p1, p2] = existingKey.split(':');
        if (type === 'l2Book' && p1) {
          this.sendJson({ method: 'unsubscribe', subscription: { type: 'l2Book', coin: p1 } });
        } else if (type === 'candle' && p1 && p2) {
          this.sendJson({ method: 'unsubscribe', subscription: { type: 'candle', coin: p1, interval: p2 } });
        } else if (type === 'userEvents' && p1) {
          this.sendJson({ method: 'unsubscribe', subscription: { type: 'userEvents', user: p1 } });
        }
        this.activeSubs.delete(existingKey);
      }
    }

    for (const item of desired) {
      if (!this.activeSubs.has(item.key)) {
        this.sendJson({ method: 'subscribe', subscription: item.subscription });
        this.activeSubs.add(item.key);
      }
    }
  }
}
