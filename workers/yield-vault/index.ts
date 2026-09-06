import { ethers } from 'ethers';
import { EthereumAdapter } from '../../chains/ethereum';
import { BaseAdapter } from '../../chains/base';
import { ArbitrumAdapter } from '../../chains/arbitrum';
import { BerachainAdapter } from '../../chains/berachain';

export interface Env {
  CAPITAL_DB: D1Database;
  CAPITAL_KV: KVNamespace;
  RPC_URL_ETH: string;
  RPC_URL_BASE: string;
  RPC_URL_ARB: string;
  RPC_URL_BERA: string;
  PRIVATE_KEY_ETH: string;
  AAVE_POOL_ADDRESS: string;
  COMPOUND_COMPTROLLER: string;
  MORPHO_VAULT_ADDRESS: string;
  LOVE_TOKEN_ADDRESS: string;  // ERC-5192 soulbound token
  MIDAS_VAULT_ADDRESS: string;
  MIDAS_VAULT_ABI: string;
  OPENTRADE_POOL_ADDRESS: string;
  OPENTRADE_POOL_ABI: string;
  EULER_VAULT_ADDRESS: string;
  EULER_VAULT_ABI: string;
  BEND_HONEY_VAULT_ADDRESS: string;
  ETHENA_VAULT_ADDRESS: string;
  BENPAY_VAULT_ADDRESS: string;
  MOONWELL_VAULT_ADDRESS: string;
  PENDLE_VAULT_ADDRESS: string;
  PEAPODS_VAULT_ADDRESS: string;
}

interface Strategy {
  id: number;
  chain: string;
  protocol: string;
  target: string;
  weight: number;
  apy_bps: number;
  active: boolean;
  last_rebalance: number;
}

