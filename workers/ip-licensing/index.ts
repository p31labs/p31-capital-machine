import { ethers } from 'ethers';

export interface Env {
  CAPITAL_DB: D1Database;
  CAPITAL_KV: KVNamespace;
  RPC_URL_ETH: string;
  PRIVATE_KEY_ETH: string;
}

interface IPAsset {
  id: string;
  chain: string;
  name: string;
  description: string;
  owner_address: string;
  ip_type: string;
  license_terms: LicenseTerms;
  status: string;
  metadata_uri?: string;
}

interface LicenseTerms {
  fee_percentage: number;
  fee_token: string;
  duration: number;
  territory: string;
  usage_rights: string[];
  auto_renew: boolean;
}

interface License {
  id: string;
  asset_id: string;
  chain: string;
  licensee_address: string;
  terms: LicenseTerms;
  start_date: number;
  end_date: number;
  status: string;
  auto_renew: boolean;
  payments: LicensePayment[];
}

interface LicensePayment {
  id: string;
  amount: string;
  token: string;
  period_start: number;
  period_end: number;
  status: string;
  tx_hash?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      if (path === '/assets') {
        const assets = await env.CAPITAL_DB.prepare(
          'SELECT * FROM ip_assets ORDER BY created_at DESC'
        ).all();
        return new Response(JSON.stringify({
          assets: (assets.results || []).map((a: any) => ({
            ...a, license_terms: JSON.parse(a.license_terms),
          })),
        }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
      }

      if (path === '/asset' && method === 'POST') {
        const body = await request.json() as any;
        const asset = await createAsset(env, body);
        return new Response(JSON.stringify({ asset }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      if (path === '/license' && method === 'POST') {
        const body = await request.json() as any;
        const license = await createLicense(env, body);
        return new Response(JSON.stringify({ license }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      if (path === '/royalties') {
        const result = await collectRoyalties(env);
        return new Response(JSON.stringify(result), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      if (path === '/stats') {
        const stats = await getIPStats(env);
        return new Response(JSON.stringify(stats), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      return new Response('IP Licensing Automation', { status: 200 });
    } catch (error: any) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
  },

  async scheduled(event: ScheduledEvent, env: Env): Promise<void> {
    await collectRoyalties(env);
    await checkExpiringLicenses(env);
  },
};

async function createAsset(env: Env, data: any): Promise<IPAsset> {
  const id = crypto.randomUUID();
  const now = Date.now();

  const terms: LicenseTerms = {
    fee_percentage: data.fee_percentage || 10,
    fee_token: data.fee_token || 'USDC',
    duration: data.duration || 31536000,
    territory: data.territory || 'global',
    usage_rights: data.usage_rights || ['commercial', 'derivative'],
    auto_renew: data.auto_renew !== false,
  };

  const asset: IPAsset = {
    id, chain: data.chain || 'ethereum',
    name: data.name, description: data.description,
    owner_address: data.owner_address,
    ip_type: data.ip_type || 'code',
    license_terms: terms,
    status: 'active', metadata_uri: data.metadata_uri,
  };

  await env.CAPITAL_DB.prepare(
    `INSERT INTO ip_assets (id, chain, name, description, owner_address, ip_type, license_terms, status, metadata_uri, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    asset.id, asset.chain, asset.name, asset.description,
    asset.owner_address, asset.ip_type, JSON.stringify(asset.license_terms),
    asset.status, asset.metadata_uri, now, now
  ).run();

  return asset;
}

async function createLicense(env: Env, data: any): Promise<License> {
  const asset = await env.CAPITAL_DB.prepare(
    'SELECT * FROM ip_assets WHERE id = ?'
  ).bind(data.asset_id).first();

  if (!asset) throw new Error('Asset not found');

  const terms: LicenseTerms = asset.license_terms as any;
  if (typeof terms === 'string') Object.assign(terms, JSON.parse(terms));

  const id = crypto.randomUUID();
  const now = Date.now();

  const license: License = {
    id,
    asset_id: data.asset_id,
    chain: data.chain || asset.chain,
    licensee_address: data.licensee_address,
    terms: {
      fee_percentage: data.fee_percentage || terms.fee_percentage,
      fee_token: data.fee_token || terms.fee_token,
      duration: data.duration || terms.duration,
      territory: data.territory || terms.territory,
      usage_rights: data.usage_rights || terms.usage_rights,
      auto_renew: data.auto_renew !== undefined ? data.auto_renew : terms.auto_renew,
    },
    start_date: now,
    end_date: now + (data.duration || terms.duration) * 1000,
    status: 'active',
    auto_renew: data.auto_renew !== undefined ? data.auto_renew : terms.auto_renew,
    payments: [],
  };

  await env.CAPITAL_DB.prepare(
    `INSERT INTO licenses (id, asset_id, chain, licensee_address, terms, start_date, end_date, status, auto_renew, payments, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    license.id, license.asset_id, license.chain, license.licensee_address,
    JSON.stringify(license.terms), license.start_date, license.end_date,
    license.status, license.auto_renew ? 1 : 0,
    JSON.stringify(license.payments), now, now
  ).run();

  await env.CAPITAL_DB.prepare(
    'UPDATE ip_assets SET status = ?, updated_at = ? WHERE id = ?'
  ).bind('licensed', now, license.asset_id).run();

  return license;
}

async function collectRoyalties(env: Env): Promise<any> {
  const activeLicenses = await env.CAPITAL_DB.prepare(
    "SELECT * FROM licenses WHERE status = 'active'"
  ).all();

  const results: any[] = [];

  for (const row of (activeLicenses.results || [])) {
    const license: License = {
      ...row,
      terms: JSON.parse(row.terms as string),
      payments: JSON.parse(row.payments as string || '[]'),
    } as any;

    const now = Date.now();
    const interval = 30 * 86400000;
    const lastPayment = license.payments[license.payments.length - 1];

    if (!lastPayment || (now - lastPayment.period_end) >= interval) {
      try {
        const payment = await processRoyaltyPayment(env, license);
        results.push(payment);

        license.payments.push(payment);
        await env.CAPITAL_DB.prepare(
          'UPDATE licenses SET payments = ?, updated_at = ? WHERE id = ?'
        ).bind(JSON.stringify(license.payments), now, license.id).run();
      } catch (error: any) {
        results.push({ licenseId: license.id, status: 'failed', error: error.message });
      }
    }
  }

  return { timestamp: Date.now(), results };
}

async function processRoyaltyPayment(env: Env, license: License): Promise<LicensePayment> {
  const provider = new ethers.JsonRpcProvider(env.RPC_URL_ETH);
  const wallet = new ethers.Wallet(env.PRIVATE_KEY_ETH, provider);

  const asset = await env.CAPITAL_DB.prepare(
    'SELECT * FROM ip_assets WHERE id = ?'
  ).bind(license.asset_id).first() as any;

  const ownerAddress = asset?.owner_address || license.licensee_address;

  const baselineRevenue = ethers.parseEther('1');
  const royaltyAmount = (baselineRevenue * BigInt(license.terms.fee_percentage)) / 100n;

  const iface = new ethers.Interface([
    'function transfer(address to, uint256 amount) external returns (bool)',
  ]);
  const data = iface.encodeFunctionData('transfer', [ownerAddress, royaltyAmount]);

  const tx = await wallet.sendTransaction({
    to: license.terms.fee_token,
    data,
    gasLimit: 100000,
    maxFeePerGas: ethers.parseUnits('20', 'gwei'),
    maxPriorityFeePerGas: ethers.parseUnits('1.5', 'gwei'),
  });

  await tx.wait();

  const payment: LicensePayment = {
    id: crypto.randomUUID(),
    amount: royaltyAmount.toString(),
    token: license.terms.fee_token,
    period_start: license.payments.length > 0
      ? license.payments[license.payments.length - 1].period_end
      : license.start_date,
    period_end: Date.now(),
    status: 'paid',
    tx_hash: tx.hash,
  };

  await env.CAPITAL_DB.prepare(
    `INSERT INTO license_payments (id, license_id, chain, amount, token, period_start, period_end, status, tx_hash, created_at, paid_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    payment.id, license.id, license.chain, payment.amount, payment.token,
    payment.period_start, payment.period_end, payment.status, payment.tx_hash,
    Date.now(), Date.now()
  ).run();

  return payment;
}

async function checkExpiringLicenses(env: Env): Promise<void> {
  const now = Date.now();
  const warningPeriod = 7 * 86400000;

  const expiring = await env.CAPITAL_DB.prepare(
    "SELECT * FROM licenses WHERE status = 'active' AND end_date <= ?"
  ).bind(now + warningPeriod).all();

  for (const row of (expiring.results || [])) {
    const license = row as any;

    if (license.auto_renew) {
      const newEnd = license.end_date + license.duration * 1000;
      await env.CAPITAL_DB.prepare(
        'UPDATE licenses SET end_date = ?, updated_at = ? WHERE id = ?'
      ).bind(newEnd, now, license.id).run();
    } else {
      await env.CAPITAL_DB.prepare(
        "UPDATE licenses SET status = 'expired', updated_at = ? WHERE id = ?"
      ).bind(now, license.id).run();
    }
  }
}

async function getIPStats(env: Env): Promise<any> {
  const assets = await env.CAPITAL_DB.prepare(
    'SELECT status, COUNT(*) as count FROM ip_assets GROUP BY status'
  ).all();

  const licenses = await env.CAPITAL_DB.prepare(
    'SELECT status, COUNT(*) as count FROM licenses GROUP BY status'
  ).all();

  const totalRoyalties = await env.CAPITAL_DB.prepare(
    "SELECT SUM(CAST(amount AS REAL)) as total FROM license_payments WHERE status = 'paid'"
  ).first();

  return {
    assets: assets.results || [],
    licenses: licenses.results || [],
    totalRoyaltiesCollected: totalRoyalties?.total || 0,
  };
}
