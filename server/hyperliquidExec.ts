import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { encode } from '@msgpack/msgpack';
import { Signature, Wallet, concat, keccak256 } from 'ethers';
import type { HlNetwork, OrderFillStatus } from '../src/types/trading.ts';

export const TUG777_CLOID_PREFIX = '0x777';

const HL_REST_BASE: Record<HlNetwork, string> = {
  mainnet: 'https://api.hyperliquid.xyz',
  testnet: 'https://api.hyperliquid-testnet.xyz',
};

// Per-symbol async mutex preventing duplicate entries or concurrent close races
const inFlightLocks = new Map<string, Promise<unknown>>();

export async function withSymbolLock<T>(coin: string, fn: () => Promise<T>): Promise<T> {
  const key = coin.trim().toUpperCase();
  const prev = inFlightLocks.get(key) || Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  inFlightLocks.set(key, prev.then(() => current, () => current));

  await prev.catch(() => undefined);
  try {
    return await fn();
  } finally {
    release();
    if (inFlightLocks.get(key) === current) {
      inFlightLocks.delete(key);
    }
  }
}

export function generateTugCloid(): string {
  // Valid 128-bit Hyperliquid hex cloid (0x + 32 hex chars) prefixed strictly with 0x777
  const tail = crypto.randomBytes(15).toString('hex').slice(0, 29);
  return `${TUG777_CLOID_PREFIX}${tail}`.toLowerCase();
}

export function isTugCloid(cloid?: string | null): boolean {
  if (!cloid) return false;
  return cloid.trim().toLowerCase().startsWith(TUG777_CLOID_PREFIX);
}

interface RegistryPositionMeta {
  coin: string;
  side: 'LONG' | 'SHORT';
  cloid: string;
  strategyTag: string;
  strategies: string[];
  openedAtMs: number;
}

interface TugRegistryStore {
  cloids: string[];
  oids: number[];
  positionsByCoin: Record<string, RegistryPositionMeta>;
}

const REGISTRY_PATH = path.resolve(process.cwd(), 'data', 'tug777-registry.json');

let memoryRegistry: TugRegistryStore = {
  cloids: [],
  oids: [],
  positionsByCoin: {},
};

