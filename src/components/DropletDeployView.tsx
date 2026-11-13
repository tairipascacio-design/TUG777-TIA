import React, { useState } from 'react';
import { Check, Copy, Download, Server, Smartphone } from 'lucide-react';
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

  const originUrl = typeof window !== 'undefined' ? window.location.origin : 'https://tu-dominio.com';

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

  const dropletSetupScript = `# 1. Actualizar Ubuntu 24.04 e instalar Node.js 22 + PM2 + Nginx
sudo apt update && sudo apt upgrade -y
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs nginx certbot python3-certbot-nginx ufw

# 2. Instalar PM2 global para ejecución 24/7 con auto-reinicio
sudo npm install -g pm2 tsx

# 3. Clonar / subir proyecto y compilar frontend
cd /opt/tug777-hypertrade
npm install
npm run build`;

  const envTemplate = `NODE_ENV=production
PORT=3000
GEMINI_API_KEY="TU_GEMINI_API_KEY"
APP_URL="https://tu-subdominio.com"
# Opcional para ejecución autónoma 24/7 en el servidor:
HL_NETWORK="mainnet"
HL_MASTER_ADDRESS="0xTuMasterAddress"`;

  const pm2AndNginx = `# 4. Iniciar servidor en modo 24/7 con PM2
NODE_ENV=production pm2 start "npx tsx server.ts" --name tug777-hypertrade
pm2 save
pm2 startup

# 5. Configurar Firewall UFW
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw --force enable

# 6. /etc/nginx/sites-available/tug777
server {
    listen 80;
    server_name tu-subdominio.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}

# 7. Activar HTTPS gratuito para WebSockets + PWA/APK
sudo ln -s /etc/nginx/sites-available/tug777 /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d tu-subdominio.com`;

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Android APK & Mobile Install Section */}
      <div className="bg-[#0F131A] border border-slate-800/90 rounded-lg p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-amber-400">
            <Smartphone className="w-5 h-5" />
            <h2 className="text-base font-bold text-slate-100">
              App Android (.apk Firmado + Instalación Directa)
            </h2>
          </div>
          <p className="text-xs text-slate-400 max-w-2xl">
            Descarga e instala directamente el archivo <code className="text-amber-300">TUG777-HyperTrade.apk</code> firmado para Android 7–15 (con soporte de audio, voz manos libres y selector de servidor para tu Droplet).
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

      {/* DigitalOcean Droplet 24/7 Guide */}
      <div className="bg-[#0F131A] border border-slate-800/90 rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-800 flex items-center gap-2.5">
          <Server className="w-5 h-5 text-sky-400" />
          <div>
            <h2 className="text-base font-bold text-slate-100">
              Despliegue 24/7 en DigitalOcean Droplet (Ubuntu 24.04 LTS)
            </h2>
            <p className="text-xs text-slate-400">
              Baja latencia recomendada: Región NYC1 / NYC3 o FRA1 · Mínimo 1 vCPU / 2 GB RAM
            </p>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {/* Step 1 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-200">
                Paso 1 · Preparar Droplet Ubuntu, Node.js 22 y Compilar
              </span>
              <button
                onClick={() => copyBlock('step1', dropletSetupScript)}
                className="inline-flex items-center gap-1 text-xs text-amber-400 hover:text-amber-300"
              >
                {copiedKey === 'step1' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedKey === 'step1' ? 'Copiado' : 'Copiar'}
              </button>
            </div>
            <pre className="p-4 rounded-md bg-[#090B0E] border border-slate-800 text-xs font-mono-tabular text-slate-300 overflow-x-auto">
              {dropletSetupScript}
            </pre>
          </div>

          {/* Step 2 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-200">
                Paso 2 · Archivo de Entorno (.env) en /opt/tug777-hypertrade/.env
              </span>
              <button
                onClick={() => copyBlock('env', envTemplate)}
                className="inline-flex items-center gap-1 text-xs text-amber-400 hover:text-amber-300"
              >
                {copiedKey === 'env' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedKey === 'env' ? 'Copiado' : 'Copiar'}
              </button>
            </div>
            <pre className="p-4 rounded-md bg-[#090B0E] border border-slate-800 text-xs font-mono-tabular text-slate-300 overflow-x-auto">
              {envTemplate}
            </pre>
          </div>

          {/* Step 3 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-200">
                Paso 3 · Daemon 24/7 con PM2, Firewall UFW, Nginx y SSL Certbot
              </span>
              <button
                onClick={() => copyBlock('pm2', pm2AndNginx)}
                className="inline-flex items-center gap-1 text-xs text-amber-400 hover:text-amber-300"
              >
                {copiedKey === 'pm2' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedKey === 'pm2' ? 'Copiado' : 'Copiar'}
              </button>
            </div>
            <pre className="p-4 rounded-md bg-[#090B0E] border border-slate-800 text-xs font-mono-tabular text-slate-300 overflow-x-auto">
              {pm2AndNginx}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
};
