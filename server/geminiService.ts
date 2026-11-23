import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

function getAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY no configurada en el entorno del servidor.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function getDecisionsAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY no configurada en el entorno del servidor.');
  }
  return new GoogleGenAI({
    apiKey,
    apiVersion: 'v1beta',
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export interface FreeGeminiModelInfo {
  id: string;
  label: string;
  tier: 'FREE';
  apiMethod: 'generateContent' | 'decisions.create';
  supportsJsonSchema: boolean;
  supportsSearchGrounding: boolean;
  supportsThinkingLevel: boolean;
  defaultThinking: string;
  description: string;
  discoveredInApi?: boolean;
}

const DEPRECATED_PROHIBITED_MODELS = new Set([
  'gemini-1.5-flash',
  'gemini-1.5-pro',
  'gemini-pro',
  'gemini-2.0-flash',
  'gemini-2.0-pro',
  'gemini-2.0-flash-thinking',
]);

const PAID_ONLY_MODELS = new Set([
  'gemini-4-carbon',
  'gemini-4-neon',
  'gemini-4-argon',
  'gemini-3-pro-image',
  'gemini-nano-banana-2.1',
  'gemini-3.1-flash-lite-image',
  'gemini-omni-1.2-flash',
  'lyria-3-clip-preview',
  'lyria-3-pro-preview',
]);

export const CORE_FREE_GEMINI_MODELS: FreeGeminiModelInfo[] = [
  {
    id: 'gemini-3.5-flash-lite',
    label: 'Gemini 3.5 Flash-Lite',
    tier: 'FREE',
    apiMethod: 'generateContent',
    supportsJsonSchema: true,
    supportsSearchGrounding: true,
    supportsThinkingLevel: true,
    defaultThinking: 'MINIMAL / AUTO',
    description: 'Gratis · Flash-Lite más rápido verificado (~1.0s), ideal para escaneo y JSON.',
  },
  {
    id: 'gemini-3.1-flash-lite',
    label: 'Gemini 3.1 Flash-Lite',
    tier: 'FREE',
    apiMethod: 'generateContent',
    supportsJsonSchema: true,
    supportsSearchGrounding: false,
    supportsThinkingLevel: true,
    defaultThinking: 'MINIMAL',
    description: 'Gratis · Respaldo ultra rápido de baja cuota para JSON y análisis.',
  },
  {
    id: 'gemini-3.8-flash',
    label: 'Gemini 3.8 Flash',
    tier: 'FREE',
    apiMethod: 'generateContent',
    supportsJsonSchema: true,
    supportsSearchGrounding: true,
    supportsThinkingLevel: true,
    defaultThinking: 'AUTO',
    description: 'Gratis · Flash de última generación con soporte Search Grounding.',
  },
  {
    id: 'gemini-4-hydrogen',
    label: 'Gemini 4 Hydrogen',
    tier: 'FREE',
    apiMethod: 'generateContent',
    supportsJsonSchema: true,
    supportsSearchGrounding: true,
    supportsThinkingLevel: true,
    defaultThinking: 'LOW / HIGH',
    description: 'Gratis · Razonamiento profundo Gemini 4 Flash + Google Search Grounding.',
  },
  {
    id: 'gemini-decision-1',
    label: 'Gemini Decision-1 (Decisions API)',
    tier: 'FREE',
    apiMethod: 'decisions.create',
    supportsJsonSchema: false,
    supportsSearchGrounding: false,
    supportsThinkingLevel: false,
    defaultThinking: 'N/A (v1beta)',
    description: 'Gratis · Clasificador probabilístico calibrado (~320ms, 0 tokens salida, v1beta).',
  },
];

let cachedFastestFreeModel: string | null = null;

function isProhibitedOrPaidModel(modelId: string): boolean {
  const clean = modelId.replace(/^models\//, '').trim();
  if (!clean) return true;
  if (DEPRECATED_PROHIBITED_MODELS.has(clean) || PAID_ONLY_MODELS.has(clean)) return true;
  if (clean.includes('1.5') || clean.includes('2.0') || clean.includes('2.5')) return true;
  if (
    clean.includes('image') ||
    clean.includes('lyria') ||
    clean.includes('omni') ||
    clean.includes('tts') ||
    clean.includes('transcribe') ||
    clean.includes('embedding') ||
    clean.includes('live')
  ) {
    return true;
  }
  return false;
}

export function resolveFreeGeminiModel(preferred?: string, deepThinking?: boolean): string {
  const clean = (preferred || '').replace(/^models\//, '').trim();
  if (clean && clean !== 'auto' && !isProhibitedOrPaidModel(clean)) {
    return clean;
  }
  if (deepThinking) return 'gemini-4-hydrogen';
  return cachedFastestFreeModel || 'gemini-3.5-flash-lite';
}

function getOrderedFreeTextChain(preferredModel: string): string[] {
  const base = [
    preferredModel === 'gemini-decision-1' ? cachedFastestFreeModel || 'gemini-3.5-flash-lite' : preferredModel,
    cachedFastestFreeModel || '',
    'gemini-3.5-flash-lite',
    'gemini-3.1-flash-lite',
    'gemini-3.8-flash',
    'gemini-3.5-flash',
    'gemini-4-hydrogen',
  ];
  return Array.from(new Set(base.filter((id) => id && !isProhibitedOrPaidModel(id))));
}

function buildGenerateConfigForModel(
  modelId: string,
  baseConfig: Record<string, unknown>,
  deepThinking: boolean
): Record<string, unknown> {
  const cfg = { ...baseConfig };
  if (modelId === 'gemini-4-hydrogen') {
    cfg.thinkingConfig = {
      thinkingLevel: deepThinking ? ThinkingLevel.HIGH : ThinkingLevel.LOW,
    };
  } else if (modelId.startsWith('gemini-3')) {
    if (modelId.includes('lite')) {
      cfg.thinkingConfig = {
        thinkingLevel: deepThinking ? ThinkingLevel.MEDIUM : ThinkingLevel.MINIMAL,
      };
    } else {
      cfg.thinkingConfig = {
        thinkingLevel: deepThinking ? ThinkingLevel.MEDIUM : ThinkingLevel.LOW,
      };
    }
  }
  return cfg;
}

export async function listAvailableFreeGeminiModels(): Promise<{
  models: FreeGeminiModelInfo[];
  apiConfigured: boolean;
  discoveredCount: number;
  listError?: string;
}> {
  const resultMap = new Map<string, FreeGeminiModelInfo>();
  for (const m of CORE_FREE_GEMINI_MODELS) {
    resultMap.set(m.id, { ...m, discoveredInApi: false });
  }

  if (!process.env.GEMINI_API_KEY) {
    return {
      models: Array.from(resultMap.values()),
      apiConfigured: false,
      discoveredCount: 0,
      listError: 'GEMINI_API_KEY no configurada en el entorno del servidor.',
    };
  }

  try {
    const ai = getAiClient();
    const pager = await ai.models.list();
    let discoveredCount = 0;
    for await (const raw of pager) {
      const id = (raw.name || '').replace(/^models\//, '').trim();
      if (!id || isProhibitedOrPaidModel(id)) continue;
      const actions = raw.supportedActions || [];
      if (!actions.includes('generateContent')) continue;
      // Only expose known free/flash/lite text models from live discovery
      const lower = id.toLowerCase();
      if (!lower.includes('flash') && !lower.includes('hydrogen') && !lower.includes('lite')) {
        continue;
      }
      discoveredCount += 1;
      const existing = resultMap.get(id);
      if (existing) {
        existing.discoveredInApi = true;
      } else {
        resultMap.set(id, {
          id,
          label: raw.displayName || id,
          tier: 'FREE',
          apiMethod: 'generateContent',
          supportsJsonSchema: true,
          supportsSearchGrounding: lower.includes('flash') || lower.includes('hydrogen'),
          supportsThinkingLevel: lower.includes('3') || lower.includes('4'),
          defaultThinking: 'AUTO',
          description: `Gratis (descubierto en vivo vía @google/genai · ${raw.displayName || id})`,
          discoveredInApi: true,
        });
      }
      if (resultMap.size >= 12) break;
    }
    return {
      models: Array.from(resultMap.values()),
      apiConfigured: true,
      discoveredCount,
    };
  } catch (err) {
    return {
      models: Array.from(resultMap.values()),
      apiConfigured: true,
      discoveredCount: 0,
      listError: err instanceof Error ? err.message : String(err),
    };
  }
}

export interface FreeGeminiModelTestResult {
  id: string;
  label: string;
  apiMethod: 'generateContent' | 'decisions.create';
  ok: boolean;
  statusCode: number;
  latencyMs: number;
  detail: string;
}

export async function benchmarkAndVerifyFreeGeminiModels(
  targetModelIds?: string[]
): Promise<{
  testedAt: number;
  results: FreeGeminiModelTestResult[];
  fastestWorkingModel: string | null;
  workingCount: number;
}> {
  const catalog = await listAvailableFreeGeminiModels();
  const candidates =
    Array.isArray(targetModelIds) && targetModelIds.length > 0
      ? catalog.models.filter((m) => targetModelIds.includes(m.id))
      : catalog.models;

  const ai = getAiClient();
  const decisionsAi = getDecisionsAiClient();

  const withTimeout = <T>(promise: Promise<T>, timeoutMs = 12000): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`408 TIMEOUT (${timeoutMs} ms)`)), timeoutMs);
      promise.then(
        (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        (err) => {
          clearTimeout(timer);
          reject(err);
        }
      );
    });

  const results: FreeGeminiModelTestResult[] = await Promise.all(
    candidates.map(async (m) => {
      const t0 = performance.now();
      try {
        if (m.apiMethod === 'decisions.create') {
          const dec = await withTimeout(
            decisionsAi.decisions.create({
              model: 'gemini-decision-1',
              input: JSON.stringify({
                coin: 'BTC',
                score: 74,
                regime: 'TRENDING_BULL',
                strategies: ['EMA_RIBBON_PULLBACK', 'LIQUIDITY_SWEEP_REJECTION'],
              }),
              questions: {
                market_bias: {
                  type: 'choice',
                  instructions: 'Select the best trading action given the quantitative setup.',
                  criteria: {
                    HOLD: 'Insufficient confluence or high chop risk.',
                    LONG: 'Bullish confluence with aligned strategies.',
                    SHORT: 'Bearish confluence with aligned strategies.',
                  },
                },
              },
            }),
            12000
          );
          const ms = Math.round(performance.now() - t0);
          const ans = dec.answers?.market_bias;
          if (!ans || ans.type !== 'choice') {
            return {
              id: m.id,
              label: m.label,
              apiMethod: m.apiMethod,
              ok: false,
              statusCode: 500,
              latencyMs: ms,
              detail: 'Decisions API respondió sin answers.',
            };
          }
          return {
            id: m.id,
            label: m.label,
            apiMethod: m.apiMethod,
            ok: true,
            statusCode: 200,
            latencyMs: ms,
            detail: `OK · choice=${ans.choice} (conf ${(ans.confidence * 100).toFixed(1)}%) · 0 tokens salida`,
          };
        }

        const cfg = buildGenerateConfigForModel(
          m.id,
          {
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                status: { type: Type.STRING },
                bias: { type: Type.STRING },
              },
              required: ['status', 'bias'],
            },
          },
          false
        );

        const resp = await withTimeout(
          ai.models.generateContent({
            model: m.id,
            contents: 'Responde JSON: {"status":"OK","bias":"LONG"} para validar BTC.',
            config: cfg,
          }),
          12000
        );
        const ms = Math.round(performance.now() - t0);
        const text = (resp.text ?? '').trim();
        const parsed = JSON.parse(text) as { status?: string; bias?: string };
        return {
          id: m.id,
          label: m.label,
          apiMethod: m.apiMethod,
          ok: Boolean(parsed.status),
          statusCode: 200,
          latencyMs: ms,
          detail: `OK · JSON ${JSON.stringify(parsed)}`,
        };
      } catch (err) {
        const ms = Math.round(performance.now() - t0);
        const raw = err instanceof Error ? err.message : String(err);
        const statusCode =
          raw.includes('429') || raw.includes('RESOURCE_EXHAUSTED')
            ? 429
            : raw.includes('503') || raw.includes('UNAVAILABLE')
            ? 503
            : raw.includes('408') || raw.includes('TIMEOUT')
            ? 408
            : raw.includes('404') || raw.includes('NOT_FOUND')
            ? 404
            : raw.includes('403') || raw.includes('PERMISSION_DENIED')
            ? 403
            : raw.includes('400')
            ? 400
            : 500;
        return {
          id: m.id,
          label: m.label,
          apiMethod: m.apiMethod,
          ok: false,
          statusCode,
          latencyMs: ms,
          detail: raw.slice(0, 220),
        };
      }
    })
  );

  const workingTextModels = results
    .filter((r) => r.ok && r.apiMethod === 'generateContent')
    .sort((a, b) => a.latencyMs - b.latencyMs);

  const fastest = workingTextModels[0]?.id ?? null;
  if (fastest) {
    cachedFastestFreeModel = fastest;
  }

  return {
    testedAt: Date.now(),
    results,
    fastestWorkingModel: fastest ?? results.find((r) => r.ok)?.id ?? null,
    workingCount: results.filter((r) => r.ok).length,
  };
}