interface VaultDeposit {
  id: string;
  chain: string;
  user_address: string;
  amount: string;
  shares: string;
  strategy_index: number;
  status: string;
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
      if (path === '/strategies') {
        const strategies = await getStrategies(env);
        return new Response(JSON.stringify({ strategies }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      if (path === '/strategies/add' && method === 'POST') {
        const body = await request.json() as any;
        const strategy = await addStrategy(env, body);
        return new Response(JSON.stringify({ strategy }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      if (path === '/rebalance') {
        const result = await rebalanceVault(env);
        return new Response(JSON.stringify(result), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      if (path === '/harvest') {
        const result = await harvestYields(env);
        return new Response(JSON.stringify(result), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      if (path === '/deposits') {
        const deposits = await env.CAPITAL_DB.prepare(
          "SELECT * FROM vault_deposits WHERE status = 'active' ORDER BY created_at DESC"
        ).all();
        return new Response(JSON.stringify({ deposits: deposits.results }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      if (path === '/stats') {
        const totalDeposits = await env.CAPITAL_DB.prepare(
          "SELECT SUM(CAST(amount AS REAL)) as total FROM vault_deposits WHERE status = 'active'"
        ).first();
        const strategies = await getStrategies(env);
        const loveTotal = await env.CAPITAL_DB.prepare(
          "SELECT SUM(CAST(amount AS REAL)) as total FROM vault_yield_harvests WHERE token = 'LOVE'"
        ).first();
        return new Response(JSON.stringify({
          totalDeposits: totalDeposits?.total || 0,
          activeStrategies: strategies.filter((s: Strategy) => s.active).length,
          totalStrategies: strategies.length,
          loveTotalHarvested: loveTotal?.total || 0,
          timestamp: Date.now(),
        }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      return new Response('Yield Vault Module', { status: 200 });
    } catch (error: any) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
  },

  async scheduled(event: ScheduledEvent, env: Env): Promise<void> {
    switch (event.cron) {
      case '*/15 * * * *':
        await rebalanceVault(env);
        break;
      case '0 * * * *':
        await harvestYields(env);
        break;
    }
  },
};

async function getStrategies(env: Env): Promise<Strategy[]> {
  const result = await env.CAPITAL_DB.prepare(
    'SELECT * FROM vault_strategies WHERE active = 1 ORDER BY weight DESC'
  ).all();
  return (result.results || []) as unknown as Strategy[];
}

async function addStrategy(env: Env, data: any): Promise<Strategy> {
  const now = Date.now();
  const result = await env.CAPITAL_DB.prepare(
    `INSERT INTO vault_strategies (chain, protocol, target, weight, active, last_rebalance, created_at)
     VALUES (?, ?, ?, ?, 1, ?, ?)
     RETURNING *`
  ).bind(data.chain, data.protocol, data.target, data.weight, now, now).first();
  return result as unknown as Strategy;
}

async function rebalanceVault(env: Env): Promise<any> {
  const strategies = await getStrategies(env);
  if (strategies.length === 0) {
    return { rebalanced: false, reason: 'No active strategies' };
  }

  const totalWeight = strategies.reduce((sum, s) => sum + s.weight, 0);
  if (totalWeight === 0) {
    return { rebalanced: false, reason: 'Total weight is zero' };
  }

  const chainAdapters = getChainAdapters(env);
  const apys: { strategyId: number; apy: number }[] = [];

  for (const strategy of strategies) {
    try {
      const adapter = chainAdapters[strategy.chain];
      if (!adapter) continue;

      const apy = await fetchAPY(adapter, strategy, env);
      apys.push({ strategyId: strategy.id, apy });
    } catch {
      apys.push({ strategyId: strategy.id, apy: 0 });
    }
  }

  const totalAPY = apys.reduce((sum, a) => sum + a.apy, 0);
  const newWeights = apys.map(a => ({
    strategyId: a.strategyId,
    weight: totalAPY > 0 ? Math.round((a.apy / totalAPY) * 10000) : 0,
  }));

  const rebalanceId = crypto.randomUUID();
  const now = Date.now();

  await env.CAPITAL_DB.prepare(
    `INSERT INTO vault_rebalances (id, chain, timestamp, old_weights, new_weights, weighted_apy_bps)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(
    rebalanceId,
    'multi',
    now,
    JSON.stringify(strategies.map(s => ({ id: s.id, weight: s.weight }))),
    JSON.stringify(newWeights),
    totalAPY
  ).run();

  for (const nw of newWeights) {
    await env.CAPITAL_DB.prepare(
      'UPDATE vault_strategies SET weight = ?, last_rebalance = ? WHERE id = ?'
    ).bind(nw.weight, now, nw.strategyId).run();
  }

  return {
    rebalanced: true,
    rebalanceId,
    strategies: newWeights,
    weightedAPY: totalAPY,
    timestamp: now,
  };
}

async function harvestYields(env: Env): Promise<any> {
  const harvests: any[] = [];

  const chains = ['ethereum', 'base', 'arbitrum', 'berachain'];
  for (const chain of chains) {
    const adapter = getChainAdapters(env)[chain];
    if (!adapter) continue;

    try {
      if (chain === 'ethereum') {
        // Harvest ETH balance
        const balance = await adapter.getBalance(adapter.getWallet().address);
        if (balance > 0n) {
          const harvestId = crypto.randomUUID();
          await env.CAPITAL_DB.prepare(
            `INSERT INTO vault_yield_harvests (id, chain, amount, token, timestamp)
             VALUES (?, ?, ?, ?, ?)`
          ).bind(harvestId, chain, balance.toString(), 'ETH', Date.now()).run();

          harvests.push({ chain, amount: balance.toString(), token: 'ETH' });
        }

        // LOVE soulbound token balance check (non-transferrable)
        const loveAddress = env.LOVE_TOKEN_ADDRESS;
        if (loveAddress) {
          const loveAdapter = adapter; // Same provider
          const loveContract = new ethers.Contract(
            loveAddress,
            ['function balanceOf(address) view returns (uint256)'],
            loveAdapter.getProvider()
          );
          const loveBalance = await loveContract.balanceOf(adapter.getWallet().address);
          if (loveBalance > 0n) {
            const harvestId = crypto.randomUUID();
            await env.CAPITAL_DB.prepare(
              `INSERT INTO vault_yield_harvests (id, chain, amount, token, timestamp)
               VALUES (?, ?, ?, ?, ?)`
            ).bind(harvestId, chain, loveBalance.toString(), 'LOVE', Date.now()).run();

            harvests.push({ chain, amount: loveBalance.toString(), token: 'LOVE' });
          }
        }
      } else {
        const balance = await adapter.getBalance(adapter.getWallet().address);
        if (balance > 0n) {
          const harvestId = crypto.randomUUID();
          await env.CAPITAL_DB.prepare(
            `INSERT INTO vault_yield_harvests (id, chain, amount, token, timestamp)
             VALUES (?, ?, ?, ?, ?)`
          ).bind(harvestId, chain, balance.toString(), 'ETH', Date.now()).run();

          harvests.push({ chain, amount: balance.toString(), token: 'ETH' });
        }
      }

      if (chain === 'berachain') {
        const beraBalance = await adapter.getBalance(adapter.getWallet().address);
        if (beraBalance > 0n) {
          const harvestId = crypto.randomUUID();
          await env.CAPITAL_DB.prepare(
            `INSERT INTO vault_yield_harvests (id, chain, amount, token, timestamp)
             VALUES (?, ?, ?, ?, ?)`
          ).bind(harvestId, chain, beraBalance.toString(), 'BERA', Date.now()).run();
          harvests.push({ chain, amount: beraBalance.toString(), token: 'BERA' });
        }

        const honeyVault = env.BEND_HONEY_VAULT_ADDRESS;
        if (honeyVault) {
          const honeyBalance = await adapter.getTokenBalance(honeyVault, adapter.getWallet().address);
          if (honeyBalance > 0n) {
            const harvestId = crypto.randomUUID();
            await env.CAPITAL_DB.prepare(
              `INSERT INTO vault_yield_harvests (id, chain, amount, token, timestamp)
               VALUES (?, ?, ?, ?, ?)`
            ).bind(harvestId, chain, honeyBalance.toString(), 'HONEY', Date.now()).run();
            harvests.push({ chain, amount: honeyBalance.toString(), token: 'HONEY' });
          }
        }
      }
    } catch {
      continue;
    }
  }

  return { harvested: true, harvests, timestamp: Date.now() };
}

function getChainAdapters(env: Env): Record<string, any> {
  return {
    ethereum: new EthereumAdapter(env.RPC_URL_ETH, env.PRIVATE_KEY_ETH),
    base: new BaseAdapter(env.RPC_URL_BASE, env.PRIVATE_KEY_ETH),
    arbitrum: new ArbitrumAdapter(env.RPC_URL_ARB, env.PRIVATE_KEY_ETH),
    berachain: new BerachainAdapter(env.RPC_URL_BERA, env.PRIVATE_KEY_ETH),
  };
}

const AAVE_POOL_ETH = '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2';
const AAVE_POOL_ARB = '0x794a61358D6845594F94dc1DB02A252b5b4814aD';
const AAVE_POOL_BASE = '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5';
const MORPHO_BLUE = '0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb';

const lastMorphoIndex = new Map<string, { index: bigint; blockNumber: number; timestamp: number }>();

async function fetchAPY(adapter: any, strategy: Strategy, env: Env): Promise<number> {
  try {
    const provider = adapter.getProvider();
    const protocol = strategy.protocol.toLowerCase();
    if (protocol === 'aave') {
      let poolAddr: string;
      switch (strategy.chain) {
        case 'arbitrum': poolAddr = AAVE_POOL_ARB; break;
        case 'base': poolAddr = AAVE_POOL_BASE; break;
        default: poolAddr = AAVE_POOL_ETH;
      }
      const pool = new ethers.Contract(
        poolAddr,
        ['function getReserveData(address) view returns (uint256,uint128,uint128,uint128,uint128,uint128,uint40,uint16,address,address,address,address,uint128,uint128,uint128)'],
        provider
      );
      const data = await pool.getReserveData(strategy.target);
      const liquidityRate = Number(data[3]) / 1e27;
      return Math.round(liquidityRate * 10000);
    }

    if (protocol === 'compound') {
      const cToken = new ethers.Contract(
        strategy.target,
        ['function supplyRatePerBlock() view returns (uint256)'],
        provider
      );
      const ratePerBlock = await cToken.supplyRatePerBlock();
      const blocksPerYear = 2628000n;
      const annualRate = Number(ratePerBlock * blocksPerYear) / 1e18;
      return Math.round(annualRate * 10000);
    }

      if (protocol === 'morpho') {
      const morpho = new ethers.Contract(
        MORPHO_BLUE,
        ['function poolIndexes(address) view returns (uint256, uint256)'],
        provider
      );
      const [supplyPoolIndex] = await morpho.poolIndexes(strategy.target);
      const block = await provider.getBlock('latest');
      if (!block) return 0;
      const cacheKey = `${strategy.chain}:${strategy.target}`;
      const last = lastMorphoIndex.get(cacheKey);
      if (last && last.index > 0n && last.blockNumber < block.number) {
        const deltaT = block.timestamp - last.timestamp;
        const indexDelta = Number(supplyPoolIndex - last.index) / Number(last.index);
        if (deltaT > 0 && indexDelta > 0) {
          const annualizedRate = (indexDelta / deltaT) * 365.25 * 86400;
          lastMorphoIndex.set(cacheKey, { index: supplyPoolIndex, blockNumber: block.number, timestamp: block.timestamp });
          return Math.round(annualizedRate * 10000);
        }
      }
      lastMorphoIndex.set(cacheKey, { index: supplyPoolIndex, blockNumber: block.number, timestamp: block.timestamp });
      const totalGrowth = Number(supplyPoolIndex) / 1e27 - 1;
      return Math.round(totalGrowth * 10000);
    }

    if (protocol === 'midas') {
      const vaultAddress = env.MIDAS_VAULT_ADDRESS;
      if (!vaultAddress) return 0;
      const vaultAbi = env.MIDAS_VAULT_ABI
        ? JSON.parse(env.MIDAS_VAULT_ABI)
        : [
            'function totalAssets() view returns (uint256)',
            'function totalSupply() view returns (uint256)',
            'function pricePerShare() view returns (uint256)',
          ];
      const vault = new ethers.Contract(vaultAddress, vaultAbi, provider);
      try {
        const totalAssets = await vault.totalAssets();
        const totalSupply = await vault.totalSupply();
        if (totalSupply === 0n) return 0;
        const sharePrice = Number(totalAssets) / Number(totalSupply);
        const entryPrice = 1e18;
        const apy = ((sharePrice - Number(entryPrice)) / Number(entryPrice)) * 100;
        return Math.round(Math.max(apy, 0) * 10000);
      } catch {
        return 0;
      }
    }

    if (protocol === 'opentrade') {
      const poolAddress = env.OPENTRADE_POOL_ADDRESS;
      if (!poolAddress) return 0;
      const poolAbi = env.OPENTRADE_POOL_ABI
        ? JSON.parse(env.OPENTRADE_POOL_ABI)
        : [
            'function getSupplyRate() view returns (uint256)',
            'function supplyRatePerBlock() view returns (uint256)',
          ];
      const pool = new ethers.Contract(poolAddress, poolAbi, provider);
      try {
        if (pool.interface.getFunction('getSupplyRate')) {
          const rate = await pool.getSupplyRate();
          const apy = Number(rate) / 1e16;
          return Math.round(apy * 10000);
        }
        const ratePerBlock = await pool.supplyRatePerBlock();
        const blocksPerYear = 2628000n;
        const annualRate = Number(ratePerBlock * blocksPerYear) / 1e18;
        return Math.round(annualRate * 10000);
      } catch {
        return 0;
      }
    }

    if (protocol === 'euler') {
      const vaultAddress = env.EULER_VAULT_ADDRESS;
      if (!vaultAddress) return 0;
      const vaultAbi = env.EULER_VAULT_ABI
        ? JSON.parse(env.EULER_VAULT_ABI)
        : [
            'function totalAssets() view returns (uint256)',
            'function convertToAssets(uint256 shares) view returns (uint256)',
          ];
      const vault = new ethers.Contract(vaultAddress, vaultAbi, provider);
      try {
        const totalAssets = await vault.totalAssets();
        const totalSupply = await vault.totalSupply();
        if (totalSupply === 0n) return 0;
        const apy = (Number(totalAssets) / Number(totalSupply) - 1) * 100;
        return Math.round(Math.max(apy, 0) * 10000);
      } catch {
        return 0;
      }
    }

    if (protocol === 'bend-honey') {
      const vaultAddress = env.BEND_HONEY_VAULT_ADDRESS;
      if (!vaultAddress) return 0;
      const vaultAbi = [
        'function apy() view returns (uint256)',
        'function totalSupply() view returns (uint256)',
        'function totalAssets() view returns (uint256)',
      ];
      const vault = new ethers.Contract(vaultAddress, vaultAbi, provider);
      try {
        const apyRaw = await vault.apy();
        const apy = Number(apyRaw) / 1e18;
        return Math.round(apy * 10000);
      } catch {
        try {
          const totalAssets = await vault.totalAssets();
          const totalSupply = await vault.totalSupply();
          if (totalSupply === 0n) return 0;
          const sharePrice = Number(totalAssets) / Number(totalSupply);
          const apy = (sharePrice - 1) * 100;
          return Math.round(Math.max(apy, 0) * 10000);
        } catch {
          return 0;
        }
      }
    }

    if (protocol === 'ethena') {
      const vaultAddress = env.ETHENA_VAULT_ADDRESS;
      if (!vaultAddress) return 0;
      const vaultAbi = [
        'function totalSupply() view returns (uint256)',
        'function totalAssets() view returns (uint256)',
        'function apy() view returns (uint256)',
      ];
      const vault = new ethers.Contract(vaultAddress, vaultAbi, provider);
      try {
        const apyRaw = await vault.apy();
        const apy = Number(apyRaw) / 1e16;
        return Math.round(Math.min(apy, 100) * 10000);
      } catch {
        try {
          const totalAssets = await vault.totalAssets();
          const totalSupply = await vault.totalSupply();
          if (totalSupply === 0n) return 0;
          const rate = Number(totalAssets) / Number(totalSupply) - 1;
          const apy = Math.max(rate, 0) * 100;
          return Math.round(apy * 10000);
        } catch {
          return 0;
        }
      }
    }

    if (protocol === 'benpay') {
      const vaultAddress = env.BENPAY_VAULT_ADDRESS;
      if (!vaultAddress) return 0;
      const vaultAbi = [
        'function totalSupply() view returns (uint256)',
        'function totalAssets() view returns (uint256)',
        'function supplyRatePerBlock() view returns (uint256)',
      ];
      const vault = new ethers.Contract(vaultAddress, vaultAbi, provider);
      try {
        if (vault.interface.getFunction('supplyRatePerBlock')) {
          const ratePerBlock = await vault.supplyRatePerBlock();
          const blocksPerYear = 2628000n;
          const annualRate = Number(ratePerBlock * blocksPerYear) / 1e18;
          return Math.round(annualRate * 10000);
        }
      } catch {
        /* fall through to share-price fallback */
      }
      try {
        const totalAssets = await vault.totalAssets();
        const totalSupply = await vault.totalSupply();
        if (totalSupply === 0n) return 0;
        const apy = (Number(totalAssets) / Number(totalSupply) - 1) * 100;
        return Math.round(Math.max(apy, 0) * 10000);
      } catch {
        return 0;
      }
    }

    if (protocol === 'moonwell') {
      const vaultAddress = env.MOONWELL_VAULT_ADDRESS;
      if (!vaultAddress) return 0;
      // Moonwell Core mTokens are Compound v2-compatible. Prefer the
      // per-block supply rate (annualized) when the market exposes it; many
      // V2 proxy markets revert, so fall back to exchange-rate growth over a
      // persisted time window (two exchangeRateCurrent observations with real
      // elapsed time) for a real on-chain supply APY.
      const vaultAbi = [
        'function supplyRatePerBlock() view returns (uint256)',
        'function exchangeRateCurrent() view returns (uint256)',
      ];
      const vault = new ethers.Contract(vaultAddress, vaultAbi, provider);
      try {
        const ratePerBlock = await vault.supplyRatePerBlock();
        if (ratePerBlock > 0n) {
          const blocksPerYear = 10512000n; // Base ~1s blocks
          const annualRate = Number(ratePerBlock * blocksPerYear) / 1e18;
          return Math.round(annualRate * 100);
        }
      } catch {
        /* fall through to exchange-rate growth */
      }
      try {
        const cur = await vault.exchangeRateCurrent();
        if (cur === 0n) return 0;
        const now = Date.now();
        const prev = await env.CAPITAL_DB.prepare(
          'SELECT stored, ts FROM moonwell_rate_observations WHERE address = ? ORDER BY ts DESC LIMIT 1'
        ).bind(vaultAddress.toLowerCase()).first();
        let apy = 0;
        if (prev && prev.stored && prev.ts) {
          const elapsedSec = (now - Number(prev.ts)) / 1000;
          // Require a meaningful window so short-lived block-boundary accruals
          // do not dominate (the cron runs every 15 min, which is sufficient).
          if (elapsedSec >= 300 && Number(prev.stored) > 0) {
            const perSec = Math.log(Number(cur) / Number(prev.stored)) / elapsedSec;
            const annualized = Math.exp(perSec * 31536000) - 1;
            apy = Math.max(annualized, 0) * 100;
            await env.CAPITAL_DB.prepare(
              'UPDATE moonwell_rate_observations SET stored = ?, ts = ? WHERE address = ?'
            ).bind(cur.toString(), now, vaultAddress.toLowerCase()).run();
            return Math.round(apy);
          }
        }
        await env.CAPITAL_DB.prepare(
          'INSERT INTO moonwell_rate_observations (address, stored, ts) VALUES (?, ?, ?) ' +
          'ON CONFLICT(address) DO UPDATE SET stored = excluded.stored, ts = excluded.ts'
        ).bind(vaultAddress.toLowerCase(), cur.toString(), now).run();
        return 0;
      } catch {
        return 0;
      }
    }

    if (protocol === 'pendle') {
      const vaultAddress = env.PENDLE_VAULT_ADDRESS;
      if (!vaultAddress) return 0;
      // PendleMarketV7.readState(address router) returns MarketState where
      // lastLnImpliedRate (index 8) is the annualized implied rate in ln form.
      const vaultAbi = [
        'function readState(address router) view returns (int256,int256,int256,address,int256,uint256,uint256,uint256,uint256)',
      ];
      const vault = new ethers.Contract(vaultAddress, vaultAbi, provider);
      try {
        const state = await vault.readState('0x0000000000000000000000000000000000000000');
        const lastLnImpliedRate = state[8];
        const impliedRate = (Number(lastLnImpliedRate) / 1e18);
        const apy = (Math.exp(impliedRate) - 1) * 100;
        return Math.round(Math.max(apy, 0) * 100);
      } catch {
        return 0;
      }
    }

    if (protocol === 'peapods') {
      const vaultAddress = env.PEAPODS_VAULT_ADDRESS;
      if (!vaultAddress) return 0;
      // Peapods pod is an ERC-4626-like wrapper: CBR = TKN backing per pTKN.
      // convertToAssets(1e18) returns the pod CBR (share price) which grows
      // irreversibly as fees burn pTKN supply. Report accrued yield to date.
      const vaultAbi = [
        'function convertToAssets(uint256 shares) view returns (uint256)',
      ];
      const vault = new ethers.Contract(vaultAddress, vaultAbi, provider);
      try {
        const sharePrice = await vault.convertToAssets(1000000000000000000n);
        if (sharePrice === 0n) return 0;
        const apy = (Number(sharePrice) / 1e18 - 1) * 100;
        return Math.round(Math.max(apy, 0) * 100);
      } catch {
        return 0;
      }
    }

    return 0;
  } catch {
    return 0;
  }
}
