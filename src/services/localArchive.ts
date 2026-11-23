import { DEFAULT_STRATEGY_PLAYBOOK } from './strategyEngine';
import type {
  AiMemoryEntry,
  ChatMessageEntry,
  LatencyHistorySample,
  PersistedPosition,
  StrategyPlaybookItem,
  TradeLogEntry,
} from '../types/trading';

const KEYS = {
  positions: 'tug777_archive_positions_v1',
  memories: 'tug777_archive_memories_v1',
  logs: 'tug777_archive_logs_v1',
  playbook: 'tug777_archive_playbook_v1',
  chat: 'tug777_archive_chat_v1',
  latency: 'tug777_archive_latency_v1',
} as const;

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore storage quota limits
  }
}

export function loadLocalPositions(): PersistedPosition[] {
  return readJson<PersistedPosition[]>(KEYS.positions, []);
}

export function saveLocalPositions(items: PersistedPosition[]) {
  writeJson(KEYS.positions, items.slice(0, 500));
}

export function loadLocalMemories(): AiMemoryEntry[] {
  return readJson<AiMemoryEntry[]>(KEYS.memories, []);
}

export function saveLocalMemories(items: AiMemoryEntry[]) {
  writeJson(KEYS.memories, items.slice(0, 500));
}

export function loadLocalLogs(): TradeLogEntry[] {
  return readJson<TradeLogEntry[]>(KEYS.logs, []);
}

export function saveLocalLogs(items: TradeLogEntry[]) {
  writeJson(KEYS.logs, items.slice(0, 300));
}

export function deduplicatePlaybook(items: StrategyPlaybookItem[]): StrategyPlaybookItem[] {
  const map = new Map<string, StrategyPlaybookItem>();
  for (const item of items) {
    if (!item || !item.strategyId) continue;
    const prev = map.get(item.strategyId);
    if (!prev || item.wins + item.losses >= prev.wins + prev.losses) {
      map.set(item.strategyId, item);
    }
  }
  return Array.from(map.values());
}

export function loadLocalPlaybook(): StrategyPlaybookItem[] {
  const saved = deduplicatePlaybook(readJson<StrategyPlaybookItem[]>(KEYS.playbook, []));
  if (saved.length > 0) return saved;
  return DEFAULT_STRATEGY_PLAYBOOK.map((d) => ({
    ...d,
    ownerId: 'local',
    wins: 0,
    losses: 0,
    totalPnlUsd: 0,
    updatedAtMs: Date.now(),
  }));
}

export function saveLocalPlaybook(items: StrategyPlaybookItem[]) {
  writeJson(KEYS.playbook, deduplicatePlaybook(items));
}

export function loadLocalChat(): ChatMessageEntry[] {
  return readJson<ChatMessageEntry[]>(KEYS.chat, []);
}

export function saveLocalChat(items: ChatMessageEntry[]) {
  writeJson(KEYS.chat, items.slice(-150));
}

export function positionFingerprint(p: Pick<PersistedPosition, 'coin' | 'side' | 'hlOrderId' | 'entryPx' | 'status'>): string {
  if (p.hlOrderId && p.hlOrderId.trim().length > 6) {
    return `${p.coin}|${p.side}|${p.hlOrderId.trim().slice(0, 80)}`;
  }
  return `${p.coin}|${p.side}|${p.entryPx.toFixed(6)}|${p.status}`;
}

export function memoryFingerprint(m: Pick<AiMemoryEntry, 'coin' | 'regime' | 'outcome' | 'lesson'>): string {
  return `${m.coin}|${m.regime}|${m.outcome}|${m.lesson.trim().slice(0, 140)}`.toLowerCase();
}

export function mergePositionsAdditive(
  primary: PersistedPosition[],
  secondary: PersistedPosition[]
): PersistedPosition[] {
  const byId = new Map<string, PersistedPosition>();
  const seenFingerprints = new Set<string>();

  for (const item of primary) {
    byId.set(item.id, item);
    seenFingerprints.add(positionFingerprint(item));
  }

  for (const item of secondary) {
    if (byId.has(item.id)) continue;
    const fp = positionFingerprint(item);
    // Keep non-local items or local items not yet mirrored in cloud
    if (item.id.startsWith('local-') && seenFingerprints.has(fp)) {
      continue;
    }
    byId.set(item.id, item);
    seenFingerprints.add(fp);
  }

  return Array.from(byId.values())
    .sort((a, b) => b.updatedAtMs - a.updatedAtMs)
    .slice(0, 500);
}

export function mergeMemoriesAdditive(
  primary: AiMemoryEntry[],
  secondary: AiMemoryEntry[]
): AiMemoryEntry[] {
  const byId = new Map<string, AiMemoryEntry>();
  const seenFingerprints = new Set<string>();

  for (const item of primary) {
    byId.set(item.id, item);
    seenFingerprints.add(memoryFingerprint(item));
  }

  for (const item of secondary) {
    if (byId.has(item.id)) continue;
    const fp = memoryFingerprint(item);
    if (seenFingerprints.has(fp)) continue;
    byId.set(item.id, item);
    seenFingerprints.add(fp);
  }

  return Array.from(byId.values())
    .sort((a, b) => b.createdAtMs - a.createdAtMs)
    .slice(0, 500);
}