export interface MarketCandidate {
  coin: string;
  markPx: number;
  oraclePx: number;
  prevDayPx: number;
  change24hPct: number;
  fundingRate: number;
  annualizedFundingPct: number;
  openInterestUsd: number;
  dayNtlVlm: number;
  maxLeverage: number;
  quantScore: number;
  quantBias: 'LONG' | 'SHORT' | 'NEUTRAL';
  quantSignals: string[];
}

export interface LearnedMemoryItem {
  coin: string;
  regime: string;
  outcome: 'WIN' | 'LOSS' | 'BREAKEVEN';
  pnlUsd: number;
  lesson: string;
}

function isQuotaError(err: unknown): boolean {
  const s = err instanceof Error ? err.message : String(err);
  return s.includes('429') || s.includes('RESOURCE_EXHAUSTED') || s.toLowerCase().includes('quota');
}

async function callCustomOpenAiCompatible(params: {
  endpointUrl: string;
  model: string;
  systemPrompt: string;
  userContent: string;
  expectJson?: boolean;
}) {
  const baseUrl = (params.endpointUrl || process.env.CUSTOM_AI_BASE_URL || '').trim().replace(/\/$/, '');
  if (!baseUrl) {
    throw new Error(
      'Falta la URL de tu IA externa (ej. http://127.0.0.1:11434/v1/chat/completions o CUSTOM_AI_BASE_URL en .env).'
    );
  }
  const targetUrl = baseUrl.endsWith('/chat/completions') ? baseUrl : `${baseUrl}/chat/completions`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const serverKey = process.env.CUSTOM_AI_API_KEY?.trim();
  if (serverKey) {
    headers.Authorization = `Bearer ${serverKey}`;
  }

  const res = await fetch(targetUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: params.model || process.env.CUSTOM_AI_MODEL || 'deepseek-chat',
      messages: [
        { role: 'system', content: params.systemPrompt },
        { role: 'user', content: params.userContent },
      ],
      ...(params.expectJson ? { response_format: { type: 'json_object' } } : {}),
      temperature: 0.2,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Error de IA Externa (${res.status}): ${errText.slice(0, 260)}`);
  }

  const json = await res.json();
  const content: string = json?.choices?.[0]?.message?.content ?? '';
  return {
    text: content,
    modelUsed: `BYO-AI (${params.model || process.env.CUSTOM_AI_MODEL || 'custom'})`,
  };
}

export interface DeepAnalysisPayload {
  coin: string;
  markPx: number;
  regime: string;
  direction: 'LONG' | 'SHORT' | 'NEUTRAL';
  unifiedScore: number;
  confidence: number;
  decisionBand?: 'NO_OPERAR' | 'ESPERAR_CONFIRMACION' | 'SENAL_VALIDA' | 'CONFLUENCIA_ALTA';
  firedStrategies: string[];
  rsi14: number;
  adx14?: number;
  cvdSlope?: number;
  vpPocPx?: number;
  smcBias?: 'BULL_BOS' | 'BEAR_BOS' | 'BULL_CHOCH' | 'BEAR_CHOCH' | 'NEUTRAL';
  atrPct: number;
  vwapDistPct: number;
  bbWidthPct: number;
  l2Imbalance: number;
  spreadBps: number;
  recommendedSlPct: number;
  recommendedTpPct: number;
  tp1Pct?: number;
  tp2Pct?: number;
  tp3Pct?: number;
  rrRatio?: number;
  antiChaseBlocked: boolean;
  sweepDirection?: 'LONG_SWEEP' | 'SHORT_SWEEP' | 'NONE';
  trapWarnings?: string[];
  reasons: string[];
}

export interface PlaybookSummaryItem {
  strategyId: string;
  name: string;
  category: string;
  preferredRegimes: string;
  weight: number;
  wins: number;
  losses: number;
  totalPnlUsd: number;
  enabled: boolean;
}

export interface DbClosedHistoryPayload {
  totalDbClosed: number;
  dbWinRatePct: number;
  dbNetPnlUsd: number;
  consecutiveRecentLosses: number;
  coinStats: Array<{
    coin: string;
    trades: number;
    wins: number;
    losses: number;
    netPnlUsd: number;
    lastClosedAtMs: number;
    lastOutcome: 'WIN' | 'LOSS' | 'BREAKEVEN';
  }>;
  topStrategies: Array<{
    strategyId: string;
    weight: number;
    wins: number;
    losses: number;
    winRatePct: number;
    totalPnlUsd: number;
    enabled: boolean;
  }>;
}

export async function analyzeMarketWithBrain(params: {
  mode: 'strategy' | 'ai' | 'strategy_ai';
  candidates: MarketCandidate[];
  deepAnalyses?: DeepAnalysisPayload[];
  playbook?: PlaybookSummaryItem[];
  positionGuide?: string[];
  dbClosedHistory?: DbClosedHistoryPayload;
  fillsSummary?: {
    totalClosed: number;
    winRatePct: number;
    netPnlUsd: number;
    totalFeesUsd: number;
    losingCoins: Array<{ coin: string; netPnl?: number; pnl?: number; losses?: number }>;
    winningCoins: Array<{ coin: string; netPnl?: number; pnl?: number; wins?: number }>;
    recentClosed: Array<{ coin: string; netPnl?: number; pnl?: number; time: number }>;
  };
  memories: LearnedMemoryItem[];
  positiveEntryRules?: LearnedMemoryItem[];
  negativeNoEntryRules?: LearnedMemoryItem[];
  openPositions: Array<{
    coin: string;
    side: string;
    size?: number;
    entryPx?: number;
    unrealizedPnl: number;
    returnOnEquity?: number;
  }>;
  macroBrief?: string;
  deepThinking?: boolean;
  geminiModel?: string;
  aiProvider?: 'gemini' | 'custom_ai';
  customAiUrl?: string;
  customAiModel?: string;
  customSystemPrompt?: string;
  tpPct?: number;
  slPct?: number;
}) {
  const slPctVal = params.slPct ?? 0.85;
  const tpPctVal = params.tpPct ?? 3.5;
  const memoriesList = Array.isArray(params.memories) ? params.memories : [];
  const candidatesList = Array.isArray(params.candidates) ? params.candidates : [];
  const openPositionsList = Array.isArray(params.openPositions) ? params.openPositions : [];

  // Unified Trading Constitution synced across ALL models (Gemini / BYO-AI / Fallback) so model switching never loses rules or history
  const unifiedProtocolBlock = `PROTOCOLO UNIFICADO TUG777 (SINCRONIZADO PARA TODOS LOS MODELOS — PROHIBIDO IMPROVISAR):
1. REGLAS SEPARADAS DE ENTRADA ("positiveEntryRules" = CUÁNDO SÍ ENTRAR vs "negativeNoEntryRules" = CUÁNDO NO ENTRAR):
   - SÍ ENTRAR ("positiveEntryRules"): Prioriza setups, estrategias y tokens con ventaja positiva probada en historial real y Firestore.
   - NO ENTRAR ("negativeNoEntryRules"): BLOQUEA estrictamente los patrones perdedores, sobreoperación en tokens en pérdida, o condiciones marcadas en "NO_ENTRAR" salvo confluencia extrema A+ (>=3 estrategias).
2. BASE DE DATOS FIRESTORE ("dbClosedHistory", "strategyPlaybook"):
   - Respeta pesos ("weight") y estado activo ("enabled"). IMPORTANTE: estrategias con <5 operaciones atribuibles ("sampleStatus" != "DEMOSTRADO") NO tienen rendimiento demostrado; trátalas con peso neutro. Nunca uses estrategias con <35% win-rate en >=5 ops.
3. CAZA-BARRIDAS DE LIQUIDEZ & ESCUDO ANTI-MENTIRAS ("sweepDirection", "trapWarnings"):
   - SÍ APROVECHAR: Cuando detectes barrida real de stops con reclaim y absorción L2 ("LONG_SWEEP" o "SHORT_SWEEP"), entra a favor del giro mientras otros pierden.
   - NO CAER EN MENTIRA: Si "trapWarnings" marca RUPTURA FALSA, BARRIDA FALSA (cuchillo sin reclaim) o SOPORTE/RESISTENCIA FALSO, prohíbe entrar en la dirección de la trampa.
4. CALIDAD, BANDAS DE DECISIÓN Y PARÁMETROS ("positionManagementGuide"):
   - Bandas calibradas: 0–49 No Operar | 50–64 Esperar Confirmación | 65–79 Señal Válida | 80–100 Confluencia Alta. Nunca abras operación con score < 65 (o < 50 absolutamente prohibido).
   - Analiza EMA 9/21/50/200, ADX(14), CVD, Volume Profile (vpPocPx), SMC (smcBias BOS/CHoCH), flujo L2 y correlación BTC.
   - Exige >=2 estrategias independientes, bloquea RANGING_CHOP débil, respeta SL (${slPctVal}%) y TP escalonado TP1 (30% + Breakeven) / TP2 (30%) / TP3 (${tpPctVal}% runner), enfriamiento 10m tras pérdida y R:R >= 2.15:1.`;

  const baseSystemPrompt = `${
    params.customSystemPrompt?.trim()
      ? `DIRECTRIZ MAESTRA DEL OPERADOR:\n${params.customSystemPrompt.trim()}\n\n`
      : `Eres el Director Cuantitativo Institucional de TUG777 HyperTrade para Hyperliquid Perps.\nTu misión es GANAR con alta asimetría y disciplina (SL ${slPctVal}% / TP ${tpPctVal}%, Breakeven +0.55% -> +0.15%, Trailing +1.10%), cazar barridas reales de liquidez y evitar trampas/chop usando estrictamente la guía unificada.\n\n`
  }${unifiedProtocolBlock}\n\nResponde únicamente con JSON válido y razón técnica concisa en español.`;

  const posRules =
    params.positiveEntryRules && params.positiveEntryRules.length > 0
      ? params.positiveEntryRules.slice(0, 15)
      : memoriesList.filter((m) => m.outcome === 'WIN' || m.regime?.startsWith('SI_ENTRAR')).slice(0, 12);

  const negRules =
    params.negativeNoEntryRules && params.negativeNoEntryRules.length > 0
      ? params.negativeNoEntryRules.slice(0, 15)
      : memoriesList.filter((m) => m.outcome === 'LOSS' || m.regime?.startsWith('NO_ENTRAR')).slice(0, 12);

  const promptPayload = {
    mode: params.mode,
    nowMs: Date.now(),
    targetTpPct: tpPctVal,
    targetSlPct: slPctVal,
    positionManagementGuide: params.positionGuide || [],
    openPositions: openPositionsList,
    dbClosedHistory: params.dbClosedHistory || null,
    strategyPlaybook: (params.playbook || []).map((p) => {
      const total = p.wins + p.losses;
      return {
        id: p.strategyId,
        name: p.name,
        regimes: p.preferredRegimes,
        weight: total >= 5 ? p.weight : 1.0,
        wins: p.wins,
        losses: p.losses,
        sampleStatus: total === 0 ? 'SIN_MUESTRA' : total < 5 ? 'MUESTRA_BAJA' : 'DEMOSTRADO',
        winRatePct: total >= 5 ? Number(((p.wins / total) * 100).toFixed(1)) : null,
        pnl: p.totalPnlUsd,
        enabled: p.enabled,
      };
    }),
    hyperliquidFillsHistory: params.fillsSummary || null,
    positiveEntryRules: posRules,
    negativeNoEntryRules: negRules,
    learnedMemories: memoriesList.slice(0, 12),
    macroContext: params.macroBrief || 'Sin briefing macro adicional.',
    deepAnalyses: (params.deepAnalyses || []).slice(0, 8),
    topCandidatesFallback: candidatesList.slice(0, 6),
  };

  const runUnifiedLocalFallback = (label: string, quotaFlag = false) => {
    const now = Date.now();
    const cooldownMs = 10 * 60 * 1000;
    const recentLossCoins = new Set(
      (params.fillsSummary?.recentClosed || [])
        .filter((f) => (f.netPnl ?? f.pnl ?? 0) < -0.05 && now - f.time < cooldownMs)
        .map((f) => f.coin)
    );
    for (const c of params.dbClosedHistory?.coinStats || []) {
      if (c.lastOutcome === 'LOSS' && now - c.lastClosedAtMs < cooldownMs) {
        recentLossCoins.add(c.coin);
      }
    }
    const negativeBlockedCoins = new Set(
      negRules.filter((r) => r.outcome === 'LOSS' && r.pnlUsd < -1.5).map((r) => r.coin)
    );
    const openCoinsSameDir = new Set(openPositionsList.map((p) => `${p.coin}:${p.side}`));

    const bestDeep = (params.deepAnalyses || [])
      .filter((d) => {
        if (d.direction === 'NEUTRAL' || d.antiChaseBlocked) return false;
        if (openCoinsSameDir.has(`${d.coin}:${d.direction}`)) return false;
        if ((d.firedStrategies || []).length < 2) return false;
        if (
          d.regime === 'RANGING_CHOP' &&
          ((d.firedStrategies || []).length < 3 || d.unifiedScore < 68)
        ) {
          return false;
        }
        if (recentLossCoins.has(d.coin)) return false;
        if (negativeBlockedCoins.has(d.coin) && d.unifiedScore < 72) return false;
        return d.unifiedScore >= 60;
      })
      .sort((a, b) => b.unifiedScore - a.unifiedScore)[0];

    if (bestDeep) {
      return {
        action: bestDeep.direction,
        coin: bestDeep.coin,
        confidence: bestDeep.confidence,
        decisionBand: bestDeep.decisionBand,
        regime: `${bestDeep.regime} (Guía Unificada + SÍ/NO Entrar)`,
        reason: `${(bestDeep.firedStrategies || []).join(' + ')}: ${(bestDeep.reasons || []).slice(0, 2).join(' · ')}`,
        tpPct: tpPctVal,
        slPct: slPctVal,
        tp1Pct: bestDeep.tp1Pct,
        tp2Pct: bestDeep.tp2Pct,
        tp3Pct: bestDeep.tp3Pct ?? tpPctVal,
        strategiesUsed: bestDeep.firedStrategies,
        modelUsed: label,
        ...(quotaFlag ? { quotaExceeded: true } : {}),
      };
    }

    const top = candidatesList.find((c) => c.quantBias !== 'NEUTRAL');
    return {
      action: 'HOLD',
      coin: top?.coin || 'NONE',
      confidence: 42,
      regime: 'Monitoreo con Filtro Alta Calidad',
      reason:
        'Sin señal limpia >=2 estrategias y >=60 pts (o bloqueada por chop/trampa/enfriamiento 10m). Protegiendo capital.',
      tpPct: tpPctVal,
      slPct: slPctVal,
      strategiesUsed: [],
      modelUsed: label,
      ...(quotaFlag ? { quotaExceeded: true } : {}),
    };
  };

  // Route to user's own AI endpoint (Ollama / DeepSeek / OpenAI / OpenRouter / Groq / xAI) with IDENTICAL unified protocol & history
  if (params.aiProvider === 'custom_ai') {
    const customRes = await callCustomOpenAiCompatible({
      endpointUrl: params.customAiUrl || '',
      model: params.customAiModel || '',
      systemPrompt: `${baseSystemPrompt}\nDevuelve ÚNICAMENTE un JSON válido con claves: action ("LONG"|"SHORT"|"CLOSE"|"HOLD"), coin (string), confidence (number 0-100), regime (string), reason (string), tpPct (number), slPct (number), strategiesUsed (string[]).`,
      userContent: JSON.stringify(promptPayload),
      expectJson: true,
    });
    const cleaned = customRes.text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    return { ...parsed, modelUsed: `${customRes.modelUsed} [Guía Sincronizada]` };
  }

  // Gemini path with explicit free-model selection, Decisions API v1beta support & automatic free-tier failover
  const ai = getAiClient();
  const useDeepModel = Boolean(params.deepThinking);
  const requestedModel = resolveFreeGeminiModel(params.geminiModel, useDeepModel);

  // Calibrated zero-output-token Decisions API path when user explicitly picks gemini-decision-1
  if (requestedModel === 'gemini-decision-1') {
    const bestDeepCand = [...(params.deepAnalyses || [])]
      .filter((d) => d.direction !== 'NEUTRAL' && !d.antiChaseBlocked)
      .sort((a, b) => b.unifiedScore - a.unifiedScore)[0];
    if (!bestDeepCand) {
      return runUnifiedLocalFallback('gemini-decision-1 [HOLD sin candidatos]', false);
    }
    const decisionsAi = getDecisionsAiClient();
    try {
      const decRes = await decisionsAi.decisions.create({
        model: 'gemini-decision-1',
        input: JSON.stringify({
          candidate: bestDeepCand,
          openPositions: openPositionsList,
          positiveEntryRules: posRules.slice(0, 6),
          negativeNoEntryRules: negRules.slice(0, 6),
        }),
        questions: {
          trade_action: {
            type: 'choice',
            instructions: `Given candidate ${bestDeepCand.coin} (${bestDeepCand.direction}, score ${bestDeepCand.unifiedScore}, regime ${bestDeepCand.regime}) and historical rules, choose the safest institutional action.`,
            criteria: {
              HOLD: 'Skip trade due to chop, weak confluence (<65), negative history, or excessive risk.',
              LONG: 'Enter LONG with confirmed bullish structure and >=2 active strategies.',
              SHORT: 'Enter SHORT with confirmed bearish structure and >=2 active strategies.',
            },
          },
          enter_confidence: {
            type: 'noul',
            instructions: `Should TUG777 execute ${bestDeepCand.direction} on ${bestDeepCand.coin} right now with SL ${slPctVal}% and TP ${tpPctVal}%?`,
            criteria: {
              true_description: 'High-conviction setup passing all risk and anti-trap filters.',
              false_description: 'Ambiguous, choppy, or trapped setup.',
            },
          },
        },
      });
      const actAns = decRes.answers?.trade_action;
      const noulAns = decRes.answers?.enter_confidence;
      const chosen = actAns?.type === 'choice' ? actAns.choice : 'HOLD';
      const probYes = noulAns?.type === 'noul' ? noulAns.noul : 0.5;
      const confPct = Math.round(
        ((actAns?.type === 'choice' ? actAns.confidence : 0.5) * 0.5 + probYes * 0.5) * 100
      );
      return {
        action: chosen === 'LONG' || chosen === 'SHORT' ? chosen : 'HOLD',
        coin: chosen === 'HOLD' ? 'NONE' : bestDeepCand.coin,
        confidence: Math.max(40, Math.min(98, confPct)),
        decisionBand: bestDeepCand.decisionBand,
        regime: `${bestDeepCand.regime} (Decisions API v1beta)`,
        reason: `Decisions API: choice=${chosen}, P(enter)=${(probYes * 100).toFixed(0)}% · ${(bestDeepCand.firedStrategies || []).join(' + ')}`,
        tpPct: tpPctVal,
        slPct: slPctVal,
        tp1Pct: bestDeepCand.tp1Pct,
        tp2Pct: bestDeepCand.tp2Pct,
        tp3Pct: bestDeepCand.tp3Pct ?? tpPctVal,
        strategiesUsed: bestDeepCand.firedStrategies,
        modelUsed: 'gemini-decision-1 [Decisions API v1beta]',
      };
    } catch (err) {
      // Rotate cleanly to generateContent free Gemini fallback if Decisions API hits quota/transient
      if (!isQuotaError(err)) {
        // try generateContent fallback below
      }
    }
  }

  // Ordered free-tier model rotation list (requested model first, then verified fastest peer free models)
  const freeTextChain = getOrderedFreeTextChain(requestedModel);

  const baseGenConfig: Record<string, unknown> = {
    systemInstruction: baseSystemPrompt,
    responseMimeType: 'application/json',
    responseSchema: {
      type: Type.OBJECT,
      properties: {
        action: { type: Type.STRING, description: 'LONG, SHORT, CLOSE o HOLD' },
        coin: { type: Type.STRING, description: 'Ticker exacto de Hyperliquid o NONE' },
        confidence: { type: Type.NUMBER, description: 'Confianza de 0 a 100' },
        regime: { type: Type.STRING, description: 'Regimen de mercado detectado' },
        reason: { type: Type.STRING, description: 'Tesis tecnica, de BD, historial y gestion en maximo 240 caracteres' },
        tpPct: { type: Type.NUMBER, description: 'Take Profit sugerido en %' },
        slPct: { type: Type.NUMBER, description: 'Stop Loss sugerido en %' },
        strategiesUsed: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: 'IDs de estrategias del playbook usadas',
        },
      },
      required: ['action', 'coin', 'confidence', 'regime', 'reason', 'tpPct', 'slPct'],
    },
  };

  let lastErr: unknown = null;
  for (let i = 0; i < freeTextChain.length; i += 1) {
    const candidateModel = freeTextChain[i];
    try {
      const modelConfig = buildGenerateConfigForModel(candidateModel, baseGenConfig, useDeepModel);
      const response = await ai.models.generateContent({
        model: candidateModel,
        contents: JSON.stringify(promptPayload),
        config: modelConfig,
      });

      const text = (response.text ?? '{}').trim();
      const parsed = JSON.parse(text);
      return {
        ...parsed,
        modelUsed: `${candidateModel}${i > 0 ? ' [Auto-Rotación Gratis]' : ' [Guía Sincronizada]'}`,
      };
    } catch (err) {
      lastErr = err;
      const errMsg = err instanceof Error ? err.message : String(err);
      const canRotate =
        isQuotaError(err) ||
        errMsg.includes('404') ||
        errMsg.includes('503') ||
        errMsg.includes('UNAVAILABLE') ||
        errMsg.includes('NOT_FOUND');
      if (!canRotate) {
        throw err;
      }
    }
  }

  // All free Gemini models exhausted or temporarily unavailable: failover to BYO-AI or unified local engine
  if (params.customAiUrl?.trim()) {
    try {
      const customRes = await callCustomOpenAiCompatible({
        endpointUrl: params.customAiUrl,
        model: params.customAiModel || '',
        systemPrompt: `${baseSystemPrompt}\nDevuelve ÚNICAMENTE un JSON válido con claves: action ("LONG"|"SHORT"|"CLOSE"|"HOLD"), coin (string), confidence (number 0-100), regime (string), reason (string), tpPct (number), slPct (number), strategiesUsed (string[]).`,
        userContent: JSON.stringify(promptPayload),
        expectJson: true,
      });
      const cleaned = customRes.text.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(cleaned);
      return {
        ...parsed,
        modelUsed: `${customRes.modelUsed} [Failover Misma Guía]`,
        quotaExceeded: isQuotaError(lastErr),
      };
    } catch {
      // Fall through to deterministic 10-strategy engine
    }
  }
  const lastErrStr = lastErr instanceof Error ? lastErr.message : String(lastErr);
  if (isQuotaError(lastErr) || lastErrStr.includes('503') || lastErrStr.includes('UNAVAILABLE')) {
    return runUnifiedLocalFallback(
      isQuotaError(lastErr) ? '10-Strategy Unified Fallback (429)' : '10-Strategy Unified Fallback (503)',
      isQuotaError(lastErr)
    );
  }
  throw lastErr;
}

export async function fetchMacroCatalystGrounding(coins: string[]) {
  const ai = getAiClient();
  const targetList = (Array.isArray(coins) ? coins : []).slice(0, 5).join(', ');
  const searchChain = ['gemini-4-hydrogen', 'gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite'];
  let lastErr: unknown = null;

  for (const model of searchChain) {
    try {
      const cfg = buildGenerateConfigForModel(model, { tools: [{ googleSearch: {} }] }, false);
      const response = await ai.models.generateContent({
        model,
        contents: `Busca noticias, flujos institucionales ETF, liquidaciones recientes y catalizadores macro de hoy para criptomonedas perpetuas enfocándote en ${targetList || 'BTC, ETH, SOL, HYPE'}. Resume en 4 puntos ejecutivos en español con impacto direccional.`,
        config: cfg,
      });

      const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
      const sources = chunks
        .map((c: { web?: { uri?: string; title?: string } }) => c.web)
        .filter((w): w is { uri: string; title: string } => Boolean(w?.uri));

      return {
        summary: response.text ?? 'No se obtuvieron catalizadores macro recientes.',
        sources,
        modelUsed: `${model} + Google Search`,
      };
    } catch (err) {
      lastErr = err;
      const errMsg = err instanceof Error ? err.message : String(err);
      if (!(isQuotaError(err) || errMsg.includes('503') || errMsg.includes('404') || errMsg.includes('400'))) {
        throw err;
      }
    }
  }

  if (isQuotaError(lastErr)) {
    return {
      summary:
        'Radar Macro en pausa por límite de cuota Gemini (429). Puedes usar una API Key con facturación en Settings > Secrets o conectar tu IA propia.',
      sources: [],
      modelUsed: 'Quota Limited (429)',
      quotaExceeded: true,
    };
  }
  throw lastErr;
}

export async function extractPostTradeLesson(params: {
  coin: string;
  side: string;
  entryPx: number;
  exitPx: number;
  pnlUsd: number;
  mode: string;
  thesis: string;
  geminiModel?: string;
  aiProvider?: 'gemini' | 'custom_ai';
  customAiUrl?: string;
  customAiModel?: string;
}) {
  const outcome = params.pnlUsd > 0.05 ? 'WIN' : params.pnlUsd < -0.05 ? 'LOSS' : 'BREAKEVEN';

  if (params.aiProvider === 'custom_ai') {
    const customRes = await callCustomOpenAiCompatible({
      endpointUrl: params.customAiUrl || '',
      model: params.customAiModel || '',
      systemPrompt:
        'Extrae una regla táctica aprendida (máximo 180 caracteres) y el régimen de mercado. Devuelve JSON: {"regime": string, "lesson": string}.',
      userContent: JSON.stringify({ ...params, outcome }),
      expectJson: true,
    });
    const parsed = JSON.parse(customRes.text.replace(/```json|```/g, '').trim());
    return {
      outcome,
      regime: parsed.regime || 'Ejecución Directa',
      lesson: parsed.lesson || `Trade ${outcome} en ${params.coin} (${params.pnlUsd.toFixed(2)} USD).`,
    };
  }

  const ai = getAiClient();
  const chain = getOrderedFreeTextChain(resolveFreeGeminiModel(params.geminiModel, false));
  for (const model of chain) {
    try {
      const cfg = buildGenerateConfigForModel(
        model,
        {
          systemInstruction:
            'Extrae exactamente 1 regla táctica aprendida (máximo 180 caracteres) y el régimen de mercado de este trade real cerrado en Hyperliquid.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              regime: { type: Type.STRING },
              lesson: { type: Type.STRING },
            },
            required: ['regime', 'lesson'],
          },
        },
        false
      );
      const response = await ai.models.generateContent({
        model,
        contents: JSON.stringify({ ...params, outcome }),
        config: cfg,
      });

      const parsed = JSON.parse((response.text ?? '{}').trim());
      return {
        outcome,
        regime: parsed.regime || 'Ejecución Directa',
        lesson: parsed.lesson || `Trade ${outcome} en ${params.coin} (${params.pnlUsd.toFixed(2)} USD).`,
      };
    } catch {
      // try next free Gemini model in chain
    }
  }
  return {
    outcome,
    regime: 'Registro Automático',
    lesson: `${outcome} en ${params.coin} (${params.side}) · PnL $${params.pnlUsd.toFixed(2)}.`,
  };
}

export async function chatWithTradingBrain(params: {
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  message: string;
  marketContext: unknown;
  useSearch: boolean;
  geminiModel?: string;
  aiProvider?: 'gemini' | 'custom_ai';
  customAiUrl?: string;
  customAiModel?: string;
  customSystemPrompt?: string;
}) {
  const baseInstruction =
    params.customSystemPrompt?.trim() ||
    `Eres TUG777 AI Core, copiloto cuantitativo experto en Hyperliquid Perps.`;

  const systemInstruction = `${baseInstruction}
Contexto en tiempo real de Hyperliquid y Firestore:
${JSON.stringify(params.marketContext)}
Responde con precisión institucional en español usando solo datos reales del contexto.`;

  if (params.aiProvider === 'custom_ai') {
    const customRes = await callCustomOpenAiCompatible({
      endpointUrl: params.customAiUrl || '',
      model: params.customAiModel || '',
      systemPrompt: systemInstruction,
      userContent: params.message,
      expectJson: false,
    });
    return {
      reply: customRes.text,
      sources: [],
      modelUsed: customRes.modelUsed,
    };
  }

  const ai = getAiClient();
  const preferredChatModel = resolveFreeGeminiModel(params.geminiModel, params.useSearch);
  const chatChain = getOrderedFreeTextChain(
    params.useSearch ? 'gemini-4-hydrogen' : preferredChatModel
  );

  const contents = [
    ...(Array.isArray(params.history) ? params.history : []).slice(-8).map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    })),
    { role: 'user', parts: [{ text: params.message }] },
  ];

  let lastChatErr: unknown = null;
  for (let i = 0; i < chatChain.length; i += 1) {
    const model = chatChain[i];
    const baseCfg: Record<string, unknown> = { systemInstruction };
    if (params.useSearch && model === 'gemini-4-hydrogen') {
      baseCfg.tools = [{ googleSearch: {} }];
    }
    const config = buildGenerateConfigForModel(model, baseCfg, params.useSearch);
    try {
      const response = await ai.models.generateContent({
        model,
        contents,
        config,
      });

      const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
      const sources = chunks
        .map((c: { web?: { uri?: string; title?: string } }) => c.web)
        .filter((w): w is { uri: string; title: string } => Boolean(w?.uri));

      return {
        reply: response.text ?? 'Sin respuesta del motor neuronal.',
        sources,
        modelUsed: `${model}${params.useSearch && model === 'gemini-4-hydrogen' ? ' + Search' : ''}${i > 0 ? ' [Auto-Rotación]' : ''}`,
      };
    } catch (err) {
      lastChatErr = err;
      const errMsg = err instanceof Error ? err.message : String(err);
      if (
        !(
          isQuotaError(err) ||
          errMsg.includes('404') ||
          errMsg.includes('503') ||
          errMsg.includes('UNAVAILABLE') ||
          errMsg.includes('NOT_FOUND')
        )
      ) {
        throw err;
      }
    }
  }

  const lastChatStr = lastChatErr instanceof Error ? lastChatErr.message : String(lastChatErr);
  if (isQuotaError(lastChatErr) || lastChatStr.includes('503') || lastChatStr.includes('UNAVAILABLE')) {
    return {
      reply:
        '⚠️ Todos los modelos gratuitos de Gemini están temporalmente saturados (429/503). El Motor Local de 10 Estrategias sigue operando normal; también puedes reintentar o conectar un endpoint en Parámetros IA.',
      sources: [],
      modelUsed: isQuotaError(lastChatErr) ? 'Quota Guard (429)' : 'Busy Guard (503)',
      quotaExceeded: isQuotaError(lastChatErr),
    };
  }
  throw lastChatErr;
}