function loadRegistryFromDisk(): TugRegistryStore {
  try {
    if (fs.existsSync(REGISTRY_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8')) as Partial<TugRegistryStore>;
      memoryRegistry = {
        cloids: Array.isArray(parsed.cloids) ? parsed.cloids.slice(-1000) : [],
        oids: Array.isArray(parsed.oids) ? parsed.oids.slice(-2000) : [],
        positionsByCoin:
          parsed.positionsByCoin && typeof parsed.positionsByCoin === 'object'
            ? parsed.positionsByCoin
            : {},
      };
    }
  } catch {
    // fallback safely to in-memory registry
  }
  return memoryRegistry;
}

loadRegistryFromDisk();

function persistRegistryToDisk() {
  try {
    fs.mkdirSync(path.dirname(REGISTRY_PATH), { recursive: true });
    fs.writeFileSync(REGISTRY_PATH, JSON.stringify(memoryRegistry, null, 2), 'utf8');
  } catch {
    // ignore read-only container filesystem errors safely
  }
}

export function registerTugOrder(params: {
  coin: string;
  side?: 'LONG' | 'SHORT';
  cloid?: string | null;
  oid?: number | null;
  strategyTag?: string;
  strategies?: string[];
  isEntry?: boolean;
}) {
  const coin = params.coin.toUpperCase();
  if (params.cloid) {
    const lc = params.cloid.toLowerCase();
    if (!memoryRegistry.cloids.includes(lc)) {
      memoryRegistry.cloids = [...memoryRegistry.cloids.slice(-999), lc];
    }
  }
  if (typeof params.oid === 'number' && Number.isFinite(params.oid) && params.oid > 0) {
    if (!memoryRegistry.oids.includes(params.oid)) {
      memoryRegistry.oids = [...memoryRegistry.oids.slice(-1999), params.oid];
    }
  }
  if (params.isEntry && params.side) {
    memoryRegistry.positionsByCoin[coin] = {
      coin,
      side: params.side,
      cloid: params.cloid || generateTugCloid(),
      strategyTag: params.strategyTag || 'TUG777-ENGINE',
      strategies: params.strategies || [],
      openedAtMs: Date.now(),
    };
  }
  persistRegistryToDisk();
}

export function clearTugPositionMeta(coin: string) {
  const key = coin.toUpperCase();
  if (memoryRegistry.positionsByCoin[key]) {
    delete memoryRegistry.positionsByCoin[key];
    persistRegistryToDisk();
  }
}

export function isKnownTugOrder(cloid?: string | null, oid?: number | null): boolean {
  if (isTugCloid(cloid)) return true;
  if (cloid && memoryRegistry.cloids.includes(cloid.toLowerCase())) return true;
  if (typeof oid === 'number' && memoryRegistry.oids.includes(oid)) return true;
  return false;
}

export function hasRegisteredTugPosition(coin: string): boolean {
  return Boolean(memoryRegistry.positionsByCoin[coin.toUpperCase()]);
}

export function getRegisteredTugPositionMeta(coin: string): RegistryPositionMeta | undefined {
  return memoryRegistry.positionsByCoin[coin.toUpperCase()];
}

export function getRegistryCounts(): { cloidsCount: number; oidsCount: number } {
  return {
    cloidsCount: memoryRegistry.cloids.length,
    oidsCount: memoryRegistry.oids.length,
  };
}

// ---------- Hyperliquid Formatting & Pre-Send Min-Notional Guard ----------

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

export interface PreparedOrderSize {
  ok: boolean;
  sizeStr: string;
  sizeNum: number;
  effectiveNotionalUsd: number;
  flooredApplied: boolean;
  reason?: string;
}

export function validateAndPrepareOrderSize(params: {
  desiredNotionalUsd: number;
  minOrderUsdFloor: number;
  referencePx: number;
  szDecimals: number;
  isReduceOnly?: boolean;
}): PreparedOrderSize {
  const { desiredNotionalUsd, minOrderUsdFloor, referencePx, szDecimals, isReduceOnly = false } = params;
  if (!Number.isFinite(referencePx) || referencePx <= 0) {
    return {
      ok: false,
      sizeStr: '0',
      sizeNum: 0,
      effectiveNotionalUsd: 0,
      flooredApplied: false,
      reason: 'Precio de referencia inválido (<= 0).',
    };
  }

  let targetUsd = desiredNotionalUsd;
  let flooredApplied = false;

  if (!isReduceOnly && targetUsd < 10.0) {
    if (minOrderUsdFloor >= 10.0) {
      targetUsd = minOrderUsdFloor;
      flooredApplied = true;
    } else {
      return {
        ok: false,
        sizeStr: '0',
        sizeNum: 0,
        effectiveNotionalUsd: targetUsd,
        flooredApplied: false,
        reason: `Capital insuficiente: nocional $${targetUsd.toFixed(2)} < mínimo $10.0 USD de Hyperliquid (piso desactivado).`,
      };
    }
  }

  const rawCoins = targetUsd / referencePx;
  let sizeStr = formatHlSize(rawCoins, szDecimals, isReduceOnly);
  let sizeNum = Number(sizeStr);

  // If rounding floored just under $10.0 on entry, bump by 1 minimal lot step when floor is enabled
  if (!isReduceOnly && sizeNum * referencePx < 10.0) {
    if (minOrderUsdFloor >= 10.0) {
      const lotStep = 1 / Math.pow(10, szDecimals);
      const minCoins = Math.ceil((Math.max(10.2, minOrderUsdFloor) / referencePx) / lotStep) * lotStep;
      sizeStr = formatHlSize(minCoins, szDecimals, false);
      sizeNum = Number(sizeStr);
      flooredApplied = true;
    }
  }

  if (sizeNum <= 0) {
    return {
      ok: false,
      sizeStr: '0',
      sizeNum: 0,
      effectiveNotionalUsd: 0,
      flooredApplied,
      reason: `Tamaño redondeado = 0 para szDecimals=${szDecimals} (abortado antes de /exchange).`,
    };
  }

  const finalNotional = sizeNum * referencePx;
  if (!isReduceOnly && finalNotional < 10.0) {
    return {
      ok: false,
      sizeStr,
      sizeNum,
      effectiveNotionalUsd: finalNotional,
      flooredApplied,
      reason: `Validación pre-envío abortada: size * px = $${finalNotional.toFixed(2)} < $10.0 USD mínimo Hyperliquid.`,
    };
  }

  return {
    ok: true,
    sizeStr,
    sizeNum,
    effectiveNotionalUsd: Number(finalNotional.toFixed(2)),
    flooredApplied,
  };
}

// ---------- In-Memory Backend Agent Key & Monotonic Nonce ----------

let sessionSignerKey = (process.env.HL_API_PRIVATE_KEY || '').trim();
let lastHlOrderNonce = 0;
const syncedLeverageCache = new Map<string, number>();

export function setBackendSignerKey(privateKey: string) {
  const cleaned = privateKey.trim();
  if (!cleaned) {
    sessionSignerKey = (process.env.HL_API_PRIVATE_KEY || '').trim();
    return;
  }
  const normalized = cleaned.startsWith('0x') ? cleaned : `0x${cleaned}`;
  // Validate format immediately
  new Wallet(normalized);
  sessionSignerKey = normalized;
}

export function isBackendSignerConfigured(): boolean {
  if (!sessionSignerKey) return false;
  try {
    new Wallet(sessionSignerKey);
    return true;
  } catch {
    return false;
  }
}

export function getBackendSignerAddress(): string | null {
  if (!sessionSignerKey) return null;
  try {
    return new Wallet(sessionSignerKey).address;
  } catch {
    return null;
  }
}

function nextMonotonicHlNonce(): number {
  const next = Math.max(Date.now(), lastHlOrderNonce + 1);
  lastHlOrderNonce = next;
  return next;
}

export function clampIocSlippageBps(requestedBps: number): number {
  const raw = Number.isFinite(requestedBps) ? requestedBps : 120;
  return Math.max(100, Math.min(150, Math.round(raw)));
}

interface HlOrderWire {
  a: number;
  b: boolean;
  p: string;
  s: string;
  r: boolean;
  t:
    | { limit: { tif: 'Ioc' | 'Alo' | 'Gtc' } }
    | { trigger: { isMarket: boolean; triggerPx: string; tpsl: 'tp' | 'sl' } };
  c?: string;
}

async function signAndPostHyperliquidAction(
  network: HlNetwork,
  action: Record<string, unknown>
): Promise<{
  exchangeResponse: unknown;
  signMs: number;
  exchangeRttMs: number;
  fillStatus: OrderFillStatus;
  filledSz: number;
  filledAvgPx: number;
  oid: number | null;
  allOids: number[];
  rejectReason: string;
}> {
  if (!sessionSignerKey) {
    throw new Error('API Wallet Private Key no configurada en tug777-engine.');
  }
  const wallet = new Wallet(sessionSignerKey);
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

  const signStarted = performance.now();
  const rawSig = await wallet.signTypedData(domain, types, message);
  const sig = Signature.from(rawSig);
  const signMs = Math.max(1, Math.round(performance.now() - signStarted));

  const signedPayload = {
    action,
    nonce,
    signature: { r: sig.r, s: sig.s, v: sig.v },
  };

  const baseUrl = HL_REST_BASE[network] || HL_REST_BASE.mainnet;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6500);
  const t0 = performance.now();
  try {
    const res = await fetch(`${baseUrl}/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(signedPayload),
      signal: controller.signal,
    });
    const text = await res.text();
    const exchangeRttMs = Math.max(1, Math.round(performance.now() - t0));
    if (!res.ok) {
      throw new Error(`HL /exchange HTTP ${res.status}: ${text.slice(0, 220)}`);
    }
    const resp = JSON.parse(text) as {
      status?: string;
      response?:
        | string
        | {
            data?: {
              statuses?: Array<{
                error?: string;
                filled?: { totalSz?: string; avgPx?: string; oid?: number };
                resting?: { oid?: number };
              }>;
            };
          };
    };

    if (resp?.status === 'err') {
      return {
        exchangeResponse: resp,
        signMs,
        exchangeRttMs,
        fillStatus: 'REJECTED',
        filledSz: 0,
        filledAvgPx: 0,
        oid: null,
        allOids: [],
        rejectReason: String(resp.response || 'Rechazo Hyperliquid'),
      };
    }

    const statuses =
      typeof resp?.response === 'object' && resp.response !== null
        ? resp.response.data?.statuses || []
        : [];
    const allOids = statuses
      .map((s) => s.filled?.oid ?? s.resting?.oid ?? null)
      .filter((id): id is number => typeof id === 'number');

    const first = statuses[0];
    if (first?.error) {
      return {
        exchangeResponse: resp,
        signMs,
        exchangeRttMs,
        fillStatus: 'REJECTED',
        filledSz: 0,
        filledAvgPx: 0,
        oid: null,
        allOids,
        rejectReason: first.error,
      };
    }
    if (first?.filled) {
      return {
        exchangeResponse: resp,
        signMs,
        exchangeRttMs,
        fillStatus: 'FILLED',
        filledSz: Number(first.filled.totalSz || 0),
        filledAvgPx: Number(first.filled.avgPx || 0),
        oid: typeof first.filled.oid === 'number' ? first.filled.oid : null,
        allOids,
        rejectReason: '',
      };
    }
    if (first?.resting) {
      return {
        exchangeResponse: resp,
        signMs,
        exchangeRttMs,
        fillStatus: 'RESTING',
        filledSz: 0,
        filledAvgPx: 0,
        oid: typeof first.resting.oid === 'number' ? first.resting.oid : null,
        allOids,
        rejectReason: '',
      };
    }
    return {
      exchangeResponse: resp,
      signMs,
      exchangeRttMs,
      fillStatus: 'ACK_ONLY',
      filledSz: 0,
      filledAvgPx: 0,
      oid: allOids[0] ?? null,
      allOids,
      rejectReason: '',
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function syncHyperliquidLeverage(params: {
  network: HlNetwork;
  assetIndex: number;
  leverage: number;
  maxLeverage?: number;
  isCross?: boolean;
}): Promise<{ ok: boolean; appliedLeverage: number; error?: string }> {
  if (!sessionSignerKey) {
    return { ok: false, appliedLeverage: params.leverage, error: 'Signer no configurado' };
  }
  const maxAllowed = Math.max(1, Math.min(100, Math.round(params.maxLeverage || 50)));
  const clamped = Math.max(1, Math.min(maxAllowed, Math.round(params.leverage || 10)));
  const cacheKey = `${params.network}:${getBackendSignerAddress() || 'default'}:${params.assetIndex}`;
  if (syncedLeverageCache.get(cacheKey) === clamped) {
    return { ok: true, appliedLeverage: clamped };
  }
  try {
    const res = await signAndPostHyperliquidAction(params.network, {
      type: 'updateLeverage',
      asset: params.assetIndex,
      isCross: params.isCross !== false,
      leverage: clamped,
    });
    if (res.fillStatus === 'REJECTED' && res.rejectReason) {
      return { ok: false, appliedLeverage: clamped, error: res.rejectReason };
    }
    syncedLeverageCache.set(cacheKey, clamped);
    return { ok: true, appliedLeverage: clamped };
  } catch (err) {
    return {
      ok: false,
      appliedLeverage: clamped,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function submitEntryWithNativeTpsl(params: {
  network: HlNetwork;
  coin: string;
  assetIndex: number;
  szDecimals: number;
  isBuy: boolean;
  referencePx: number;
  desiredNotionalUsd: number;
  minOrderUsdFloor: number;
  slippageBps: number;
  slPct: number;
  tpPct: number;
  tp1Pct?: number;
  tp2Pct?: number;
  useAloEntries: boolean;
  targetLeverage?: number;
  maxLeverage?: number;
  strategyTag?: string;
  strategies?: string[];
}) {
  return withSymbolLock(params.coin, async () => {
    if (params.targetLeverage && params.targetLeverage >= 1) {
      await syncHyperliquidLeverage({
        network: params.network,
        assetIndex: params.assetIndex,
        leverage: params.targetLeverage,
        maxLeverage: params.maxLeverage,
        isCross: true,
      });
    }
    const prep = validateAndPrepareOrderSize({
      desiredNotionalUsd: params.desiredNotionalUsd,
      minOrderUsdFloor: params.minOrderUsdFloor,
      referencePx: params.referencePx,
      szDecimals: params.szDecimals,
      isReduceOnly: false,
    });

    if (!prep.ok) {
      return {
        ok: false,
        abortedPreSend: true,
        abortReason: prep.reason || 'Pre-send validation aborted',
        entryCloid: '',
        cloids: [] as string[],
        allOids: [] as number[],
        fillStatus: 'REJECTED' as OrderFillStatus,
        filledSz: 0,
        filledAvgPx: 0,
        oid: null as number | null,
        signMs: 0,
        exchangeRttMs: 0,
        effectiveNotionalUsd: prep.effectiveNotionalUsd,
        sizeStr: prep.sizeStr,
        limitPxStr: '0',
        scaledTpUsed: false,
        nativeTpslAttached: false,
        rejectReason: prep.reason || 'Pre-send validation aborted',
      };
    }

    const iocSlipBps = clampIocSlippageBps(params.slippageBps);
    const entrySlipFactor = params.useAloEntries
      ? params.isBuy
        ? 0.9994
        : 1.0006
      : params.isBuy
      ? 1 + iocSlipBps / 10000
      : Math.max(0.05, 1 - iocSlipBps / 10000);

    const limitPxStr = formatHlPrice(params.referencePx * entrySlipFactor, params.szDecimals);
    const entryCloid = generateTugCloid();
    const slCloid = generateTugCloid();

    const orders: HlOrderWire[] = [
      {
        a: params.assetIndex,
        b: params.isBuy,
        p: limitPxStr,
        s: prep.sizeStr,
        r: false,
        t: { limit: { tif: params.useAloEntries ? 'Alo' : 'Ioc' } },
        c: entryCloid,
      },
    ];

    const slFrac = Math.max(0.001, (params.slPct || 0.85) / 100);
    const slTriggerRaw = params.isBuy
      ? params.referencePx * (1 - slFrac)
      : params.referencePx * (1 + slFrac);
    // Protective market-trigger limit price with 1.5% worst-case execution cushion
    const slLimitRaw = params.isBuy ? slTriggerRaw * 0.985 : slTriggerRaw * 1.015;
    const slTrigPxStr = formatHlPrice(slTriggerRaw, params.szDecimals);
    const slLimitPxStr = formatHlPrice(slLimitRaw, params.szDecimals);

    orders.push({
      a: params.assetIndex,
      b: !params.isBuy,
      p: slLimitPxStr,
      s: prep.sizeStr,
      r: true,
      t: { trigger: { isMarket: true, triggerPx: slTrigPxStr, tpsl: 'sl' } },
      c: slCloid,
    });

    const cloids = [entryCloid, slCloid];
    const tpFrac = Math.max(0.002, (params.tpPct || 3.5) / 100);
    // Disable 3-tier TP automatically when notional < $35 USD or sub-chunks < $10.50
    const allow3Tier = prep.effectiveNotionalUsd >= 35 && prep.effectiveNotionalUsd * 0.3 >= 10.5;
    let scaledTpUsed = false;

    if (allow3Tier) {
      const s1 = formatHlSize(prep.sizeNum * 0.3, params.szDecimals, true);
      const s2 = formatHlSize(prep.sizeNum * 0.3, params.szDecimals, true);
      const rem = prep.sizeNum - Number(s1) - Number(s2);
      const s3 = formatHlSize(rem, params.szDecimals, true);
      if (Number(s1) > 0 && Number(s2) > 0 && Number(s3) > 0) {
        scaledTpUsed = true;
        const tp1Frac = Math.max(0.002, ((params.tp1Pct ?? params.slPct * 1.15) || 1.0) / 100);
        const tp2Frac = Math.max(0.004, ((params.tp2Pct ?? params.tpPct * 0.58) || 2.0) / 100);
        const tiers = [
          { sz: s1, frac: tp1Frac },
          { sz: s2, frac: tp2Frac },
          { sz: s3, frac: tpFrac },
        ];
        for (const tier of tiers) {
          const trigRaw = params.isBuy
            ? params.referencePx * (1 + tier.frac)
            : params.referencePx * (1 - tier.frac);
          const limRaw = params.isBuy ? trigRaw * 0.99 : trigRaw * 1.01;
          const tpCloid = generateTugCloid();
          cloids.push(tpCloid);
          orders.push({
            a: params.assetIndex,
            b: !params.isBuy,
            p: formatHlPrice(limRaw, params.szDecimals),
            s: tier.sz,
            r: true,
            t: { trigger: { isMarket: true, triggerPx: formatHlPrice(trigRaw, params.szDecimals), tpsl: 'tp' } },
            c: tpCloid,
          });
        }
      }
    }

    if (!scaledTpUsed) {
      const tpTriggerRaw = params.isBuy
        ? params.referencePx * (1 + tpFrac)
        : params.referencePx * (1 - tpFrac);
      const tpLimitRaw = params.isBuy ? tpTriggerRaw * 0.99 : tpTriggerRaw * 1.01;
      const tpCloid = generateTugCloid();
      cloids.push(tpCloid);
      orders.push({
        a: params.assetIndex,
        b: !params.isBuy,
        p: formatHlPrice(tpLimitRaw, params.szDecimals),
        s: prep.sizeStr,
        r: true,
        t: { trigger: { isMarket: true, triggerPx: formatHlPrice(tpTriggerRaw, params.szDecimals), tpsl: 'tp' } },
        c: tpCloid,
      });
    }

    const res = await signAndPostHyperliquidAction(params.network, {
      type: 'order',
      orders,
      grouping: 'normalTpsl',
    });

    if (res.fillStatus !== 'REJECTED') {
      for (let i = 0; i < cloids.length; i++) {
        registerTugOrder({
          coin: params.coin,
          side: params.isBuy ? 'LONG' : 'SHORT',
          cloid: cloids[i],
          oid: res.allOids[i] ?? null,
          strategyTag: params.strategyTag,
          strategies: params.strategies,
          isEntry: i === 0,
        });
      }
    }

    return {
      ok: res.fillStatus !== 'REJECTED',
      abortedPreSend: false,
      abortReason: '',
      entryCloid,
      cloids,
      allOids: res.allOids,
      fillStatus: res.fillStatus,
      filledSz: res.filledSz,
      filledAvgPx: res.filledAvgPx,
      oid: res.oid,
      signMs: res.signMs,
      exchangeRttMs: res.exchangeRttMs,
      effectiveNotionalUsd: prep.effectiveNotionalUsd,
      sizeStr: prep.sizeStr,
      limitPxStr,
      scaledTpUsed,
      nativeTpslAttached: res.fillStatus !== 'REJECTED',
      rejectReason: res.rejectReason,
    };
  });
}

export async function submitReduceOnlyClose(params: {
  network: HlNetwork;
  coin: string;
  assetIndex: number;
  szDecimals: number;
  isBuyToClose: boolean;
  referencePx: number;
  sizeCoins: number;
  slippageBps: number;
}) {
  return withSymbolLock(params.coin, async () => {
    const sizeStr = formatHlSize(params.sizeCoins, params.szDecimals, true);
    if (Number(sizeStr) <= 0) {
      return {
        ok: false,
        cloid: '',
        fillStatus: 'REJECTED' as OrderFillStatus,
        filledSz: 0,
        filledAvgPx: 0,
        oid: null as number | null,
        signMs: 0,
        exchangeRttMs: 0,
        rejectReason: 'Tamaño de cierre inválido (<= 0).',
      };
    }

    const iocSlipBps = clampIocSlippageBps(params.slippageBps);
    const slipFactor = params.isBuyToClose
      ? 1 + iocSlipBps / 10000
      : Math.max(0.05, 1 - iocSlipBps / 10000);
    const limitPxStr = formatHlPrice(params.referencePx * slipFactor, params.szDecimals);
    const cloid = generateTugCloid();

    const res = await signAndPostHyperliquidAction(params.network, {
      type: 'order',
      orders: [
        {
          a: params.assetIndex,
          b: params.isBuyToClose,
          p: limitPxStr,
          s: sizeStr,
          r: true,
          t: { limit: { tif: 'Ioc' } },
          c: cloid,
        },
      ],
      grouping: 'na',
    });

    if (res.fillStatus !== 'REJECTED') {
      registerTugOrder({ coin: params.coin, cloid, oid: res.oid, isEntry: false });
      clearTugPositionMeta(params.coin);
    }

    return {
      ok: res.fillStatus !== 'REJECTED',
      cloid,
      fillStatus: res.fillStatus,
      filledSz: res.filledSz,
      filledAvgPx: res.filledAvgPx,
      oid: res.oid,
      signMs: res.signMs,
      exchangeRttMs: res.exchangeRttMs,
      rejectReason: res.rejectReason,
    };
  });
}
