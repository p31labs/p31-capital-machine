import { respond } from '../../shared/response';
import { createLogger, Logger } from '../../shared/logger';
import { withRetry } from '../../shared/retry';

const MODULE = 'btcpay-gateway';

export interface Env {
  CAPITAL_DB: D1Database;
  CAPITAL_KV: KVNamespace;
  BTCPAY_API_KEY: string;
  BTCPAY_API_URL: string;
  BTCPAY_WEBHOOK_SECRET: string;
  BTCPAY_STORE_ID: string;
  DISCORD_WEBHOOK: string;
  YIELD_VAULT_URL?: string;
  REVENUE_LEDGER_URL?: string;
  MERCHANT_DID?: string;
}

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, Btcpay-Sig',
  'Access-Control-Max-Age': '86400',
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    const method = request.method;
    const logger = createLogger(MODULE);

    if (method === 'OPTIONS' || method === 'HEAD') {
      return new Response(null, { status: 204, headers: CORS });
    }

    try {
      switch (true) {
        case pathname === '/health' && method === 'GET':
          return handleHealth(env, logger);

        case pathname === '/webhook' && method === 'POST':
          return await processWebhook(request, env, logger);

        case pathname === '/invoice' && method === 'GET':
          return await createInvoice(new URL(request.url), env, logger);

        case pathname === '/invoices' && method === 'GET':
          return await listInvoices(new URL(request.url), env, logger);

        case pathname === '/stores' && method === 'GET':
          return await listStores(env, logger);

        case pathname === '/donations' && method === 'GET':
          return await listDonations(env, new URL(request.url));

        case pathname === '/sweep' && method === 'POST':
          return await sweepDonations(env, logger);

        default:
          return new Response('P31 Capital Machine - BTCPay Gateway', { status: 200 });
      }
    } catch (err: any) {
      logger.error('Unhandled fetch error', err);
      return jsonResponse(false, null, err.message || 'Unexpected error', 'INTERNAL_ERROR', 500);
    }
  },

  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    const logger = createLogger(MODULE);
    try {
      await sweepDonations(env, logger);
    } catch (err: any) {
      logger.error('Scheduled sweep failed', err);
    }
  },
};

// ─── Response Helper ──────────────────────────────────────────────

function jsonResponse<T>(
  success: boolean,
  data: T | null,
  error?: string,
  code?: string,
  status: number = 200
): Response {
  const body: Record<string, any> = {
    success,
    timestamp: Date.now(),
    requestId: crypto.randomUUID().slice(0, 12),
  };
  if (success && data !== null) body.data = data;
  if (!success) {
    body.error = error;
    body.code = code || 'ERROR';
  }
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

// ─── Health Check ────────────────────────────────────────────────

type HealthStatus = 'healthy' | 'error' | 'not_configured' | 'unknown';

async function handleHealth(env: Env, logger: Logger): Promise<Response> {
  const checks: Record<string, { status: HealthStatus; error?: string; statusCode?: number }> = {
    d1: { status: 'unknown' },
    kv: { status: 'unknown' },
    btcpay: { status: 'unknown' },
  };

  try {
    await env.CAPITAL_DB.prepare('SELECT 1 as ok').first();
    checks.d1 = { status: 'healthy' };
  } catch (e: any) {
    checks.d1 = { status: 'error', error: e.message };
  }

  try {
    if (env.CAPITAL_KV) {
      const key = `__health_check_${Date.now()}__`;
      await env.CAPITAL_KV.put(key, '1', { expirationTtl: 60 });
      await env.CAPITAL_KV.get(key);
      checks.kv = { status: 'healthy' };
    } else {
      checks.kv = { status: 'not_configured' };
    }
  } catch (e: any) {
    checks.kv = { status: 'error', error: e.message };
  }

  try {
    if (env.BTCPAY_API_URL && env.BTCPAY_API_KEY) {
      const url = `${env.BTCPAY_API_URL.replace(/\/$/, '')}/api/v1/stores`;
      const res = await fetch(url, {
        headers: { 'Authorization': `token ${env.BTCPAY_API_KEY}` },
      });
      checks.btcpay = { status: res.ok ? 'healthy' : 'error', statusCode: res.status };
    } else {
      checks.btcpay = { status: 'not_configured' };
    }
  } catch (e: any) {
    checks.btcpay = { status: 'error', error: e.message };
  }

  const healthy = Object.values(checks).every(
    (c) => c.status === 'healthy' || c.status === 'not_configured'
  );

  const payload = {
    status: healthy ? 'healthy' : 'degraded',
    module: MODULE,
    timestamp: Date.now(),
    checks,
  };

  return healthy
    ? respond.ok(payload)
    : new Response(JSON.stringify({ success: false, data: payload, timestamp: Date.now() }), {
        status: 503,
        headers: { 'Content-Type': 'application/json', ...CORS },
      });
}

// ─── Webhook Processing ──────────────────────────────────────────

async function processWebhook(request: Request, env: Env, logger: Logger): Promise<Response> {
  const sigHeader = request.headers.get('Btcpay-Sig');
  if (!sigHeader) {
    return jsonResponse(false, null, 'Missing Btcpay-Sig header', 'MISSING_SIGNATURE', 401);
  }

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return jsonResponse(false, null, 'Failed to read request body', 'BODY_READ_ERROR', 400);
  }

  const validHmac = await verifyHmac(rawBody, sigHeader, env.BTCPAY_WEBHOOK_SECRET);
  if (!validHmac) {
    logger.warn('HMAC verification failed — rejecting webhook');
    return jsonResponse(false, null, 'Invalid webhook signature', 'INVALID_SIGNATURE', 401);
  }

  let event: Record<string, any>;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return jsonResponse(false, null, 'Malformed JSON payload', 'INVALID_JSON', 400);
  }

  const eventType = getField(event, ['Type', 'type']) || 'Unknown';
  const invoiceId = getField(event, ['InvoiceId', 'invoiceId']);

  logger.info(`Webhook received: ${eventType}`, { invoiceId });

  switch (eventType) {
    case 'InvoicePaid':
    case 'InvoiceSettled':
      return handleInvoicePaid(event, env, logger);
    case 'InvoiceExpired':
      return handleInvoiceExpired(event, env, logger);
    default:
      return jsonResponse(true, { received: true, eventType });
  }
}

