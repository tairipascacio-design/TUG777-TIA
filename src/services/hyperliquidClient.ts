import { encode } from '@msgpack/msgpack';
import { Signature, Wallet, concat, getBytes, keccak256 } from 'ethers';
import type {
  HlAccountSummary,
  HlAssetMarket,
  HlCandle,
  HlL2Level,
  HlNetwork,
  HlUserFill,
  MevProbeStatus,
} from '../types/trading';

export async function hlInfoRequest<T = unknown>(
  network: HlNetwork,
  payload: Record<string, unknown>
): Promise<{ data: T; latencyMs: number; channel: string }> {
  const res = await fetch('/api/hl/info', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ network, payload }),
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json?.error || `Hyperliquid HTTP ${res.status}`);
  }
  return json;
}

export async function fetchMevAndLatencyProbe(network: HlNetwork): Promise<MevProbeStatus> {
  const res = await fetch(`/api/mev/probe?network=${network}`);
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json?.error || 'Error verificando canales RPC');
  }
  return json;
}

export function computeQuantConfluence(raw: {
  change24hPct: number;
  annualizedFundingPct: number;
  openInterestUsd: number;
  dayNtlVlm: number;
  markPx: number;
  oraclePx: number;
}): { quantScore: number; quantBias: 'LONG' | 'SHORT' | 'NEUTRAL'; quantSignals: string[] } {
  const signals: string[] = [];
  let bullPts = 0;
  let bearPts = 0;

  // 1. Institutional Liquidity Turnover (Volume / OI)
  const turnover = raw.openInterestUsd > 0 ? raw.dayNtlVlm / raw.openInterestUsd : 0;
  if (turnover > 2.5) {
    signals.push('Alta rotación OI/Vol');
    bullPts += 12;
    bearPts += 12;
  }

  // 2. Momentum Confluence
  if (raw.change24hPct >= 2.2 && raw.change24hPct <= 14) {
    signals.push(`Momentum alcista +${raw.change24hPct.toFixed(1)}%`);
    bullPts += 28;
  } else if (raw.change24hPct <= -2.2 && raw.change24hPct >= -14) {
    signals.push(`Momentum bajista ${raw.change24hPct.toFixed(1)}%`);
    bearPts += 28;
  } else if (raw.change24hPct > 18) {
    signals.push('Sobreextensión alcista');
    bearPts += 20;
  } else if (raw.change24hPct < -18) {
    signals.push('Capitulación extrema');
    bullPts += 20;
  }

  // 3. Funding Rate Squeeze / Carry Edge
  if (raw.annualizedFundingPct <= -25) {
    signals.push(`Short Squeeze Funding (${raw.annualizedFundingPct.toFixed(0)}% APR)`);
    bullPts += 26;
  } else if (raw.annualizedFundingPct >= 45) {
    signals.push(`Long Crowding (${raw.annualizedFundingPct.toFixed(0)}% APR)`);
    bearPts += 26;
  }

  // 4. Mark vs Oracle Basis
  const basisBps = raw.oraclePx > 0 ? ((raw.markPx - raw.oraclePx) / raw.oraclePx) * 10000 : 0;
  if (basisBps > 8) {
    signals.push('Prima Mark > Oracle');
    bullPts += 10;
  } else if (basisBps < -8) {
    signals.push('Descuento Mark < Oracle');
    bearPts += 10;
  }

  // 5. Minimum institutional liquidity filter
  if (raw.dayNtlVlm > 5_000_000) {
    bullPts += 14;
    bearPts += 14;
    signals.push('Liquidez Profunda >$5M');
  }

  const net = bullPts - bearPts;
  const quantScore = Math.min(98, Math.max(bullPts, bearPts));
  if (net >= 16) return { quantScore, quantBias: 'LONG', quantSignals: signals };
  if (net <= -16) return { quantScore, quantBias: 'SHORT', quantSignals: signals };
  return { quantScore: Math.round(quantScore * 0.7), quantBias: 'NEUTRAL', quantSignals: signals };
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

  return (data || []).map((k) => ({
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
  }));
}

