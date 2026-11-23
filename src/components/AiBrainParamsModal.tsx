import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  BrainCircuit,
  CheckCircle2,
  Layers,
  Play,
  PlugZap,
  RefreshCw,
  Server,
  Sliders,
  Sparkles,
  X,
} from 'lucide-react';
import {
  buildBackendApiUrl,
  getConfiguredBackendUrl,
  hasConfiguredBackendForApk,
  isMcloudWebhookOrServiceUrl,
  isRunningInEmbeddedApk,
  setConfiguredBackendUrl,
  testMcloudConnection,
} from '../services/hyperliquidClient';
import { DEFAULT_STRATEGY_PLAYBOOK, getStrategySampleStatus } from '../services/strategyEngine';
import type { BiasLockMode, BotConfigData, StrategyPlaybookItem } from '../types/trading';
import { formatSignedUsd } from '../utils/formatters';
import { soundEngine } from '../utils/soundEngine';

interface AiBrainParamsModalProps {
  open: boolean;
  onClose: () => void;
  config: BotConfigData;
  onSave: (patch: Partial<BotConfigData>) => void;
  playbook?: StrategyPlaybookItem[];
  onUpdateStrategy?: (strategyId: string, patch: { enabled?: boolean; weight?: number }) => void;
  onAutoCalibrateStrategies?: () => void;
  onResetStrategyWeights?: () => void;
}

interface AiPreset {
  id: string;
  label: string;
  provider: 'gemini' | 'custom_ai';
  url: string;
  model: string;
  geminiModel?: string;
  deepThinking: boolean;
  hint: string;
}