// ─── Webhook Actions: Paid ───────────────────────────────────────

async function handleInvoicePaid(event: Record<string, any>, env: Env, logger: Logger): Promise<Response> {
  const inv = extractInvoice(event);
  const donationId = crypto.randomUUID();
  const now = Date.now();
  const btcpayData = JSON.stringify(inv.raw);

  await withRetry(() =>
    env.CAPITAL_DB.prepare(
      `INSERT OR IGNORE INTO btcpay_donations
         (id, invoice_id, store_id, amount, currency, order_id, status, webhook_event, btcpay_data, swept, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
    ).bind(
      donationId,
      inv.id,
      inv.storeId,
      inv.amount,
      inv.currency,
      inv.orderId,
      inv.status,
      'invoice_paid',
      btcpayData,
      now
    ).run()
  );

  if (env.REVENUE_LEDGER_URL && env.MERCHANT_DID) {
    const usdValue = inv.currency === 'BTC' ? (parseFloat(inv.amount) * 50000).toFixed(2) : inv.amount;
    const ledgerPayload = {
      source: 'btcpay',
      payer_did: inv.orderId || inv.id,
      merchant_did: env.MERCHANT_DID,
      amount_usdc: usdValue,
      asset: 'USDC',
      settlement_tx: inv.id,
    };
    fetch(`${env.REVENUE_LEDGER_URL}/revenue/record`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ledgerPayload),
    })
      .then(async (res) => {
        if (res.ok) {
          logger.info('Revenue ledger recorded', { invoiceId: inv.id, usdValue, status: res.status });
        } else {
          const txt = await res.text().catch(() => '');
          logger.error('Revenue ledger non-ok', undefined, { invoiceId: inv.id, status: res.status, body: txt.slice(0, 300) });
        }
      })
      .catch((err) => {
        logger.error('Revenue ledger fetch failed', err, { invoiceId: inv.id });
      });
  }

  await triggerPostDonationFlow(env, logger, { donationId, ...inv });

  logger.info('Donation recorded', { donationId, invoiceId: inv.id, amount: inv.amount, currency: inv.currency });

  return respond.ok({ success: true, donationId });
}

// ─── Webhook Actions: Expired ────────────────────────────────────

function handleInvoiceExpired(event: Record<string, any>, env: Env, logger: Logger): Promise<Response> {
  const inv = extractInvoice(event);

  return withRetry(() =>
    env.CAPITAL_DB.prepare(
      `UPDATE btcpay_donations
         SET status = ?, webhook_event = 'invoice_expired'
       WHERE invoice_id = ? AND swept = 0`
    ).bind('expired', inv.id).run()
  ).then(() => {
    logger.info('Stale invoice expired and cleaned', { invoiceId: inv.id });
    return jsonResponse(true, { success: true, invoiceId: inv.id, action: 'expired_cleaned' });
  });
}

// ─── Invoice Creation ────────────────────────────────────────────

async function createInvoice(url: URL, env: Env, logger: Logger): Promise<Response> {
  const amount   = url.searchParams.get('amount');
  const currency = (url.searchParams.get('currency') || 'BTC').toUpperCase();
  const storeId  = url.searchParams.get('store_id') || env.BTCPAY_STORE_ID;
  const orderId  = url.searchParams.get('order_id');

  if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
    return respond.badRequest('Missing or invalid "amount" query parameter');
  }

  if (!env.BTCPAY_API_URL || !env.BTCPAY_API_KEY) {
    return respond.badRequest('BTCPay Server is not configured (missing BTCPAY_API_URL or BTCPAY_API_KEY)');
  }

  const endpoint = `${env.BTCPAY_API_URL.replace(/\/$/, '')}/api/v1/stores/${encodeURIComponent(storeId)}/invoices`;
  const payload: Record<string, string | number> = { price: parseFloat(amount), currency };
  if (orderId) payload.orderId = orderId;

  logger.info('Creating BTCPay invoice', { amount, currency, storeId });

  const invoice = (await withRetry(async () => {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `token ${env.BTCPAY_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`BTCPay API ${res.status}: ${txt}`);
    }
    return res.json();
  })) as any;

  if (env.CAPITAL_KV) {
    await env.CAPITAL_KV.put(`btcpay:invoice:${invoice.id}`, JSON.stringify(invoice), { expirationTtl: 3600 });
  }

  return respond.ok({
    invoiceId:    invoice.id,
    amount:       invoice.amount         ?? amount,
    currency:     invoice.currency       ?? currency,
    status:       invoice.status,
    checkoutLink: invoice.checkoutLink,
    qrCode:       invoice.qrCodes?.[0]?.image ?? null,
    expiresAt:    invoice.expirationTime,
  });
}

