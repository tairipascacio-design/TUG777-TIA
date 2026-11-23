import React, { useState } from 'react';
import { Check, Cloud, Copy, Download, Smartphone } from 'lucide-react';
import { downloadAndroidApkKit } from '../utils/apkPackager';
import { soundEngine } from '../utils/soundEngine';

interface DropletDeployViewProps {
  isInstallable: boolean;
  onTriggerPwaInstall: () => void;
}

export const DropletDeployView: React.FC<DropletDeployViewProps> = ({
  isInstallable,
  onTriggerPwaInstall,
}) => {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [downloadingApk, setDownloadingApk] = useState(false);

  const originUrl = typeof window !== 'undefined' ? window.location.origin : 'https://tu-servicio.run.app';

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

  const cloudRunDeployCmd = `# 1. Desplegar tug777-engine 24/7 en Google Cloud Run (región us-east1 junto a mcloud)
gcloud run deploy tug777-engine \\
  --source . \\
  --region us-east1 \\
  --platform managed \\
  --allow-unauthenticated \\
  --min-instances 1 \\
  --max-instances 1 \\
  --no-cpu-throttling \\
  --port 8080 \\
  --set-env-vars "NODE_ENV=production,HL_NETWORK=mainnet,MCLOUD_URL=https://mcloud-1036926196544.us-east1.run.app,TUG777_ENGINE_TOKEN=TUG777_ENGINE"`;

  const secretsEnvTemplate = `# 2. Variables / Secretos recomendados en Cloud Run (Secret Manager / --set-secrets)
GEMINI_API_KEY="TU_GEMINI_API_KEY"
HL_MASTER_ADDRESS="0xTuMasterAddress"
# Opcional para ejecución autónoma 24/7 sin depender del teléfono:
HL_API_PRIVATE_KEY="0xTuAgentPrivateKey"
MCLOUD_URL="https://mcloud-1036926196544.us-east1.run.app"
MCLOUD_API_KEY="TU_CLAVE_MC_LIVE_DE_MCLOUD"
MCLOUD_SECRET="TU_WEBHOOK_SECRET_HMAC"
ENGINE_AUTH_TOKEN="TOKEN_INTERNO_THIN_CLIENT"`;

  const verifyEndpointsCmd = `# 3. Verificar salud de tug777-engine (siempre arranca en PAUSA por seguridad)
curl -s https://TU_SERVICIO_TUG777.us-east1.run.app/api/health
curl -s https://TU_SERVICIO_TUG777.us-east1.run.app/api/engine/state

# 4. Verificar webhook activo de Montana Cloud (mcloud)
curl -s -X POST https://mcloud-1036926196544.us-east1.run.app/api/wh/tug777 \\
  -H "Content-Type: application/json" -d '{"evento":"health_probe","origen":"tug777-engine"}'`;

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Android APK & Mobile Install Section */}
      <div className="bg-[#0F131A] border border-slate-800/90 rounded-lg p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-amber-400">
            <Smartphone className="w-5 h-5" />
            <h2 className="text-base font-bold text-slate-100">
              App Android (.apk Firmado — Thin Client Conectado a Cloud Run + mcloud)
            </h2>
          </div>
          <p className="text-xs text-slate-400 max-w-2xl">
            Descarga e instala <code className="text-amber-300">TUG777-HyperTrade.apk</code> para Android 7–15. Funciona como panel de control ligero conectado vía REST + WebSocket (<code className="text-emerald-300">/ws</code>) a tu motor 24/7 <code className="text-sky-300">tug777-engine</code> en Cloud Run, evitando cierres por batería o red móvil.
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
            {downloadingApk ? 'Descargando APK...' : 'Descargar TUG777-HyperTrade.apk'}
          </button>
        </div>
      </div>

      {/* Google Cloud Run 24/7 + Montana Cloud Guide */}
      <div className="bg-[#0F131A] border border-slate-800/90 rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-800 flex items-center gap-2.5">
          <Cloud className="w-5 h-5 text-sky-400" />
          <div>
            <h2 className="text-base font-bold text-slate-100">
              Motor 24/7 en Google Cloud Run (`tug777-engine`, us-east1) + Montana Cloud (`mcloud`)
            </h2>
            <p className="text-xs text-slate-400">
              WebSocket persistente a Hyperliquid · Instancia única siempre activa (`--min-instances=1 --max-instances=1 --no-cpu-throttling`) · Arranque seguro en PAUSA
            </p>
          </div>
        </div>

        <div className="p-6 space-y-6">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-200">
                Paso 1 · Desplegar `tug777-engine` en Cloud Run (us-east1) con `Dockerfile` incluido
              </span>
              <button
                onClick={() => copyBlock('cloudrun', cloudRunDeployCmd)}
                className="inline-flex items-center gap-1 text-xs text-amber-400 hover:text-amber-300"
              >
                {copiedKey === 'cloudrun' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedKey === 'cloudrun' ? 'Copiado' : 'Copiar'}
              </button>
            </div>
            <pre className="p-4 rounded-md bg-[#090B0E] border border-slate-800 text-xs font-mono-tabular text-slate-300 overflow-x-auto">
              {cloudRunDeployCmd}
            </pre>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-200">
                Paso 2 · Variables y Secretos en Cloud Run (Sin exponer llaves en la APK)
              </span>
              <button
                onClick={() => copyBlock('secrets', secretsEnvTemplate)}
                className="inline-flex items-center gap-1 text-xs text-amber-400 hover:text-amber-300"
              >
                {copiedKey === 'secrets' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedKey === 'secrets' ? 'Copiado' : 'Copiar'}
              </button>
            </div>
            <pre className="p-4 rounded-md bg-[#090B0E] border border-slate-800 text-xs font-mono-tabular text-slate-300 overflow-x-auto">
              {secretsEnvTemplate}
            </pre>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-200">
                Paso 3 · Verificar Salud de `tug777-engine` y Montana Cloud (`mcloud`)
              </span>
              <button
                onClick={() => copyBlock('verify', verifyEndpointsCmd)}
                className="inline-flex items-center gap-1 text-xs text-amber-400 hover:text-amber-300"
              >
                {copiedKey === 'verify' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedKey === 'verify' ? 'Copiado' : 'Copiar'}
              </button>
            </div>
            <pre className="p-4 rounded-md bg-[#090B0E] border border-slate-800 text-xs font-mono-tabular text-slate-300 overflow-x-auto">
              {verifyEndpointsCmd}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
};
