import {
  addDoc,
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import { OperationType, db, handleFirestoreError } from '../firebase';
import type {
  AiMemoryEntry,
  BotConfigData,
  ChatMessageEntry,
  PersistedPosition,
  StrategyPlaybookItem,
  TradeLogEntry,
} from '../types/trading';
import { DEFAULT_STRATEGY_PLAYBOOK } from './strategyEngine';

const DEFAULT_CONFIG = (uid: string): BotConfigData => ({
  ownerId: uid,
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
  sizingMode: 'equity_pct',
  capitalPctPerTrade: 25,
  maxOpenPositions: 3,
  trailingStopEnabled: true,
  autoManagePositions: true,
});

export async function ensureUserProfileAndConfig(user: {
  uid: string;
  email: string | null;
  displayName: string | null;
}): Promise<BotConfigData> {
  const userPath = `users/${user.uid}`;
  const userRef = doc(db, 'users', user.uid);

  try {
    const snap = await getDoc(userRef);
    if (!snap.exists()) {
      await setDoc(userRef, {
        uid: user.uid,
        email: (user.email || 'trader@tug777.app').slice(0, 254),
        displayName: (user.displayName || 'TUG777 Trader').slice(0, 120),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, userPath);
  }

  const configPath = `users/${user.uid}/bot_configs/default`;
  const configRef = doc(db, 'users', user.uid, 'bot_configs', 'default');

  try {
    const cfgSnap = await getDoc(configRef);
    if (!cfgSnap.exists()) {
      const defaults = DEFAULT_CONFIG(user.uid);
      await setDoc(configRef, {
        ...defaults,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      return defaults;
    }
    const d = cfgSnap.data();
    return {
      ownerId: user.uid,
      mode: d.mode || 'strategy_ai',
      aiEnabled: Boolean(d.aiEnabled),
      network: d.network || 'mainnet',
      masterWalletAddress: d.masterWalletAddress || '',
      mevShieldEnabled: d.mevShieldEnabled !== false,
      maxSlippageBps: Number(d.maxSlippageBps || 25),
      maxOracleDeviationBps: Number(d.maxOracleDeviationBps || 45),
      riskPerTradeUsd: Number(d.riskPerTradeUsd || 50),
      soundEnabled: d.soundEnabled !== false,
      aiProvider: d.aiProvider === 'custom_ai' ? 'custom_ai' : 'gemini',
      customAiUrl: d.customAiUrl || '',
      customAiModel: d.customAiModel || '',
      customSystemPrompt: d.customSystemPrompt || '',
      scanIntervalSec: Number(d.scanIntervalSec || 180),
      minConfidence: Number(d.minConfidence || 68),
      minQuantScore: Number(d.minQuantScore || 58),
      minVolumeM: Number(d.minVolumeM || 2),
      tpPct: Number(d.tpPct || 3.0),
      slPct: Number(d.slPct || 1.4),
      useDeepThinking: Boolean(d.useDeepThinking),
      useSearchGrounding: Boolean(d.useSearchGrounding),
      sizingMode: d.sizingMode === 'fixed_usd' ? 'fixed_usd' : 'equity_pct',
      capitalPctPerTrade: Number(d.capitalPctPerTrade || 25),
      maxOpenPositions: Number(d.maxOpenPositions || 3),
      trailingStopEnabled: d.trailingStopEnabled !== false,
      autoManagePositions: d.autoManagePositions !== false,
    };
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, configPath);
  }
}

export async function saveBotConfig(uid: string, patch: Partial<BotConfigData>) {
  const path = `users/${uid}/bot_configs/default`;
  const ref = doc(db, 'users', uid, 'bot_configs', 'default');

  // Remove immutable/non-patchable ownerId if passed in full config object
  const { ownerId: _ignoredOwner, ...rest } = patch;
  const sanitized: Record<string, unknown> = { ...rest };

  if (typeof sanitized.maxSlippageBps === 'number') {
    sanitized.maxSlippageBps = Math.max(1, Math.min(500, sanitized.maxSlippageBps));
  }
  if (typeof sanitized.maxOracleDeviationBps === 'number') {
    sanitized.maxOracleDeviationBps = Math.max(1, Math.min(500, sanitized.maxOracleDeviationBps));
  }
  if (typeof sanitized.riskPerTradeUsd === 'number') {
    sanitized.riskPerTradeUsd = Math.max(1, Math.min(1000000, sanitized.riskPerTradeUsd));
  }
  if (typeof sanitized.scanIntervalSec === 'number') {
    sanitized.scanIntervalSec = Math.max(30, Math.min(3600, sanitized.scanIntervalSec));
  }
  if (typeof sanitized.minConfidence === 'number') {
    sanitized.minConfidence = Math.max(40, Math.min(99, sanitized.minConfidence));
  }
  if (typeof sanitized.minQuantScore === 'number') {
    sanitized.minQuantScore = Math.max(20, Math.min(95, sanitized.minQuantScore));
  }
  if (typeof sanitized.minVolumeM === 'number') {
    sanitized.minVolumeM = Math.max(0.1, Math.min(500, sanitized.minVolumeM));
  }
  if (typeof sanitized.tpPct === 'number') {
    sanitized.tpPct = Math.max(0.2, Math.min(100, sanitized.tpPct));
  }
  if (typeof sanitized.slPct === 'number') {
    sanitized.slPct = Math.max(0.2, Math.min(50, sanitized.slPct));
  }
  if (typeof sanitized.masterWalletAddress === 'string') {
    sanitized.masterWalletAddress = sanitized.masterWalletAddress.slice(0, 64);
  }
  if (typeof sanitized.customAiUrl === 'string') {
    sanitized.customAiUrl = sanitized.customAiUrl.slice(0, 256);
  }
  if (typeof sanitized.customAiModel === 'string') {
    sanitized.customAiModel = sanitized.customAiModel.slice(0, 120);
  }
  if (typeof sanitized.customSystemPrompt === 'string') {
    sanitized.customSystemPrompt = sanitized.customSystemPrompt.slice(0, 1500);
  }
  if (typeof sanitized.capitalPctPerTrade === 'number') {
    sanitized.capitalPctPerTrade = Math.max(1, Math.min(100, sanitized.capitalPctPerTrade));
  }
  if (typeof sanitized.maxOpenPositions === 'number') {
    sanitized.maxOpenPositions = Math.max(1, Math.min(20, Math.round(sanitized.maxOpenPositions)));
  }

  try {
    await updateDoc(ref, {
      ...sanitized,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export function subscribePositions(
  uid: string,
  onData: (positions: PersistedPosition[]) => void
): Unsubscribe {
  const path = `users/${uid}/positions`;
  const q = query(
    collection(db, 'users', uid, 'positions'),
    where('ownerId', '==', uid),
    orderBy('updatedAt', 'desc'),
    limit(100)
  );
  return onSnapshot(
    q,
    (snap) => {
      const items: PersistedPosition[] = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          ownerId: data.ownerId,
          coin: data.coin,
          side: data.side,
          size: Number(data.size),
          entryPx: Number(data.entryPx),
          markPx: Number(data.markPx),
          leverage: Number(data.leverage),
          unrealizedPnl: Number(data.unrealizedPnl),
          realizedPnl: Number(data.realizedPnl),
          status: data.status,
          mode: data.mode,
          hlOrderId: data.hlOrderId || '',
          thesis: data.thesis || '',
          strategyTag: data.strategyTag || '',
          createdAtMs: data.createdAt?.toMillis?.() ?? Date.now(),
          updatedAtMs: data.updatedAt?.toMillis?.() ?? Date.now(),
        };
      });
      onData(items);
    },
    (error) => handleFirestoreError(error, OperationType.LIST, path)
  );
}

export async function createPersistedPosition(
  uid: string,
  pos: Omit<PersistedPosition, 'id' | 'ownerId' | 'createdAtMs' | 'updatedAtMs'>
): Promise<string> {
  const path = `users/${uid}/positions`;
  try {
    const ref = await addDoc(collection(db, 'users', uid, 'positions'), {
      ownerId: uid,
      coin: pos.coin.slice(0, 32),
      side: pos.side,
      size: pos.size,
      entryPx: pos.entryPx,
      markPx: pos.markPx,
      leverage: Math.max(1, Math.min(100, pos.leverage)),
      unrealizedPnl: pos.unrealizedPnl,
      realizedPnl: pos.realizedPnl,
      status: pos.status,
      mode: pos.mode,
      hlOrderId: pos.hlOrderId.slice(0, 128),
      thesis: pos.thesis.slice(0, 600),
      strategyTag: (pos.strategyTag || '').slice(0, 160),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return ref.id;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function closePersistedPosition(
  uid: string,
  positionId: string,
  markPx: number,
  realizedPnl: number
) {
  const path = `users/${uid}/positions/${positionId}`;
  try {
    await updateDoc(doc(db, 'users', uid, 'positions', positionId), {
      markPx,
      unrealizedPnl: 0,
      realizedPnl,
      status: 'CLOSED',
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export function subscribeTradeLogs(
  uid: string,
  onData: (logs: TradeLogEntry[]) => void
): Unsubscribe {
  const path = `users/${uid}/trade_logs`;
  const q = query(
    collection(db, 'users', uid, 'trade_logs'),
    where('ownerId', '==', uid),
    orderBy('createdAt', 'desc'),
    limit(120)
  );
  return onSnapshot(
    q,
    (snap) => {
      const items: TradeLogEntry[] = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          ownerId: data.ownerId,
          level: data.level,
          category: data.category,
          coin: data.coin,
          message: data.message,
          latencyMs: Number(data.latencyMs || 0),
          createdAtMs: data.createdAt?.toMillis?.() ?? Date.now(),
        };
      });
      onData(items);
    },
    (error) => handleFirestoreError(error, OperationType.LIST, path)
  );
}

export async function appendTradeLog(
  uid: string,
  entry: Omit<TradeLogEntry, 'id' | 'ownerId' | 'createdAtMs'>
) {
  const path = `users/${uid}/trade_logs`;
  try {
    await addDoc(collection(db, 'users', uid, 'trade_logs'), {
      ownerId: uid,
      level: entry.level,
      category: entry.category.slice(0, 48),
      coin: entry.coin.slice(0, 32),
      message: entry.message.slice(0, 800),
      latencyMs: Math.max(0, Math.round(entry.latencyMs)),
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export function subscribeAiMemories(
  uid: string,
  onData: (memories: AiMemoryEntry[]) => void
): Unsubscribe {
  const path = `users/${uid}/ai_memory`;
  const q = query(
    collection(db, 'users', uid, 'ai_memory'),
    where('ownerId', '==', uid),
    orderBy('createdAt', 'desc'),
    limit(60)
  );
  return onSnapshot(
    q,
    (snap) => {
      const items: AiMemoryEntry[] = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          ownerId: data.ownerId,
          coin: data.coin,
          regime: data.regime,
          outcome: data.outcome,
          pnlUsd: Number(data.pnlUsd || 0),
          lesson: data.lesson,
          createdAtMs: data.createdAt?.toMillis?.() ?? Date.now(),
        };
      });
      onData(items);
    },
    (error) => handleFirestoreError(error, OperationType.LIST, path)
  );
}

export async function appendAiMemory(
  uid: string,
  memory: Omit<AiMemoryEntry, 'id' | 'ownerId' | 'createdAtMs'>
) {
  const path = `users/${uid}/ai_memory`;
  try {
    await addDoc(collection(db, 'users', uid, 'ai_memory'), {
      ownerId: uid,
      coin: memory.coin.slice(0, 32),
      regime: memory.regime.slice(0, 64),
      outcome: memory.outcome,
      pnlUsd: memory.pnlUsd,
      lesson: memory.lesson.slice(0, 800),
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export function subscribeChatMessages(
  uid: string,
  onData: (messages: ChatMessageEntry[]) => void
): Unsubscribe {
  const path = `users/${uid}/chat_messages`;
  const q = query(
    collection(db, 'users', uid, 'chat_messages'),
    where('ownerId', '==', uid),
    orderBy('createdAt', 'asc'),
    limit(60)
  );
  return onSnapshot(
    q,
    (snap) => {
      const items: ChatMessageEntry[] = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          ownerId: data.ownerId,
          role: data.role,
          content: data.content,
          modelUsed: data.modelUsed,
          createdAtMs: data.createdAt?.toMillis?.() ?? Date.now(),
        };
      });
      onData(items);
    },
    (error) => handleFirestoreError(error, OperationType.LIST, path)
  );
}

export async function appendChatMessage(
  uid: string,
  msg: Omit<ChatMessageEntry, 'id' | 'ownerId' | 'createdAtMs'>
) {
  const path = `users/${uid}/chat_messages`;
  try {
    await addDoc(collection(db, 'users', uid, 'chat_messages'), {
      ownerId: uid,
      role: msg.role,
      content: msg.content.slice(0, 8000),
      modelUsed: msg.modelUsed.slice(0, 64),
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function syncStrategyPlaybook(uid: string) {
  for (const item of DEFAULT_STRATEGY_PLAYBOOK) {
    const path = `users/${uid}/strategy_playbook/${item.strategyId}`;
    const ref = doc(db, 'users', uid, 'strategy_playbook', item.strategyId);
    try {
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        await setDoc(ref, {
          ownerId: uid,
          strategyId: item.strategyId,
          name: item.name.slice(0, 100),
          category: item.category,
          preferredRegimes: item.preferredRegimes.slice(0, 180),
          entryRule: item.entryRule.slice(0, 400),
          positionManagementGuide: item.positionManagementGuide.slice(0, 400),
          weight: item.weight,
          wins: 0,
          losses: 0,
          totalPnlUsd: 0,
          enabled: item.enabled,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, path);
    }
  }
}

export function subscribeStrategyPlaybook(
  uid: string,
  onData: (items: StrategyPlaybookItem[]) => void
): Unsubscribe {
  const path = `users/${uid}/strategy_playbook`;
  const q = query(
    collection(db, 'users', uid, 'strategy_playbook'),
    where('ownerId', '==', uid),
    limit(40)
  );
  return onSnapshot(
    q,
    (snap) => {
      const items: StrategyPlaybookItem[] = snap.docs.map((d) => {
        const data = d.data();
        return {
          strategyId: data.strategyId || d.id,
          ownerId: data.ownerId,
          name: data.name,
          category: data.category,
          preferredRegimes: data.preferredRegimes,
          entryRule: data.entryRule,
          positionManagementGuide: data.positionManagementGuide,
          weight: Number(data.weight ?? 1),
          wins: Number(data.wins ?? 0),
          losses: Number(data.losses ?? 0),
          totalPnlUsd: Number(data.totalPnlUsd ?? 0),
          enabled: data.enabled !== false,
          updatedAtMs: data.updatedAt?.toMillis?.() ?? Date.now(),
        };
      });
      onData(items);
    },
    (error) => handleFirestoreError(error, OperationType.LIST, path)
  );
}

export async function recordStrategyTradeOutcome(
  uid: string,
  strategyIds: string[],
  pnlUsd: number
) {
  const uniqueIds = Array.from(new Set(strategyIds.filter(Boolean)));
  const isWin = pnlUsd > 0.05;
  const isLoss = pnlUsd < -0.05;

  for (const strategyId of uniqueIds) {
    const path = `users/${uid}/strategy_playbook/${strategyId}`;
    const ref = doc(db, 'users', uid, 'strategy_playbook', strategyId);
    try {
      const snap = await getDoc(ref);
      if (!snap.exists()) continue;
      const d = snap.data();
      const prevWeight = Number(d.weight ?? 1.0);
      const delta = isWin ? 0.08 : isLoss ? -0.09 : 0;
      const nextWeight = Number(Math.max(0.3, Math.min(2.5, prevWeight + delta)).toFixed(2));
      await updateDoc(ref, {
        wins: Number(d.wins ?? 0) + (isWin ? 1 : 0),
        losses: Number(d.losses ?? 0) + (isLoss ? 1 : 0),
        totalPnlUsd: Number((Number(d.totalPnlUsd ?? 0) + pnlUsd).toFixed(4)),
        weight: nextWeight,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
    }
  }
}

export async function toggleStrategyPlaybookItem(
  uid: string,
  strategyId: string,
  enabled: boolean
) {
  const path = `users/${uid}/strategy_playbook/${strategyId}`;
  try {
    await updateDoc(doc(db, 'users', uid, 'strategy_playbook', strategyId), {
      enabled,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