// ─── List Stores ─────────────────────────────────────────────────

async function listInvoices(url: URL, env: Env, logger: Logger): Promise<Response> {
  const storeId = url.searchParams.get('store_id') || env.BTCPAY_STORE_ID;
  const skip = Number(url.searchParams.get('skip') || 0);
  const take = Number(url.searchParams.get('take') || 25);

  if (!env.BTCPAY_API_URL || !env.BTCPAY_API_KEY || !storeId) {
    return respond.ok({ invoices: [] });
  }

  const endpoint = `${env.BTCPAY_API_URL.replace(/\/$/, '')}/api/v1/stores/${encodeURIComponent(storeId)}/invoices?skip=${skip}&take=${take}`;

  try {
    const res = await fetch(endpoint, {
      headers: { 'Authorization': `token ${env.BTCPAY_API_KEY}`, 'Accept': 'application/json' },
    });
    if (!res.ok) {
      const txt = await res.text();
      logger.error('listInvoices failed', undefined, { status: res.status, body: txt.slice(0, 300) });
      return respond.badRequest(`BTCPay API ${res.status}`);
    }
    const list = (await res.json()) as any[];

    const invoices = (list || []).map((inv: any) => ({
      id: inv.id,
      amount: inv.amount ?? inv.price,
      currency: inv.currency,
      status: inv.status,
      type: inv.type,
      checkoutLink: inv.checkoutLink,
      createdTime: inv.createdTime,
      expirationTime: inv.expirationTime,
      orderId: inv.metadata?.orderId ?? null,
    }));

    return respond.ok({ invoices, count: invoices.length, skip, take });
  } catch (err: any) {
    logger.error('listInvoices threw', err);
    return respond.badRequest('Failed to list invoices');
  }
}

// ─── List Stores ─────────────────────────────────────────────────