interface FreeGeminiModelInfo {
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

interface FreeGeminiModelTestResult {
  id: string;
  label: string;
  apiMethod: 'generateContent' | 'decisions.create';
  ok: boolean;
  statusCode: number;
  latencyMs: number;
  detail: string;
}

const STANDARD_COMPATIBLE_PRESETS: AiPreset[] = [
  {
    id: 'gemini_auto',
    label: 'Gemini Auto (Más Rápido)',
    provider: 'gemini',
    url: '',
    model: 'auto',
    geminiModel: 'auto',
    deepThinking: false,
    hint: 'Gratis · Auto-optimizado',
  },
  {
    id: 'gemini_35_lite',
    label: 'Gemini 3.5 Flash-Lite',
    provider: 'gemini',
    url: '',
    model: 'gemini-3.5-flash-lite',
    geminiModel: 'gemini-3.5-flash-lite',
    deepThinking: false,
    hint: 'Gratis · Veloz + Search',
  },
  {
    id: 'gemini_31_lite',
    label: 'Gemini 3.1 Flash-Lite',
    provider: 'gemini',
    url: '',
    model: 'gemini-3.1-flash-lite',
    geminiModel: 'gemini-3.1-flash-lite',
    deepThinking: false,
    hint: 'Gratis · Respaldo JSON',
  },
  {
    id: 'gemini_38_flash',
    label: 'Gemini 3.8 Flash',
    provider: 'gemini',
    url: '',
    model: 'gemini-3.8-flash',
    geminiModel: 'gemini-3.8-flash',
    deepThinking: false,
    hint: 'Gratis · Flash Gen 3.8',
  },
  {
    id: 'gemini_hydrogen',
    label: 'Gemini 4 Hydrogen',
    provider: 'gemini',
    url: '',
    model: 'gemini-4-hydrogen',
    geminiModel: 'gemini-4-hydrogen',
    deepThinking: true,
    hint: 'Gratis · Deep Thinking',
  },
  {
    id: 'gemini_decision',
    label: 'Gemini Decision-1 (v1beta)',
    provider: 'gemini',
    url: '',
    model: 'gemini-decision-1',
    geminiModel: 'gemini-decision-1',
    deepThinking: false,
    hint: 'Gratis · Decisions API',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek V3',
    provider: 'custom_ai',
    url: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    deepThinking: false,
    hint: 'OpenAI v1 compatible',
  },
  {
    id: 'openai',
    label: 'OpenAI GPT-4o-mini',
    provider: 'custom_ai',
    url: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    deepThinking: false,
    hint: 'Estándar OpenAI',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter Claude',
    provider: 'custom_ai',
    url: 'https://openrouter.ai/api/v1',
    model: 'anthropic/claude-3.5-sonnet',
    deepThinking: false,
    hint: 'Multi-modelo unificado',
  },
  {
    id: 'groq',
    label: 'Groq Llama 3.3 70B',
    provider: 'custom_ai',
    url: 'https://api.groq.com/openai/v1',
    model: 'llama-3.3-70b-versatile',
    deepThinking: false,
    hint: 'Baja latencia',
  },
  {
    id: 'xai',
    label: 'xAI Grok-2',
    provider: 'custom_ai',
    url: 'https://api.x.ai/v1',
    model: 'grok-2-latest',
    deepThinking: false,
    hint: 'Endpoint xAI v1',
  },
  {
    id: 'ollama',
    label: 'Ollama Local / Droplet',
    provider: 'custom_ai',
    url: 'http://127.0.0.1:11434/v1',
    model: 'qwen2.5:14b',
    deepThinking: false,
    hint: 'Modelo propio 0 costo',
  },
];

export const AiBrainParamsModal: React.FC<AiBrainParamsModalProps> = ({
  open,
  onClose,
  config,
  onSave,
  playbook = [],
  onUpdateStrategy,
  onAutoCalibrateStrategies,
  onResetStrategyWeights,
}) => {
  const [aiProvider, setAiProvider] = useState<'gemini' | 'custom_ai'>(config.aiProvider);
  const [geminiModel, setGeminiModel] = useState<string>(config.geminiModel || 'auto');
  const [customAiUrl, setCustomAiUrl] = useState(config.customAiUrl);
  const [customAiModel, setCustomAiModel] = useState(config.customAiModel);
  const [customSystemPrompt, setCustomSystemPrompt] = useState(config.customSystemPrompt);
  const [scanIntervalSec, setScanIntervalSec] = useState(String(config.scanIntervalSec));
  const [minConfidence, setMinConfidence] = useState(String(config.minConfidence));
  const [minQuantScore, setMinQuantScore] = useState(String(config.minQuantScore));
  const [minVolumeM, setMinVolumeM] = useState(String(config.minVolumeM));
  const [tpPct, setTpPct] = useState(String(config.tpPct));
  const [slPct, setSlPct] = useState(String(config.slPct));
  const [useDeepThinking, setUseDeepThinking] = useState(config.useDeepThinking);
  const [useSearchGrounding, setUseSearchGrounding] = useState(config.useSearchGrounding);
  const [sizingMode, setSizingMode] = useState<'equity_pct' | 'fixed_usd'>(config.sizingMode || 'equity_pct');
  const [capitalPctPerTrade, setCapitalPctPerTrade] = useState(String(config.capitalPctPerTrade || 15));
  const [maxOpenPositions, setMaxOpenPositions] = useState(String(config.maxOpenPositions || 2));
  const [riskPerTradePct, setRiskPerTradePct] = useState(String(config.riskPerTradePct ?? 0.35));
  const [dailyMaxLossPct, setDailyMaxLossPct] = useState(String(config.dailyMaxLossPct ?? 2.5));
  const [killSwitchEnabled, setKillSwitchEnabled] = useState(Boolean(config.killSwitchEnabled));
  const [trailingStopEnabled, setTrailingStopEnabled] = useState(config.trailingStopEnabled !== false);
  const [autoManagePositions, setAutoManagePositions] = useState(config.autoManagePositions !== false);
  const [globalBiasLock, setGlobalBiasLock] = useState<BiasLockMode>(config.globalBiasLock || 'AMBOS');
  const [pairBiasLocksJson, setPairBiasLocksJson] = useState<string>(config.pairBiasLocksJson || '{}');
  const [useAloEntries, setUseAloEntries] = useState<boolean>(Boolean(config.useAloEntries));
  const [minOrderUsdFloor, setMinOrderUsdFloor] = useState<string>(String(config.minOrderUsdFloor ?? 12));
  const [streakCooldownHours, setStreakCooldownHours] = useState<string>(String(config.streakCooldownHours ?? 3));
  const [watchlistCoinsCsv, setWatchlistCoinsCsv] = useState<string>(config.watchlistCoinsCsv || 'BTC,ETH,SOL,HYPE');
  const [mcloudEnabled, setMcloudEnabled] = useState<boolean>(config.mcloudEnabled !== false);
  const [mcloudUrl, setMcloudUrl] = useState<string>(
    config.mcloudUrl || 'https://mcloud-1036926196544.us-east1.run.app'
  );
  const [mcloudTesting, setMcloudTesting] = useState(false);
  const [mcloudTestResult, setMcloudTestResult] = useState<{ ok: boolean; text: string } | null>(null);

  // Backend Server Connection URL (Cloud Run tug777-engine / APK Thin Client)
  const [backendUrl, setBackendUrl] = useState<string>(() => getConfiguredBackendUrl());
  const [healthTesting, setHealthTesting] = useState(false);
  const [healthStatus, setHealthStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [presetNotice, setPresetNotice] = useState<string>('');

  // Free Gemini Models Management & Benchmark State
  const [freeModels, setFreeModels] = useState<FreeGeminiModelInfo[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsMeta, setModelsMeta] = useState<{
    apiConfigured: boolean;
    discoveredCount: number;
    error?: string;
  } | null>(null);
  const [benchmarkRunning, setBenchmarkRunning] = useState(false);
  const [benchmarkData, setBenchmarkData] = useState<{
    testedAt: number;
    results: FreeGeminiModelTestResult[];
    fastestWorkingModel: string | null;
    workingCount: number;
  } | null>(null);
  const [benchmarkError, setBenchmarkError] = useState<string>('');

  const loadFreeGeminiCatalog = useCallback(async () => {
    if (!hasConfiguredBackendForApk() && !backendUrl.trim()) {
      setModelsMeta({
        apiConfigured: false,
        discoveredCount: 0,
        error: 'APK sin URL de servidor remoto configurada (Motor Local activo).',
      });
      return;
    }
    setModelsLoading(true);
    try {
      const base = backendUrl.trim().replace(/\/$/, '');
      const url = base ? `${base}/api/ai/models` : buildBackendApiUrl('/api/ai/models');
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      const raw = await res.text();
      if (!raw.trim() || raw.trim().startsWith('<')) {
        throw new Error(`HTTP ${res.status} (HTML en lugar de JSON)`);
      }
      const data = JSON.parse(raw) as {
        models: FreeGeminiModelInfo[];
        apiConfigured: boolean;
        discoveredCount: number;
        listError?: string;
      };
      const rawModels = Array.isArray(data.models) ? data.models : [];
      const uniqueModels = Array.from(
        new Map(rawModels.filter((m) => m && m.id).map((m) => [m.id, m])).values()
      );
      setFreeModels(uniqueModels);
      setModelsMeta({
        apiConfigured: Boolean(data.apiConfigured),
        discoveredCount: Number(data.discoveredCount || 0),
        error: data.listError,
      });
    } catch (err) {
      setModelsMeta({
        apiConfigured: false,
        discoveredCount: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setModelsLoading(false);
    }
  }, [backendUrl]);

  useEffect(() => {
    if (!open) return;
    setAiProvider(config.aiProvider);
    setGeminiModel(config.geminiModel || 'auto');
    setCustomAiUrl(config.customAiUrl);
    setCustomAiModel(config.customAiModel);
    setCustomSystemPrompt(config.customSystemPrompt);
    setScanIntervalSec(String(config.scanIntervalSec));
    setMinConfidence(String(config.minConfidence));
    setMinQuantScore(String(config.minQuantScore));
    setMinVolumeM(String(config.minVolumeM));
    setTpPct(String(config.tpPct));
    setSlPct(String(config.slPct));
    setUseDeepThinking(config.useDeepThinking);
    setUseSearchGrounding(config.useSearchGrounding);
    setSizingMode(config.sizingMode || 'equity_pct');
    setCapitalPctPerTrade(String(config.capitalPctPerTrade || 15));
    setMaxOpenPositions(String(config.maxOpenPositions || 2));
    setRiskPerTradePct(String(config.riskPerTradePct ?? 0.35));
    setDailyMaxLossPct(String(config.dailyMaxLossPct ?? 2.5));
    setKillSwitchEnabled(Boolean(config.killSwitchEnabled));
    setTrailingStopEnabled(config.trailingStopEnabled !== false);
    setAutoManagePositions(config.autoManagePositions !== false);
    setGlobalBiasLock(config.globalBiasLock || 'AMBOS');
    setPairBiasLocksJson(config.pairBiasLocksJson || '{}');
    setUseAloEntries(Boolean(config.useAloEntries));
    setMinOrderUsdFloor(String(config.minOrderUsdFloor ?? 12));
    setStreakCooldownHours(String(config.streakCooldownHours ?? 3));
    setWatchlistCoinsCsv(config.watchlistCoinsCsv || 'BTC,ETH,SOL,HYPE');
    setMcloudEnabled(config.mcloudEnabled !== false);
    setMcloudUrl(config.mcloudUrl || 'https://mcloud-1036926196544.us-east1.run.app');
    setMcloudTestResult(null);
    setBackendUrl(getConfiguredBackendUrl());
    setPresetNotice('');
    setBenchmarkError('');
  }, [open, config]);

  useEffect(() => {
    if (open && aiProvider === 'gemini') {
      void loadFreeGeminiCatalog();
    }
  }, [open, aiProvider, loadFreeGeminiCatalog]);

  if (!open) return null;

  const rawPlaybook: StrategyPlaybookItem[] =
    playbook.length > 0
      ? playbook
      : DEFAULT_STRATEGY_PLAYBOOK.map((d) => ({
          ...d,
          ownerId: 'local',
          wins: 0,
          losses: 0,
          totalPnlUsd: 0,
          updatedAtMs: Date.now(),
        }));
  const effectivePlaybook: StrategyPlaybookItem[] = Array.from(
    new Map(
      rawPlaybook.map((item, idx) => [item.strategyId || `strategy-${idx}`, item])
    ).values()
  );

  const normalizeMcloudInputValue = (raw: string) =>
    raw
      .trim()
      .replace(/\/api\/health\/?$/i, '')
      .replace(/\/api\/tug777\/(infer|context)\/?$/i, '')
      .replace(/\/+$/, '') || 'https://mcloud-1036926196544.us-east1.run.app';

  const testBackendHealth = async (overrideUrl?: string) => {
    soundEngine.click();
    setHealthTesting(true);
    setHealthStatus(null);
    const rawInput = (overrideUrl ?? backendUrl).trim().replace(/\/$/, '');

    // If user pasted the Montana Cloud (mcloud) webhook URL into the Engine box, move it cleanly & test via server proxy (no CORS Failed to fetch!)
    if (isMcloudWebhookOrServiceUrl(rawInput)) {
      const cleanedMcloud = normalizeMcloudInputValue(rawInput);
      setMcloudUrl(cleanedMcloud);
      setMcloudEnabled(true);
      setBackendUrl('');
      setConfiguredBackendUrl('');
      try {
        const mcRes = await testMcloudConnection(cleanedMcloud);
        setMcloudTestResult({
          ok: mcRes.ok,
          text: `${mcRes.ok ? 'Montana Cloud OK' : 'Montana Cloud respondió con aviso'} · ${mcRes.detail}`,
        });
        setHealthStatus({
          ok: mcRes.ok,
          text: `Esa URL es de Montana Cloud (mcloud), no de tug777-engine. La movimos automáticamente al campo Montana Cloud y la probamos sin CORS: ${mcRes.detail}`,
        });
      } catch (mcErr) {
        setHealthStatus({
          ok: false,
          text: `URL de Montana Cloud movida a su sección, pero falló la prueba desde el servidor local: ${mcErr instanceof Error ? mcErr.message : String(mcErr)}`,
        });
      } finally {
        setHealthTesting(false);
      }
      return;
    }

    const base = rawInput;
    const target = base ? `${base}/api/health` : '/api/health';

    if (!base && isRunningInEmbeddedApk()) {
      setHealthTesting(false);
      setHealthStatus({
        ok: true,
        text: 'APK sin servidor remoto: el Motor Local de 10 Estrategias + Hyperliquid L1 funciona directo 100% sin 404. Si quieres IA en la nube desde el APK, pega la URL HTTPS de tu servidor tug777-engine.',
      });
      return;
    }

    const t0 = performance.now();
    try {
      const res = await fetch(target, { headers: { Accept: 'application/json' } });
      const raw = await res.text();
      if (!raw.trim() || raw.trim().startsWith('<')) {
        setHealthStatus({
          ok: false,
          text: `HTTP ${res.status} (HTML en lugar de JSON). Esa URL no apunta al servidor tug777-engine; déjala vacía (Auto) o apunta a tu servicio Cloud Run tug777-engine.`,
        });
        return;
      }
      const json = JSON.parse(raw) as {
        status?: string;
        service?: string;
        geminiConfigured?: boolean;
        customAiConfigured?: boolean;
      };
      const ms = Math.round(performance.now() - t0);
      if (res.ok && json.status === 'ok') {
        setHealthStatus({
          ok: true,
          text: `Conexión Engine OK (${ms} ms) · Servicio: ${json.service || 'tug777-engine'} · Gemini: ${json.geminiConfigured ? 'LISTO' : 'Sin key'} · IA Externa: ${json.customAiConfigured ? 'LISTO' : 'Opcional/Local'}`,
        });
      } else {
        setHealthStatus({
          ok: false,
          text: `El servidor respondió HTTP ${res.status} en ${ms} ms.`,
        });
      }
    } catch (err) {
      // If direct browser fetch failed due to CORS on a remote URL, verify via server-side /api/engine/probe-url
      if (base && !isRunningInEmbeddedApk()) {
        try {
          const proxyRes = await fetch('/api/engine/probe-url', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ url: base }),
          });
          const proxyData = (await proxyRes.json()) as {
            ok?: boolean;
            status?: number;
            latencyMs?: number;
            json?: { status?: string; service?: string } | null;
            error?: string;
          };
          if (proxyData.ok && proxyData.json?.status === 'ok') {
            setHealthStatus({
              ok: true,
              text: `Servidor remoto respondió HTTP 200 vía proxy (${proxyData.latencyMs} ms), pero bloquea CORS directo desde el navegador. Habilita CORS en tug777-engine o déjalo en Auto / Origen Local.`,
            });
            return;
          }
          setHealthStatus({
            ok: false,
            text: `Sin conexión directa (CORS/red) y proxy servidor reportó HTTP ${proxyData.status || 0}: ${proxyData.error || 'No responde como tug777-engine.'}`,
          });
          return;
        } catch {
          // fall through to original error
        }
      }
      setHealthStatus({
        ok: false,
        text: `No se pudo conectar con ${target}: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setHealthTesting(false);
    }
  };

  const runFreeGeminiBenchmark = async (targetIds?: string[]) => {
    soundEngine.click();
    if (!hasConfiguredBackendForApk() && !backendUrl.trim()) {
      setBenchmarkError(
        'Conecta la URL de tu servidor Express/Droplet arriba para ejecutar pruebas reales contra @google/genai.'
      );
      return;
    }
    setBenchmarkRunning(true);
    setBenchmarkError('');
    try {
      const base = backendUrl.trim().replace(/\/$/, '');
      const url = base ? `${base}/api/ai/test-models` : buildBackendApiUrl('/api/ai/test-models');
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(targetIds ? { models: targetIds } : {}),
      });
      const raw = await res.text();
      if (!raw.trim() || raw.trim().startsWith('<')) {
        throw new Error(`HTTP ${res.status} (HTML en lugar de JSON)`);
      }
      const data = JSON.parse(raw) as {
        testedAt: number;
        results: FreeGeminiModelTestResult[];
        fastestWorkingModel: string | null;
        workingCount: number;
        error?: string;
      };
      if (!res.ok || data.error) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setBenchmarkData({
        testedAt: data.testedAt,
        results: Array.isArray(data.results) ? data.results : [],
        fastestWorkingModel: data.fastestWorkingModel ?? null,
        workingCount: Number(data.workingCount || 0),
      });
      if (data.fastestWorkingModel) {
        setPresetNotice(
          `Benchmark real completo: ${data.workingCount}/${data.results.length} modelos gratis activos. Más rápido: ${data.fastestWorkingModel}.`
        );
      }
    } catch (err) {
      setBenchmarkError(err instanceof Error ? err.message : String(err));
    } finally {
      setBenchmarkRunning(false);
    }
  };

  const applyAiPreset = (preset: AiPreset) => {
    soundEngine.click();
    setAiProvider(preset.provider);
    if (preset.provider === 'gemini') {
      setGeminiModel(preset.geminiModel || preset.model || 'auto');
    } else {
      setCustomAiUrl(preset.url);
      setCustomAiModel(preset.model);
    }
    setUseDeepThinking(preset.deepThinking);
    // Preserve customSystemPrompt, SL, TP & separated SI_ENTRAR / NO_ENTRAR rules automatically across model switches!
    setPresetNotice(
      `Modelo cambiado a ${preset.label}. Tu Guía Unificada, SL/TP (${slPct}%/${tpPct}%) e Historial SÍ/NO Entrar siguen intactos y sincronizados.`
    );
  };

  const normalizeMcloudInput = (raw: string) =>
    raw
      .trim()
      .replace(/\/api\/health\/?$/i, '')
      .replace(/\/api\/tug777\/(infer|context)\/?$/i, '')
      .replace(/\/+$/, '') || 'https://mcloud-1036926196544.us-east1.run.app';

  const runMcloudDiagnostic = async () => {
    soundEngine.click();
    setMcloudTesting(true);
    setMcloudTestResult(null);
    const cleaned = normalizeMcloudInput(mcloudUrl);
    setMcloudUrl(cleaned);
    try {
      const res = await testMcloudConnection(cleaned);
      setMcloudTestResult({
        ok: res.ok,
        text: `${res.ok ? 'Montana Cloud OK' : 'Montana Cloud respondió con aviso'} · ${res.detail}`,
      });
    } catch (err) {
      setMcloudTestResult({
        ok: false,
        text: `Error probando mcloud: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setMcloudTesting(false);
    }
  };

  const applyFullStandardPanel = () => {
    soundEngine.tradeExecuted();
    setSlPct('0.85');
    setTpPct('3.5');
    setScanIntervalSec('45');
    setMinConfidence('65');
    setMinQuantScore('65');
    setMinVolumeM('5');
    setSizingMode('equity_pct');
    setCapitalPctPerTrade('15');
    setMaxOpenPositions('2');
    setRiskPerTradePct('0.35');
    setDailyMaxLossPct('2.5');
    setGlobalBiasLock('AMBOS');
    setMinOrderUsdFloor('12');
    setStreakCooldownHours('3');
    setAutoManagePositions(true);
    setTrailingStopEnabled(true);
    setUseDeepThinking(false);
    setUseSearchGrounding(false);
    if (!customSystemPrompt.trim() || customSystemPrompt.includes('0.10%')) {
      setCustomSystemPrompt(
        'Sigue estrictamente la Guía Cuantitativa TUG777: Riesgo 0.35%/trade, Kill Switch 2.5%/día, máx 2 posiciones, SL 0.85% / TP1 30% / TP2 30% / TP3 3.5%, BE +0.15%, Trailing, Caza-Barridas reales y Anti-Trampas.'
      );
    }
    setPresetNotice(
      'Calibración Cuantitativa aplicada: Riesgo 0.35%/trade, Kill Switch 2.5%/día, Máx 2 slots, Piso $12, Cooldown 3h, SL 0.85% / TP 3.5%, Score >=65.'
    );
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    soundEngine.tradeExecuted();
    const mcloudCandidate = isMcloudWebhookOrServiceUrl(backendUrl) ? backendUrl : mcloudUrl;
    setConfiguredBackendUrl(backendUrl);
    onSave({
      aiProvider,
      geminiModel: geminiModel.trim() || 'auto',
      customAiUrl: customAiUrl.trim(),
      customAiModel: customAiModel.trim(),
      customSystemPrompt: customSystemPrompt.trim(),
      scanIntervalSec: Math.max(15, Math.min(3600, Number(scanIntervalSec || 45))),
      minConfidence: Math.max(35, Math.min(99, Number(minConfidence || 65))),
      minQuantScore: Math.max(20, Math.min(95, Number(minQuantScore || 65))),
      minVolumeM: Math.max(0.1, Math.min(500, Number(minVolumeM || 5))),
      tpPct: Math.max(0.2, Math.min(200, Number(tpPct || 3.5))),
      slPct: Math.max(0.05, Math.min(50, Number(slPct || 0.85))),
      useDeepThinking,
      useSearchGrounding,
      sizingMode,
      capitalPctPerTrade: Math.max(1, Math.min(100, Number(capitalPctPerTrade || 15))),
      maxOpenPositions: Math.max(1, Math.min(20, Math.round(Number(maxOpenPositions || 2)))),
      riskPerTradePct: Math.max(0.05, Math.min(25.0, Number(riskPerTradePct || 0.35))),
      dailyMaxLossPct: Math.max(0.1, Math.min(100.0, Number(dailyMaxLossPct || 2.5))),
      killSwitchEnabled,
      trailingStopEnabled,
      autoManagePositions,
      globalBiasLock,
      pairBiasLocksJson: pairBiasLocksJson.trim() || '{}',
      useAloEntries,
      minOrderUsdFloor: Math.max(0, Math.min(1000, Number(minOrderUsdFloor || 0))),
      streakCooldownHours: Math.max(0.5, Math.min(72, Number(streakCooldownHours || 3))),
      watchlistCoinsCsv: watchlistCoinsCsv.trim().toUpperCase() || 'BTC,ETH,SOL,HYPE',
      mcloudEnabled,
      mcloudUrl: normalizeMcloudInput(mcloudCandidate),
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      <div className="w-full max-w-3xl bg-[#0F131A] border border-slate-800 rounded-xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <Sliders className="w-5 h-5 text-amber-400" />
            <div>
              <h2 className="text-base font-bold text-slate-100">
                Panel Estándar: Conexiones IA, Guía Sincronizada y 10 Estrategias
              </h2>
              <p className="text-xs text-slate-400">
                Todo configurable desde la interfaz · La misma guía e historial SÍ/NO Entrar viajan con cada cambio de modelo
              </p>
            </div>
          </div>
          <button
            onClick={() => {
              soundEngine.click();
              onClose();
            }}
            className="p-1.5 text-slate-400 hover:text-white rounded-md"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSave} className="p-6 space-y-5 max-h-[84vh] overflow-y-auto">
          {/* 1-Click Standard Full Panel Bar */}
          <div className="p-3.5 rounded-lg bg-amber-500/10 border border-amber-500/35 flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-0.5">
              <div className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
                <Sparkles className="w-4 h-4" />
                Calibración Cuantitativa + TP1/TP2/TP3 (Sin tocar código)
              </div>
              <div className="text-[11px] text-slate-300">
                Riesgo 0.35%/trade · Kill Switch 1.8%/día · Máx 2 slots · SL 0.85% / TP1 30% / TP2 30% / TP3 3.5% · Banda Válida &gt;=65.
              </div>
            </div>
            <button
              type="button"
              onClick={applyFullStandardPanel}
              className="px-3.5 py-2 rounded-md bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold whitespace-nowrap"
            >
              Aplicar Panel Cuantitativo
            </button>
          </div>

          {presetNotice && (
            <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/40 text-xs text-emerald-300 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{presetNotice}</span>
            </div>
          )}

          {/* Backend Server Connection Panel (Cloud Run tug777-engine & APK Thin Client) */}
          <div className="p-4 rounded-lg bg-[#090B0E] border border-slate-800 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-sky-300">
                <Server className="w-4 h-4" />
                Conexión Motor 24/7 Cloud Run (`tug777-engine`) + Montana Cloud (`mcloud`)
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    soundEngine.click();
                    setBackendUrl('');
                    setHealthStatus(null);
                  }}
                  className={`px-2 py-1 rounded text-[11px] font-semibold border ${
                    !backendUrl
                      ? 'bg-sky-500/20 border-sky-500/50 text-sky-300'
                      : 'bg-slate-900 border-slate-700 text-slate-400'
                  }`}
                >
                  Auto / Origen Local
                </button>
                <button
                  type="button"
                  onClick={() => {
                    soundEngine.click();
                    if (typeof window !== 'undefined' && !window.location.hostname.includes('web.app')) {
                      setBackendUrl(window.location.origin);
                    }
                  }}
                  className="px-2 py-1 rounded text-[11px] font-semibold bg-slate-900 border border-slate-700 text-slate-300 hover:border-amber-500"
                >
                  Usar URL Web Actual
                </button>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                placeholder="Déjalo vacío en Auto / Origen Local (o URL de tu servicio tug777-engine, NO mcloud)"
                value={backendUrl}
                onChange={(e) => setBackendUrl(e.target.value)}
                className="flex-1 bg-[#0F131A] border border-slate-700 rounded-md px-3 py-2 text-xs font-mono-tabular text-slate-100 focus:outline-none focus:border-sky-500"
              />
              <button
                type="button"
                disabled={healthTesting}
                onClick={() => void testBackendHealth()}
                className="px-3.5 py-2 rounded-md bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-xs font-bold inline-flex items-center justify-center gap-1.5 whitespace-nowrap"
              >
                <PlugZap className="w-3.5 h-3.5" />
                {healthTesting ? 'Probando...' : 'Probar Engine'}
              </button>
            </div>
            <p className="text-[11px] text-slate-500">
              En la web actual usa <strong className="text-slate-300">Auto / Origen Local</strong>. La URL de <strong className="text-slate-300">Montana Cloud (mcloud)</strong> va abajo en su propio campo (si la pegas aquí se mueve automático y se prueba sin CORS).
            </p>
            {healthStatus && (
              <div
                className={`text-[11px] px-3 py-2 rounded border ${
                  healthStatus.ok
                    ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-300'
                    : 'bg-red-500/10 border-red-500/40 text-red-300'
                }`}
              >
                {healthStatus.text}
              </div>
            )}
          </div>

          {/* AI Engine Provider + 1-Click Compatible Presets (NO API Key Inputs) */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <label className="block text-xs font-semibold text-slate-200">
                Motor Neuronal Activo y Presets Estándar Compatibles
              </label>
              <span className="text-[11px] text-emerald-400 font-medium">
                Guía + Historial sincronizados en automático
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {STANDARD_COMPATIBLE_PRESETS.map((p) => {
                const isSelected =
                  p.provider === aiProvider &&
                  (p.provider === 'gemini'
                    ? (geminiModel || 'auto') === (p.geminiModel || p.model)
                    : customAiUrl.trim() === p.url && customAiModel.trim() === p.model);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => applyAiPreset(p)}
                    className={`p-2 rounded-lg border text-left transition-colors ${
                      isSelected
                        ? 'bg-amber-500/15 border-amber-500 text-slate-100'
                        : 'bg-[#090B0E] border-slate-800 text-slate-300 hover:border-slate-600'
                    }`}
                  >
                    <div className="text-[11px] font-bold truncate">{p.label}</div>
                    <div className="text-[10px] text-slate-400 truncate mt-0.5">{p.hint}</div>
                  </button>
                );
              })}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => {
                  soundEngine.click();
                  setAiProvider('gemini');
                  setPresetNotice('Cambiado a Gemini (Servidor) conservando tu Guía Unificada y reglas SÍ/NO Entrar.');
                }}
                className={`p-3 rounded-lg border text-left transition-colors ${
                  aiProvider === 'gemini'
                    ? 'bg-amber-500/15 border-amber-500 text-slate-100'
                    : 'bg-[#090B0E] border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                <div className="text-xs font-bold">Gemini Integrado (Servidor)</div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  Flash-Lite / Hydrogen con failover automático al segundo modelo o Motor Local 10-Estrategias.
                </div>
              </button>
              <button
                type="button"
                onClick={() => {
                  soundEngine.click();
                  setAiProvider('custom_ai');
                  setPresetNotice('Cambiado a IA Externa OpenAI v1 conservando la misma Guía Unificada y BD Firestore.');
                }}
                className={`p-3 rounded-lg border text-left transition-colors ${
                  aiProvider === 'custom_ai'
                    ? 'bg-amber-500/15 border-amber-500 text-slate-100'
                    : 'bg-[#090B0E] border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                <div className="text-xs font-bold">IA Externa Compatible (OpenAI v1)</div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  DeepSeek, OpenAI, OpenRouter, Groq, xAI u Ollama usando exactamente las mismas reglas.
                </div>
              </button>
            </div>
          </div>

          {aiProvider === 'custom_ai' ? (
            <div className="p-4 rounded-lg bg-[#090B0E] border border-slate-800 space-y-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-amber-300">
                <BrainCircuit className="w-4 h-4" />
                Endpoint Compatible OpenAI v1 (Sin llaves en el cliente)
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
                    Endpoint Base URL (OpenAI v1)
                  </label>
                  <input
                    type="text"
                    placeholder="http://127.0.0.1:11434/v1 o https://api.deepseek.com/v1"
                    value={customAiUrl}
                    onChange={(e) => setCustomAiUrl(e.target.value)}
                    className="w-full bg-[#0F131A] border border-slate-700 rounded-md px-3 py-2 text-xs font-mono-tabular text-slate-100 focus:outline-none focus:border-amber-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
                    Nombre del Modelo
                  </label>
                  <input
                    type="text"
                    placeholder="qwen2.5:14b / deepseek-chat / gpt-4o-mini"
                    value={customAiModel}
                    onChange={(e) => setCustomAiModel(e.target.value)}
                    className="w-full bg-[#0F131A] border border-slate-700 rounded-md px-3 py-2 text-xs font-mono-tabular text-slate-100 focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>
              <p className="text-[11px] text-slate-500">
                Las credenciales Bearer (si tu endpoint externo las exige) permanecen seguras únicamente del lado del servidor (<code className="text-slate-300">CUSTOM_AI_API_KEY</code> en Secrets / <code className="text-slate-300">.env</code>).
              </p>
            </div>
          ) : (
            <div className="p-4 rounded-lg bg-[#090B0E] border border-slate-800 space-y-4">
              {/* Free Gemini Models Management & Live Benchmark Panel */}
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
                      <Activity className="w-4 h-4" />
                      Gestor de Modelos Gemini Gratis (<code className="text-slate-200">@google/genai</code>)
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      Modelo activo: <span className="text-emerald-300 font-mono-tabular font-semibold">{geminiModel || 'auto'}</span>
                      {modelsMeta && (
                        <>
                          {' '}· API Key: <span className={modelsMeta.apiConfigured ? 'text-emerald-300' : 'text-amber-300'}>{modelsMeta.apiConfigured ? 'LISTA' : 'NO CONFIGURADA'}</span>
                          {' '}· Descubiertos en vivo: <span className="text-sky-300 font-mono-tabular">{modelsMeta.discoveredCount}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={modelsLoading}
                      onClick={() => {
                        soundEngine.click();
                        void loadFreeGeminiCatalog();
                      }}
                      className="px-2.5 py-1.5 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 text-[11px] font-semibold inline-flex items-center gap-1.5"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${modelsLoading ? 'animate-spin' : ''}`} />
                      {modelsLoading ? 'Cargando...' : 'Refrescar Catálogo'}
                    </button>
                    <button
                      type="button"
                      disabled={benchmarkRunning}
                      onClick={() => void runFreeGeminiBenchmark()}
                      className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-[11px] font-bold inline-flex items-center gap-1.5"
                    >
                      <Play className="w-3.5 h-3.5" />
                      {benchmarkRunning ? 'Probando en vivo...' : 'Probar Todos & Optimizar'}
                    </button>
                  </div>
                </div>

                {modelsMeta?.error && (
                  <div className="text-[11px] px-3 py-2 rounded border bg-amber-500/10 border-amber-500/40 text-amber-300">
                    {modelsMeta.error}
                  </div>
                )}

                {benchmarkError && (
                  <div className="text-[11px] px-3 py-2 rounded border bg-red-500/10 border-red-500/40 text-red-300">
                    Error en prueba en vivo: {benchmarkError}
                  </div>
                )}

                {benchmarkData && (
                  <div className="p-2.5 rounded border border-emerald-500/35 bg-emerald-500/10 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                    <div className="text-emerald-200">
                      Resultado real ({new Date(benchmarkData.testedAt).toLocaleTimeString()}):{' '}
                      <span className="font-bold font-mono-tabular">
                        {benchmarkData.workingCount}/{benchmarkData.results.length} operativos
                      </span>
                      {benchmarkData.fastestWorkingModel && (
                        <>
                          {' '}· Más rápido: <span className="font-mono-tabular font-bold text-amber-300">{benchmarkData.fastestWorkingModel}</span>
                        </>
                      )}
                    </div>
                    {benchmarkData.fastestWorkingModel && (
                      <button
                        type="button"
                        onClick={() => {
                          soundEngine.click();
                          setGeminiModel(benchmarkData.fastestWorkingModel!);
                          setPresetNotice(`Modelo fijado al más rápido verificado: ${benchmarkData.fastestWorkingModel}.`);
                        }}
                        className="px-2.5 py-1 rounded bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-[11px]"
                      >
                        Usar Más Rápido
                      </button>
                    )}
                  </div>
                )}

                <div className="space-y-1.5 max-h-60 overflow-y-auto pr-1">
                  {/* Auto selector row */}
                  <div
                    className={`p-2 rounded border flex flex-wrap items-center justify-between gap-2 ${
                      geminiModel === 'auto'
                        ? 'bg-amber-500/10 border-amber-500/50'
                        : 'bg-[#0F131A] border-slate-800'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-bold text-slate-100 font-mono-tabular">auto</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 font-semibold">
                          AUTO-ROTACIÓN GRATIS
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5">
                        Usa el modelo gratuito más rápido verificado y rota automáticamente si hay 429/503.
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        soundEngine.click();
                        setGeminiModel('auto');
                      }}
                      className={`px-2.5 py-1 rounded text-[11px] font-bold ${
                        geminiModel === 'auto'
                          ? 'bg-amber-500 text-slate-950'
                          : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                      }`}
                    >
                      {geminiModel === 'auto' ? 'Activo' : 'Seleccionar'}
                    </button>
                  </div>

                  {freeModels.map((m, idx) => {
                    const testRes = benchmarkData?.results.find((r) => r.id === m.id);
                    const isActive = geminiModel === m.id;
                    return (
                      <div
                        key={`${m.id || 'model'}-${idx}`}
                        className={`p-2 rounded border flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${
                          isActive
                            ? 'bg-amber-500/10 border-amber-500/50'
                            : 'bg-[#0F131A] border-slate-800'
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-[11px] font-bold text-slate-100 font-mono-tabular">{m.id}</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-300 font-mono-tabular">
                              {m.apiMethod === 'decisions.create' ? 'decisions.create v1beta' : 'generateContent'}
                            </span>
                            {m.discoveredInApi && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300">
                                LIVE API
                              </span>
                            )}
                            {m.supportsSearchGrounding && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
                                Search
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-slate-400 mt-0.5">{m.description}</div>
                          {testRes && (
                            <div
                              className={`text-[10px] font-mono-tabular mt-1 ${
                                testRes.ok ? 'text-emerald-300' : 'text-amber-300'
                              }`}
                            >
                              HTTP {testRes.statusCode} · {testRes.latencyMs} ms · {testRes.detail}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            disabled={benchmarkRunning}
                            onClick={() => void runFreeGeminiBenchmark([m.id])}
                            className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 text-[10px] font-semibold"
                          >
                            Probar
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              soundEngine.click();
                              setGeminiModel(m.id);
                              setUseDeepThinking(m.id === 'gemini-4-hydrogen');
                            }}
                            className={`px-2.5 py-1 rounded text-[11px] font-bold ${
                              isActive
                                ? 'bg-amber-500 text-slate-950'
                                : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                            }`}
                          >
                            {isActive ? 'Activo' : 'Usar'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-slate-800/80">
                <div>
                  <div className="text-xs font-semibold text-slate-200">
                    Deep Thinking (`gemini-4-hydrogen`)
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Desactívalo en auto-escaneo para conservar cuota y evitar errores 429.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    soundEngine.click();
                    setUseDeepThinking(!useDeepThinking);
                  }}
                  className={`px-3 py-1.5 rounded text-xs font-bold ${
                    useDeepThinking ? 'bg-amber-500 text-slate-950' : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {useDeepThinking ? 'ON' : 'OFF'}
                </button>
              </div>
              <div className="flex items-center justify-between pt-2 border-t border-slate-800/80">
                <div>
                  <div className="text-xs font-semibold text-slate-200">
                    Google Search Grounding Automático
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Busca catalizadores macro en vivo antes de analizar.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    soundEngine.click();
                    setUseSearchGrounding(!useSearchGrounding);
                  }}
                  className={`px-3 py-1.5 rounded text-xs font-bold ${
                    useSearchGrounding ? 'bg-sky-500 text-slate-950' : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {useSearchGrounding ? 'ON' : 'OFF'}
                </button>
              </div>
            </div>
          )}

          {/* Unified Master Prompt synced identically to ALL models */}
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              Guía Maestra Unificada (Se transfiere idéntica al cambiar de modelo IA o Failover)
            </label>
            <textarea
              rows={3}
              maxLength={1400}
              placeholder="Ej: Respeta SL 0.85% / TP 3.5%, opera barridas reales de liquidez, bloquea rupturas/soportes falsos y sigue reglas SÍ/NO Entrar..."
              value={customSystemPrompt}
              onChange={(e) => setCustomSystemPrompt(e.target.value)}
              className="w-full bg-[#090B0E] border border-slate-700 rounded-md px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-amber-500"
            />
          </div>

          {/* 10 Strategies Inline Configuration */}
          <div className="p-4 rounded-lg bg-[#090B0E] border border-slate-800 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-amber-300">
                <Layers className="w-4 h-4" />
                Estrategias del Playbook (Configuración Directa · {effectivePlaybook.filter((s) => s.enabled).length}/10 Activas)
              </div>
              <div className="flex items-center gap-2">
                {onAutoCalibrateStrategies && (
                  <button
                    type="button"
                    onClick={() => {
                      soundEngine.click();
                      onAutoCalibrateStrategies();
                    }}
                      className="px-2.5 py-1 rounded bg-emerald-600/20 hover:bg-emerald-600/35 border border-emerald-500/40 text-emerald-300 text-[11px] font-bold"
                    >
                      Auto-Calibrar (&gt;=5 ops)
                    </button>
                  )}
                  {onResetStrategyWeights && (
                    <button
                      type="button"
                      onClick={() => {
                        soundEngine.click();
                        onResetStrategyWeights();
                      }}
                      className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-semibold"
                    >
                      Pesos 1.0x
                    </button>
                  )}
                </div>
              </div>

              <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                {effectivePlaybook.map((st, idx) => {
                  const totalTrades = st.wins + st.losses;
                  const wr = totalTrades > 0 ? Math.round((st.wins / totalTrades) * 100) : null;
                  const sample = getStrategySampleStatus(st);
                  return (
                    <div
                      key={`${st.strategyId || 'strat'}-${idx}`}
                      className="p-2.5 rounded-md bg-[#0F131A] border border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-slate-100 truncate">{st.name}</span>
                          <span className="text-[10px] font-mono-tabular text-amber-400">{st.category}</span>
                        </div>
                        <div className="text-[10px] text-slate-400 font-mono-tabular mt-0.5">
                          {st.wins}W / {st.losses}L {wr !== null ? `(${wr}% WR)` : ''} ·{' '}
                          <span className={sample.proven ? 'text-emerald-300' : 'text-amber-300/80'}>
                            {sample.label}
                          </span>{' '}
                          ·{' '}
                          <span className={st.totalPnlUsd >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                            {formatSignedUsd(st.totalPnlUsd)}
                          </span>
                        </div>
                      </div>

                    <div className="flex items-center gap-2.5 shrink-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-slate-400 font-mono-tabular">Peso</span>
                        <input
                          type="range"
                          min={0.3}
                          max={2.5}
                          step={0.05}
                          disabled={!onUpdateStrategy}
                          value={st.weight}
                          onChange={(e) =>
                            onUpdateStrategy?.(st.strategyId, { weight: Number(e.target.value) })
                          }
                          className="w-20 accent-amber-500 cursor-pointer"
                        />
                        <span className="text-[11px] font-mono-tabular font-bold text-amber-300 w-10 text-right">
                          {st.weight.toFixed(2)}x
                        </span>
                      </div>
                      <button
                        type="button"
                        disabled={!onUpdateStrategy}
                        onClick={() => {
                          soundEngine.click();
                          onUpdateStrategy?.(st.strategyId, { enabled: !st.enabled });
                        }}
                        className={`px-2.5 py-1 rounded text-[11px] font-bold ${
                          st.enabled
                            ? 'bg-emerald-600/25 text-emerald-300 border border-emerald-500/40'
                            : 'bg-slate-800 text-slate-500'
                        }`}
                      >
                        {st.enabled ? 'ON' : 'OFF'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Capital Compounding & Active Position Management */}
          <div className="p-4 rounded-lg bg-[#090B0E] border border-slate-800 space-y-3">
            <div className="text-xs font-semibold text-amber-300">
              Gestión de Capital y Posiciones en Vivo (Sin Tope Fijo de Capital)
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => {
                  soundEngine.click();
                  setSizingMode('equity_pct');
                }}
                className={`p-2.5 rounded border text-left text-xs ${
                  sizingMode === 'equity_pct'
                    ? 'bg-emerald-500/15 border-emerald-500 text-slate-100'
                    : 'bg-[#0F131A] border-slate-800 text-slate-400'
                }`}
              >
                <div className="font-bold">Dinámico (% Equity × Apalancamiento)</div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  Escala automáticamente según crece tu capital en Hyperliquid.
                </div>
              </button>
              <button
                type="button"
                onClick={() => {
                  soundEngine.click();
                  setSizingMode('fixed_usd');
                }}
                className={`p-2.5 rounded border text-left text-xs ${
                  sizingMode === 'fixed_usd'
                    ? 'bg-amber-500/15 border-amber-500 text-slate-100'
                    : 'bg-[#0F131A] border-slate-800 text-slate-400'
                }`}
              >
                <div className="font-bold">Nocional Fijo (USD por Trade)</div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  Usa el monto exacto en USD configurado en tu API Wallet.
                </div>
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-1">
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Riesgo / Trade (% Equity)</label>
                <input
                  type="number"
                  step="0.05"
                  min={0.05}
                  max={25.0}
                  value={riskPerTradePct}
                  onChange={(e) => setRiskPerTradePct(e.target.value)}
                  className="w-full bg-[#0F131A] border border-slate-700 rounded-md px-2.5 py-1.5 text-xs font-mono-tabular text-slate-100"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Límite Pérdida Auto-Cierre (%)</label>
                <input
                  type="number"
                  step="0.1"
                  min={0.1}
                  max={100.0}
                  value={dailyMaxLossPct}
                  onChange={(e) => setDailyMaxLossPct(e.target.value)}
                  className="w-full bg-[#0F131A] border border-slate-700 rounded-md px-2.5 py-1.5 text-xs font-mono-tabular text-slate-100"
                />
              </div>
              <div className="flex flex-col justify-between">
                <span className="text-[11px] text-slate-400">Kill Switch (Cierra Posiciones)</span>
                <button
                  type="button"
                  onClick={() => {
                    soundEngine.click();
                    setKillSwitchEnabled(!killSwitchEnabled);
                  }}
                  className={`py-1.5 rounded text-xs font-bold border ${
                    killSwitchEnabled
                      ? 'bg-red-600/80 border-red-400 text-white'
                      : 'bg-slate-800 border-slate-700 text-slate-400'
                  }`}
                >
                  {killSwitchEnabled ? 'ON (Auto-Cierre)' : 'OFF (Libre)'}
                </button>
              </div>
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Max Posiciones</label>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={maxOpenPositions}
                  onChange={(e) => setMaxOpenPositions(e.target.value)}
                  className="w-full bg-[#0F131A] border border-slate-700 rounded-md px-2.5 py-1.5 text-xs font-mono-tabular text-slate-100"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">% Equity / Trade (Tope)</label>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={capitalPctPerTrade}
                  onChange={(e) => setCapitalPctPerTrade(e.target.value)}
                  className="w-full bg-[#0F131A] border border-slate-700 rounded-md px-2.5 py-1.5 text-xs font-mono-tabular text-slate-100"
                />
              </div>
              <div className="flex flex-col justify-between">
                <span className="text-[11px] text-slate-400">Gestión Auto TP1/TP2/TP3</span>
                <button
                  type="button"
                  onClick={() => {
                    soundEngine.click();
                    setAutoManagePositions(!autoManagePositions);
                  }}
                  className={`py-1.5 rounded text-xs font-bold ${
                    autoManagePositions ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {autoManagePositions ? 'ACTIVA' : 'OFF'}
                </button>
              </div>
              <div className="flex flex-col justify-between">
                <span className="text-[11px] text-slate-400">Trailing + Breakeven</span>
                <button
                  type="button"
                  onClick={() => {
                    soundEngine.click();
                    setTrailingStopEnabled(!trailingStopEnabled);
                  }}
                  className={`py-1.5 rounded text-xs font-bold ${
                    trailingStopEnabled ? 'bg-amber-500 text-slate-950' : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {trailingStopEnabled ? 'ON' : 'OFF'}
                </button>
              </div>
              <div className="flex flex-col justify-between">
                <span className="text-[11px] text-slate-400">Modo Entradas (Maker/IOC)</span>
                <button
                  type="button"
                  onClick={() => {
                    soundEngine.click();
                    setUseAloEntries(!useAloEntries);
                  }}
                  className={`py-1.5 rounded text-xs font-bold border ${
                    useAloEntries
                      ? 'bg-sky-500/20 border-sky-500 text-sky-300'
                      : 'bg-slate-800 border-slate-700 text-slate-300'
                  }`}
                >
                  {useAloEntries ? 'ALO Post-Only' : 'IOC (1.0–1.5%)'}
                </button>
              </div>
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Piso Mínimo Orden ($ USD)</label>
                <input
                  type="number"
                  min={0}
                  max={1000}
                  step="1"
                  value={minOrderUsdFloor}
                  onChange={(e) => setMinOrderUsdFloor(e.target.value)}
                  className="w-full bg-[#0F131A] border border-slate-700 rounded-md px-2.5 py-1.5 text-xs font-mono-tabular text-slate-100"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Cooldown 3 Pérdidas (hrs)</label>
                <input
                  type="number"
                  min={0.5}
                  max={72}
                  step="0.5"
                  value={streakCooldownHours}
                  onChange={(e) => setStreakCooldownHours(e.target.value)}
                  className="w-full bg-[#0F131A] border border-slate-700 rounded-md px-2.5 py-1.5 text-xs font-mono-tabular text-slate-100"
                />
              </div>
            </div>
          </div>

          {/* Bias Lock, Watchlist & Montana Cloud (mcloud) */}
          <div className="p-4 rounded-lg bg-[#090B0E] border border-slate-800 space-y-3">
            <div className="text-xs font-semibold text-emerald-300">
              Control Direccional (Bias Lock), Watchlist Activa y Montana Cloud (`mcloud`)
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Bias Lock Global</label>
                <div className="grid grid-cols-4 gap-1">
                  {(['AMBOS', 'SOLO_LONG', 'SOLO_SHORT', 'PAUSA'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => {
                        soundEngine.click();
                        setGlobalBiasLock(mode);
                      }}
                      className={`py-1.5 px-1 rounded text-[10px] font-bold border ${
                        globalBiasLock === mode
                          ? mode === 'PAUSA'
                            ? 'bg-red-500/25 border-red-500 text-red-300'
                            : 'bg-amber-500 text-slate-950 border-amber-400'
                          : 'bg-[#0F131A] border-slate-800 text-slate-400'
                      }`}
                    >
                      {mode.replace('_', ' ')}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Watchlist Activa (CSV)</label>
                <input
                  type="text"
                  value={watchlistCoinsCsv}
                  onChange={(e) => setWatchlistCoinsCsv(e.target.value)}
                  placeholder="BTC,ETH,SOL,HYPE"
                  className="w-full bg-[#0F131A] border border-slate-700 rounded-md px-2.5 py-1.5 text-xs font-mono-tabular text-slate-100"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] text-slate-400 mb-1">
                Bloqueo por Par JSON (ej: {`{"BTC":"SOLO_LONG","ETH":"PAUSA"}`})
              </label>
              <input
                type="text"
                value={pairBiasLocksJson}
                onChange={(e) => setPairBiasLocksJson(e.target.value)}
                className="w-full bg-[#0F131A] border border-slate-700 rounded-md px-2.5 py-1.5 text-xs font-mono-tabular text-slate-100"
              />
            </div>

            <div className="pt-2 border-t border-slate-800/80 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-slate-300 font-semibold">
                  Integración Montana Cloud (`mcloud` inferencia + eventos HMAC)
                </span>
                <button
                  type="button"
                  onClick={() => {
                    soundEngine.click();
                    setMcloudEnabled(!mcloudEnabled);
                  }}
                  className={`px-2.5 py-1 rounded text-[11px] font-bold ${
                    mcloudEnabled ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {mcloudEnabled ? 'mcloud ON' : 'mcloud OFF'}
                </button>
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  value={mcloudUrl}
                  onChange={(e) => setMcloudUrl(e.target.value)}
                  placeholder="https://mcloud-1036926196544.us-east1.run.app"
                  className="flex-1 bg-[#0F131A] border border-slate-700 rounded-md px-2.5 py-1.5 text-xs font-mono-tabular text-slate-100"
                />
                <button
                  type="button"
                  disabled={mcloudTesting}
                  onClick={() => void runMcloudDiagnostic()}
                  className="px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold whitespace-nowrap"
                >
                  {mcloudTesting ? 'Probando mcloud...' : 'Probar Montana Cloud'}
                </button>
              </div>
              {mcloudTestResult && (
                <div
                  className={`text-[11px] px-2.5 py-1.5 rounded border ${
                    mcloudTestResult.ok
                      ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-300'
                      : 'bg-amber-500/10 border-amber-500/40 text-amber-300'
                  }`}
                >
                  {mcloudTestResult.text}
                </div>
              )}
            </div>
          </div>

          {/* Quantitative & Execution Parameters */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Cadencia Auto (seg)</label>
              <input
                type="number"
                min={15}
                max={3600}
                value={scanIntervalSec}
                onChange={(e) => setScanIntervalSec(e.target.value)}
                className="w-full bg-[#090B0E] border border-slate-700 rounded-md px-3 py-1.5 text-xs font-mono-tabular text-slate-100"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Confianza Mín. IA (%)</label>
              <input
                type="number"
                min={35}
                max={99}
                value={minConfidence}
                onChange={(e) => setMinConfidence(e.target.value)}
                className="w-full bg-[#090B0E] border border-slate-700 rounded-md px-3 py-1.5 text-xs font-mono-tabular text-slate-100"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Score Estrategia Mín.</label>
              <input
                type="number"
                min={20}
                max={95}
                value={minQuantScore}
                onChange={(e) => setMinQuantScore(e.target.value)}
                className="w-full bg-[#090B0E] border border-slate-700 rounded-md px-3 py-1.5 text-xs font-mono-tabular text-slate-100"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Volumen 24h Mín ($M)</label>
              <input
                type="number"
                step="0.5"
                min={0.1}
                value={minVolumeM}
                onChange={(e) => setMinVolumeM(e.target.value)}
                className="w-full bg-[#090B0E] border border-slate-700 rounded-md px-3 py-1.5 text-xs font-mono-tabular text-slate-100"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Take Profit Objetivo (%)</label>
              <input
                type="number"
                step="0.5"
                min={0.2}
                max={200}
                value={tpPct}
                onChange={(e) => setTpPct(e.target.value)}
                className="w-full bg-[#090B0E] border border-slate-700 rounded-md px-3 py-1.5 text-xs font-mono-tabular text-slate-100"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Stop Loss Objetivo (%)</label>
              <input
                type="number"
                step="0.05"
                min={0.05}
                max={50}
                value={slPct}
                onChange={(e) => setSlPct(e.target.value)}
                className="w-full bg-[#090B0E] border border-slate-700 rounded-md px-3 py-1.5 text-xs font-mono-tabular text-slate-100"
              />
            </div>
          </div>

          <div className="pt-3 flex items-center justify-end gap-3 border-t border-slate-800">
            <button
              type="button"
              onClick={() => {
                soundEngine.click();
                onClose();
              }}
              className="px-4 py-2 text-xs font-medium text-slate-300 hover:text-white"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-md bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold"
            >
              Guardar Panel y Sincronizar Modelos
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
