import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  analyzeMarketWithBrain,
  chatWithTradingBrain,
  extractPostTradeLesson,
  fetchMacroCatalystGrounding,
} from './server/geminiService.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: '2mb' }));

const HL_ENDPOINTS = {
  mainnet: [
    'https://api.hyperliquid.xyz',
    'https://api.hyperliquid.xyz', // Parallel keep-alive channel #2 for race hedging
  ],
  testnet: [
    'https://api.hyperliquid-testnet.xyz',
    'https://api.hyperliquid-testnet.xyz',
  ],
};

// Multi-connection low-latency racing fetch to Hyperliquid
async function raceHyperliquidPost(network: 'mainnet' | 'testnet', endpointPath: string, body: unknown) {
  const urls = HL_ENDPOINTS[network] || HL_ENDPOINTS.mainnet;
  const startedAt = performance.now();

  const attempts = urls.map(async (baseUrl, channelIdx) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8500);
    try {
      const res = await fetch(`${baseUrl}${endpointPath}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
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
        channel: `HL-NODE-${channelIdx + 1}`,
      };
    } finally {
      clearTimeout(timer);
    }
  });

  return Promise.any(attempts);
}

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// Hyperliquid Info Racing Proxy (metaAndAssetCtxs, l2Book, candleSnapshot, clearinghouseState, userFills, openOrders)
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

// Hyperliquid Signed Exchange Execution Relay (real EIP-712 signed order/cancel/leverage)
app.post('/api/hl/exchange', async (req, res) => {
  try {
    const { network = 'mainnet', signedPayload } = req.body ?? {};
    if (!signedPayload || !signedPayload.action || !signedPayload.signature) {
      return res.status(400).json({ error: 'Payload firmado EIP-712 requerido para ejecución real.' });
    }
    const result = await raceHyperliquidPost(
      network === 'testnet' ? 'testnet' : 'mainnet',
      '/exchange',
      signedPayload
    );
    res.json(result);
  } catch (err) {
    const msg = err instanceof AggregateError ? err.errors.map((e) => String(e)).join(' | ') : String(err);
    res.status(502).json({ error: `Error ejecutando orden en Hyperliquid: ${msg}` });
  }
});

// Real Multi-Connection Latency & Flashbots Protect RPC Probe
app.get('/api/mev/probe', async (req, res) => {
  const network = req.query.network === 'testnet' ? 'testnet' : 'mainnet';
  const hlBase = network === 'testnet' ? 'https://api.hyperliquid-testnet.xyz' : 'https://api.hyperliquid.xyz';

  const probeChannel = async (name: string, url: string, body: unknown) => {
    const t0 = performance.now();
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const rtt = Math.round(performance.now() - t0);
      if (!r.ok) return { name, ok: false, latencyMs: rtt, detail: `HTTP ${r.status}` };
      const json = await r.json();
      return { name, ok: true, latencyMs: rtt, detail: json?.result || 'OK' };
    } catch (e) {
      return { name, ok: false, latencyMs: Math.round(performance.now() - t0), detail: String(e) };
    }
  };

  const [hl1, hl2, flashbots] = await Promise.all([
    probeChannel('Hyperliquid L1 Primary', `${hlBase}/info`, { type: 'meta' }),
    probeChannel('Hyperliquid L1 Backup Pool', `${hlBase}/info`, { type: 'allMids' }),
    probeChannel('Flashbots Protect RPC', 'https://rpc.flashbots.net', {
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_blockNumber',
      params: [],
    }),
  ]);

  res.json({
    channels: [hl1, hl2, flashbots],
    bestHlLatencyMs: Math.min(hl1.latencyMs, hl2.latencyMs),
    flashbotsBlockHex: flashbots.ok ? flashbots.detail : null,
    checkedAt: Date.now(),
  });
});

// Gemini AI Unified Brain: Analyze Market & Strategy Confluence
app.post('/api/ai/analyze-market', async (req, res) => {
  try {
    const result = await analyzeMarketWithBrain(req.body);
    res.json(result);
  } catch (err) {
    console.error('AI analyze error:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error en análisis IA.' });
  }
});

// Gemini AI Search Grounding: Live Macro Catalysts
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

// Gemini AI Post-Trade Learning Distillation
app.post('/api/ai/post-trade-lesson', async (req, res) => {
  try {
    const result = await extractPostTradeLesson(req.body);
    res.json(result);
  } catch (err) {
    console.error('Post-trade lesson error:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error generando lección.' });
  }
});

// Gemini AI Multi-Turn Trading Copilot Chat
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
  const PORT = 3000;

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

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`TUG777 HyperTrade server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
