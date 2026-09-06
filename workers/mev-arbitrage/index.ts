import { ethers } from 'ethers';
import { Keypair, VersionedTransaction, Connection, SystemProgram, Transaction, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';

export interface Env {
  CAPITAL_DB: D1Database;
  CAPITAL_KV: KVNamespace;
  RPC_URL_ETH: string;
  RPC_URL_BASE: string;
  RPC_URL_SOL: string;
  PRIVATE_KEY_ETH: string;
  PRIVATE_KEY_SOL: string;
  FLASHBOTS_RELAY: string;
  JITO_TIP_KEY: string;
  JITO_BUNDLE_URL?: string;
  JITO_TIP_PCT?: string;
  JUPITER_BASE_URL?: string;
  JUPITER_API_KEY?: string;
  SWAP_MAX_SLIPPAGE_BPS?: string;
  MIN_PROFIT_BPS: string;
}

interface ArbitrageOpportunity {
  id: string;
  chain: string;
  path: string[];
  dex_path: string[];
  profit_bps: number;
  expected_profit: string;
  gas_cost: string;
  net_profit: string;
  executed: boolean;
}

const DEXES = {
  ethereum: [
    { name: 'UniswapV2', factory: '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f', router: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D' },
    { name: 'UniswapV3', factory: '0x1F98431c8aD98523631AE4a59f267346ea31F984', router: '0xE592427A0AEce92De3Edee1F18E0157C05861564' },
    { name: 'Sushiswap', factory: '0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac', router: '0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F' },
    { name: 'UniswapV4', factory: '0x0000000000000000000000000000000000000000', router: '0xDFe3eE6e083CBe1a6a0066b7B1BeBB081b8eB26e' }, // V4 placeholder
  ],
  base: [
    { name: 'UniswapV3', factory: '0x33128a8fC17869897dcE68Ed026d694621f6FDfD', router: '0x2626664c2603336E57B271c5C0b26F421741e481' },
    { name: 'Aerodrome', factory: '0x420DD381b31aEf6683db6B902084cB0FFECe40Da', router: '0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43' },
    { name: 'Sushiswap', factory: '0xC5fdd2e1a5cccA6e71cA668C3593DcB75CC7D267', router: '0x38f1bA9bA1f4b3f844716F6c36863C2158A0d6eC' },
  ],
  solana: [
    { name: 'Orca', programId: '9W95xVd2RQDkGHtdGtrwSrLNvNxdN1Ja694DEwRTW6H' },
    { name: 'Raydium', programId: '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8' },
    { name: 'Meteora', programId: 'coqm2Q1r6ygRxS6ybYJCGdafnukjBh68B3M3iEzQe6J' },
  ],
};

const TOKENS: Record<string, Record<string, string>> = {
  ethereum: {
    WETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    DAI: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
  },
  base: {
    WETH: '0x4200000000000000000000000000000000000006',
    USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    DAI: '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb',
  },
  solana: {
    WSOL: 'So11111111111111111111111111111111111111112',
    USDT: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
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
      if (path === '/scan') {
        const chain = url.searchParams.get('chain') || 'ethereum';
        const opportunities = await scanForArbitrage(env, chain);
        return new Response(JSON.stringify({ opportunities }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      if (path === '/execute' && method === 'POST') {
        const body = await request.json() as any;
        const result = await executeArbitrage(env, body);
        return new Response(JSON.stringify(result), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      if (path === '/status') {
        const stats = await getArbitrageStats(env);
        return new Response(JSON.stringify(stats), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      if (path === '/opportunities') {
        const status = url.searchParams.get('status') || 'pending';
        const opportunities = await env.CAPITAL_DB.prepare(
          'SELECT * FROM arbitrage_opportunities WHERE executed = ? ORDER BY profit_bps DESC LIMIT 50'
        ).bind(status === 'executed' ? 1 : 0).all();
        return new Response(JSON.stringify({ opportunities: opportunities.results }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      return new Response('MEV Arbitrage Engine', { status: 200 });
    } catch (error: any) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
  },

  async scheduled(event: ScheduledEvent, env: Env): Promise<void> {
    const chains = ['ethereum', 'base', 'solana'];
    for (const chain of chains) {
      try {
        const opportunities = await scanForArbitrage(env, chain);
        const minProfit = parseInt(env.MIN_PROFIT_BPS || '200');
        const profitable = opportunities.filter(o => o.profit_bps >= minProfit);

        if (profitable.length > 0) {
          await executeArbitrage(env, profitable[0]);
        }
      } catch {
        continue;
      }
    }
  },
};

async function scanForArbitrage(env: Env, chain: string): Promise<ArbitrageOpportunity[]> {
  // Solana is not an EVM chain; the generic scanner below reads Uniswap-style
  // pool reserves via an ethers provider, which cannot work on Solana. Use a
  // Jupiter-quote-based discovery path instead.
  if (chain === 'solana') {
    return scanSolanaOpportunities(env);
  }

  const provider = new ethers.JsonRpcProvider(getRPCUrl(env, chain));
  const opportunities: ArbitrageOpportunity[] = [];

  const dexes = DEXES[chain as keyof typeof DEXES] || [];
  const tokens = TOKENS[chain] || {};

  const tokenPairs = Object.entries(tokens);
  for (let i = 0; i < tokenPairs.length; i++) {
    for (let j = i + 1; j < tokenPairs.length; j++) {
      const [symA, addrA] = tokenPairs[i];
      const [symB, addrB] = tokenPairs[j];

      const prices: Record<string, number> = {};
      for (const dex of dexes) {
        try {
          const price = await getTokenPrice(provider, dex, addrA, addrB);
          prices[dex.name] = price;
        } catch {
          continue;
        }
      }

      const entries = Object.entries(prices);
      for (let a = 0; a < entries.length; a++) {
        for (let b = a + 1; b < entries.length; b++) {
          const [dexA, priceA] = entries[a];
          const [dexB, priceB] = entries[b];

          if (priceA > 0 && priceB > 0) {
            const profitBps = Math.abs(Math.round(((priceA / priceB) - 1) * 10000));
            if (profitBps > 50) {
              const expectedProfit = calculateExpectedProfit(priceA, priceB, profitBps);
              const gasCost = await estimateGasCost(provider);
              const netProfit = (parseFloat(expectedProfit) - parseFloat(gasCost)).toString();

              if (parseFloat(netProfit) > 0) {
                opportunities.push({
                  id: crypto.randomUUID(),
                  chain,
                  path: [symA, symB],
                  dex_path: priceA > priceB ? [dexB, dexA] : [dexA, dexB],
                  profit_bps: profitBps,
                  expected_profit: expectedProfit,
                  gas_cost: gasCost,
                  net_profit: netProfit,
                  executed: false,
                });

                await env.CAPITAL_DB.prepare(
                  `INSERT INTO arbitrage_opportunities (id, chain, path, dex_path, profit_bps, expected_profit, gas_cost, net_profit, executed, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
                ).bind(
                  opportunities[opportunities.length - 1].id,
                  chain,
                  JSON.stringify([symA, symB]),
                  JSON.stringify(opportunities[opportunities.length - 1].dex_path),
                  profitBps,
                  expectedProfit,
                  gasCost,
                  netProfit,
                  Date.now()
                ).run();
              }
            }
          }
        }
      }
    }
  }

  await env.CAPITAL_KV.put(`last_scan:${chain}`, JSON.stringify({
    timestamp: Date.now(),
    count: opportunities.length,
  }));

  return opportunities;
}

interface JupiterQuote {
  inAmount: string;
  outAmount: string;
  priceImpactPct: string;
  routePlan?: unknown[];
  error?: string;
}

async function jupiterQuote(
  env: Env,
  inputMint: string,
  outputMint: string,
  amountBase: number,
  slippageBps: number
): Promise<JupiterQuote | null> {
  try {
    const jupBase = env.JUPITER_BASE_URL || 'https://api.jup.ag/swap/v1';
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (env.JUPITER_API_KEY) headers['x-api-key'] = env.JUPITER_API_KEY;
    const res = await fetch(
      `${jupBase}/quote?inputMint=${encodeURIComponent(inputMint)}&outputMint=${encodeURIComponent(outputMint)}&amount=${amountBase}&slippageBps=${slippageBps}`,
      { headers }
    );
    if (!res.ok) return null;
    return await res.json() as JupiterQuote;
  } catch {
    return null;
  }
}

async function scanSolanaOpportunities(env: Env): Promise<ArbitrageOpportunity[]> {
  const opportunities: ArbitrageOpportunity[] = [];
  const tokens = TOKENS.solana || {};
  const symbols = Object.keys(tokens);
  const slippageBps = parseInt(env.SWAP_MAX_SLIPPAGE_BPS || '100', 10);
  const amountBase = 100_000_000; // 0.1 SOL in base units

  for (let i = 0; i < symbols.length; i++) {
    for (let j = i + 1; j < symbols.length; j++) {
      const symA = symbols[i];
      const symB = symbols[j];
      const mintA = tokens[symA] as string;
      const mintB = tokens[symB] as string;

      // Round-trip: how much B does A buy, and how much A does that B buy back.
      const ab = await jupiterQuote(env, mintA, mintB, amountBase, slippageBps);
      const ba = await jupiterQuote(env, mintB, mintA, amountBase, slippageBps);

      if (!ab || !ba || ab.error || ba.error || !ab.routePlan || !ba.routePlan) continue;

      const abOut = parseInt(ab.outAmount, 10);
      const baOut = parseInt(ba.outAmount, 10);
      if (!abOut || !baOut) continue;

      // Value of A recovered after A->B->A round trip, in units of A.
      const roundTripA = (abOut / amountBase) * baOut;
      const profitBps = Math.round(((roundTripA / amountBase) - 1) * 10000);

      if (profitBps > 50) {
        const expectedProfit = (profitBps / 10000) * amountBase / 1e8; // SOL-valued profit
        const gasCost = '0.0004'; // Solana fee + approximate priority
        const netProfit = (expectedProfit - parseFloat(gasCost)).toString();
        if (parseFloat(netProfit) > 0) {
          opportunities.push({
            id: crypto.randomUUID(),
            chain: 'solana',
            path: [symA, symB],
            dex_path: ['Jupiter', 'Jupiter'],
            profit_bps: profitBps,
            expected_profit: netProfit,
            gas_cost: gasCost,
            net_profit: netProfit,
            executed: false,
          });
        }
      }
    }
  }

  await env.CAPITAL_KV.put(`last_scan:solana`, JSON.stringify({
    timestamp: Date.now(),
    count: opportunities.length,
  }));

  return opportunities;
}

async function executeArbitrage(env: Env, opportunity: any): Promise<any> {
  if (opportunity.chain === 'solana') {
    return executeSolanaArbitrage(env, opportunity);
  }

  const provider = new ethers.JsonRpcProvider(getRPCUrl(env, opportunity.chain));
  const wallet = new ethers.Wallet(env.PRIVATE_KEY_ETH, provider);

  try {
    const execId = crypto.randomUUID();

    const tx = {
      to: getDEXRouter(opportunity.chain, opportunity.dex_path?.[0]),
      data: buildSwapData(opportunity),
      gasLimit: 500000,
      maxFeePerGas: ethers.parseUnits('30', 'gwei'),
      maxPriorityFeePerGas: ethers.parseUnits('2', 'gwei'),
    };

    const response = await wallet.sendTransaction(tx);
    await response.wait();

    await env.CAPITAL_DB.prepare(
      `INSERT INTO arbitrage_executions (id, opportunity_id, chain, bundle_hash, status, profit_text, gas_used, block_number, executed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      execId,
      opportunity.id,
      opportunity.chain,
      response.hash,
      'success',
      opportunity.net_profit,
      '0',
      0,
      Date.now()
    ).run();

    await env.CAPITAL_DB.prepare(
      'UPDATE arbitrage_opportunities SET executed = 1, executed_at = ? WHERE id = ?'
    ).bind(Date.now(), opportunity.id).run();

    await updateStats(env, opportunity.chain, opportunity.net_profit, true);

    return { success: true, txHash: response.hash, execId };
  } catch (error: any) {
    await env.CAPITAL_DB.prepare(
      `INSERT INTO arbitrage_executions (id, opportunity_id, chain, status, error, executed_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(
      crypto.randomUUID(),
      opportunity.id,
      opportunity.chain,
      'failed',
      error.message,
      Date.now()
    ).run();

    await updateStats(env, opportunity.chain, '0', false);

    return { success: false, error: error.message };
  }
}

async function executeSolanaArbitrage(env: Env, opportunity: any): Promise<any> {
  const execId = crypto.randomUUID();

  try {
    if (!env.PRIVATE_KEY_SOL || !env.RPC_URL_SOL) {
      throw new Error('Solana execution not configured (missing PRIVATE_KEY_SOL or RPC_URL_SOL)');
    }

    const bundle = await buildSolanaSwapBundle(env, opportunity);
    if (!bundle || !bundle.swapTx) {
      throw new Error('Failed to build Solana swap bundle for opportunity');
    }

    const tipLamports = await sizeJitoTip(env, opportunity);

    // Safety: never submit a bundle we cannot pay for (base fee + Jito tip).
    const connection = new Connection(env.RPC_URL_SOL, 'confirmed');
    const keypair = Keypair.fromSecretKey(secretKeyFromBase64(env.PRIVATE_KEY_SOL));
    const balance = await connection.getBalance(keypair.publicKey);
    const requiredLamports = tipLamports + 10_000; // tip + base fee margin
    if (balance < requiredLamports) {
      throw new Error(
        `Insufficient SOL to submit bundle: have ${(balance / LAMPORTS_PER_SOL).toFixed(6)}, need ${(requiredLamports / LAMPORTS_PER_SOL).toFixed(6)}`
      );
    }

    const tipTx = await buildJitoTipTx(env, tipLamports);
    const bundleTxs = tipTx ? [bundle.swapTx, tipTx] : [bundle.swapTx];

    const bundleResp = await submitJitoBundle(env, bundleTxs);
    const bundleId = bundleResp.bundleId || 'sent';

    // Confirm landing (bundleId only confirms Jito *received* it, not that it landed).
    const landing = await confirmJitoBundleLanding(bundleId);

    const status = landing === 'landed' ? 'success' : 'pending';
    await env.CAPITAL_DB.prepare(
      `INSERT INTO arbitrage_executions (id, opportunity_id, chain, bundle_hash, status, profit_text, gas_used, block_number, executed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      execId,
      opportunity.id,
      'solana',
      bundleId,
      status,
      opportunity.net_profit,
      '0',
      0,
      Date.now()
    ).run();

    await env.CAPITAL_DB.prepare(
      'UPDATE arbitrage_opportunities SET executed = 1, executed_at = ? WHERE id = ?'
    ).bind(Date.now(), opportunity.id).run();

    await updateStats(env, 'solana', opportunity.net_profit, status === 'success');

    return { success: status === 'success', status, landing, bundle: bundleResp, execId };
  } catch (error: any) {
    await env.CAPITAL_DB.prepare(
      `INSERT INTO arbitrage_executions (id, opportunity_id, chain, status, error, executed_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(
      execId,
      opportunity.id,
      'solana',
      'failed',
      error.message,
      Date.now()
    ).run();

    await updateStats(env, 'solana', '0', false);

    return { success: false, error: error.message };
  }
}

async function buildSolanaSwapBundle(env: Env, opportunity: any): Promise<{ swapTx: string; quote: any } | null> {
  try {
    if (!env.PRIVATE_KEY_SOL || !env.RPC_URL_SOL) {
      return null;
    }

    const inputSym = opportunity.path?.[0];
    const outputSym = opportunity.path?.[1];
    const tokens = TOKENS.solana || {};
    const inputMint = tokens[inputSym];
    const outputMint = tokens[outputSym];
    if (!inputMint || !outputMint) return null;

    const amountBase = 100_000_000; // 0.1 SOL (or base units of the input token)
    const slippageBps = parseInt(env.SWAP_MAX_SLIPPAGE_BPS || '100', 10);
    // Jupiter sunset the legacy V6 endpoints; Swap API V1 requires an x-api-key.
    const jupBase = env.JUPITER_BASE_URL || 'https://api.jup.ag/swap/v1';
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (env.JUPITER_API_KEY) {
      headers['x-api-key'] = env.JUPITER_API_KEY;
    }

    const quoteRes = await fetch(
      `${jupBase}/quote?inputMint=${encodeURIComponent(inputMint)}&outputMint=${encodeURIComponent(outputMint)}&amount=${amountBase}&slippageBps=${slippageBps}`,
      { headers }
    );
    if (!quoteRes.ok) return null;
    const quote = await quoteRes.json() as any;
    if (!quote || quote.error || !quote.routePlan) return null;

    const keypair = Keypair.fromSecretKey(secretKeyFromBase64(env.PRIVATE_KEY_SOL));
    const swapRes = await fetch(`${jupBase}/swap`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey: keypair.publicKey.toBase58(),
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: 'auto',
      }),
    });
    if (!swapRes.ok) return null;
    const swapData = await swapRes.json() as { swapTransaction?: string };
    if (!swapData.swapTransaction) return null;

    const tx = VersionedTransaction.deserialize(Buffer.from(swapData.swapTransaction, 'base64'));
    tx.sign([keypair]);
    const signedBase64 = Buffer.from(tx.serialize()).toString('base64');

    return { swapTx: signedBase64, quote };
  } catch {
    return null;
  }
}

function secretKeyFromBase64(secret: string): Uint8Array {
  const decoded = Buffer.from(secret, 'base64');
  if (decoded.length < 64) return new Uint8Array(64).fill(0);
  return new Uint8Array(decoded.subarray(0, 64));
}

async function getRandomTipAccount(): Promise<string> {
  const FALLBACK = '96gYZGLnJkkVFyC2A98sSi8MYp4vC6CGiXmCz8RLM7x8';
  try {
    const res = await fetch('https://mainnet.block-engine.jito.wtf/api/v1/bundles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTipAccounts', params: [] }),
    });
    const data = await res.json() as { result?: string[] };
    const accounts = data.result || [];
    if (accounts.length === 0) return FALLBACK;
    return accounts[Math.floor(Math.random() * accounts.length)];
  } catch {
    return FALLBACK;
  }
}

async function getJitoTipFloor(): Promise<number | null> {
  try {
    const res = await fetch('https://bundles.jito.wtf/api/v1/bundles/tip_floor');
    const data = await res.json() as Array<{ ema_landed_tips_50th_percentile?: number }>;
    if (data && data.length > 0 && typeof data[0].ema_landed_tips_50th_percentile === 'number') {
      return data[0].ema_landed_tips_50th_percentile;
    }
    return null;
  } catch {
    return null;
  }
}

async function sizeJitoTip(env: Env, opportunity: any): Promise<number> {
  const netProfitSol = parseFloat(opportunity.net_profit || '0') || 0.001;
  const tipPct = parseInt(env.JITO_TIP_PCT || '60', 10) / 100;
  const profitLamports = Math.ceil(netProfitSol * tipPct * LAMPORTS_PER_SOL);

  const emaTip = await getJitoTipFloor();
  const emaLamports = emaTip ? Math.ceil(emaTip * LAMPORTS_PER_SOL) : 1_000_000;

  return Math.max(profitLamports, emaLamports, 1_000_000);
}

async function buildJitoTipTx(env: Env, tipLamports: number): Promise<string | null> {
  try {
    const keypair = Keypair.fromSecretKey(secretKeyFromBase64(env.PRIVATE_KEY_SOL));
    const tipAccount = await getRandomTipAccount();
    const connection = new Connection(env.RPC_URL_SOL, 'confirmed');

    const tipIx = SystemProgram.transfer({
      fromPubkey: keypair.publicKey,
      toPubkey: new PublicKey(tipAccount),
      lamports: tipLamports,
    });

    const tx = new Transaction().add(tipIx);
    const { blockhash } = await connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = keypair.publicKey;
    tx.sign(keypair);

    return Buffer.from(tx.serialize()).toString('base64');
  } catch {
    return null;
  }
}

async function submitJitoBundle(
  env: Env,
  serializedTxs: string[]
): Promise<{ bundleId?: string }> {
  if (!serializedTxs || serializedTxs.length === 0) {
    throw new Error('Cannot submit empty Jito bundle');
  }

  const bundleUrl = env.JITO_BUNDLE_URL || 'https://mainnet.block-engine.jito.wtf/api/v1/bundles';
  const res = await fetch(bundleUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: crypto.randomUUID(),
      method: 'sendBundle',
      params: [serializedTxs, { encoding: 'base64' }],
    }),
  });

  const data = await res.json() as { result?: string; error?: any };
  if (!res.ok || data.error) {
    throw new Error(`Jito sendBundle failed: ${data.error?.message || res.status}`);
  }

  return { bundleId: data.result };
}

async function confirmJitoBundleLanding(bundleId: string): Promise<'landed' | 'failed' | 'pending'> {
  try {
    const bundleUrl = 'https://mainnet.block-engine.jito.wtf/api/v1/bundles';
    for (let attempt = 0; attempt < 5; attempt++) {
      const res = await fetch(bundleUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: crypto.randomUUID(),
          method: 'getBundleStatuses',
          params: [[bundleId]],
        }),
      });
      if (res.ok) {
        const data = await res.json() as { result?: { value?: Array<{ status?: string }> } };
        const status = data.result?.value?.[0]?.status;
        if (status === 'Landed') return 'landed';
        if (status === 'Failed') return 'failed';
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    return 'pending';
  } catch {
    return 'pending';
  }
}

async function getArbitrageStats(env: Env): Promise<any> {
  return {
    ethereum: await getChainStats(env, 'ethereum'),
    base: await getChainStats(env, 'base'),
    solana: await getChainStats(env, 'solana'),
  };
}

async function getChainStats(env: Env, chain: string): Promise<any> {
  const stats = await env.CAPITAL_DB.prepare(
    'SELECT * FROM arbitrage_stats WHERE chain = ? ORDER BY updated_at DESC LIMIT 1'
  ).bind(chain).first() as any;

  const lastScan = await env.CAPITAL_KV.get(`last_scan:${chain}`);

  return {
    totalProfit: stats?.total_profit || '0',
    totalAttempts: stats?.total_attempts || 0,
    successCount: stats?.success_count || 0,
    totalGasSpent: stats?.total_gas_spent || '0',
    lastScan: lastScan ? JSON.parse(lastScan) : null,
    successRate: stats?.total_attempts > 0
      ? Math.round((stats.success_count / stats.total_attempts) * 100)
      : 0,
  };
}

async function updateStats(env: Env, chain: string, profit: string, success: boolean): Promise<void> {
  const existing = await env.CAPITAL_DB.prepare(
    'SELECT * FROM arbitrage_stats WHERE chain = ? ORDER BY updated_at DESC LIMIT 1'
  ).bind(chain).first();

  if (existing) {
    await env.CAPITAL_DB.prepare(
      `UPDATE arbitrage_stats SET 
        total_profit = CAST(CAST(total_profit AS REAL) + ? AS TEXT),
        total_attempts = total_attempts + 1,
        success_count = success_count + ?,
        total_gas_spent = CAST(CAST(total_gas_spent AS REAL) + ? AS TEXT),
        updated_at = ?
       WHERE id = ?`
    ).bind(
      profit,
      success ? 1 : 0,
      '0',
      Date.now(),
      existing.id
    ).run();
  } else {
    await env.CAPITAL_DB.prepare(
      `INSERT INTO arbitrage_stats (chain, total_profit, total_attempts, success_count, total_gas_spent, updated_at)
       VALUES (?, ?, 1, ?, ?, ?)`
    ).bind(chain, profit, success ? 1 : 0, '0', Date.now()).run();
  }
}

function getRPCUrl(env: Env, chain: string): string {
  switch (chain) {
    case 'ethereum': return env.RPC_URL_ETH;
    case 'base': return env.RPC_URL_BASE;
    case 'solana': return env.RPC_URL_SOL;
    default: return env.RPC_URL_ETH;
  }
}

async function getTokenPrice(provider: ethers.JsonRpcProvider, dex: any, tokenA: string, tokenB: string): Promise<number> {
  const pairAddress = ethers.getCreate2Address(
    dex.factory,
    ethers.solidityPackedKeccak256(['address', 'address'], [tokenA, tokenB].sort()),
    '0x96e8ac4277198ff8b6f785478aa9a39f403cb768dd02cbee326c3e7da348845f'
  );

  const pair = new ethers.Contract(
    pairAddress,
    ['function getReserves() view returns (uint112,uint112,uint32)'],
    provider
  );

  const [reserve0, reserve1] = await pair.getReserves();
  if (reserve0 === 0n || reserve1 === 0n) return 0;

  return Number(reserve1) / Number(reserve0);
}

function calculateExpectedProfit(priceA: number, priceB: number, profitBps: number): string {
  const baseAmount = 0.1;
  const profit = (baseAmount * profitBps) / 10000;
  return profit.toFixed(6);
}

async function estimateGasCost(provider: ethers.JsonRpcProvider): Promise<string> {
  const fee = await provider.getFeeData();
  const gasPrice = fee.gasPrice || ethers.parseUnits('10', 'gwei');
  const cost = gasPrice * 500000n;
  return ethers.formatEther(cost);
}

function getDEXRouter(chain: string, dexName: string): string {
  const dexes = DEXES[chain as keyof typeof DEXES] || [];
  const dex = dexes.find((d: any) => d.name === dexName);
  if (!dex) return '0x0000000000000000000000000000000000000000';
  // Type-safe access: Ethereum dexes have router, Solana dexes have programId
  if ('programId' in dex) return (dex as { programId: string }).programId;
  return (dex as { router: string }).router || '0x0000000000000000000000000000000000000000';
}

function buildSwapData(opportunity: any): string {
  const chain = opportunity.chain;
  const path = opportunity.path;
  const tokens = TOKENS[chain];
  if (!tokens || !path || path.length < 2) return '0x';

  const tokenAddrs = path.map((sym: string) => tokens[sym]).filter(Boolean);
  if (tokenAddrs.length < 2) return '0x';

  const WETH = tokens.WETH;
  const lastIsWETH = tokenAddrs[tokenAddrs.length - 1].toLowerCase() === WETH.toLowerCase();

  const profitWei = ethers.parseEther(opportunity.expected_profit || '0');
  const baseAmount = ethers.parseEther('0.1');
  const amountIn = baseAmount + profitWei;

  const iface = new ethers.Interface([
    'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] path, address to, uint deadline)',
    'function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] path, address to, uint deadline)',
  ]);

  const deadline = Math.floor(Date.now() / 1000) + 60 * 20;
  const to = '0x0000000000000000000000000000000000000000';

  if (lastIsWETH) {
    return iface.encodeFunctionData('swapExactTokensForETH', [
      amountIn,
      0n,
      tokenAddrs,
      to,
      deadline,
    ]);
  }

  return iface.encodeFunctionData('swapExactTokensForTokens', [
    amountIn,
    0n,
    tokenAddrs,
    to,
    deadline,
  ]);
}
