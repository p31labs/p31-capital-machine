// @p31 HONESTY STUB — NOT DEPLOYABLE AS-IS
// This worker queries /cashback endpoints on Pump.fun, Jupiter, 1inch, and Odos
// that DO NOT EXIST on those platforms. It is educational scaffolding showing the
// intended cashback-reconciliation flow, not a functioning revenue source.
// See /home/p31/p31-capital-machine/README.md "Honest Status: Revenue Workers".
import { ethers } from 'ethers';

export interface Env {
  CAPITAL_DB: D1Database;
  CAPITAL_KV: KVNamespace;
  RPC_URL_ETH: string;
  RPC_URL_SOL: string;
  PRIVATE_KEY_ETH: string;
  PRIVATE_KEY_SOL: string;
}

interface CashbackTransaction {
  id: string;
  source: string;
  chain: string;
  amount: string;
  token: string;
  token_address?: string;
  recipient: string;
  status: string;
  tx_hash?: string;
  created_at: number;
  claimed_at?: number;
}

const CASHBACK_SOURCES = {
  pumpfun: {
    name: 'Pump.fun',
    chain: 'solana',
    apiUrl: 'https://api.pump.fun/cashback',
    active: true,
  },
  jupiter: {
    name: 'Jupiter',
    chain: 'solana',
    apiUrl: 'https://api.jup.ag/cashback',
    active: true,
  },
  '1inch': {
    name: '1inch',
    chain: 'ethereum',
    apiUrl: 'https://api.1inch.io/cashback',
    active: true,
  },
  odos: {
    name: 'Odos',
    chain: 'ethereum',
    apiUrl: 'https://api.odos.xyz/cashback',
    active: true,
  },
};

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
      if (path === '/transactions') {
        const status = url.searchParams.get('status') || 'all';
        let query = 'SELECT * FROM cashback_transactions';
        const params: any[] = [];
        if (status !== 'all') {
          query += ' WHERE status = ?';
          params.push(status);
        }
        query += ' ORDER BY created_at DESC LIMIT 100';
        const txs = await env.CAPITAL_DB.prepare(query).bind(...params).all();
        return new Response(JSON.stringify({ transactions: txs.results }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      if (path === '/claim') {
        const result = await claimAllCashback(env);
        return new Response(JSON.stringify(result), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      if (path === '/sources') {
        const sources = await env.CAPITAL_DB.prepare('SELECT * FROM cashback_sources WHERE active = 1').all();
        return new Response(JSON.stringify({ sources: sources.results }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      if (path === '/stats') {
        const stats = await getCashbackStats(env);
        return new Response(JSON.stringify(stats), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      return new Response('Cashback Collector', { status: 200 });
    } catch (error: any) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
  },

  async scheduled(event: ScheduledEvent, env: Env): Promise<void> {
    await claimAllCashback(env);
  },
};

async function claimAllCashback(env: Env): Promise<any> {
  const pending = await env.CAPITAL_DB.prepare(
    "SELECT * FROM cashback_transactions WHERE status = 'pending' ORDER BY created_at ASC LIMIT 50"
  ).all();

  const results: any[] = [];

  for (const tx of (pending.results || [])) {
    try {
      const result = await claimCashback(env, tx as any);
      results.push(result);

      await env.CAPITAL_DB.prepare(
        'UPDATE cashback_transactions SET status = ?, tx_hash = ?, claimed_at = ? WHERE id = ?'
      ).bind('claimed', result.txHash || null, Date.now(), tx.id).run();

      await updateCashbackStats(env, (tx as any).amount, (tx as any).token);
    } catch (error: any) {
      results.push({ id: tx.id, status: 'failed', error: error.message });
      await env.CAPITAL_DB.prepare(
        "UPDATE cashback_transactions SET status = ? WHERE id = ?"
      ).bind('failed', tx.id).run();
    }
  }

  return { timestamp: Date.now(), results };
}

async function claimCashback(env: Env, transaction: CashbackTransaction): Promise<any> {
  switch (transaction.source) {
    case 'pumpfun':
      return claimPumpFunCashback(env, transaction);
    case 'jupiter':
      return claimJupiterCashback(env, transaction);
    case '1inch':
    case 'odos':
      return claimEVMCashback(env, transaction);
    default:
      return claimGenericCashback(env, transaction);
  }
}

async function claimPumpFunCashback(env: Env, tx: CashbackTransaction): Promise<any> {
  const response = await fetch(`${CASHBACK_SOURCES.pumpfun.apiUrl}/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      wallet: tx.recipient,
      amount: tx.amount,
      signature: tx.tx_hash || '0x',
    }),
  });

  if (!response.ok) throw new Error(`Pump.fun claim failed: ${response.status}`);
  const data = await response.json() as any;
  return { txHash: data.txHash || data.signature, amount: tx.amount, source: 'pumpfun' };
}

async function claimJupiterCashback(env: Env, tx: CashbackTransaction): Promise<any> {
  const response = await fetch(`${CASHBACK_SOURCES.jupiter.apiUrl}/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      wallet: tx.recipient,
    }),
  });

  if (!response.ok) throw new Error(`Jupiter claim failed: ${response.status}`);
  const data = await response.json() as any;
  return { txHash: data.txId || data.txHash, amount: tx.amount, source: 'jupiter' };
}

async function claimEVMCashback(env: Env, tx: CashbackTransaction): Promise<any> {
  const provider = new ethers.JsonRpcProvider(env.RPC_URL_ETH);
  const wallet = new ethers.Wallet(env.PRIVATE_KEY_ETH, provider);

  let iface: ethers.Interface;
  let data: string;

  switch (tx.source) {
    case '1inch': {
      iface = new ethers.Interface([
        'function claim() external returns (uint256)',
      ]);
      data = iface.encodeFunctionData('claim', []);
      break;
    }
    case 'odos': {
      iface = new ethers.Interface([
        'function claimRebate() external returns (uint256)',
      ]);
      data = iface.encodeFunctionData('claimRebate', []);
      break;
    }
    default: {
      data = '0x';
    }
  }

  const contractTx = {
    to: tx.token_address || '0x0000000000000000000000000000000000000000',
    data,
    gasLimit: 100000,
    maxFeePerGas: ethers.parseUnits('20', 'gwei'),
    maxPriorityFeePerGas: ethers.parseUnits('1.5', 'gwei'),
  };

  const response = await wallet.sendTransaction(contractTx);
  await response.wait();

  return { txHash: response.hash, amount: tx.amount, source: tx.source };
}

async function claimGenericCashback(env: Env, tx: CashbackTransaction): Promise<any> {
  const apiUrl = CASHBACK_SOURCES[tx.source as keyof typeof CASHBACK_SOURCES]?.apiUrl;
  if (apiUrl) {
    const response = await fetch(`${apiUrl}/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient: tx.recipient, amount: tx.amount }),
    });
    if (response.ok) {
      const data = await response.json() as any;
      return { txHash: data.txHash || data.id, amount: tx.amount, source: tx.source };
    }
  }

  return { txHash: 'pending', amount: tx.amount, source: tx.source };
}

async function updateCashbackStats(env: Env, amount: string, token: string): Promise<void> {
    const existing = await env.CAPITAL_DB.prepare(
    'SELECT * FROM cashback_stats WHERE token = ? ORDER BY updated_at DESC LIMIT 1'
  ).bind(token).first();

  if (existing) {
    await env.CAPITAL_DB.prepare(
      `UPDATE cashback_stats SET
        total_claimed = CAST(CAST(total_claimed AS REAL) + ? AS TEXT),
        total_transactions = total_transactions + 1,
        last_claim_at = ?,
        updated_at = ?
       WHERE id = ?`
    ).bind(amount, Date.now(), Date.now(), existing.id).run();
  } else {
    await env.CAPITAL_DB.prepare(
      `INSERT INTO cashback_stats (token, total_claimed, total_transactions, last_claim_at, updated_at)
       VALUES (?, ?, 1, ?, ?)`
    ).bind(token, amount, Date.now(), Date.now()).run();
  }
}

async function getCashbackStats(env: Env): Promise<any> {
  const stats = await env.CAPITAL_DB.prepare('SELECT * FROM cashback_stats ORDER BY updated_at DESC').all();
  const pending = await env.CAPITAL_DB.prepare(
    "SELECT COUNT(*) as count FROM cashback_transactions WHERE status = 'pending'"
  ).first();

  return {
    byToken: stats.results || [],
    pendingCount: pending?.count || 0,
    totalClaimed: (stats.results || []).reduce(
      (sum: number, s: any) => sum + parseFloat(s.total_claimed || '0'), 0
    ),
  };
}
