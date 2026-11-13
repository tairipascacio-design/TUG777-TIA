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
  firedStrategies: string[];
  rsi14: number;
  atrPct: number;
  vwapDistPct: number;
  bbWidthPct: number;
  l2Imbalance: number;
  spreadBps: number;
  recommendedSlPct: number;
  recommendedTpPct: number;
  antiChaseBlocked: boolean;
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

export async function analyzeMarketWithBrain(params: {
  mode: 'strategy' | 'ai' | 'strategy_ai';
  candidates: MarketCandidate[];
  deepAnalyses?: DeepAnalysisPayload[];
  playbook?: PlaybookSummaryItem[];
  positionGuide?: string[];
  fillsSummary?: {
    totalClosed: number;
    winRatePct: number;
    netPnlUsd: number;
    totalFeesUsd: number;
    losingCoins: Array<{ coin: string; pnl: number }>;
    winningCoins: Array<{ coin: string; pnl: number }>;
    recentClosed: Array<{ coin: string; pnl: number; time: number }>;
  };
  memories: LearnedMemoryItem[];
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
  aiProvider?: 'gemini' | 'custom_ai';
  customAiUrl?: string;
  customAiModel?: string;
  customSystemPrompt?: string;
  tpPct?: number;
  slPct?: number;
}) {
  const baseSystemPrompt =
    params.customSystemPrompt?.trim() ||
    `Eres el Cerebro Unificado de Trading Institucional de TUG777 HyperTrade para Hyperliquid Perps.
Tu misión es HACER CRECER EL CAPITAL con precisión quirúrgica (Ratio Riesgo/Beneficio mínimo 1:2.1) evitando sobre-operar y operando SIEMPRE A FAVOR DE LA ESTRUCTURA REAL.
REGLAS OBLIGATORIAS:
1. PROHIBIDO OPERAR EN CONTRA DE LA TENDENCIA: Nunca abras SHORT cuando el régimen es TRENDING_BULL o la dirección en deepAnalyses es LONG/NEUTRAL por sobreextensión. Nunca abras LONG cuando el régimen es TRENDING_BEAR o atrapando cuchillos cayendo. Si BTC está cayendo fuerte, exige confluencia extrema (>=80) para cualquier LONG.
2. CRUZA LA BASE DE DATOS: Revisa "strategyPlaybook" (pesos aprendidos, wins/losses reales), "learnedMemories" (lecciones de Firestore) y "hyperliquidFillsHistory" (historial real de fills, comisiones y tokens perdedores).
3. GESTIÓN DE POSICIONES ABIERTAS: Revisa "openPositions" contra "positionManagementGuide". Si una posición abierta va en contra de la estructura 15M+1H actual, muestra invalidación de régimen o conviene asegurar ganancia, devuelve action = "CLOSE" sobre ese coin.
4. ENTRADAS DE ALTA PROBABILIDAD: Solo abre LONG o SHORT cuando un candidato en "deepAnalyses" tiene direction igual a tu acción ("LONG" o "SHORT"), antiChaseBlocked == false, mínimo 2 estrategias alineadas y score >= 60. Penaliza tokens en "losingCoins".
5. EVITA FALSAS ENTRADAS: Si ningún setup tiene dirección clara y ventaja matemática real, devuelve action = "HOLD". Nunca inventes precios. Responde en español técnico conciso.`;

  const promptPayload = {
    mode: params.mode,
    targetTpPct: params.tpPct ?? 3.0,
    targetSlPct: params.slPct ?? 1.4,
    positionManagementGuide: params.positionGuide || [],
    openPositions: params.openPositions,
    strategyPlaybook: (params.playbook || []).map((p) => ({
      id: p.strategyId,
      name: p.name,
      regimes: p.preferredRegimes,
      weight: p.weight,
      wins: p.wins,
      losses: p.losses,
      pnl: p.totalPnlUsd,
      enabled: p.enabled,
    })),
    hyperliquidFillsHistory: params.fillsSummary || null,
    learnedMemories: params.memories.slice(0, 15),
    macroContext: params.macroBrief || 'Sin briefing macro adicional.',
    deepAnalyses: (params.deepAnalyses || []).slice(0, 8),
    topCandidatesFallback: params.candidates.slice(0, 6),
  };

  // Route to user's own AI endpoint (Ollama / DeepSeek / OpenAI-compatible) if selected
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
    return { ...parsed, modelUsed: customRes.modelUsed };
  }

  // Gemini path (defaults to fast low-quota gemini-3.1-flash-lite unless deepThinking is enabled)
  const ai = getAiClient();
  const useDeepModel = Boolean(params.deepThinking);
  const model = useDeepModel ? 'gemini-4-hydrogen' : 'gemini-3.1-flash-lite';

  const config: Record<string, unknown> = {
    systemInstruction: baseSystemPrompt,
    responseMimeType: 'application/json',
    responseSchema: {
      type: Type.OBJECT,
      properties: {
        action: { type: Type.STRING, description: 'LONG, SHORT, CLOSE o HOLD' },
        coin: { type: Type.STRING, description: 'Ticker exacto de Hyperliquid o NONE' },
        confidence: { type: Type.NUMBER, description: 'Confianza de 0 a 100' },
        regime: { type: Type.STRING, description: 'Regimen de mercado detectado' },
        reason: { type: Type.STRING, description: 'Tesis tecnica, de gestion y memoria en maximo 240 caracteres' },
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

  if (useDeepModel) {
    config.thinkingConfig = { thinkingLevel: ThinkingLevel.HIGH };
  }

  try {
    const response = await ai.models.generateContent({
      model,
      contents: JSON.stringify(promptPayload),
      config,
    });

    const text = (response.text ?? '{}').trim();
    const parsed = JSON.parse(text);
    return { ...parsed, modelUsed: model };
  } catch (err) {
    if (isQuotaError(err)) {
      // Automatic fallback to deterministic Unified 10-Strategy Deep Engine on 429
      const bestDeep = (params.deepAnalyses || [])
        .filter((d) => d.direction !== 'NEUTRAL' && !d.antiChaseBlocked)
        .sort((a, b) => b.unifiedScore - a.unifiedScore)[0];

      if (bestDeep && bestDeep.unifiedScore >= 60) {
        return {
          action: bestDeep.direction,
          coin: bestDeep.coin,
          confidence: bestDeep.confidence,
          regime: `${bestDeep.regime} (Fallback Multi-Estrategia 429)`,
          reason: `${bestDeep.firedStrategies.join(' + ')}: ${bestDeep.reasons.slice(0, 2).join(' · ')}`,
          tpPct: bestDeep.recommendedTpPct || params.tpPct || 3.0,
          slPct: bestDeep.recommendedSlPct || params.slPct || 1.4,
          strategiesUsed: bestDeep.firedStrategies,
          modelUsed: '10-Strategy Quant Fallback (429)',
          quotaExceeded: true,
        };
      }

      const top = params.candidates.find((c) => c.quantBias !== 'NEUTRAL');
      return {
        action: 'HOLD',
        coin: top?.coin || 'NONE',
        confidence: bestDeep?.confidence || 42,
        regime: 'Espera Segura (Cuota Gemini 429)',
        reason:
          'Sin confluencia multi-estrategia suficiente en modo fallback. Configura facturación o tu IA Externa en Parámetros IA.',
        tpPct: params.tpPct ?? 3.0,
        slPct: params.slPct ?? 1.4,
        strategiesUsed: [],
        modelUsed: '10-Strategy Quant Fallback (429)',
        quotaExceeded: true,
      };
    }
    throw err;
  }
}

export async function fetchMacroCatalystGrounding(coins: string[]) {
  const ai = getAiClient();
  const targetList = coins.slice(0, 5).join(', ');
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: `Busca noticias, flujos institucionales ETF, liquidaciones recientes y catalizadores macro de hoy para criptomonedas perpetuas enfocándote en ${targetList || 'BTC, ETH, SOL, HYPE'}. Resume en 4 puntos ejecutivos en español con impacto direccional.`,
      config: {
        tools: [{ googleSearch: {} }],
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      },
    });

    const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
    const sources = chunks
      .map((c: { web?: { uri?: string; title?: string } }) => c.web)
      .filter((w): w is { uri: string; title: string } => Boolean(w?.uri));

    return {
      summary: response.text ?? 'No se obtuvieron catalizadores macro recientes.',
      sources,
      modelUsed: 'gemini-4-hydrogen + Google Search',
    };
  } catch (err) {
    if (isQuotaError(err)) {
      return {
        summary:
          'Radar Macro en pausa por límite de cuota Gemini (429). Puedes usar una API Key con facturación en Settings > Secrets o conectar tu IA propia.',
        sources: [],
        modelUsed: 'Quota Limited (429)',
        quotaExceeded: true,
      };
    }
    throw err;
  }
}