export function mergeTradeLogsAdditive(
  primary: TradeLogEntry[],
  secondary: TradeLogEntry[]
): TradeLogEntry[] {
  const byId = new Map<string, TradeLogEntry>();
  const seen = new Set<string>();

  const fp = (l: TradeLogEntry) =>
    `${l.level}|${l.category}|${l.coin}|${l.message.slice(0, 80)}|${Math.round(l.createdAtMs / 5000)}`;

  for (const item of primary) {
    byId.set(item.id, item);
    seen.add(fp(item));
  }
  for (const item of secondary) {
    if (byId.has(item.id)) continue;
    const key = fp(item);
    if (item.id.startsWith('local-') && seen.has(key)) continue;
    byId.set(item.id, item);
    seen.add(key);
  }

  return Array.from(byId.values())
    .sort((a, b) => b.createdAtMs - a.createdAtMs)
    .slice(0, 300);
}

export function mergeChatAdditive(
  primary: ChatMessageEntry[],
  secondary: ChatMessageEntry[]
): ChatMessageEntry[] {
  const byId = new Map<string, ChatMessageEntry>();
  const seen = new Set<string>();
  const fp = (m: ChatMessageEntry) => `${m.role}|${m.content.slice(0, 100)}`;

  for (const item of primary) {
    byId.set(item.id, item);
    seen.add(fp(item));
  }
  for (const item of secondary) {
    if (byId.has(item.id)) continue;
    if (item.id.startsWith('local-') && seen.has(fp(item))) continue;
    byId.set(item.id, item);
    seen.add(fp(item));
  }

  return Array.from(byId.values())
    .sort((a, b) => a.createdAtMs - b.createdAtMs)
    .slice(-150);
}

export function loadLocalLatencyHistory(): LatencyHistorySample[] {
  return readJson<LatencyHistorySample[]>(KEYS.latency, []);
}

export function saveLocalLatencyHistory(samples: LatencyHistorySample[]) {
  writeJson(KEYS.latency, samples.slice(-500));
}

export function appendLatencySample(
  existing: LatencyHistorySample[],
  sample: LatencyHistorySample
): LatencyHistorySample[] {
  const next = [...existing, sample].slice(-500);
  saveLocalLatencyHistory(next);
  return next;
}

export interface ComputedLatencyTelemetry {
  avgConfirmMs: number;
  minConfirmMs: number;
  maxConfirmMs: number;
  avgDetectToExecMs: number;
  maxDetectToExecMs: number;
  baselineAvgMs: number;
  recent5AvgMs: number;
  degradationPct: number;
  degradationAlert: boolean;
  totalConfirmed: number;
  totalFilledConfirmed: number;
  totalAckOnly: number;
  totalRejected: number;
  totalBlockedByMev: number;
  totalMevEvaluated: number;
}

export function computeLatencyStats(samples: LatencyHistorySample[]): ComputedLatencyTelemetry {
  const confirmed = samples.filter((s) => s.outcome === 'CONFIRMED' && s.e2eAckMs > 0);
  const rejected = samples.filter((s) => s.outcome === 'REJECTED');
  const blocked = samples.filter((s) => s.outcome === 'MEV_BLOCKED');
  const executed = samples.filter((s) => s.outcome !== 'MEV_BLOCKED' && s.e2eAckMs > 0);

  const latencies = executed.map((s) => s.e2eAckMs);
  const avgConfirmMs =
    latencies.length > 0 ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0;
  const minConfirmMs = latencies.length > 0 ? Math.min(...latencies) : 0;
  const maxConfirmMs = latencies.length > 0 ? Math.max(...latencies) : 0;

  const detectExecLatencies = executed
    .map((s) => s.detectToExecMs ?? s.e2eAckMs)
    .filter((v) => v > 0);
  const avgDetectToExecMs =
    detectExecLatencies.length > 0
      ? Math.round(detectExecLatencies.reduce((a, b) => a + b, 0) / detectExecLatencies.length)
      : 0;
  const maxDetectToExecMs = detectExecLatencies.length > 0 ? Math.max(...detectExecLatencies) : 0;

  const recentWindow = latencies.slice(-5);
  const recent5AvgMs =
    recentWindow.length > 0
      ? Math.round(recentWindow.reduce((a, b) => a + b, 0) / recentWindow.length)
      : 0;

  const priorWindow = latencies.length > 5 ? latencies.slice(0, latencies.length - 5) : latencies;
  const baselineAvgMs =
    priorWindow.length > 0
      ? Math.round(priorWindow.reduce((a, b) => a + b, 0) / priorWindow.length)
      : 0;

  const degradationPct =
    baselineAvgMs > 0 ? Math.round(((recent5AvgMs - baselineAvgMs) / baselineAvgMs) * 100) : 0;
  const degradationAlert =
    latencies.length >= 6 && baselineAvgMs > 0 && recent5AvgMs > baselineAvgMs * 1.45 && recent5AvgMs > 450;

  const totalFilledConfirmed = confirmed.filter((s) => s.fillStatus === 'FILLED').length;
  const totalAckOnly = confirmed.filter((s) => s.fillStatus !== 'FILLED').length;

  return {
    avgConfirmMs,
    minConfirmMs,
    maxConfirmMs,
    avgDetectToExecMs,
    maxDetectToExecMs,
    baselineAvgMs,
    recent5AvgMs,
    degradationPct,
    degradationAlert,
    totalConfirmed: confirmed.length,
    totalFilledConfirmed,
    totalAckOnly,
    totalRejected: rejected.length,
    totalBlockedByMev: blocked.length,
    totalMevEvaluated: samples.length,
  };
}


