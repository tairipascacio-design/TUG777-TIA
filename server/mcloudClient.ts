import crypto from 'crypto';

export const DEFAULT_MCLOUD_BASE_URL = 'https://mcloud-1036926196544.us-east1.run.app';

export function extractMcloudWebhookSlug(rawUrl?: string | null): string | null {
  const cleaned = (rawUrl || process.env.MCLOUD_URL || '').trim();
  const match = cleaned.match(/\/api\/wh\/([a-zA-Z0-9_-]+)/i);
  if (match && match[1]) {
    return match[1];
  }
  const envSlug = (process.env.MCLOUD_WEBHOOK_SLUG || '').trim();
  return envSlug || null;
}

export function normalizeMcloudBaseUrl(rawUrl?: string | null): string {
  const cleaned = (rawUrl || process.env.MCLOUD_URL || DEFAULT_MCLOUD_BASE_URL).trim();
  if (!cleaned) return DEFAULT_MCLOUD_BASE_URL;
  return (
    cleaned
      .replace(/\/api\/wh\/[a-zA-Z0-9_-]+(?:\/api\/health)?\/?$/i, '')
      .replace(/\/api\/tug777\/(?:infer|context)\/?$/i, '')
      .replace(/\/api\/kv\/.*$/i, '')
      .replace(/\/+$/, '') || DEFAULT_MCLOUD_BASE_URL
  );
}

function getEngineToken(): string {
  return (process.env.TUG777_ENGINE_TOKEN || 'TUG777_ENGINE').trim();
}

function getMcloudHmacSecret(): string {
  return (process.env.MCLOUD_SECRET || process.env.MCLOUD_HMAC_SECRET || '').trim();
}

function getMcloudApiKey(): string {
  return (process.env.MCLOUD_API_KEY || '').trim();
}

export function buildMcloudSignedHeaders(
  bodyString: string,
  options?: { useWebhookBearer?: boolean; useApiKeyBearer?: boolean; secretOverride?: string }
): Record<string, string> {
  const ts = String(Date.now());
  const secret = (options?.secretOverride ?? getMcloudHmacSecret()).trim();
  const apiKey = getMcloudApiKey();
  const engineToken = getEngineToken();
  const bearer = options?.useApiKeyBearer && apiKey
    ? apiKey
    : options?.useWebhookBearer && secret
    ? secret
    : apiKey || engineToken;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Authorization: `Bearer ${bearer}`,
    'X-TUG777-Timestamp': ts,
    'X-TUG777-Engine': 'tug777-engine',
  };

  if (apiKey) {
    headers['X-API-Key'] = apiKey;
  }

  if (secret) {
    const sigPayload = `${ts}.${bodyString}`;
    const hmacHex = crypto.createHmac('sha256', secret).update(sigPayload).digest('hex');
    const bodyOnlyHmac = crypto.createHmac('sha256', secret).update(bodyString).digest('hex');
    headers['X-TUG777-Signature'] = `sha256=${hmacHex}`;
    headers['X-Webhook-Signature'] = bodyOnlyHmac;
  }

  return headers;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = 4000
): Promise<{ status: number; ok: boolean; latencyMs: number; rawText: string; json: unknown | null }> {
  const startedAt = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const rawText = await res.text();
    const latencyMs = Math.round(performance.now() - startedAt);
    let json: unknown | null = null;
    try {
      const trimmed = rawText.trim();
      if (trimmed && !trimmed.startsWith('<')) {
        json = JSON.parse(trimmed);
      }
    } catch {
      json = null;
    }
    return { status: res.status, ok: res.ok, latencyMs, rawText, json };
  } finally {
    clearTimeout(timer);
  }
}

