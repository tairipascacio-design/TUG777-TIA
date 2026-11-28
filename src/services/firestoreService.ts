import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
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
import { memoryFingerprint, positionFingerprint } from './localArchive';
import type {
  AiMemoryEntry,
  BiasLockMode,
  BotConfigData,
  ChatMessageEntry,
  PersistedPosition,
  StrategyPlaybookItem,
  TradeLogEntry,
} from '../types/trading';
import {
  DEFAULT_STRATEGY_PLAYBOOK,
  MIN_ATTRIBUTABLE_TRADES,
  computeCalibratedStrategyWeight,
} from './strategyEngine';

const ATTRIBUTED_TRADE_IDS_KEY = 'tug777_attributed_trade_ids_v1';
const attributedTradeIdsMem = new Set<string>();

function loadAttributedTradeIds(): Set<string> {
  if (attributedTradeIdsMem.size > 0) return attributedTradeIdsMem;
  if (typeof window === 'undefined') return attributedTradeIdsMem;
  try {
    const raw = localStorage.getItem(ATTRIBUTED_TRADE_IDS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const id of parsed) {
          if (typeof id === 'string') attributedTradeIdsMem.add(id);
        }
      }
    }
  } catch {
    // ignore storage errors
  }
  return attributedTradeIdsMem;
}

function markTradeIdAttributed(tradeId: string) {
  const set = loadAttributedTradeIds();
  set.add(tradeId);
  if (typeof window === 'undefined') return;
  try {
    const trimmed = Array.from(set).slice(-500);
    localStorage.setItem(ATTRIBUTED_TRADE_IDS_KEY, JSON.stringify(trimmed));
  } catch {
    // ignore storage errors
  }
}

export const DEFAULT_CONFIG = (uid: string): BotConfigData => ({
  ownerId: uid,
  mode: 'strategy_ai',
  aiEnabled: false,
  network: 'mainnet',
  masterWalletAddress: '',
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
  mcloudUrl: 'https://mcloud-1036926196544.us-east1.run.app',
});

function sanitizeBiasLock(val: unknown): BiasLockMode {
  if (val === 'SOLO_LONG' || val === 'SOLO_SHORT' || val === 'PAUSA') return val;
  return 'AMBOS';
}

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
    const defaults = DEFAULT_CONFIG(user.uid);
    if (!cfgSnap.exists()) {
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
      mode: d.mode || defaults.mode,
      aiEnabled: Boolean(d.aiEnabled),
      network: d.network || defaults.network,
      masterWalletAddress: d.masterWalletAddress || '',
      mevShieldEnabled: d.mevShieldEnabled !== false,
      maxSlippageBps: Number(d.maxSlippageBps ?? defaults.maxSlippageBps),
      maxOracleDeviationBps: Number(d.maxOracleDeviationBps ?? defaults.maxOracleDeviationBps),
      riskPerTradeUsd: Number(d.riskPerTradeUsd ?? defaults.riskPerTradeUsd),
      soundEnabled: d.soundEnabled !== false,
      aiProvider: d.aiProvider === 'custom_ai' ? 'custom_ai' : 'gemini',
      customAiUrl: d.customAiUrl || '',
      customAiModel: d.customAiModel || '',
      customSystemPrompt: d.customSystemPrompt || '',
      scanIntervalSec: Number(d.scanIntervalSec ?? defaults.scanIntervalSec),
      minConfidence: Number(d.minConfidence ?? defaults.minConfidence),
      minQuantScore: Number(d.minQuantScore ?? defaults.minQuantScore),
      minVolumeM: Number(d.minVolumeM ?? defaults.minVolumeM),
      tpPct: Number(d.tpPct ?? defaults.tpPct),
      slPct: Number(d.slPct ?? defaults.slPct),
      useDeepThinking: Boolean(d.useDeepThinking),
      useSearchGrounding: Boolean(d.useSearchGrounding),
      sizingMode: d.sizingMode === 'fixed_usd' ? 'fixed_usd' : 'equity_pct',
      capitalPctPerTrade: Number(d.capitalPctPerTrade ?? defaults.capitalPctPerTrade),
      maxOpenPositions: Number(d.maxOpenPositions ?? defaults.maxOpenPositions),
      leverage: Number(d.leverage ?? defaults.leverage ?? 10),
      trailingStopEnabled: d.trailingStopEnabled !== false,
      autoManagePositions: d.autoManagePositions !== false,
      riskPerTradePct: Number(d.riskPerTradePct ?? defaults.riskPerTradePct),
      dailyMaxLossPct: Number(d.dailyMaxLossPct ?? defaults.dailyMaxLossPct),
      killSwitchEnabled: Boolean(d.killSwitchEnabled),
      geminiModel: typeof d.geminiModel === 'string' && d.geminiModel.trim() ? d.geminiModel.trim() : 'auto',
      globalBiasLock: sanitizeBiasLock(d.globalBiasLock),
      pairBiasLocksJson: typeof d.pairBiasLocksJson === 'string' ? d.pairBiasLocksJson : '{}',
      useAloEntries: Boolean(d.useAloEntries),
      minOrderUsdFloor: Number(d.minOrderUsdFloor ?? defaults.minOrderUsdFloor),
      streakCooldownHours: Number(d.streakCooldownHours ?? defaults.streakCooldownHours),
      watchlistCoinsCsv:
        typeof d.watchlistCoinsCsv === 'string' && d.watchlistCoinsCsv.trim()
          ? d.watchlistCoinsCsv.trim()
          : defaults.watchlistCoinsCsv,
      mcloudEnabled: d.mcloudEnabled !== false,
      mcloudUrl:
        typeof d.mcloudUrl === 'string' && d.mcloudUrl.trim()
          ? d.mcloudUrl.trim()
          : defaults.mcloudUrl,
    };
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, configPath);
  }
}

