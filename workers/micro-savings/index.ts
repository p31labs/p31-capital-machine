import { ethers } from 'ethers';

export interface Env {
  CAPITAL_DB: D1Database;
  CAPITAL_KV: KVNamespace;
  RPC_URL_ETH: string;
  RPC_URL_BASE: string;
  PRIVATE_KEY_ETH: string;
}

interface SavingsAccount {
  id: string;
  chain: string;
  user_address: string;
  total_saved: string;
  total_roundups: number;
  yield_earned: string;
  vault_address?: string;
  active: boolean;
}

interface Roundup {
  id: string;
  account_id: string;
  chain: string;
  original_tx_hash?: string;
  original_amount: string;
  rounded_amount: string;
  roundup_amount: string;
  deposited: boolean;
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
      if (path === '/accounts') {
        const accounts = await env.CAPITAL_DB.prepare(
          'SELECT * FROM savings_accounts WHERE active = 1 ORDER BY total_saved DESC'
        ).all();
        return new Response(JSON.stringify({ accounts: accounts.results }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      if (path === '/account' && method === 'POST') {
        const body = await request.json() as any;
        const account = await createAccount(env, body);
        return new Response(JSON.stringify({ account }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      if (path === '/roundup' && method === 'POST') {
        const body = await request.json() as any;
        const roundup = await processRoundup(env, body);
        return new Response(JSON.stringify({ roundup }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      if (path === '/sweep') {
        const result = await sweepRoundups(env);
        return new Response(JSON.stringify(result), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      if (path === '/stats') {
        const stats = await getSavingsStats(env);
        return new Response(JSON.stringify(stats), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      return new Response('Micro-Savings', { status: 200 });
    } catch (error: any) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
  },

  async scheduled(event: ScheduledEvent, env: Env): Promise<void> {
    await sweepRoundups(env);
  },
};

async function createAccount(env: Env, data: any): Promise<SavingsAccount> {
  const id = crypto.randomUUID();
  const now = Date.now();

  const account: SavingsAccount = {
    id,
    chain: data.chain || 'ethereum',
    user_address: data.user_address,
    total_saved: '0',
    total_roundups: 0,
    yield_earned: '0',
    vault_address: data.vault_address,
    active: true,
  };

  await env.CAPITAL_DB.prepare(
    `INSERT INTO savings_accounts (id, chain, user_address, total_saved, total_roundups, yield_earned, vault_address, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
  ).bind(
    account.id, account.chain, account.user_address,
    account.total_saved, account.total_roundups, account.yield_earned,
    account.vault_address, now, now
  ).run();

  return account;
}

async function processRoundup(env: Env, data: any): Promise<Roundup> {
  const originalAmount = parseFloat(data.original_amount);
  const roundedAmount = Math.ceil(originalAmount);
  const roundupAmount = (roundedAmount - originalAmount).toFixed(6);

  const roundup: Roundup = {
    id: crypto.randomUUID(),
    account_id: data.account_id,
    chain: data.chain || 'ethereum',
    original_tx_hash: data.tx_hash,
    original_amount: data.original_amount,
    rounded_amount: roundedAmount.toString(),
    roundup_amount: roundupAmount,
    deposited: false,
  };

  await env.CAPITAL_DB.prepare(
    `INSERT INTO savings_roundups (id, account_id, chain, original_tx_hash, original_amount, rounded_amount, roundup_amount, deposited, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`
  ).bind(
    roundup.id, roundup.account_id, roundup.chain, roundup.original_tx_hash,
    roundup.original_amount, roundup.rounded_amount, roundup.roundup_amount, Date.now()
  ).run();

  await env.CAPITAL_DB.prepare(
    'UPDATE savings_accounts SET total_roundups = total_roundups + 1, updated_at = ? WHERE id = ?'
  ).bind(Date.now(), roundup.account_id).run();

  return roundup;
}

async function sweepRoundups(env: Env): Promise<any> {
  const undeposited = await env.CAPITAL_DB.prepare(
    'SELECT * FROM savings_roundups WHERE deposited = 0 ORDER BY created_at ASC LIMIT 100'
  ).all();

  const grouped = new Map<string, any[]>();
  for (const row of (undeposited.results || [])) {
    const r = row as any;
    const list = grouped.get(r.account_id) || [];
    list.push(r);
    grouped.set(r.account_id, list);
  }

  const results: any[] = [];

  for (const [accountId, roundups] of grouped) {
    try {
      const account = await env.CAPITAL_DB.prepare(
        'SELECT * FROM savings_accounts WHERE id = ?'
      ).bind(accountId).first<any>();
      if (!account) {
        for (const r of roundups) {
          results.push({ id: r.id, status: 'skipped', reason: 'Account not found' });
        }
        continue;
      }

      const chain = account.chain || 'ethereum';
      const provider = new ethers.JsonRpcProvider(
        chain === 'base' ? env.RPC_URL_BASE : env.RPC_URL_ETH
      );
      const wallet = new ethers.Wallet(env.PRIVATE_KEY_ETH, provider);

      let vaultAddress = account.vault_address;
      if (!vaultAddress) {
        vaultAddress = await getOrCreateVault(env, account.user_address, chain);
        await env.CAPITAL_DB.prepare(
          'UPDATE savings_accounts SET vault_address = ?, updated_at = ? WHERE id = ?'
        ).bind(vaultAddress, Date.now(), accountId).run();
      }

      const totalAmount = roundups.reduce(
        (sum, r) => sum + parseFloat(r.roundup_amount), 0
      );
      const amount = ethers.parseEther(totalAmount.toFixed(6));
      if (amount <= 0n) {
        for (const r of roundups) {
          results.push({ id: r.id, status: 'skipped', reason: 'Zero amount' });
        }
        continue;
      }

      const iface = new ethers.Interface([
        'function deposit(uint256 assets, address receiver) returns (uint256)',
      ]);
      const data = iface.encodeFunctionData('deposit', [amount, account.user_address]);

      const tx = await wallet.sendTransaction({
        to: vaultAddress,
        data,
        gasLimit: 200000,
      });
      await tx.wait();

      for (const r of roundups) {
        await env.CAPITAL_DB.prepare(
          'UPDATE savings_roundups SET deposited = 1 WHERE id = ?'
        ).bind(r.id).run();

        await env.CAPITAL_DB.prepare(
          `INSERT INTO savings_deposits (id, account_id, chain, amount, token, status, tx_hash, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          crypto.randomUUID(), accountId, chain,
          r.roundup_amount, 'ETH', 'completed', tx.hash, Date.now()
        ).run();
      }

      await env.CAPITAL_DB.prepare(
        `UPDATE savings_accounts SET
          total_saved = CAST(CAST(total_saved AS REAL) + ? AS TEXT),
          updated_at = ?
         WHERE id = ?`
      ).bind(totalAmount.toFixed(6), Date.now(), accountId).run();

      results.push({
        accountId,
        roundupIds: roundups.map(r => r.id),
        status: 'deposited',
        txHash: tx.hash,
        amount: totalAmount.toFixed(6),
      });
    } catch (error: any) {
      for (const r of roundups) {
        results.push({ id: r.id, status: 'failed', error: error.message });
      }
    }
  }

  return { timestamp: Date.now(), results };
}

const VAULT_BYTECODE = '0x608060405234801561001057600080fd5b506040518060400160405280600e81526020016d4d696e696d616c5661756c742056313160901b815250806040518060400160405280600381526020016210d55460ea1b8152506000826000806101000a8154816001600160a01b0302191690836001600160a01b03160217905550505050610';
const CREATE2_FACTORY = '0x4e59b44847b379578588920cA78FdF26D28Da83E';

async function getOrCreateVault(
  env: Env,
  userAddress: string,
  chain: string
): Promise<string> {
  const provider = new ethers.JsonRpcProvider(
    chain === 'base' ? env.RPC_URL_BASE : env.RPC_URL_ETH
  );
  const wallet = new ethers.Wallet(env.PRIVATE_KEY_ETH, provider);
  const salt = ethers.solidityPackedKeccak256(
    ['address', 'string'],
    [userAddress, chain]
  );
  const initCodeHash = ethers.keccak256(VAULT_BYTECODE);
  const vaultAddress = ethers.getCreate2Address(
    wallet.address,
    salt,
    initCodeHash
  );

  const code = await provider.getCode(vaultAddress);
  if (code !== '0x') {
    return vaultAddress;
  }

  const factory = new ethers.Contract(
    CREATE2_FACTORY,
    ['function deploy(bytes initCode, bytes32 salt) returns (address)'],
    wallet
  );

  const tx = await factory.deploy(VAULT_BYTECODE, salt, { gasLimit: 500000 });
  await tx.wait();

  return vaultAddress;
}

async function getSavingsStats(env: Env): Promise<any> {
  const accounts = await env.CAPITAL_DB.prepare(
    'SELECT COUNT(*) as count, SUM(CAST(total_saved AS REAL)) as total FROM savings_accounts WHERE active = 1'
  ).first();

  const pendingRoundups = await env.CAPITAL_DB.prepare(
    'SELECT COUNT(*) as count, SUM(CAST(roundup_amount AS REAL)) as total FROM savings_roundups WHERE deposited = 0'
  ).first();

  return {
    activeAccounts: accounts?.count || 0,
    totalSaved: accounts?.total || 0,
    pendingRoundups: pendingRoundups?.count || 0,
    pendingAmount: pendingRoundups?.total || 0,
  };
}