export async function inferWithMcloud(
  payload: Record<string, unknown>,
  baseUrlOverride?: string
): Promise<{ ok: boolean; status: number; latencyMs: number; data: Record<string, unknown> | null; error?: string }> {
  const base = normalizeMcloudBaseUrl(baseUrlOverride);
  const bodyString = JSON.stringify(payload);
  try {
    let res = await fetchWithTimeout(
      `${base}/api/tug777/infer`,
      {
        method: 'POST',
        headers: buildMcloudSignedHeaders(bodyString, { useWebhookBearer: false }),
        body: bodyString,
      },
      4500
    );
    if (res.status === 404) {
      res = await fetchWithTimeout(
        `${base}/api/wh/tug777-infer`,
        {
          method: 'POST',
          headers: buildMcloudSignedHeaders(bodyString, { useWebhookBearer: true }),
          body: bodyString,
        },
        4500
      );
    }
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        latencyMs: res.latencyMs,
        data: null,
        error: `HTTP ${res.status}: ${res.rawText.slice(0, 180)}`,
      };
    }
    return {
      ok: true,
      status: res.status,
      latencyMs: res.latencyMs,
      data: (res.json as Record<string, unknown>) || null,
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      latencyMs: 0,
      data: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function fetchMcloudContext(baseUrlOverride?: string): Promise<{
  ok: boolean;
  status: number;
  latencyMs: number;
  data: unknown | null;
  error?: string;
}> {
  const base = normalizeMcloudBaseUrl(baseUrlOverride);
  try {
    let res = await fetchWithTimeout(
      `${base}/api/kv/tug777/context`,
      {
        method: 'GET',
        headers: buildMcloudSignedHeaders('', { useApiKeyBearer: true }),
      },
      3500
    );
    if (res.status === 404) {
      res = await fetchWithTimeout(
        `${base}/api/wh/tug777-context`,
        {
          method: 'GET',
          headers: buildMcloudSignedHeaders('', { useWebhookBearer: true }),
        },
        3500
      );
    }
    if (res.status === 404) {
      res = await fetchWithTimeout(
        `${base}/api/tug777/context`,
        {
          method: 'GET',
          headers: buildMcloudSignedHeaders('', { useWebhookBearer: false }),
        },
        3500
      );
    }
    return {
      ok: res.ok,
      status: res.status,
      latencyMs: res.latencyMs,
      data: res.json,
      ...(res.ok ? {} : { error: `HTTP ${res.status}: ${res.rawText.slice(0, 180)}` }),
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      latencyMs: 0,
      data: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function saveMcloudKvObject(
  bucket: string,
  key: string,
  payload: Record<string, unknown>,
  baseUrlOverride?: string
): Promise<{ ok: boolean; status: number; latencyMs: number; error?: string }> {
  const base = normalizeMcloudBaseUrl(baseUrlOverride);
  const bodyString = JSON.stringify(payload);
  try {
    const res = await fetchWithTimeout(
      `${base}/api/kv/${encodeURIComponent(bucket)}/${encodeURIComponent(key)}`,
      {
        method: 'PUT',
        headers: buildMcloudSignedHeaders(bodyString, { useApiKeyBearer: true }),
        body: bodyString,
      },
      3500
    );
    return {
      ok: res.ok,
      status: res.status,
      latencyMs: res.latencyMs,
      ...(res.ok ? {} : { error: `HTTP ${res.status}: ${res.rawText.slice(0, 160)}` }),
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      latencyMs: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function emitMcloudEvent(
  eventType: string,
  data: Record<string, unknown>,
  baseUrlOverride?: string
): Promise<{ ok: boolean; status: number; latencyMs: number; error?: string }> {
  const base = normalizeMcloudBaseUrl(baseUrlOverride);
  const explicitSlug = extractMcloudWebhookSlug(baseUrlOverride);
  const slugs = Array.from(new Set([...(explicitSlug ? [explicitSlug] : []), 'tug777', 'tugg777', 'tug777-events']));
  const bodyString = JSON.stringify({
    evento: eventType,
    origen: 'tug777-engine',
    ts: Date.now(),
    ...data,
  });

  try {
    let lastRes: { status: number; ok: boolean; latencyMs: number; rawText: string; json: unknown | null } | null = null;
    for (const slug of slugs) {
      const res = await fetchWithTimeout(
        `${base}/api/wh/${slug}`,
        {
          method: 'POST',
          headers: buildMcloudSignedHeaders(bodyString, { useWebhookBearer: true }),
          body: bodyString,
        },
        3500
      );
      lastRes = res;
      if (res.ok) {
        return { ok: true, status: res.status, latencyMs: res.latencyMs };
      }
      if (res.status !== 404 && res.status !== 401) {
        break;
      }
    }
    return {
      ok: false,
      status: lastRes?.status ?? 0,
      latencyMs: lastRes?.latencyMs ?? 0,
      error: `HTTP ${lastRes?.status ?? 0}: ${(lastRes?.rawText || '').slice(0, 160)}`,
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      latencyMs: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function probeMcloudHealth(baseUrlOverride?: string): Promise<{
  ok: boolean;
  baseUrl: string;
  healthStatus: number;
  healthLatencyMs: number;
  contextStatus: number;
  contextLatencyMs: number;
  webhookStatus: number;
  webhookLatencyMs: number;
  hmacConfigured: boolean;
  detail: string;
}> {
  const base = normalizeMcloudBaseUrl(baseUrlOverride);
  const explicitSlug = extractMcloudWebhookSlug(baseUrlOverride);
  const secondarySlug = explicitSlug && explicitSlug !== 'tug777' ? explicitSlug : 'tugg777';
  const hmacConfigured = Boolean(getMcloudHmacSecret());
  const apiKeyConfigured = Boolean(getMcloudApiKey());
  const probeBody = JSON.stringify({ evento: 'health_probe', origen: 'tug777-engine' });

  const [secWhRes, kvCtxRes, whRes] = await Promise.all([
    fetchWithTimeout(
      `${base}/api/wh/${secondarySlug}`,
      {
        method: 'POST',
        headers: buildMcloudSignedHeaders(probeBody, { useWebhookBearer: true }),
        body: probeBody,
      },
      6500
    ).catch((e) => ({ status: 0, ok: false, latencyMs: 0, rawText: String(e), json: null })),
    fetchWithTimeout(
      `${base}/api/kv/tug777/context`,
      { method: 'GET', headers: buildMcloudSignedHeaders('', { useApiKeyBearer: true }) },
      6500
    ).catch((e) => ({ status: 0, ok: false, latencyMs: 0, rawText: String(e), json: null })),
    fetchWithTimeout(
      `${base}/api/wh/tug777`,
      {
        method: 'POST',
        headers: buildMcloudSignedHeaders(probeBody, { useWebhookBearer: true }),
        body: probeBody,
      },
      6500
    ).catch((e) => ({ status: 0, ok: false, latencyMs: 0, rawText: String(e), json: null })),
  ]);

  const anyOk = secWhRes.ok || kvCtxRes.ok || whRes.ok;
  const detailParts = [
    `wh/tug777=${whRes.status || 'ERR'}(${whRes.latencyMs}ms)`,
    `wh/${secondarySlug}=${secWhRes.status || 'ERR'}(${secWhRes.latencyMs}ms)`,
    `kv/context=${kvCtxRes.status || 'ERR'}(${kvCtxRes.latencyMs}ms)`,
    `apiKey=${apiKeyConfigured ? 'ON' : 'OFF'}`,
    `hmac=${hmacConfigured ? 'ON' : 'BEARER_ONLY'}`,
  ];

  return {
    ok: anyOk,
    baseUrl: base,
    healthStatus: secWhRes.status,
    healthLatencyMs: secWhRes.latencyMs,
    contextStatus: kvCtxRes.status,
    contextLatencyMs: kvCtxRes.latencyMs,
    webhookStatus: whRes.status,
    webhookLatencyMs: whRes.latencyMs,
    hmacConfigured,
    detail: detailParts.join(' · '),
  };
}