export async function saveBotConfig(uid: string, patch: Partial<BotConfigData>) {
  const path = `users/${uid}/bot_configs/default`;
  const ref = doc(db, 'users', uid, 'bot_configs', 'default');

  const { ownerId: _ignoredOwner, ...rest } = patch;
  const sanitized: Record<string, unknown> = {};

  const allowedKeys: Array<keyof Omit<BotConfigData, 'ownerId'>> = [
    'mode',
    'aiEnabled',
    'network',
    'masterWalletAddress',
    'mevShieldEnabled',
    'maxSlippageBps',
    'maxOracleDeviationBps',
    'riskPerTradeUsd',
    'soundEnabled',
    'aiProvider',
    'customAiUrl',
    'customAiModel',
    'customSystemPrompt',
    'scanIntervalSec',
    'minConfidence',
    'minQuantScore',
    'minVolumeM',
    'tpPct',
    'slPct',
    'useDeepThinking',
    'useSearchGrounding',
    'sizingMode',
    'capitalPctPerTrade',
    'maxOpenPositions',
    'leverage',
    'trailingStopEnabled',
    'autoManagePositions',
    'riskPerTradePct',
    'dailyMaxLossPct',
    'killSwitchEnabled',
    'geminiModel',
    'globalBiasLock',
    'pairBiasLocksJson',
    'useAloEntries',
    'minOrderUsdFloor',
    'streakCooldownHours',
    'watchlistCoinsCsv',
    'mcloudEnabled',
    'mcloudUrl',
  ];

  for (const k of allowedKeys) {
    if (k in rest && rest[k] !== undefined) {
      sanitized[k] = rest[k];
    }
  }

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
    sanitized.scanIntervalSec = Math.max(15, Math.min(3600, sanitized.scanIntervalSec));
  }
  if (typeof sanitized.minConfidence === 'number') {
    sanitized.minConfidence = Math.max(35, Math.min(99, sanitized.minConfidence));
  }
  if (typeof sanitized.minQuantScore === 'number') {
    sanitized.minQuantScore = Math.max(20, Math.min(95, sanitized.minQuantScore));
  }
  if (typeof sanitized.minVolumeM === 'number') {
    sanitized.minVolumeM = Math.max(0.1, Math.min(500, sanitized.minVolumeM));
  }
  if (typeof sanitized.tpPct === 'number') {
    sanitized.tpPct = Math.max(0.2, Math.min(200, sanitized.tpPct));
  }
  if (typeof sanitized.slPct === 'number') {
    sanitized.slPct = Math.max(0.05, Math.min(50, sanitized.slPct));
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
  if (typeof sanitized.leverage === 'number') {
    sanitized.leverage = Math.max(1, Math.min(100, Math.round(sanitized.leverage)));
  }
  if (typeof sanitized.riskPerTradePct === 'number') {
    sanitized.riskPerTradePct = Math.max(0.05, Math.min(25, sanitized.riskPerTradePct));
  }
  if (typeof sanitized.dailyMaxLossPct === 'number') {
    sanitized.dailyMaxLossPct = Math.max(0.1, Math.min(100, sanitized.dailyMaxLossPct));
  }
  if (typeof sanitized.geminiModel === 'string') {
    sanitized.geminiModel = (sanitized.geminiModel || 'auto').slice(0, 120);
  }
  if ('globalBiasLock' in sanitized) {
    sanitized.globalBiasLock = sanitizeBiasLock(sanitized.globalBiasLock);
  }
  if (typeof sanitized.pairBiasLocksJson === 'string') {
    sanitized.pairBiasLocksJson = sanitized.pairBiasLocksJson.slice(0, 1000);
  }
  if (typeof sanitized.minOrderUsdFloor === 'number') {
    sanitized.minOrderUsdFloor = Math.max(0, Math.min(1000, sanitized.minOrderUsdFloor));
  }
  if (typeof sanitized.streakCooldownHours === 'number') {
    sanitized.streakCooldownHours = Math.max(0.5, Math.min(72, sanitized.streakCooldownHours));
  }
  if (typeof sanitized.watchlistCoinsCsv === 'string') {
    sanitized.watchlistCoinsCsv = sanitized.watchlistCoinsCsv.slice(0, 500);
  }
  if (typeof sanitized.mcloudUrl === 'string') {
    sanitized.mcloudUrl = sanitized.mcloudUrl.slice(0, 256);
  }

  if (Object.keys(sanitized).length === 0) return;

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
    limit(500)
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
          cloid: data.cloid || '',
          isExternal: Boolean(data.isExternal),
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
      ...(pos.cloid ? { cloid: pos.cloid.slice(0, 72) } : {}),
      ...(typeof pos.isExternal === 'boolean' ? { isExternal: pos.isExternal } : {}),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return ref.id;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function updateOpenPersistedPositionSize(
  uid: string,
  positionId: string,
  remainingSize: number,
  markPx: number,
  unrealizedPnl: number
) {
  const path = `users/${uid}/positions/${positionId}`;
  try {
    await updateDoc(doc(db, 'users', uid, 'positions', positionId), {
      size: Math.max(0, remainingSize),
      markPx,
      unrealizedPnl,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
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
    limit(300)
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
    limit(500)
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
    limit(150)
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
          weight: 1.0,
          wins: 0,
          losses: 0,
          totalPnlUsd: 0,
          enabled: item.enabled,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else {
        const d = snap.data();
        const totalTrades = Number(d.wins ?? 0) + Number(d.losses ?? 0);
        const totalPnlUsd = Number(d.totalPnlUsd ?? 0);
        const curWeight = Number(d.weight ?? 1.0);
        if (totalTrades < MIN_ATTRIBUTABLE_TRADES && curWeight !== 1.0) {
          await updateDoc(ref, {
            weight: 1.0,
            updatedAt: serverTimestamp(),
          });
        } else if (totalPnlUsd < 0 && curWeight > 1.0) {
          await updateDoc(ref, {
            weight: 1.0,
            updatedAt: serverTimestamp(),
          });
        }
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
      const byStrategyId = new Map<string, StrategyPlaybookItem>();
      for (const d of snap.docs) {
        const data = d.data();
        const sid = String(data.strategyId || d.id || '').trim();
        if (!sid) continue;
        const item: StrategyPlaybookItem = {
          strategyId: sid,
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
        const prev = byStrategyId.get(sid);
        if (!prev || d.id === sid || item.wins + item.losses >= prev.wins + prev.losses) {
          byStrategyId.set(sid, item);
        }
      }
      onData(Array.from(byStrategyId.values()));
    },
    (error) => handleFirestoreError(error, OperationType.LIST, path)
  );
}

// Attribution strictly deduplicated by tradeId and proportional (pnlUsd / uniqueIds.length) — never duplicates 100% of losses across all strategies!
export async function recordStrategyTradeOutcome(
  uid: string,
  strategyIds: string[],
  pnlUsd: number,
  tradeId?: string
) {
  const uniqueIds = Array.from(new Set(strategyIds.filter(Boolean)));
  if (uniqueIds.length === 0) return;

  const dedupKey = tradeId ? `${uid}:${tradeId}` : '';
  if (dedupKey && loadAttributedTradeIds().has(dedupKey)) {
    return;
  }
  if (dedupKey) {
    markTradeIdAttributed(dedupKey);
  }

  const pnlShare = pnlUsd / uniqueIds.length;
  const isWin = pnlUsd > 0.05;
  const isLoss = pnlUsd < -0.05;

  for (const strategyId of uniqueIds) {
    const path = `users/${uid}/strategy_playbook/${strategyId}`;
    const ref = doc(db, 'users', uid, 'strategy_playbook', strategyId);
    try {
      const snap = await getDoc(ref);
      if (!snap.exists()) continue;
      const d = snap.data();
      const nextWins = Number(d.wins ?? 0) + (isWin ? 1 : 0);
      const nextLosses = Number(d.losses ?? 0) + (isLoss ? 1 : 0);
      const nextTotalPnl = Number((Number(d.totalPnlUsd ?? 0) + pnlShare).toFixed(4));
      const nextWeight = computeCalibratedStrategyWeight({
        wins: nextWins,
        losses: nextLosses,
        totalPnlUsd: nextTotalPnl,
      });
      await updateDoc(ref, {
        wins: nextWins,
        losses: nextLosses,
        totalPnlUsd: nextTotalPnl,
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
  return updateStrategyPlaybookItem(uid, strategyId, { enabled });
}

export async function updateStrategyPlaybookItem(
  uid: string,
  strategyId: string,
  patch: { enabled?: boolean; weight?: number }
) {
  const path = `users/${uid}/strategy_playbook/${strategyId}`;
  const updateFields: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
  };
  if (typeof patch.enabled === 'boolean') {
    updateFields.enabled = patch.enabled;
  }
  if (typeof patch.weight === 'number' && Number.isFinite(patch.weight)) {
    updateFields.weight = Number(Math.max(0.3, Math.min(2.5, patch.weight)).toFixed(2));
  }
  try {
    await updateDoc(doc(db, 'users', uid, 'strategy_playbook', strategyId), updateFields);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function backfillLocalArchiveToFirestore(
  uid: string,
  localPositions: PersistedPosition[],
  localMemories: AiMemoryEntry[]
): Promise<{ addedPositions: number; addedMemories: number }> {
  let addedPositions = 0;
  let addedMemories = 0;

  const unsyncedPositions = localPositions.filter((p) => p.id.startsWith('local-'));
  if (unsyncedPositions.length > 0) {
    const posPath = `users/${uid}/positions`;
    try {
      const snap = await getDocs(
        query(collection(db, 'users', uid, 'positions'), where('ownerId', '==', uid), limit(500))
      );
      const existingFps = new Set(
        snap.docs.map((d) => {
          const data = d.data();
          return positionFingerprint({
            coin: String(data.coin || ''),
            side: (data.side === 'SHORT' ? 'SHORT' : 'LONG') as 'LONG' | 'SHORT',
            hlOrderId: String(data.hlOrderId || ''),
            entryPx: Number(data.entryPx || 0),
            status: (data.status === 'CLOSED' ? 'CLOSED' : 'OPEN') as 'OPEN' | 'CLOSED',
          });
        })
      );

      for (const p of unsyncedPositions) {
        const fp = positionFingerprint(p);
        if (existingFps.has(fp)) continue;
        await createPersistedPosition(uid, {
          coin: p.coin,
          side: p.side,
          size: p.size,
          entryPx: p.entryPx,
          markPx: p.markPx,
          leverage: p.leverage,
          unrealizedPnl: p.unrealizedPnl,
          realizedPnl: p.realizedPnl,
          status: p.status,
          mode: p.mode,
          hlOrderId: p.hlOrderId,
          thesis: p.thesis,
          strategyTag: p.strategyTag || '',
          ...(p.cloid ? { cloid: p.cloid } : {}),
          ...(typeof p.isExternal === 'boolean' ? { isExternal: p.isExternal } : {}),
        });
        existingFps.add(fp);
        addedPositions += 1;
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, posPath);
    }
  }

  const unsyncedMemories = localMemories.filter(
    (m) => m.id.startsWith('local-') || m.id.startsWith('hist-')
  );
  if (unsyncedMemories.length > 0) {
    const memPath = `users/${uid}/ai_memory`;
    try {
      const snap = await getDocs(
        query(collection(db, 'users', uid, 'ai_memory'), where('ownerId', '==', uid), limit(500))
      );
      const existingFps = new Set(
        snap.docs.map((d) => {
          const data = d.data();
          return memoryFingerprint({
            coin: String(data.coin || ''),
            regime: String(data.regime || ''),
            outcome: (data.outcome || 'BREAKEVEN') as 'WIN' | 'LOSS' | 'BREAKEVEN',
            lesson: String(data.lesson || ''),
          });
        })
      );

      for (const m of unsyncedMemories) {
        const fp = memoryFingerprint(m);
        if (existingFps.has(fp)) continue;
        await appendAiMemory(uid, {
          coin: m.coin,
          regime: m.regime,
          outcome: m.outcome,
          pnlUsd: m.pnlUsd,
          lesson: m.lesson,
        });
        existingFps.add(fp);
        addedMemories += 1;
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, memPath);
    }
  }

  return { addedPositions, addedMemories };
}
