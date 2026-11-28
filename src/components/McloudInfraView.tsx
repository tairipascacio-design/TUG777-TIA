import React, { useEffect, useState } from 'react';
import {
  Activity,
  Check,
  Cloud,
  Copy,
  Database,
  Download,
  RefreshCw,
  Save,
  Send,
  Server,
  Smartphone,
  Webhook,
} from 'lucide-react';
import {
  fetchMcloudContextFromServer,
  getConfiguredBackendUrl,
  hasConfiguredBackendForApk,
  isRunningInEmbeddedApk,
  setConfiguredBackendUrl,
  syncMcloudStateFromServer,
  testMcloudConnection,
} from '../services/hyperliquidClient';
import type { BotConfigData, EngineStateSnapshot } from '../types/trading';
import { downloadAndroidApkKit } from '../utils/apkPackager';
import { soundEngine } from '../utils/soundEngine';

interface McloudInfraViewProps {
  config: BotConfigData;
  engineSnapshot: EngineStateSnapshot | null;
  onSaveMcloudConfig: (patch: { mcloudEnabled: boolean; mcloudUrl: string }) => Promise<void> | void;
  onApplyEngineSnapshot?: (snap: EngineStateSnapshot) => void;
  isInstallable: boolean;
  onTriggerPwaInstall: () => void;
}

const DEFAULT_MCLOUD_BASE = 'https://mcloud-1036926196544.us-east1.run.app';

