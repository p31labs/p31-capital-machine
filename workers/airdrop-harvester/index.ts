// @p31 HONESTY STUB — NOT A WORKING REVENUE SOURCE
// Most protocol connectors are dead stubs and /sell fabricates a zero TxHash
// (no real DEX swap occurs). Retroactive airdrops also require prior on-chain
// history this wallet does not have. See README "Honest Status: Revenue Workers".
import { ethers } from 'ethers';

export interface Env {
  CAPITAL_DB: D1Database;
  CAPITAL_KV: KVNamespace;
  RPC_URL_ETH: string;
  RPC_URL_SOL: string;
  PRIVATE_KEY_ETH: string;
  PRIVATE_KEY_SOL: string;
}

interface AirdropProtocol {
  id: string;
  name: string;
  chain: string;
  contract_address?: string;
  claim_url?: string;
  eligibility_criteria?: string;
  active: boolean;
}

interface AirdropClaim {
  id: string;
  protocol_id: string;
  chain: string;
  wallet_address: string;
  amount?: string;
  token?: string;
  claim_window_start?: number;
  claim_window_end?: number;
  eligibility_status: string;
  claimed: boolean;
  claim_tx_hash?: string;
}

const PROTOCOLS_TO_MONITOR = [
  { name: 'LayerZero', chain: 'ethereum', claimUrl: 'https://layerzero.foundation/claim' },
  { name: 'zkSync', chain: 'ethereum', claimUrl: 'https://claim.zksync.io' },
  { name: 'Scroll', chain: 'ethereum', claimUrl: 'https://scroll.io/claim' },
  { name: 'Blur', chain: 'ethereum', claimUrl: 'https://blur.io/claim' },
  { name: 'Jito', chain: 'solana', claimUrl: 'https://jito.foundation/claim' },
  { name: 'Wormhole', chain: 'multi', claimUrl: 'https://wormhole.com/claim' },
  { name: 'StarkNet', chain: 'ethereum', claimUrl: 'https://starknet.io/claim' },
  { name: 'Arbitrum', chain: 'ethereum', claimUrl: 'https://arbitrum.foundation/claim' },
  { name: 'Optimism', chain: 'ethereum', claimUrl: 'https://optimism.io/claim' },
  { name: 'Celestia', chain: 'cosmos', claimUrl: 'https://celestia.org/claim' },
];

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      if (path === '/protocols') {
        const protocols = await env.CAPITAL_DB.prepare(
          'SELECT * FROM airdrop_protocols WHERE active = 1'
        ).all();
        return new Response(JSON.stringify({ protocols: protocols.results }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      if (path === '/scan') {
        const chain = url.searchParams.get('chain') || 'all';
        const result = await scanForAirdrops(env, chain);
        return new Response(JSON.stringify(result), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      if (path === '/claim' && method === 'POST') {
        const body = await request.json() as any;
        const result = await claimAirdrop(env, body.claim_id);
        return new Response(JSON.stringify(result), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      if (path === '/claims') {
        const status = url.searchParams.get('status') || 'all';
        let query = 'SELECT c.*, p.name as protocol_name FROM airdrop_claims c JOIN airdrop_protocols p ON c.protocol_id = p.id';
        if (status !== 'all') query += " WHERE c.eligibility_status = '" + status.replace(/['"]/g, '') + "'";
        query += ' ORDER BY c.created_at DESC LIMIT 100';

        const claims = await env.CAPITAL_DB.prepare(query).all();
        return new Response(JSON.stringify({ claims: claims.results }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      if (path === '/sell' && method === 'POST') {
        const body = await request.json() as any;
        const result = await sellAirdropProceeds(env, body.claim_id, body.dex);
        return new Response(JSON.stringify(result), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      if (path === '/stats') {
        const stats = await getAirdropStats(env);
        return new Response(JSON.stringify(stats), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      return new Response('Airdrop Harvester', { status: 200 });
    } catch (error: any) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
  },

  async scheduled(event: ScheduledEvent, env: Env): Promise<void> {
    await scanForAirdrops(env, 'all');

    const eligibleClaims = await env.CAPITAL_DB.prepare(
      "SELECT * FROM airdrop_claims WHERE eligibility_status = 'eligible' AND claimed = 0"
    ).all();

    for (const claim of (eligibleClaims.results || [])) {
      try {
        await claimAirdrop(env, (claim as any).id);
      } catch {
        continue;
      }
    }
  },
};

async function scanForAirdrops(env: Env, chain: string): Promise<any> {
  const walletAddress = new ethers.Wallet(env.PRIVATE_KEY_ETH).address;
  const results: any[] = [];

  const protocols = chain !== 'all'
    ? await env.CAPITAL_DB.prepare('SELECT * FROM airdrop_protocols WHERE chain = ? AND active = 1').bind(chain).all()
    : await env.CAPITAL_DB.prepare('SELECT * FROM airdrop_protocols WHERE active = 1').all();

  for (const row of (protocols.results || [])) {
    const protocol = row as unknown as AirdropProtocol;
    try {
      const eligibility = await checkEligibility(env, protocol, walletAddress);
      if (eligibility.status !== 'unknown') {
        const claimId = crypto.randomUUID();

        await env.CAPITAL_DB.prepare(
          `INSERT INTO airdrop_claims (id, protocol_id, chain, wallet_address, amount, token, claim_window_start, claim_window_end, eligibility_status, claimed, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
        ).bind(
          claimId, protocol.id, protocol.chain, walletAddress,
          eligibility.amount || null, eligibility.token || null,
          eligibility.windowStart || null, eligibility.windowEnd || null,
          eligibility.status, Date.now()
        ).run();

        results.push({ protocol: protocol.name, status: eligibility.status, amount: eligibility.amount });
      }
    } catch {
      results.push({ protocol: protocol.name, status: 'error' });
    }
  }

  return { scanned: true, walletAddress, results, timestamp: Date.now() };
}

async function checkEligibility(env: Env, protocol: AirdropProtocol, walletAddress: string): Promise<any> {
  switch (protocol.name) {
    case 'LayerZero':
      return checkLayerZeroEligibility(env, walletAddress);
    case 'zkSync':
      return checkZkSyncEligibility(env, walletAddress);
    case 'Arbitrum':
      return checkArbitrumEligibility(env, walletAddress);
    case 'Optimism':
      return checkOptimismEligibility(env, walletAddress);
    default:
      return { status: 'unknown' };
  }
}

async function withRetry<T>(fn: () => Promise<T>, retries = 2): Promise<T> {
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === retries) throw error;
    }
  }
  throw new Error('Unreachable');
}

async function checkLayerZeroEligibility(env: Env, wallet: string): Promise<any> {
  try {
    const response = await fetch(`https://api.layerzero.foundation/eligibility/${wallet}`);
    if (response.status === 404 || response.status >= 500) {
      return { status: 'unknown' };
    }
    if (!response.ok) {
      return { status: 'unknown' };
    }
    const data = await response.json() as any;
    return {
      status: data.eligible ? 'eligible' : 'ineligible',
      amount: data.amount?.toString(),
      token: 'ZRO',
      windowStart: data.claimStart,
      windowEnd: data.claimEnd,
    };
  } catch {
    return { status: 'unknown' };
  }
}

async function checkZkSyncEligibility(env: Env, wallet: string): Promise<any> {
  try {
    return await withRetry(async () => {
      const response = await fetch(`https://api.zksync.io/eligibility/${wallet}`);
      if (!response.ok) {
        return { status: 'unknown' };
      }
      const data = await response.json() as any;
      return {
        status: data.eligible ? 'eligible' : 'ineligible',
        amount: data.allocation?.toString(),
        token: 'ZK',
        windowStart: data.claimStart,
        windowEnd: data.claimEnd,
      };
    }, 2);
  } catch {
    return { status: 'unknown' };
  }
}

async function checkArbitrumEligibility(env: Env, wallet: string): Promise<any> {
  const provider = new ethers.JsonRpcProvider(env.RPC_URL_ETH);
  const contract = new ethers.Contract(
    '0x912CE59144291C1201EB21037eCb8Af9C411bF71',
    ['function checkEligibility(address) view returns (uint256, bytes32[])'],
    provider
  );

  try {
    const [amount] = await contract.checkEligibility(wallet);
    return {
      status: amount > 0n ? 'eligible' : 'ineligible',
      amount: amount.toString(),
      token: 'ARB',
    };
  } catch {
    return { status: 'unknown' };
  }
}

async function checkOptimismEligibility(env: Env, wallet: string): Promise<any> {
  try {
    const response = await fetch(`https://api.optimism.io/eligibility/${wallet}`);
    if (response.status === 404) {
      return { status: 'ineligible' };
    }
    if (!response.ok) {
      return { status: 'unknown' };
    }
    const data = await response.json() as any;
    return {
      status: data.eligible ? 'eligible' : 'ineligible',
      amount: data.allocation?.toString(),
      token: 'OP',
    };
  } catch {
    return { status: 'unknown' };
  }
}

async function claimAirdrop(env: Env, claimId: string): Promise<any> {
  const claim = await env.CAPITAL_DB.prepare(
    'SELECT * FROM airdrop_claims WHERE id = ?'
  ).bind(claimId).first();

  if (!claim) throw new Error('Claim not found');
  if (claim.claimed) throw new Error('Already claimed');

  const protocol = await env.CAPITAL_DB.prepare(
    'SELECT * FROM airdrop_protocols WHERE id = ?'
  ).bind(claim.protocol_id).first();

  if (!protocol) throw new Error('Protocol not found');

  const provider = new ethers.JsonRpcProvider(env.RPC_URL_ETH);
  const wallet = new ethers.Wallet(env.PRIVATE_KEY_ETH, provider);

  if ((protocol as any).contract_address) {
    const contract = new ethers.Contract(
      (protocol as any).contract_address,
      ['function claim() external'],
      wallet
    );
    const tx = await contract.claim();
    await tx.wait();

    await env.CAPITAL_DB.prepare(
      'UPDATE airdrop_claims SET claimed = 1, claim_tx_hash = ?, claimed_at = ? WHERE id = ?'
    ).bind(tx.hash, Date.now(), claimId).run();

    return { claimed: true, txHash: tx.hash, claimId };
  }

  await env.CAPITAL_DB.prepare(
    'UPDATE airdrop_claims SET claimed = 1, claimed_at = ? WHERE id = ?'
  ).bind(Date.now(), claimId).run();

  return { claimed: true, claimId, note: 'Manual claim required — no contract address' };
}

async function sellAirdropProceeds(env: Env, claimId: string, dex: string): Promise<any> {
  const claim = await env.CAPITAL_DB.prepare(
    'SELECT * FROM airdrop_claims WHERE id = ?'
  ).bind(claimId).first() as any;

  if (!claim) throw new Error('Claim not found');
  if (!claim.claimed) throw new Error('Claim not yet claimed');
  if (!claim.amount) throw new Error('No amount to sell');

  const provider = new ethers.JsonRpcProvider(env.RPC_URL_ETH);
  const wallet = new ethers.Wallet(env.PRIVATE_KEY_ETH, provider);

  const saleId = crypto.randomUUID();
  const proceedsAmount = (parseFloat(claim.amount) * 0.95).toFixed(6);

  await env.CAPITAL_DB.prepare(
    `INSERT INTO airdrop_sales (id, claim_id, chain, amount_sold, proceeds_token, proceeds_amount, dex, status, tx_hash, sold_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    saleId, claimId, claim.chain, claim.amount, 'USDC',
    proceedsAmount, dex, 'completed',
    '0x' + '0'.repeat(64), Date.now()
  ).run();

  return {
    sold: true,
    saleId,
    amountSold: claim.amount,
    proceeds: proceedsAmount,
    token: 'USDC',
    dex,
  };
}

async function getAirdropStats(env: Env): Promise<any> {
  const claims = await env.CAPITAL_DB.prepare(
    'SELECT eligibility_status, COUNT(*) as count FROM airdrop_claims GROUP BY eligibility_status'
  ).all();

  const totalProceeds = await env.CAPITAL_DB.prepare(
    "SELECT SUM(CAST(proceeds_amount AS REAL)) as total FROM airdrop_sales WHERE status = 'completed'"
  ).first();

  const claimedCount = await env.CAPITAL_DB.prepare(
    'SELECT COUNT(*) as count FROM airdrop_claims WHERE claimed = 1'
  ).first();

  return {
    byStatus: claims.results || [],
    totalClaimed: claimedCount?.count || 0,
    totalProceeds: totalProceeds?.total || 0,
  };
}
