import 'dotenv/config';
import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import { engineRuntime } from './server/engineRuntime.ts';
import { fetchMcloudContext, normalizeMcloudBaseUrl, probeMcloudHealth } from './server/mcloudClient.ts';
import {
  analyzeMarketWithBrain,
  benchmarkAndVerifyFreeGeminiModels,
  chatWithTradingBrain,
  extractPostTradeLesson,
  fetchMacroCatalystGrounding,
  listAvailableFreeGeminiModels,
} from './server/geminiService.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: '2mb' }));

// Allow cross-origin requests from standalone Android APK and web dashboards
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, X-TUG777-Token');
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

function isAuthorizedEngineRequest(req: express.Request, queryToken?: string): boolean {
  const required = (process.env.ENGINE_AUTH_TOKEN || '').trim();
  if (!required) return true;
  const auth = req.headers.authorization || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const headerToken = typeof req.headers['x-tug777-token'] === 'string' ? req.headers['x-tug777-token'].trim() : '';
  return bearer === required || headerToken === required || queryToken === required;
}

const HL_ENDPOINTS = {
  mainnet: 'https://api.hyperliquid.xyz',
  testnet: 'https://api.hyperliquid-testnet.xyz',
} as const;

// Low-latency Hyperliquid /info fetch with 1 clean transient retry (avoids 2x parallel rate-limit hits & AggregateError)
async function raceHyperliquidPost(network: 'mainnet' | 'testnet', endpointPath: string, body: unknown) {
  const baseUrl = HL_ENDPOINTS[network] || HL_ENDPOINTS.mainnet;
  const startedAt = performance.now();
  let lastErr: Error | null = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch(`${baseUrl}${endpointPath}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`HL HTTP ${res.status}: ${errText.slice(0, 180)}`);
      }
      const data = await res.json();
      return {
        data,
        latencyMs: Math.round(performance.now() - startedAt),
        channel: 'HL-NODE-1',
      };
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 250));
      }
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastErr || new Error('Error conectando con Hyperliquid Info');
}

// Health check
app.get('/api/health', (_req, res) => {
  const snap = engineRuntime.getSnapshot();
  res.json({
    status: 'ok',
    service: 'tug777-engine',
    enginePaused: snap.enginePaused,
    wsConnected: snap.wsConnected,
    wsLatencyMs: snap.wsLatencyMs,
    mcloudConnected: snap.mcloudConnected,
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
    customAiConfigured: Boolean(process.env.CUSTOM_AI_API_KEY),
    timestamp: Date.now(),
  });
});

// Engine Thin Client State & Controls
app.get('/api/engine/state', (req, res) => {
  if (!isAuthorizedEngineRequest(req)) {
    return res.status(401).json({ error: 'Token de engine no autorizado.' });
  }
  res.json(engineRuntime.getSnapshot());
});

app.post('/api/engine/control', (req, res) => {
  if (!isAuthorizedEngineRequest(req)) {
    return res.status(401).json({ error: 'Token de engine no autorizado.' });
  }
  const { action, coin, interval, reason } = req.body ?? {};
  if (action === 'SELECT_FEED') {
    const snapshot = engineRuntime.setFeedSelection(coin, interval);
    return res.json({ ok: true, snapshot });
  }
  if (action === 'START' || action === 'PAUSE' || action === 'ANALYZE_NOW') {
    const result = engineRuntime.controlEngine(action, reason);
    return res.status(result.ok ? 200 : 400).json(result);
  }
  return res.status(400).json({ error: 'Acción inválida (usa START, PAUSE, ANALYZE_NOW o SELECT_FEED).' });
});

app.post('/api/engine/config', (req, res) => {
  if (!isAuthorizedEngineRequest(req)) {
    return res.status(401).json({ error: 'Token de engine no autorizado.' });
  }
  try {
    const { config, apiPrivateKey } = req.body ?? {};
    const snapshot = engineRuntime.updateConfig(config || {}, apiPrivateKey);
    res.json({ ok: true, snapshot });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Error guardando configuración.' });
  }
});

app.post('/api/engine/manual-order', async (req, res) => {
  if (!isAuthorizedEngineRequest(req)) {
    return res.status(401).json({ error: 'Token de engine no autorizado.' });
  }
  try {
    const { coin, side, notionalUsd, useAlo } = req.body ?? {};
    if (!coin || (side !== 'LONG' && side !== 'SHORT') || !Number.isFinite(Number(notionalUsd))) {
      return res.status(400).json({ error: 'Parámetros de orden manual inválidos.' });
    }
    const result = await engineRuntime.executeManualOrder({
      coin: String(coin),
      side,
      notionalUsd: Number(notionalUsd),
      useAlo: typeof useAlo === 'boolean' ? useAlo : undefined,
    });
    res.json({ ...result, snapshot: engineRuntime.getSnapshot() });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Error en orden manual.' });
  }
});

app.post('/api/engine/close-position', async (req, res) => {
  if (!isAuthorizedEngineRequest(req)) {
    return res.status(401).json({ error: 'Token de engine no autorizado.' });
  }
  try {
    const { coin } = req.body ?? {};
    if (!coin) return res.status(400).json({ error: 'Falta símbolo coin.' });
    const result = await engineRuntime.closePosition(String(coin));
    res.json({ ...result, snapshot: engineRuntime.getSnapshot() });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Error cerrando posición.' });
  }
});

app.post('/api/engine/close-all', async (req, res) => {
  if (!isAuthorizedEngineRequest(req)) {
    return res.status(401).json({ error: 'Token de engine no autorizado.' });
  }
  try {
    const includeExternal = Boolean(req.body?.includeExternal);
    const results = await engineRuntime.closeAllTugPositions(includeExternal);
    res.json({ ok: true, results, snapshot: engineRuntime.getSnapshot() });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error en cierre global.' });
  }
});

// Montana Cloud (mcloud) Context & Diagnostic Test
app.get('/api/mcloud/context', async (req, res) => {
  const rawUrl = typeof req.query.url === 'string' ? req.query.url : undefined;
  const result = await fetchMcloudContext(rawUrl);
  res.status(result.ok ? 200 : 502).json({
    ...result,
    baseUrl: normalizeMcloudBaseUrl(rawUrl),
  });
});

app.post('/api/mcloud/test', async (req, res) => {
  const rawUrl = typeof req.body?.mcloudUrl === 'string' ? req.body.mcloudUrl : undefined;
  const result = await probeMcloudHealth(rawUrl);
  res.json(result);
});

app.post('/api/engine/probe-url', async (req, res) => {
  const rawUrl = typeof req.body?.url === 'string' ? req.body.url.trim().replace(/\/+$/, '') : '';
  if (!rawUrl || !/^https?:\/\//i.test(rawUrl)) {
    return res.status(400).json({ ok: false, error: 'URL inválida (debe iniciar con http:// o https://).' });
  }
  const target = rawUrl.endsWith('/api/health') ? rawUrl : `${rawUrl}/api/health`;
  const t0 = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const r = await fetch(target, { headers: { Accept: 'application/json' }, signal: controller.signal });
    const raw = await r.text();
    const latencyMs = Math.round(performance.now() - t0);
    let json: Record<string, unknown> | null = null;
    try {
      const trimmed = raw.trim();
      if (trimmed && !trimmed.startsWith('<')) json = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      json = null;
    }
    res.json({ ok: r.ok, status: r.status, latencyMs, target, json, rawSnippet: raw.slice(0, 180) });
  } catch (err) {
    res.status(502).json({
      ok: false,
      status: 0,
      latencyMs: Math.round(performance.now() - t0),
      target,
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    clearTimeout(timer);
  }
});

// Hyperliquid Info Racing Proxy
app.post('/api/hl/info', async (req, res) => {
  try {
    const { network = 'mainnet', payload } = req.body ?? {};
    if (!payload || typeof payload !== 'object') {
      return res.status(400).json({ error: 'Payload Hyperliquid inválido.' });
    }
    const result = await raceHyperliquidPost(network === 'testnet' ? 'testnet' : 'mainnet', '/info', payload);
    res.json(result);
  } catch (err) {
    const msg = err instanceof AggregateError ? err.errors.map((e) => String(e)).join(' | ') : String(err);
    res.status(502).json({ error: `Error conectando con Hyperliquid Info: ${msg}` });
  }
});

// Single-shot relay for mutating EIP-712 signed /exchange actions
async function sendSignedHyperliquidOrder(network: 'mainnet' | 'testnet', signedPayload: unknown) {
  const baseUrl = network === 'testnet' ? 'https://api.hyperliquid-testnet.xyz' : 'https://api.hyperliquid.xyz';
  const startedAt = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(`${baseUrl}/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(signedPayload),
      signal: controller.signal,
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`HL HTTP ${res.status}: ${errText}`);
    }
    const data = await res.json();
    return {
      data,
      latencyMs: Math.round(performance.now() - startedAt),
      channel: 'HL-EXCHANGE-L1',
    };
  } finally {
    clearTimeout(timer);
  }
}