export async function fetchL2Book(
  network: HlNetwork,
  coin: string
): Promise<{ bids: HlL2Level[]; asks: HlL2Level[]; latencyMs: number }> {
  type L2Response = {
    levels: [
      Array<{ px: string; sz: string; n: number }>,
      Array<{ px: string; sz: string; n: number }>
    ];
  };
  const { data, latencyMs } = await hlInfoRequest<L2Response>(network, { type: 'l2Book', coin });
  const bids = (data?.levels?.[0] || []).slice(0, 12).map((l) => ({
    px: Number(l.px),
    sz: Number(l.sz),
    n: l.n,
  }));
  const asks = (data?.levels?.[1] || []).slice(0, 12).map((l) => ({
    px: Number(l.px),
    sz: Number(l.sz),
    n: l.n,
  }));
  return { bids, asks, latencyMs };
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

  const { data } = await hlInfoRequest<ClearinghouseResp>(network, {
    type: 'clearinghouseState',
    user: userAddress,
  });

  const positions = (data?.assetPositions || [])
    .map((ap) => ap.position)
    .filter((p) => Math.abs(Number(p.szi)) > 0)
    .map((p) => {
      const szi = Number(p.szi);
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
  };
  const { data } = await hlInfoRequest<RawFill[]>(network, {
    type: 'userFills',
    user: userAddress,
  });
  return (data || []).slice(0, 60).map((f) => ({
    coin: f.coin,
    px: Number(f.px),
    sz: Number(f.sz),
    side: f.side,
    time: f.time,
    closedPnl: Number(f.closedPnl || 0),
    fee: Number(f.fee || 0),
    oid: f.oid,
    hash: f.hash,
  }));
}

// Hyperliquid 5-sig-fig price formatting rule
export function formatHlPrice(price: number, szDecimals: number): string {
  if (!Number.isFinite(price) || price <= 0) return '0';
  const maxDecimals = Math.max(0, 6 - szDecimals);
  const roundedSig = Number(price.toPrecision(5));
  const fixed = roundedSig.toFixed(Math.min(maxDecimals, 6));
  return fixed.replace(/\.?0+$/, '');
}

export function formatHlSize(size: number, szDecimals: number): string {
  if (!Number.isFinite(size) || size <= 0) return '0';
  const factor = Math.pow(10, szDecimals);
  const floored = Math.floor(size * factor) / factor;
  return floored.toFixed(szDecimals).replace(/\.?0+$/, '') || '0';
}

// Anti-MEV / Flashbots Guard Verification before any order submission
export function evaluateMevShield(params: {
  enabled: boolean;
  markPx: number;
  oraclePx: number;
  bids: HlL2Level[];
  asks: HlL2Level[];
  notionalUsd: number;
  maxSlippageBps: number;
  maxOracleDeviationBps: number;
}): { passed: boolean; spreadBps: number; oracleDiffBps: number; topDepthUsd: number; reason: string } {
  const bestBid = params.bids[0]?.px ?? params.markPx;
  const bestAsk = params.asks[0]?.px ?? params.markPx;
  const mid = (bestBid + bestAsk) / 2 || params.markPx;
  const spreadBps = mid > 0 ? ((bestAsk - bestBid) / mid) * 10000 : 0;
  const oracleDiffBps = params.oraclePx > 0 ? (Math.abs(params.markPx - params.oraclePx) / params.oraclePx) * 10000 : 0;

  const top3BidUsd = params.bids.slice(0, 3).reduce((acc, l) => acc + l.px * l.sz, 0);
  const top3AskUsd = params.asks.slice(0, 3).reduce((acc, l) => acc + l.px * l.sz, 0);
  const topDepthUsd = Math.min(top3BidUsd || params.notionalUsd, top3AskUsd || params.notionalUsd);

  if (!params.enabled) {
    return {
      passed: true,
      spreadBps,
      oracleDiffBps,
      topDepthUsd,
      reason: 'Escudo MEV desactivado manualmente',
    };
  }

  if (spreadBps > params.maxSlippageBps) {
    return {
      passed: false,
      spreadBps,
      oracleDiffBps,
      topDepthUsd,
      reason: `Spread ${spreadBps.toFixed(1)} bps excede límite anti-sandwich (${params.maxSlippageBps} bps).`,
    };
  }

  if (oracleDiffBps > params.maxOracleDeviationBps) {
    return {
      passed: false,
      spreadBps,
      oracleDiffBps,
      topDepthUsd,
      reason: `Desviación Mark/Oracle ${oracleDiffBps.toFixed(1)} bps excede escudo (${params.maxOracleDeviationBps} bps).`,
    };
  }

  return {
    passed: true,
    spreadBps,
    oracleDiffBps,
    topDepthUsd,
    reason: `Verificado · Spread ${spreadBps.toFixed(1)} bps · Oracle Δ ${oracleDiffBps.toFixed(1)} bps`,
  };
}

// Real EIP-712 + MsgPack L1 Action Signer for Hyperliquid API Wallet
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
}) {
  const wallet = new Wallet(params.apiPrivateKey.trim());
  const slipFactor = params.isBuy ? 1 + params.slippageBps / 10000 : 1 - params.slippageBps / 10000;
  const limitPxStr = formatHlPrice(params.referencePx * slipFactor, params.szDecimals);
  const sizeStr = formatHlSize(params.sizeCoins, params.szDecimals);

  if (Number(sizeStr) <= 0) {
    throw new Error('Tamaño de orden demasiado pequeño tras redondeo de decimales Hyperliquid.');
  }

  const action = {
    type: 'order',
    orders: [
      {
        a: params.assetIndex,
        b: params.isBuy,
        p: limitPxStr,
        s: sizeStr,
        r: Boolean(params.reduceOnly),
        t: { limit: { tif: 'Ioc' } },
      },
    ],
    grouping: 'na',
  };

  const nonce = Date.now();
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

  const rawSig = await wallet.signTypedData(domain, types, message);
  const sig = Signature.from(rawSig);

  const signedPayload = {
    action,
    nonce,
    signature: {
      r: sig.r,
      s: sig.s,
      v: sig.v,
    },
  };

  const res = await fetch('/api/hl/exchange', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      network: params.network,
      signedPayload,
    }),
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(json?.error || 'Error enviando orden firmada a Hyperliquid');
  }

  return {
    exchangeResponse: json.data,
    latencyMs: json.latencyMs as number,
    channel: json.channel as string,
    agentAddress: wallet.address,
    limitPxStr,
    sizeStr,
  };
}