export const McloudInfraView: React.FC<McloudInfraViewProps> = ({
  config,
  engineSnapshot,
  onSaveMcloudConfig,
  onApplyEngineSnapshot,
  isInstallable,
  onTriggerPwaInstall,
}) => {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [downloadingApk, setDownloadingApk] = useState(false);

  const [mcloudEnabled, setMcloudEnabled] = useState<boolean>(config.mcloudEnabled ?? true);
  const [mcloudUrl, setMcloudUrl] = useState<string>(
    config.mcloudUrl || engineSnapshot?.mcloudUrl || DEFAULT_MCLOUD_BASE
  );
  const [savingMcloud, setSavingMcloud] = useState(false);

  const [engineUrlInput, setEngineUrlInput] = useState<string>(() => getConfiguredBackendUrl());
  const [engineProbeMsg, setEngineProbeMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [probingEngine, setProbingEngine] = useState(false);

  const [testing, setTesting] = useState(false);
  const [probeResult, setProbeResult] = useState<{
    ok: boolean;
    baseUrl: string;
    detail: string;
    webhookStatus: number;
    webhookLatencyMs: number;
    healthStatus: number;
    healthLatencyMs: number;
    contextStatus: number;
    contextLatencyMs: number;
    hmacConfigured: boolean;
  } | null>(null);
  const [probeError, setProbeError] = useState<string | null>(null);

  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);

  const [readingContext, setReadingContext] = useState(false);
  const [contextOutput, setContextOutput] = useState<string | null>(null);

  useEffect(() => {
    setMcloudEnabled(config.mcloudEnabled ?? true);
    if (config.mcloudUrl) {
      setMcloudUrl(config.mcloudUrl);
    }
  }, [config.mcloudEnabled, config.mcloudUrl]);

  const inStandaloneApk = isRunningInEmbeddedApk();
  const hasEngineBackend = hasConfiguredBackendForApk();
  const originUrl =
    typeof window !== 'undefined' ? window.location.origin : 'https://tu-servicio.run.app';
  const normalizedBase =
    (mcloudUrl || DEFAULT_MCLOUD_BASE)
      .trim()
      .replace(/\/api\/wh\/[a-zA-Z0-9_-]+(?:\/api\/health)?\/?$/i, '')
      .replace(/\/+$/, '') || DEFAULT_MCLOUD_BASE;

  const copyBlock = (key: string, text: string) => {
    soundEngine.click();
    void navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1800);
  };

  const handleDownloadApkKit = async () => {
    soundEngine.tradeExecuted();
    setDownloadingApk(true);
    try {
      await downloadAndroidApkKit(originUrl);
    } finally {
      setDownloadingApk(false);
    }
  };

  const handleSaveAndTestEngineUrl = async () => {
    soundEngine.click();
    const cleaned = engineUrlInput.trim().replace(/\/+$/, '');
    if (cleaned && (/mcloud-\d+/i.test(cleaned) || /\/api\/wh\//i.test(cleaned))) {
      setEngineProbeMsg({
        ok: false,
        text: 'Esa URL es de mcloud (almacén/webhooks). El campo Relay Engine es solo para tu servicio tug777-engine en Cloud Run.',
      });
      return;
    }
    setConfiguredBackendUrl(cleaned);
    if (!cleaned) {
      setEngineProbeMsg({
        ok: true,
        text: inStandaloneApk
          ? 'Modo APK directo activo: Hyperliquid L1 + WebSocket directo (wss://api.hyperliquid.xyz/ws) + Firestore OAuth.'
          : 'Modo Auto (origen actual conectado a tug777-engine + mcloud).',
      });
      return;
    }
    setProbingEngine(true);
    setEngineProbeMsg(null);
    const t0 = performance.now();
    try {
      const res = await fetch(`${cleaned}/api/health`, { headers: { Accept: 'application/json' } });
      const raw = await res.text();
      if (!raw.trim() || raw.trim().startsWith('<')) {
        setEngineProbeMsg({
          ok: false,
          text: `HTTP ${res.status} (devolvió HTML en lugar de JSON). Verifica que ${cleaned} sea tu servicio público tug777-engine.`,
        });
        return;
      }
      const data = JSON.parse(raw) as { status?: string; mcloudConnected?: boolean; wsConnected?: boolean };
      const ms = Math.round(performance.now() - t0);
      setEngineProbeMsg({
        ok: res.ok && data.status === 'ok',
        text: `Relay tug777-engine OK (${ms} ms) · WS: ${data.wsConnected ? 'ON' : 'OFF'} · mcloud: ${data.mcloudConnected ? 'CONECTADA' : 'ESPERA'}. Recarga o prueba mcloud abajo.`,
      });
    } catch (err) {
      setEngineProbeMsg({
        ok: false,
        text: `No se pudo conectar con ${cleaned}/api/health: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setProbingEngine(false);
    }
  };

  const handleSaveConfig = async () => {
    soundEngine.click();
    setSavingMcloud(true);
    try {
      await onSaveMcloudConfig({
        mcloudEnabled,
        mcloudUrl: mcloudUrl.trim() || DEFAULT_MCLOUD_BASE,
      });
    } finally {
      setSavingMcloud(false);
    }
  };

  const handleRunProbe = async () => {
    soundEngine.click();
    setTesting(true);
    setProbeError(null);
    try {
      const res = await testMcloudConnection(mcloudUrl.trim() || DEFAULT_MCLOUD_BASE);
      setProbeResult(res);
    } catch (err) {
      setProbeError(err instanceof Error ? err.message : String(err));
    } finally {
      setTesting(false);
    }
  };

  const handleSyncState = async () => {
    soundEngine.click();
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await syncMcloudStateFromServer(mcloudUrl.trim() || DEFAULT_MCLOUD_BASE);
      if (res.snapshot && onApplyEngineSnapshot) {
        onApplyEngineSnapshot(res.snapshot);
      }
      setSyncResult({
        ok: res.ok,
        text: `Webhook wh/tug777: HTTP ${res.webhookResult.status || 'ERR'} (${res.webhookResult.latencyMs} ms)${res.webhookResult.error ? ` [${res.webhookResult.error}]` : ''} · KV engine_state: HTTP ${res.kvResult.status || 'ERR'} (${res.kvResult.latencyMs} ms)${res.kvResult.error ? ` [${res.kvResult.error}]` : ''}`,
      });
    } catch (err) {
      setSyncResult({
        ok: false,
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSyncing(false);
    }
  };

  const handleReadContext = async () => {
    soundEngine.click();
    setReadingContext(true);
    setContextOutput(null);
    try {
      const res = await fetchMcloudContextFromServer(mcloudUrl.trim() || DEFAULT_MCLOUD_BASE);
      if (res.ok && res.data !== null) {
        setContextOutput(JSON.stringify(res.data, null, 2));
      } else {
        setContextOutput(
          `HTTP ${res.status} (${res.latencyMs} ms): ${res.error || 'Sin objeto en /api/kv/tug777/context'}`
        );
      }
    } catch (err) {
      setContextOutput(err instanceof Error ? err.message : String(err));
    } finally {
      setReadingContext(false);
    }
  };

  const mcloudEndpoints = [
    {
      id: 'wh-tug777',
      label: 'Tug777 · Almacén JSON Principal (v3)',
      methods: 'GET · POST · PUT',
      bucket: 'webhooks-capturados',
      url: `${normalizedBase}/api/wh/tug777`,
      note: 'Endpoint principal usado por tug777-engine para eventos, trades y telemetría.',
    },
    {
      id: 'wh-tugg777',
      label: 'Tugg777 · Almacén JSON Backup (v1)',
      methods: 'GET · POST · DELETE',
      bucket: 'webhooks-capturados',
      url: `${normalizedBase}/api/wh/tugg777`,
      note: 'Endpoint secundario respaldado por HMAC-SHA256 / Bearer.',
    },
    {
      id: 'wh-warcore',
      label: 'Warcore Foundry & Nexus Sync',
      methods: 'POST',
      bucket: 'warcore-sync',
      url: `${normalizedBase}/api/wh/warcore-sync`,
      note: 'Receptor sincronizado para eventos de Warcore Foundry, Nexus y n8n.',
    },
    {
      id: 'wh-nexus',
      label: 'Nexus Events Inbound',
      methods: 'POST',
      bucket: 'nexus-events',
      url: `${normalizedBase}/api/wh/nexus-events`,
      note: 'Receptor inbound para señales de Nexus.',
    },
    {
      id: 'kv-store',
      label: 'Bóveda KV JSON (Contexto / Estado)',
      methods: 'PUT · GET',
      bucket: 'tug777',
      url: `${normalizedBase}/api/kv/tug777/engine_state`,
      note: 'Lectura y escritura persistente de objetos JSON (requiere MCLOUD_API_KEY).',
    },
    {
      id: 'warcore-inbound',
      label: 'Sincronización Inbound Warcore / Nexus',
      methods: 'POST',
      bucket: 'inbound',
      url: `${normalizedBase}/api/sync/warcore/inbound`,
      note: 'Sincronización directa de eventos Warcore / Nexus.',
    },
    {
      id: 'storage-upload',
      label: 'Subida Binaria o JSON',
      methods: 'POST',
      bucket: 'storage',
      url: `${normalizedBase}/api/storage/upload`,
      note: 'Carga de artefactos JSON o binarios hacia tu bóveda mcloud.',
    },
  ];

  const cloudRunConnectCmd = `# Desplegar tug777-engine en Cloud Run (us-east1) conectado a tu infraestructura mcloud
gcloud run deploy tug777-engine \\
  --source . \\
  --region us-east1 \\
  --platform managed \\
  --allow-unauthenticated \\
  --min-instances 1 \\
  --max-instances 1 \\
  --no-cpu-throttling \\
  --port 8080 \\
  --set-env-vars "NODE_ENV=production,HL_NETWORK=mainnet,MCLOUD_URL=${normalizedBase},TUG777_ENGINE_TOKEN=TUG777_ENGINE"`;

  const mcloudEnvTemplate = `# Variables de entorno servidor para enlazar tug777-engine con mcloud (sin exponer secretos al navegador)
MCLOUD_URL="${normalizedBase}"
MCLOUD_API_KEY="TU_CLAVE_MC_LIVE_DE_MCLOUD"
MCLOUD_SECRET="TU_SECRETO_WHSEC_DE_TUG777"
MCLOUD_WEBHOOK_SLUG="tug777"
GEMINI_API_KEY="TU_GEMINI_API_KEY"
HL_MASTER_ADDRESS="0xTuMasterAddress"
HL_API_PRIVATE_KEY="0xTuAgentPrivateKey"`;

  const mcloudVerifyCmd = `# Probar tu endpoint activo /api/wh/tug777 en mcloud con Bearer / HMAC
curl -s -X POST "${normalizedBase}/api/wh/tug777" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer TU_SECRETO_WHSEC_DE_TUG777" \\
  -d '{"evento":"orden.completada","origen":"tug777-engine","apalancamiento":10}'`;

  const isConnected = Boolean(engineSnapshot?.mcloudConnected || probeResult?.ok);

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* 1. Live mcloud Infrastructure Control & Diagnostics */}
      <div className="bg-[#0F131A] border border-slate-800/90 rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Cloud className="w-5 h-5 text-sky-400 shrink-0" />
            <div>
              <h2 className="text-base font-bold text-slate-100">
                Infraestructura Montana Cloud (`mcloud`) — us-east1
              </h2>
              <p className="text-xs text-slate-400">
                Centro operativo de webhooks JSON, bóveda KV y sincronización 24/7 en{' '}
                <code className="text-sky-300">{normalizedBase}</code>
              </p>
            </div>
          </div>
          <span
            className={`px-2.5 py-1 rounded text-xs font-mono font-semibold border self-start sm:self-auto ${
              !mcloudEnabled
                ? 'bg-slate-900 border-slate-700 text-slate-400'
                : isConnected
                ? 'bg-emerald-950/50 border-emerald-500/40 text-emerald-300'
                : 'bg-amber-950/40 border-amber-500/40 text-amber-300'
            }`}
          >
            {!mcloudEnabled
              ? 'mcloud: DESACTIVADA'
              : isConnected
              ? 'mcloud: CONECTADA'
              : hasEngineBackend
              ? 'mcloud: VERIFICAR'
              : 'APK DIRECTO HL'}
          </span>
        </div>

        <div className="p-6 space-y-5">
          {/* Status Metrics Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs font-mono-tabular">
            <div className="bg-[#090B0E] border border-slate-800 rounded p-3">
              <div className="text-slate-500 text-[11px]">Motor Engine</div>
              <div className="text-slate-100 font-semibold mt-0.5">
                {hasEngineBackend
                  ? engineSnapshot?.wsConnected
                    ? `HL-WS LIVE (${engineSnapshot.wsLatencyMs || 0}ms)`
                    : 'Engine REST'
                  : 'HL-WS Directo APK'}
              </div>
            </div>
            <div className="bg-[#090B0E] border border-slate-800 rounded p-3">
              <div className="text-slate-500 text-[11px]">Apalancamiento Objetivo</div>
              <div className="text-amber-300 font-semibold mt-0.5">
                {Math.max(1, Number(config.leverage ?? 10))}x (Cross)
              </div>
            </div>
            <div className="bg-[#090B0E] border border-slate-800 rounded p-3">
              <div className="text-slate-500 text-[11px]">Pares / Estado</div>
              <div className="text-slate-100 font-semibold mt-0.5">
                {engineSnapshot?.scannedTokenCount || 0} pares ·{' '}
                {engineSnapshot?.enginePaused === false ? 'ACTIVO' : 'PAUSA'}
              </div>
            </div>
            <div className="bg-[#090B0E] border border-slate-800 rounded p-3">
              <div className="text-slate-500 text-[11px]">Último Diagnóstico mcloud</div>
              <div className="text-sky-300 font-semibold mt-0.5 truncate" title={engineSnapshot?.mcloudLastStatus || ''}>
                {engineSnapshot?.mcloudLastStatus ||
                  (hasEngineBackend ? 'Listo para probar' : 'Requiere URL relay en APK')}
              </div>
            </div>
          </div>

          {/* URL & Toggle Config */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
            <div className="md:col-span-8 space-y-1.5">
              <label className="block text-xs font-semibold text-slate-300">
                URL Base / Webhook de tu servicio `mcloud`
              </label>
              <input
                type="url"
                value={mcloudUrl}
                onChange={(e) => setMcloudUrl(e.target.value)}
                placeholder={DEFAULT_MCLOUD_BASE}
                className="w-full px-3 py-2 rounded-md bg-[#090B0E] border border-slate-700 text-xs font-mono text-slate-100 focus:outline-none focus:border-sky-500"
              />
            </div>
            <div className="md:col-span-2 flex items-center gap-2 pb-2">
              <input
                id="mcloud-enabled-toggle"
                type="checkbox"
                checked={mcloudEnabled}
                onChange={(e) => setMcloudEnabled(e.target.checked)}
                className="w-4 h-4 accent-sky-500 rounded"
              />
              <label htmlFor="mcloud-enabled-toggle" className="text-xs font-semibold text-slate-200">
                mcloud Activa
              </label>
            </div>
            <div className="md:col-span-2">
              <button
                type="button"
                disabled={savingMcloud}
                onClick={() => void handleSaveConfig()}
                className="w-full px-3 py-2 rounded-md bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 text-xs font-bold inline-flex items-center justify-center gap-1.5"
              >
                <Save className="w-3.5 h-3.5" />
                {savingMcloud ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </div>

          {/* Optional Engine Relay URL for APK outside AI Studio */}
          <div className="p-4 rounded-md bg-[#090B0E] border border-slate-800 space-y-2.5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
              <span className="text-xs font-semibold text-slate-200">
                Relay `tug777-engine` para APK fuera de AI Studio (opcional)
              </span>
              <span className="text-[11px] font-mono text-slate-400">
                {inStandaloneApk
                  ? hasEngineBackend
                    ? 'APK usando relay remoto'
                    : 'APK conectado directo a Hyperliquid L1 + WS'
                  : 'Dentro de origen servidor (Auto)'}
              </span>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="url"
                value={engineUrlInput}
                onChange={(e) => setEngineUrlInput(e.target.value)}
                placeholder="https://tug777-engine-xxxx.us-east1.run.app (vacío = Auto)"
                className="flex-1 px-3 py-2 rounded-md bg-[#0F131A] border border-slate-700 text-xs font-mono text-slate-100 focus:outline-none focus:border-amber-500"
              />
              <button
                type="button"
                disabled={probingEngine}
                onClick={() => void handleSaveAndTestEngineUrl()}
                className="px-4 py-2 rounded-md bg-slate-800 hover:bg-slate-700 border border-slate-600 text-xs font-semibold text-amber-300 whitespace-nowrap"
              >
                {probingEngine ? 'Probando...' : 'Guardar y Probar Relay'}
              </button>
            </div>
            {engineProbeMsg && (
              <div
                className={`text-xs font-mono ${
                  engineProbeMsg.ok ? 'text-emerald-300' : 'text-red-300'
                }`}
              >
                {engineProbeMsg.text}
              </div>
            )}
          </div>

          {/* Live Actions */}
          <div className="flex flex-wrap items-center gap-2.5 pt-1">
            <button
              type="button"
              disabled={testing}
              onClick={() => void handleRunProbe()}
              className="px-3.5 py-2 rounded-md bg-sky-600/20 border border-sky-500/40 hover:bg-sky-600/30 disabled:opacity-50 text-sky-300 text-xs font-semibold inline-flex items-center gap-1.5"
            >
              <Activity className={`w-3.5 h-3.5 ${testing ? 'animate-pulse' : ''}`} />
              {testing ? 'Probando mcloud...' : 'Probar Endpoints mcloud'}
            </button>

            <button
              type="button"
              disabled={syncing}
              onClick={() => void handleSyncState()}
              className="px-3.5 py-2 rounded-md bg-emerald-600/20 border border-emerald-500/40 hover:bg-emerald-600/30 disabled:opacity-50 text-emerald-300 text-xs font-semibold inline-flex items-center gap-1.5"
            >
              <Send className={`w-3.5 h-3.5 ${syncing ? 'animate-pulse' : ''}`} />
              {syncing ? 'Sincronizando...' : 'Sincronizar Estado → mcloud'}
            </button>

            <button
              type="button"
              disabled={readingContext}
              onClick={() => void handleReadContext()}
              className="px-3.5 py-2 rounded-md bg-slate-800 hover:bg-slate-700 border border-slate-700 disabled:opacity-50 text-slate-200 text-xs font-semibold inline-flex items-center gap-1.5"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${readingContext ? 'animate-spin' : ''}`} />
              {readingContext ? 'Leyendo KV...' : 'Leer Contexto KV'}
            </button>
          </div>

          {/* Diagnostic Output Banners */}
          {probeError && (
            <div className="p-3 rounded bg-red-950/40 border border-red-500/40 text-xs text-red-300 font-mono">
              Error probando mcloud: {probeError}
            </div>
          )}

          {probeResult && (
            <div
              className={`p-3 rounded border text-xs font-mono ${
                probeResult.ok
                  ? 'bg-emerald-950/30 border-emerald-500/40 text-emerald-300'
                  : 'bg-amber-950/30 border-amber-500/40 text-amber-300'
              }`}
            >
              <div className="font-semibold">
                {probeResult.ok ? 'Respuesta real mcloud OK' : 'Diagnóstico mcloud'} ({probeResult.baseUrl})
              </div>
              <div className="mt-1 text-[11px]">{probeResult.detail}</div>
            </div>
          )}

          {syncResult && (
            <div
              className={`p-3 rounded border text-xs font-mono ${
                syncResult.ok
                  ? 'bg-emerald-950/30 border-emerald-500/40 text-emerald-300'
                  : 'bg-red-950/40 border-red-500/40 text-red-300'
              }`}
            >
              {syncResult.text}
            </div>
          )}

          {contextOutput && (
            <pre className="p-3 rounded bg-[#090B0E] border border-slate-800 text-[11px] font-mono text-slate-300 overflow-x-auto max-h-48">
              {contextOutput}
            </pre>
          )}
        </div>
      </div>

      {/* 2. Active mcloud Endpoints Map */}
      <div className="bg-[#0F131A] border border-slate-800/90 rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-800 flex items-center gap-2.5">
          <Webhook className="w-5 h-5 text-amber-400 shrink-0" />
          <div>
            <h2 className="text-base font-bold text-slate-100">
              Mapa de Endpoints y Almacenes Activos en `mcloud`
            </h2>
            <p className="text-xs text-slate-400">
              Rutas desplegadas en tu servidor Cloud Run (`mcloud`) para webhooks HMAC, bóveda KV JSON y almacenamiento.
            </p>
          </div>
        </div>
        <div className="divide-y divide-slate-800/80">
          {mcloudEndpoints.map((ep) => (
            <div
              key={ep.id}
              className="px-6 py-3.5 flex flex-col md:flex-row md:items-center justify-between gap-3"
            >
              <div className="space-y-0.5 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-bold text-slate-100">{ep.label}</span>
                  <span className="text-[11px] font-mono text-amber-300">{ep.methods}</span>
                  <span className="text-[11px] font-mono text-slate-500">· bucket: {ep.bucket}</span>
                </div>
                <div className="text-xs font-mono text-sky-300 truncate">{ep.url}</div>
                <div className="text-[11px] text-slate-400">{ep.note}</div>
              </div>
              <button
                type="button"
                onClick={() => copyBlock(ep.id, ep.url)}
                className="px-3 py-1.5 rounded bg-[#090B0E] border border-slate-700 hover:border-slate-500 text-xs font-semibold text-amber-300 inline-flex items-center gap-1.5 shrink-0 self-start md:self-auto"
              >
                {copiedKey === ep.id ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedKey === ep.id ? 'Copiada' : 'Copiar URL'}
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* 3. PWA v3.5.0 + APK v3.5.0 */}
      <div className="bg-[#0F131A] border border-slate-800/90 rounded-lg p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-amber-400">
            <Smartphone className="w-5 h-5" />
            <h2 className="text-base font-bold text-slate-100">
              App Android (.apk v3.5.0) + PWA v3.5.0 → Hyperliquid L1 + mcloud
            </h2>
          </div>
          <p className="text-xs text-slate-400 max-w-2xl">
            Tanto la web/PWA como el instalador <code className="text-amber-300">TUG777-HyperTrade.apk</code> ya incluyen el código <code className="text-emerald-300">v3.5.0</code> (apalancamiento 10x, errores L2 explícitos, pestaña mcloud 24/7 y WebSocket directo <code className="text-sky-300">wss://api.hyperliquid.xyz/ws</code> para operar desde el teléfono sin depender de AI Studio).
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          {isInstallable && (
            <button
              onClick={() => {
                soundEngine.tradeExecuted();
                onTriggerPwaInstall();
              }}
              className="px-4 py-2 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold whitespace-nowrap"
            >
              Instalar App PWA
            </button>
          )}
          <button
            disabled={downloadingApk}
            onClick={handleDownloadApkKit}
            className="px-4 py-2 rounded-md bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold inline-flex items-center gap-2 whitespace-nowrap"
          >
            <Download className="w-4 h-4" />
            {downloadingApk ? 'Descargando APK...' : 'Descargar APK v3.5.0'}
          </button>
        </div>
      </div>

      {/* 4. Cloud Run Engine <-> mcloud Integration Reference */}
      <div className="bg-[#0F131A] border border-slate-800/90 rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-800 flex items-center gap-2.5">
          <Server className="w-5 h-5 text-emerald-400 shrink-0" />
          <div>
            <h2 className="text-base font-bold text-slate-100">
              Despliegue `tug777-engine` (Cloud Run us-east1) enlazado a `mcloud`
            </h2>
            <p className="text-xs text-slate-400">
              WebSocket persistente a Hyperliquid + sincronización HMAC/Bearer hacia <code className="text-sky-300">{normalizedBase}</code> (sin exponer llaves al navegador).
            </p>
          </div>
        </div>

        <div className="p-6 space-y-6">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-200 inline-flex items-center gap-1.5">
                <Cloud className="w-3.5 h-3.5 text-sky-400" />
                Paso 1 · Desplegar motor `tug777-engine` en Cloud Run (misma región `us-east1` que `mcloud`)
              </span>
              <button
                onClick={() => copyBlock('cloudrun', cloudRunConnectCmd)}
                className="inline-flex items-center gap-1 text-xs text-amber-400 hover:text-amber-300"
              >
                {copiedKey === 'cloudrun' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedKey === 'cloudrun' ? 'Copiado' : 'Copiar'}
              </button>
            </div>
            <pre className="p-4 rounded-md bg-[#090B0E] border border-slate-800 text-xs font-mono-tabular text-slate-300 overflow-x-auto">
              {cloudRunConnectCmd}
            </pre>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-200 inline-flex items-center gap-1.5">
                <Database className="w-3.5 h-3.5 text-amber-400" />
                Paso 2 · Variables / Secretos en Cloud Run para conectar con `mcloud`
              </span>
              <button
                onClick={() => copyBlock('secrets', mcloudEnvTemplate)}
                className="inline-flex items-center gap-1 text-xs text-amber-400 hover:text-amber-300"
              >
                {copiedKey === 'secrets' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedKey === 'secrets' ? 'Copiado' : 'Copiar'}
              </button>
            </div>
            <pre className="p-4 rounded-md bg-[#090B0E] border border-slate-800 text-xs font-mono-tabular text-slate-300 overflow-x-auto">
              {mcloudEnvTemplate}
            </pre>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-200">
                Paso 3 · Prueba directa cURL contra tu Almacén JSON `/api/wh/tug777`
              </span>
              <button
                onClick={() => copyBlock('verify', mcloudVerifyCmd)}
                className="inline-flex items-center gap-1 text-xs text-amber-400 hover:text-amber-300"
              >
                {copiedKey === 'verify' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedKey === 'verify' ? 'Copiado' : 'Copiar'}
              </button>
            </div>
            <pre className="p-4 rounded-md bg-[#090B0E] border border-slate-800 text-xs font-mono-tabular text-slate-300 overflow-x-auto">
              {mcloudVerifyCmd}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
};