app.post('/api/hl/exchange', async (req, res) => {
  try {
    const { network = 'mainnet', signedPayload } = req.body ?? {};
    if (!signedPayload || !signedPayload.action || !signedPayload.signature) {
      return res.status(400).json({ error: 'Payload firmado EIP-712 requerido para ejecución real.' });
    }
    const result = await sendSignedHyperliquidOrder(
      network === 'testnet' ? 'testnet' : 'mainnet',
      signedPayload
    );
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: `Error ejecutando orden en Hyperliquid: ${msg}` });
  }
});

// Hyperliquid WebSocket + Info + Montana Cloud Probe (ETH Flashbots RPC completely purged)
app.get('/api/mev/probe', async (req, res) => {
  const network = req.query.network === 'testnet' ? 'testnet' : 'mainnet';
  const hlBase = network === 'testnet' ? 'https://api.hyperliquid-testnet.xyz' : 'https://api.hyperliquid.xyz';

  const probeChannel = async (
    id: string,
    name: string,
    scope: 'HYPERLIQUID_INFO' | 'HYPERLIQUID_WS' | 'MCLOUD_API',
    url: string,
    body: unknown
  ) => {
    const t0 = performance.now();
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const rtt = Math.round(performance.now() - t0);
      if (!r.ok) return { id, name, scope, ok: false, latencyMs: rtt, detail: `HTTP ${r.status}` };
      await r.json();
      return { id, name, scope, ok: true, latencyMs: rtt, detail: 'OK' };
    } catch (e) {
      return { id, name, scope, ok: false, latencyMs: Math.round(performance.now() - t0), detail: String(e) };
    }
  };

  const snap = engineRuntime.getSnapshot();
  const [hlMeta, hlMids, mcloudProbe] = await Promise.all([
    probeChannel('hl_info_meta', 'HL Info (Meta)', 'HYPERLIQUID_INFO', `${hlBase}/info`, { type: 'meta' }),
    probeChannel('hl_info_mids', 'HL Info (Mids)', 'HYPERLIQUID_INFO', `${hlBase}/info`, { type: 'allMids' }),
    probeMcloudHealth(snap.mcloudUrl),
  ]);

  const wsChannel = {
    id: 'hl_ws_stream',
    name: 'Hyperliquid WS Persistente',
    scope: 'HYPERLIQUID_WS' as const,
    ok: snap.wsConnected,
    latencyMs: snap.wsLatencyMs || 0,
    detail: snap.wsConnected ? `Conectado (${snap.wsUrl})` : 'Reconectando...',
  };

  const mcloudChannel = {
    id: 'mcloud_api',
    name: 'Montana Cloud (mcloud)',
    scope: 'MCLOUD_API' as const,
    ok: mcloudProbe.ok,
    latencyMs: mcloudProbe.healthLatencyMs || mcloudProbe.contextLatencyMs || 0,
    detail: mcloudProbe.detail,
  };

  res.json({
    channels: [wsChannel, hlMeta, hlMids, mcloudChannel],
    bestHlLatencyMs: Math.min(
      hlMeta.latencyMs,
      hlMids.latencyMs,
      snap.wsConnected && snap.wsLatencyMs > 0 ? snap.wsLatencyMs : 9999
    ),
    wsConnected: snap.wsConnected,
    checkedAt: Date.now(),
  });
});

