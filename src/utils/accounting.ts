import type { HlUserFill, PersistedPosition } from '../types/trading.ts';

export const TUG777_CLOID_PREFIX = '0x777';

export function isTug777Cloid(cloid?: string | null): boolean {
  if (!cloid) return false;
  return cloid.trim().toLowerCase().startsWith(TUG777_CLOID_PREFIX);
}

export function isTug777Fill(
  fill: Pick<HlUserFill, 'cloid' | 'oid'>,
  knownTugOids?: Set<number>,
  knownTugCloids?: Set<string>
): boolean {
  if (isTug777Cloid(fill.cloid)) return true;
  if (fill.cloid && knownTugCloids?.has(fill.cloid.toLowerCase())) return true;
  if (knownTugOids?.has(fill.oid)) return true;
  return false;
}

export interface CoinAccountingRow {
  coin: string;
  netPnlUsd: number;
  grossPnlUsd: number;
  feesUsd: number;
  closedTrades: number;
  wins: number;
  losses: number;
  fillsCount: number;
}

export interface UnifiedAccountingResult {
  netRealizedPnlUsd: number;
  grossProfitUsd: number;
  grossLossUsd: number;
  totalFeesUsd: number;
  closedCount: number;
  winsCount: number;
  lossesCount: number;
  winRatePct: number;
  profitFactor: number;
  avgWinUsd: number;
  avgLossUsd: number;
  coinBreakdown: CoinAccountingRow[];
  curve: Array<{ idx: number; pnl: number; delta: number; coin: string; time: number }>;
  recentClosed: Array<{ coin: string; side: string; netPnl: number; px: number; time: number; oid: number; cloid?: string }>;
  sourceLabel: string;
  totalFillsInWindow: number;
  tugFilteredCount: number;
}