async function listStores(env: Env, logger: Logger): Promise<Response> {
  if (!env.BTCPAY_API_URL || !env.BTCPAY_API_KEY) {
    return respond.ok({ stores: [] });
  }

  const url = `${env.BTCPAY_API_URL.replace(/\/$/, '')}/api/v1/stores`;
  const stores = (await withRetry(async () => {
    const res = await fetch(url, {
      headers: {
        'Authorization': `token ${env.BTCPAY_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`BTCPay API ${res.status}: ${txt}`);
    }
    const data = await res.json();
    return Array.isArray(data) ? data : (data as any)?.stores ?? [];
  })) as Record<string, any>[];

  logger.info('Stores listed', { count: stores.length });

  return respond.ok({ stores });
}

// ─── List Donations ──────────────────────────────────────────────

async function listDonations(env: Env, url: URL): Promise<Response> {
  const qs = new URLSearchParams(url.search);
  const limit  = Math.min(parseInt(qs.get('limit') || '50'), 200);
  const offset = Math.max(parseInt(qs.get('offset') || '0'), 0);

  const result = await withRetry(() =>
    env.CAPITAL_DB.prepare(
      'SELECT * FROM btcpay_donations ORDER BY created_at DESC LIMIT ? OFFSET ?'
    ).bind(limit < 1 ? 1 : limit, offset).all()
  );

  const rows      = (result.results || []) as Record<string, any>[];
  const donations = rows.map((row) => {
    const raw = typeof row.btcpayData === 'string' ? row.btcpayData : (row.btcpay_data || '{}');
    return { ...row, btcpayData: JSON.parse(raw) };
  });

  return respond.ok({ donations, count: donations.length, limit, offset });
}

// ─── Sweep Donations ─────────────────────────────────────────────

async function sweepDonations(env: Env, logger: Logger): Promise<Response> {
  const result = await withRetry(() =>
    env.CAPITAL_DB.prepare(
      'SELECT * FROM btcpay_donations WHERE swept = 0 ORDER BY created_at ASC'
    ).all()
  );

  const donations = (result.results || []) as Record<string, any>[];
  if (donations.length === 0) {
    return respond.ok({ swept: false, count: 0, totalBTC: '0', reason: 'No unswept donations' });
  }

  const totalBTC = donations.reduce((s, d) => s + parseFloat(d.amount || '0'), 0);
  const ids: string[] = donations.map((d) => d.id);
  const now = Date.now();

  if (env.YIELD_VAULT_URL) {
    try {
      await withRetry(async () => {
        const res = await fetch(`${env.YIELD_VAULT_URL}/deposits`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            deposits: donations.map((d) => ({
              id: d.id,
              invoice_id: d.invoice_id,
              amount: d.amount,
              currency: d.currency,
            })),
            totalBTC,
          }),
        });
        if (!res.ok) throw new Error(`Yield Vault HTTP ${res.status}`);
        return res.json();
      });
      logger.info('Deposits forwarded to yield vault', { count: donations.length, totalBTC });
    } catch (err: any) {
      logger.error('Yield vault deposit failed — donations remain unswept', err);
      return jsonResponse(
        false,
        null,
        `Yield vault deposit failed: ${err.message}`,
        'YIELD_VAULT_ERROR',
        502
      );
    }
  }

  const placeholders = ids.map(() => '?').join(',');
  await withRetry(() =>
    env.CAPITAL_DB.prepare(
      `UPDATE btcpay_donations SET swept = 1, swept_at = ? WHERE id IN (${placeholders})`
    ).bind(now, ...ids).run()
  );

  // BTCPay payout primitive: create a pull payment so the swept BTC can be
  // claimed via a public URL (BTC-OnChain). Failure is non-blocking — the
  // sweep already completed; the payout can be re-run manually.
  let pullPaymentLink: string | null = null;
  if (env.BTCPAY_API_URL && env.BTCPAY_API_KEY && totalBTC > 0) {
    try {
      pullPaymentLink = await createPullPayment(env, totalBTC, logger);
    } catch (err: any) {
      logger.error('Pull payment creation failed (non-blocking)', err);
    }
  }

  if (env.DISCORD_WEBHOOK) {
    notifyDiscord(env, {
      title: '[BANK] BTC Donations Swept to Yield Vault',
      description: `${donations.length} donation(s) totaling ${totalBTC.toFixed(8)} BTC deposited into yield strategies${pullPaymentLink ? `\nPayout: ${pullPaymentLink}` : ''}`,
      color: 0x00D4FF,
    }).catch(() => {});
  }

  logger.info('Sweep completed', { count: donations.length, totalBTC });

  return respond.ok({ swept: true, count: donations.length, totalBTC, donationIds: ids, timestamp: now, pullPaymentLink });
}

// ─── Pull Payment (BTCPay payout primitive) ─────────────────────

async function createPullPayment(env: Env, amountBtc: number, logger: Logger): Promise<string> {
  const storeId = env.BTCPAY_STORE_ID;
  const endpoint = `${env.BTCPAY_API_URL.replace(/\/$/, '')}/api/v1/stores/${encodeURIComponent(storeId)}/pull-payments`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Authorization': `token ${env.BTCPAY_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'P31 Capital Machine sweep',
      amount: amountBtc.toFixed(8),
      currency: 'BTC',
      paymentMethods: ['BTC-OnChain'],
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`BTCPay pull-payment ${res.status}: ${txt.slice(0, 200)}`);
  }
  const data = (await res.json()) as { link?: string; id?: string };
  logger.info('Pull payment created', { amountBtc, link: data.link ?? null });
  return data.link ?? `https://btcpay.p31ca.org/pull-payments/${data.id ?? 'unknown'}`;
}

// ─── Shared Helpers ──────────────────────────────────────────────

function getField(obj: Record<string, any>, keys: string[]): any {
  for (const k of keys) {
    if (k in obj) return obj[k];
  }
  return undefined;
}

interface InvoiceFields {
  id: string;
  storeId: string;
  amount: string;
  currency: string;
  orderId: string | null;
  status: string;
  raw: Record<string, any>;
}

function extractInvoice(event: Record<string, any>): InvoiceFields {
  const flat = event.Invoice || event.invoice || event;
  return {
    id:        getField(flat, ['Id', 'id', 'InvoiceId', 'invoiceId']) || '',
    storeId:   getField(flat, ['StoreId', 'storeId']) || '',
    amount:    String(getField(flat, ['Price', 'price', 'Amount', 'amount']) || '0'),
    currency:  getField(flat, ['Currency', 'currency']) || 'BTC',
    orderId:   getField(flat, ['OrderId', 'orderId']) || null,
    status:    getField(flat, ['Status', 'status']) || 'unknown',
    raw:       flat,
  };
}

async function verifyHmac(body: string, sigHeader: string, secret: string): Promise<boolean> {
  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
    const expected  = 'sha256=' + Array.from(new Uint8Array(signature))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    return expected === sigHeader;
  } catch {
    return false;
  }
}

async function triggerPostDonationFlow(env: Env, logger: Logger, d: {
  donationId: string;
  id: string;
  storeId: string;
  amount: string;
  currency: string;
  orderId: string | null;
  status: string;
}): Promise<void> {
  if (env.CAPITAL_KV) {
    try {
      const key    = 'btcpay:donation-stats';
      const cached = await env.CAPITAL_KV.get(key);
      const stats  = cached ? JSON.parse(cached) : { totalBTC: '0', count: 0, lastDonation: null };
      stats.totalBTC      = (parseFloat(stats.totalBTC || '0') + parseFloat(d.amount)).toFixed(8);
      stats.count        += 1;
      stats.lastDonation  = {
        donationId: d.donationId,
        invoiceId: d.id,
        amount: d.amount,
        currency: d.currency,
        receivedAt: Date.now(),
      };
      stats.lastUpdated   = Date.now();
      await env.CAPITAL_KV.put(key, JSON.stringify(stats), { expirationTtl: 86400 * 7 });
    } catch (e: any) {
      logger.warn('Post-donation KV update failed', e);
    }
  }

  if (env.DISCORD_WEBHOOK) {
    await notifyDiscord(env, {
      title: '[BTC] New Bitcoin Donation Received',
      description: `${d.amount} ${d.currency} received on invoice \`${d.id}\`\nOrder ID: ${d.orderId ?? 'n/a'}\nStatus: ${d.status}`,
      color: 0xF7931A,
    });
  }
}

async function notifyDiscord(
  env: Env,
  embed: { title: string; description: string; color: number; url?: string }
): Promise<void> {
  if (!env.DISCORD_WEBHOOK) return;
  try {
    await fetch(env.DISCORD_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [{ ...embed, timestamp: new Date().toISOString() }] }),
    });
  } catch (e: any) {
    console.warn(`Discord notification failed: ${e.message}`);
  }
}
