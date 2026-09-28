import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import { x402ResourceServer, HTTPFacilitatorClient } from '@x402/core/server';
import type { PaymentRequirements } from './x402';
import { resetX402RuntimeForTest, base64Encode, X402_PRICE, type X402Runtime } from './x402';

const MOCK_PAY_TO = '0x51c285Df171C76bE36252e32679F098d90768413';
const MOCK_ASSET = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const MOCK_NETWORK = 'eip155:84532';

function buildRequirement(): PaymentRequirements {
  return {
    scheme: 'exact',
    network: MOCK_NETWORK,
    asset: MOCK_ASSET,
    amount: '10000',
    payTo: MOCK_PAY_TO,
    maxTimeoutSeconds: 60,
    extra: {},
  };
}

function buildValidPaymentPayload() {
  return {
    x402Version: 2,
    accepted: buildRequirement(),
    payload: {
      signature: '0x' + '11'.repeat(64),
      authorization: {
        from: '0x0000000000000000000000000000000000000001',
        to: MOCK_PAY_TO,
        value: '10000',
        validAfter: '0',
        validBefore: '9999999999',
        nonce: '0x' + '00'.repeat(32),
        tokenContract: MOCK_ASSET,
        chainId: 84532,
      },
    },
  };
}

interface MockFacilitator {
  verify: ReturnType<typeof vi.fn>;
  settle: ReturnType<typeof vi.fn>;
  getSupported: ReturnType<typeof vi.fn>;
}

function buildRuntime(mock: MockFacilitator): X402Runtime {
  const facilitator = {
    verify: mock.verify,
    settle: mock.settle,
    getSupported: mock.getSupported,
  };
  const scheme = new ExactEvmScheme();
  const server = new x402ResourceServer(facilitator);
  server.register(MOCK_NETWORK, scheme);
  return {
    server,
    scheme,
    network: MOCK_NETWORK,
    mode: 'mogami',
    payTo: MOCK_PAY_TO,
    asset: MOCK_ASSET,
    price: X402_PRICE,
    timeoutSeconds: 60,
  };
}

function mockD1() {
  const state = new Map<string, any>();
  state.set('SELECT * FROM entitlements WHERE did = ?', {
    did: 'did:key:test-proxy',
    balance_usdc: '10.00',
    balance_love: '0',
    tier: 'pro',
    monthly_allowance_usdc: '50',
    monthly_used_usdc: '0',
    last_updated: Date.now(),
    created_at: Date.now(),
  });
  state.set('SELECT * FROM tier_limits WHERE tier = ?', {
    tier: 'pro',
    monthly_allowance_usdc: '50',
    monthly_calls_per_tool: 1000,
    burst_multiplier: 2.0,
  });

  const makeStatement = (sql: string) => {
    const stmt: {
      sql: string;
      bindArgs: any[];
      bind: (...args: any[]) => any;
      first: () => Promise<any>;
      all: () => Promise<any>;
      run: () => Promise<{ success: boolean }>;
    } = {
      sql,
      bindArgs: [] as any[],
      bind: function (this: any, ...args: any[]) {
        this.bindArgs = args;
        return this;
      },
      async first() {
        const r = state.get(this.sql);
        return typeof r === 'function' ? r(this.bindArgs) : r;
      },
      async all() {
        const r = state.get(this.sql);
        return r && r.results ? r : { results: [] };
      },
      async run() {
        return { success: true };
      },
    };
    return stmt;
  };

  return {
    db: {
      prepare: vi.fn((sql: string) => makeStatement(sql)),
      exec: vi.fn().mockResolvedValue(undefined),
    },
    state,
  };
}

const mockVerify = vi.fn();
const mockSettle = vi.fn();
const mockGetSupported = vi.fn();
let testRuntime: X402Runtime;

vi.mock('./x402', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./x402')>();
  return {
    ...actual,
    getX402: vi.fn(async () => testRuntime),
  };
});

import worker from './index';

beforeEach(() => {
  resetX402RuntimeForTest();
  mockVerify.mockReset();
  mockSettle.mockReset();
  mockGetSupported.mockReset();
  mockVerify.mockResolvedValue({ isValid: true, payer: '0xpayer' });
  mockSettle.mockResolvedValue({ success: true, payer: '0xpayer', transaction: '0xsettletx', network: MOCK_NETWORK, amount: '10000' });
  mockGetSupported.mockResolvedValue({ kinds: [], extensions: [], signers: {} });
  testRuntime = buildRuntime({ verify: mockVerify, settle: mockSettle, getSupported: mockGetSupported });
});

afterEach(() => {
  resetX402RuntimeForTest();
  vi.clearAllMocks();
});