// Gemini AI Unified Brain Routes
app.post('/api/ai/analyze-market', async (req, res) => {
  try {
    const result = await analyzeMarketWithBrain(req.body);
    res.json(result);
  } catch (err) {
    console.error('AI analyze error:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error en análisis IA.' });
  }
});

app.post('/api/ai/macro-radar', async (req, res) => {
  try {
    const { coins = ['BTC', 'ETH', 'SOL', 'HYPE'] } = req.body ?? {};
    const result = await fetchMacroCatalystGrounding(coins);
    res.json(result);
  } catch (err) {
    console.error('Macro radar error:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error en radar macro.' });
  }
});

app.post('/api/ai/post-trade-lesson', async (req, res) => {
  try {
    const result = await extractPostTradeLesson(req.body);
    res.json(result);
  } catch (err) {
    console.error('Post-trade lesson error:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error generando lección.' });
  }
});

app.get('/api/ai/models', async (_req, res) => {
  try {
    const result = await listAvailableFreeGeminiModels();
    res.json(result);
  } catch (err) {
    console.error('List free models error:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error listando modelos Gemini.' });
  }
});

app.post('/api/ai/test-models', async (req, res) => {
  try {
    const targetModels = Array.isArray(req.body?.models) ? req.body.models : undefined;
    const result = await benchmarkAndVerifyFreeGeminiModels(targetModels);
    res.json(result);
  } catch (err) {
    console.error('Benchmark free models error:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error probando modelos Gemini.' });
  }
});