export async function extractPostTradeLesson(params: {
  coin: string;
  side: string;
  entryPx: number;
  exitPx: number;
  pnlUsd: number;
  mode: string;
  thesis: string;
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
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.1-flash-lite',
      contents: JSON.stringify({ ...params, outcome }),
      config: {
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
    });

    const parsed = JSON.parse((response.text ?? '{}').trim());
    return {
      outcome,
      regime: parsed.regime || 'Ejecución Directa',
      lesson: parsed.lesson || `Trade ${outcome} en ${params.coin} (${params.pnlUsd.toFixed(2)} USD).`,
    };
  } catch {
    return {
      outcome,
      regime: 'Registro Automático',
      lesson: `${outcome} en ${params.coin} (${params.side}) · PnL $${params.pnlUsd.toFixed(2)}.`,
    };
  }
}

export async function chatWithTradingBrain(params: {
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  message: string;
  marketContext: unknown;
  useSearch: boolean;
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
  const model = params.useSearch ? 'gemini-4-hydrogen' : 'gemini-3.1-flash-lite';

  const contents = [
    ...params.history.slice(-8).map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    })),
    { role: 'user', parts: [{ text: params.message }] },
  ];

  const config: Record<string, unknown> = {
    systemInstruction,
  };
  if (params.useSearch) {
    config.tools = [{ googleSearch: {} }];
    config.thinkingConfig = { thinkingLevel: ThinkingLevel.LOW };
  }

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
      modelUsed: params.useSearch ? 'gemini-4-hydrogen + Search' : 'gemini-3.1-flash-lite',
    };
  } catch (err) {
    if (isQuotaError(err)) {
      return {
        reply:
          '⚠️ Límite de cuota de Gemini alcanzado (429 RESOURCE_EXHAUSTED). Puedes seleccionar una API Key con facturación en AI Studio (**Settings > Secrets**) o abrir **"Parámetros IA"** en la barra superior para conectar tu propio endpoint de IA (Ollama, DeepSeek, OpenRouter o servidor en tu Droplet).',
        sources: [],
        modelUsed: 'Quota Guard (429)',
        quotaExceeded: true,
      };
    }
    throw err;
  }
}