describe('entitlement paywall (handler-level, mocked facilitator)', () => {
  function makeEnv() {
    const { db, state } = mockD1();
    return { env: { ENTITLEMENT_DB: db, ENVIRONMENT: 'test' }, state };
  }

  it('GET /entitlement/{did} without X-PAYMENT → 402 with accepts[]', async () => {
    const { env } = makeEnv();
    const req = new Request('https://entitlement.test/entitlement/did:key:test-proxy');
    const res = await worker.fetch(req, env as any);
    expect(res.status).toBe(402);
    const body = JSON.parse(await res.text());
    expect(body.x402Version).toBe(2);
    expect(body.accepts[0]).toMatchObject({ scheme: 'exact', network: MOCK_NETWORK, amount: '10000', asset: MOCK_ASSET, payTo: MOCK_PAY_TO });
    expect(mockSettle).not.toHaveBeenCalled();
  });

  it('valid X-PAYMENT → verify FIRST, handler runs, settle AFTER, 200 + X-PAYMENT-RESPONSE', async () => {
    const { env, state } = makeEnv();
    let handlerRan = false;
    const origFirst = state.get('SELECT * FROM entitlements WHERE did = ?');
    state.set('SELECT * FROM entitlements WHERE did = ?', () => {
      handlerRan = true;
      return origFirst;
    });

    mockSettle.mockImplementation(async () => {
      expect(handlerRan).toBe(true);
      return { success: true, payer: '0xpayer', transaction: '0xsettletx', network: MOCK_NETWORK, amount: '10000' };
    });

    const payload = buildValidPaymentPayload();
    const req = new Request('https://entitlement.test/entitlement/did:key:test-proxy', {
      headers: { 'X-PAYMENT': base64Encode(JSON.stringify(payload)) },
    });
    const res = await worker.fetch(req, env as any);

    expect(res.status).toBe(200);
    expect(mockVerify).toHaveBeenCalledTimes(1);
    expect(mockSettle).toHaveBeenCalledTimes(1);
    const header = res.headers.get('X-PAYMENT-RESPONSE');
    expect(header).toBeTruthy();
    const settle = JSON.parse(Buffer.from(header as string, 'base64').toString('utf8'));
    expect(settle.success).toBe(true);
    expect(settle.transaction).toBe('0xsettletx');
    const body = JSON.parse(await res.text());
    expect(body.data.tier).toBe('pro');
  });

  it('verify failure → 402 with reason, handler NOT run, settle NOT called', async () => {
    const { env, state } = makeEnv();
    mockVerify.mockResolvedValue({ isValid: false, invalidReason: 'signature_invalid', invalidMessage: 'bad sig' });

    const payload = buildValidPaymentPayload();
    const req = new Request('https://entitlement.test/entitlement/did:key:test-proxy', {
      headers: { 'X-PAYMENT': base64Encode(JSON.stringify(payload)) },
    });
    const res = await worker.fetch(req, env as any);
    expect(res.status).toBe(402);
    const body = JSON.parse(await res.text());
    expect(body.error).toContain('Payment verification failed');
    expect(mockSettle).not.toHaveBeenCalled();
  });

  it('settle failure → 502, not a false 200', async () => {
    const { env } = makeEnv();
    mockSettle.mockResolvedValue({ success: false, transaction: '', network: MOCK_NETWORK, errorReason: 'insufficient_funds' });

    const payload = buildValidPaymentPayload();
    const req = new Request('https://entitlement.test/entitlement/did:key:test-proxy', {
      headers: { 'X-PAYMENT': base64Encode(JSON.stringify(payload)) },
    });
    const res = await worker.fetch(req, env as any);
    expect(res.status).toBe(502);
    const body = JSON.parse(await res.text());
    expect(body.error).toContain('settlement failed');
    expect(res.headers.get('X-PAYMENT-RESPONSE')).toBeNull();
  });

  it('free-list /health stays 200 with X-PAYMENT absent (not paywalled)', async () => {
    const { env } = makeEnv();
    const req = new Request('https://entitlement.test/health');
    const res = await worker.fetch(req, env as any);
    expect(res.status).toBe(200);
    expect(mockVerify).not.toHaveBeenCalled();
  });

  it('POST /entitlement/check keeps its own 402 semantics (not the x402 paywall)', async () => {
    const { env } = makeEnv();
    const req = new Request('https://entitlement.test/entitlement/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ did: 'did:key:test-proxy', tool_id: 't', estimated_cost_usdc: '11.00' }),
    });
    const res = await worker.fetch(req, env as any);
    expect(res.status).toBe(402);
    const body = JSON.parse(await res.text());
    expect(body.ok).toBe(false);
    expect(body.accepts).toBeUndefined();
    expect(mockVerify).not.toHaveBeenCalled();
  });
});