app.post('/api/ai/chat', async (req, res) => {
  try {
    const result = await chatWithTradingBrain(req.body);
    res.json(result);
  } catch (err) {
    console.error('AI chat error:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error en chat IA.' });
  }
});

async function startServer() {
  const PORT = Number(process.env.PORT || 3000);

  app.get('/TUG777-HyperTrade.apk', (_req, res) => {
    const apkPath = path.join(__dirname, 'public', 'TUG777-HyperTrade.apk');
    res.setHeader('Content-Type', 'application/vnd.android.package-archive');
    res.setHeader('Content-Disposition', 'attachment; filename="TUG777-HyperTrade.apk"');
    res.sendFile(apkPath);
  });

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API route not found' });
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const httpServer = http.createServer(app);
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (ws, req) => {
    const urlObj = new URL(req.url || '/ws', `http://${req.headers.host || 'localhost'}`);
    const token = urlObj.searchParams.get('token') || undefined;
    const required = (process.env.ENGINE_AUTH_TOKEN || '').trim();
    if (required && token !== required) {
      ws.close(1008, 'Unauthorized');
      return;
    }

    engineRuntime.attachWsClient(ws);

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as { type?: string; coin?: string; interval?: '1m' | '5m' | '15m' | '1h' | '4h' };
        if (msg.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong', payload: null, ts: Date.now() }));
        } else if (msg.type === 'select_feed') {
          engineRuntime.setFeedSelection(msg.coin, msg.interval);
        }
      } catch {
        // ignore invalid client frame
      }
    });
  });

  engineRuntime.start();

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`TUG777 HyperTrade (tug777-engine) running on http://0.0.0.0:${PORT} [PAUSED]`);
  });
}

startServer();