export function computeUnifiedAccounting(params: {
  fills: HlUserFill[];
  persistedPositions: PersistedPosition[];
  windowStartMs?: number;
  onlyTug777?: boolean;
  knownTugOids?: Set<number>;
  knownTugCloids?: Set<string>;
}): UnifiedAccountingResult {
  const {
    fills,
    persistedPositions,
    windowStartMs = 0,
    onlyTug777 = false,
    knownTugOids,
    knownTugCloids,
  } = params;

  const windowedFills = fills.filter((f) => f.time >= windowStartMs);
  const tugFills = windowedFills.filter((f) => isTug777Fill(f, knownTugOids, knownTugCloids));
  const activeFills = onlyTug777 ? tugFills : windowedFills;

  // Group fills by coin cleanly so Global Summary and Coin Breakdown share 100% identical numbers over the exact same window!
  const closedEvents: Array<{
    coin: string;
    side: string;
    grossPnl: number;
    fee: number;
    netPnl: number;
    px: number;
    time: number;
    oid: number;
    cloid?: string;
  }> = [];

  if (activeFills.length > 0) {
    // Include fees on opening fills in the coin breakdown AND global net realized PnL so sum(coinBreakdown.netPnlUsd) === netRealizedPnlUsd!
    const coinMap = new Map<string, CoinAccountingRow>();
    let totalFeesUsd = 0;
    let grossProfitUsd = 0;
    let grossLossUsd = 0;
    let winsCount = 0;
    let lossesCount = 0;
    let closedCount = 0;

    for (const f of activeFills) {
      const fee = Number(f.fee || 0);
      const closedGross = Number(f.closedPnl || 0);
      const isClose = Math.abs(closedGross) > 0.0001;
      const netDelta = closedGross - fee;
      totalFeesUsd += fee;

      const row = coinMap.get(f.coin) || {
        coin: f.coin,
        netPnlUsd: 0,
        grossPnlUsd: 0,
        feesUsd: 0,
        closedTrades: 0,
        wins: 0,
        losses: 0,
        fillsCount: 0,
      };
      row.netPnlUsd += netDelta;
      row.grossPnlUsd += closedGross;
      row.feesUsd += fee;
      row.fillsCount += 1;

      if (isClose) {
        closedCount += 1;
        row.closedTrades += 1;
        if (netDelta > 0) {
          winsCount += 1;
          row.wins += 1;
          grossProfitUsd += netDelta;
        } else if (netDelta < 0) {
          lossesCount += 1;
          row.losses += 1;
          grossLossUsd += Math.abs(netDelta);
        }
        closedEvents.push({
          coin: f.coin,
          side: f.side,
          grossPnl: closedGross,
          fee,
          netPnl: netDelta,
          px: f.px,
          time: f.time,
          oid: f.oid,
          cloid: f.cloid,
        });
      } else if (fee > 0) {
        // Opening fill fee contributes to net realized drawdown/cost consistently
        grossLossUsd += fee;
      }

      coinMap.set(f.coin, row);
    }

    const coinBreakdown = Array.from(coinMap.values())
      .map((r) => ({
        ...r,
        netPnlUsd: Number(r.netPnlUsd.toFixed(4)),
        grossPnlUsd: Number(r.grossPnlUsd.toFixed(4)),
        feesUsd: Number(r.feesUsd.toFixed(4)),
      }))
      .sort((a, b) => a.netPnlUsd - b.netPnlUsd);

    // Exact sum over the identical coinBreakdown source guarantees 0.00 drift between Global KPI & Breakdown cards
    const netRealizedPnlUsd = Number(
      coinBreakdown.reduce((acc, r) => acc + r.netPnlUsd, 0).toFixed(2)
    );
    const chrono = [...closedEvents].sort((a, b) => a.time - b.time);
    let running = 0;
    const curve = chrono.map((ev, idx) => {
      running += ev.netPnl;
      return { idx, pnl: running, delta: ev.netPnl, coin: ev.coin, time: ev.time };
    });

    const recentClosed = [...closedEvents]
      .sort((a, b) => b.time - a.time)
      .slice(0, 20)
      .map((e) => ({
        coin: e.coin,
        side: e.side,
        netPnl: Number(e.netPnl.toFixed(2)),
        px: e.px,
        time: e.time,
        oid: e.oid,
        cloid: e.cloid,
      }));

    return {
      netRealizedPnlUsd,
      grossProfitUsd: Number(grossProfitUsd.toFixed(2)),
      grossLossUsd: Number(grossLossUsd.toFixed(2)),
      totalFeesUsd: Number(totalFeesUsd.toFixed(2)),
      closedCount,
      winsCount,
      lossesCount,
      winRatePct: closedCount > 0 ? Number(((winsCount / closedCount) * 100).toFixed(1)) : 0,
      profitFactor:
        grossLossUsd > 0 ? Number((grossProfitUsd / grossLossUsd).toFixed(2)) : grossProfitUsd > 0 ? 9.99 : 0,
      avgWinUsd: winsCount > 0 ? Number((grossProfitUsd / winsCount).toFixed(2)) : 0,
      avgLossUsd: lossesCount > 0 ? Number((grossLossUsd / lossesCount).toFixed(2)) : 0,
      coinBreakdown,
      curve,
      recentClosed,
      sourceLabel: onlyTug777
        ? 'Hyperliquid Fills (Solo TUG777 0x777)'
        : 'Hyperliquid Real Fills',
      totalFillsInWindow: windowedFills.length,
      tugFilteredCount: tugFills.length,
    };
  }

  // Fallback: Persisted CLOSED positions from Firestore
  const closedDb = persistedPositions.filter(
    (p) =>
      p.status === 'CLOSED' &&
      p.updatedAtMs >= windowStartMs &&
      (!onlyTug777 || !p.isExternal)
  );
  const coinMap = new Map<string, CoinAccountingRow>();
  let grossProfitUsd = 0;
  let grossLossUsd = 0;
  let winsCount = 0;
  let lossesCount = 0;

  for (const p of closedDb) {
    const net = Number(p.realizedPnl || 0);
    const row = coinMap.get(p.coin) || {
      coin: p.coin,
      netPnlUsd: 0,
      grossPnlUsd: 0,
      feesUsd: 0,
      closedTrades: 0,
      wins: 0,
      losses: 0,
      fillsCount: 0,
    };
    row.netPnlUsd += net;
    row.grossPnlUsd += net;
    row.closedTrades += 1;
    row.fillsCount += 1;
    if (net > 0.01) {
      winsCount += 1;
      row.wins += 1;
      grossProfitUsd += net;
    } else if (net < -0.01) {
      lossesCount += 1;
      row.losses += 1;
      grossLossUsd += Math.abs(net);
    }
    coinMap.set(p.coin, row);
  }

  const coinBreakdown = Array.from(coinMap.values())
    .map((r) => ({
      ...r,
      netPnlUsd: Number(r.netPnlUsd.toFixed(4)),
      grossPnlUsd: Number(r.grossPnlUsd.toFixed(4)),
    }))
    .sort((a, b) => a.netPnlUsd - b.netPnlUsd);

  const netRealizedPnlUsd = Number(
    coinBreakdown.reduce((acc, r) => acc + r.netPnlUsd, 0).toFixed(2)
  );
  const chrono = [...closedDb].sort((a, b) => a.updatedAtMs - b.updatedAtMs);
  let running = 0;
  const curve = chrono.map((p, idx) => {
    const delta = Number(p.realizedPnl || 0);
    running += delta;
    return { idx, pnl: running, delta, coin: p.coin, time: p.updatedAtMs };
  });

  return {
    netRealizedPnlUsd,
    grossProfitUsd: Number(grossProfitUsd.toFixed(2)),
    grossLossUsd: Number(grossLossUsd.toFixed(2)),
    totalFeesUsd: 0,
    closedCount: closedDb.length,
    winsCount,
    lossesCount,
    winRatePct: closedDb.length > 0 ? Number(((winsCount / closedDb.length) * 100).toFixed(1)) : 0,
    profitFactor:
      grossLossUsd > 0 ? Number((grossProfitUsd / grossLossUsd).toFixed(2)) : grossProfitUsd > 0 ? 9.99 : 0,
    avgWinUsd: winsCount > 0 ? Number((grossProfitUsd / winsCount).toFixed(2)) : 0,
    avgLossUsd: lossesCount > 0 ? Number((grossLossUsd / lossesCount).toFixed(2)) : 0,
    coinBreakdown,
    curve,
    recentClosed: [...closedDb]
      .sort((a, b) => b.updatedAtMs - a.updatedAtMs)
      .slice(0, 20)
      .map((p, i) => ({
        coin: p.coin,
        side: p.side === 'LONG' ? 'B' : 'A',
        netPnl: Number(p.realizedPnl.toFixed(2)),
        px: p.markPx,
        time: p.updatedAtMs,
        oid: i,
        cloid: p.cloid,
      })),
    sourceLabel: 'Firestore Historial Cerrado',
    totalFillsInWindow: 0,
    tugFilteredCount: 0,
  };
}
