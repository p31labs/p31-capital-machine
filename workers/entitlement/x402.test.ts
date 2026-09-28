import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getX402,
  resetX402RuntimeForTest,
  buildRequirements,
  buildResourceInfo,
  parsePaymentPayload,
  serializeSettleResponse,
  base64Encode,
  probeSupported,
  paymentRequiredResponse,
  paymentSettlementFailedResponse,
  X402_PRICE,
  type X402Env,
} from './x402';

const noopLog = () => {};

beforeEach(() => {
  resetX402RuntimeForTest();
});

afterEach(() => {
  resetX402RuntimeForTest();
  vi.restoreAllMocks();
});

describe('x402 resolver + requirements', () => {
  it('mogami mode builds a $0.01 base-sepolia requirement (amount 10000 atomic units)', async () => {
    const env: X402Env = {
      X402_FACILITATOR: 'mogami',
      X402_NETWORK: 'eip155:84532',
      X402_PAY_TO: '0x51c285Df171C76bE36252e32679F098d90768413',
    };
    const r = await getX402(env, noopLog);
    expect(r.mode).toBe('mogami');
    expect(r.network).toBe('eip155:84532');
    expect(r.asset).toBe('0x036CbD53842c5426634e7929541eC2318f3dCF7e');

    const req = await buildRequirements(r);
    expect(req.scheme).toBe('exact');
    expect(req.amount).toBe('10000');
    expect(req.asset).toBe('0x036CbD53842c5426634e7929541eC2318f3dCF7e');
    expect(req.payTo).toBe('0x51c285Df171C76bE36252e32679F098d90768413');
    expect(req.maxTimeoutSeconds).toBe(60);
  });

  it('X402_ASSET env overrides the derived default asset', async () => {
    const env: X402Env = {
      X402_FACILITATOR: 'mogami',
      X402_NETWORK: 'eip155:84532',
      X402_ASSET: '0x0000000000000000000000000000000000000001',
      X402_PAY_TO: '0x51c285Df171C76bE36252e32679F098d90768413',
    };
    const r = await getX402(env, noopLog);
    expect(r.asset).toBe('0x0000000000000000000000000000000000000001');
  });

  it('creates a spec-shaped 402 response body', async () => {
    const env: X402Env = {
      X402_FACILITATOR: 'mogami',
      X402_NETWORK: 'eip155:84532',
      X402_PAY_TO: '0x51c285Df171C76bE36252e32679F098d90768413',
    };
    const r = await getX402(env, noopLog);
    const req = await buildRequirements(r);
    const resourceInfo = buildResourceInfo('https://entitlement.test/entitlement/did:key:test-proxy', 'did:key:test-proxy');
    const pr = await r.server.createPaymentRequiredResponse([req], resourceInfo, 'Payment required');
    const res = paymentRequiredResponse(pr);

    expect(res.status).toBe(402);
    const body = JSON.parse((await res.text()) as string);
    expect(body.x402Version).toBe(2);
    expect(body.error).toBe('Payment required');
    expect(Array.isArray(body.accepts)).toBe(true);
    expect(body.accepts[0]).toMatchObject({
      scheme: 'exact',
      network: 'eip155:84532',
      amount: '10000',
      asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      payTo: '0x51c285Df171C76bE36252e32679F098d90768413',
      maxTimeoutSeconds: 60,
    });
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('X-PAYMENT base64 round-trip for a v2 payment payload', () => {
    const payload = {
      x402Version: 2,
      accepted: {
        scheme: 'exact',
        network: 'eip155:84532',
        amount: '10000',
        asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
        payTo: '0x51c285Df171C76bE36252e32679F098d90768413',
        maxTimeoutSeconds: 60,
        extra: {},
      },
      payload: { token: 'signed-token', txHash: '0xabc' },
    };
    const header = base64Encode(JSON.stringify(payload));
    const parsed = parsePaymentPayload(header);
    expect(parsed.x402Version).toBe(2);
    expect(parsed.accepted.amount).toBe('10000');
    expect(parsed.payload.txHash).toBe('0xabc');
  });

  it('settlement response serializes to base64 for the X-PAYMENT-RESPONSE header', () => {
    const settle = {
      success: true,
      payer: '0xpayer',
      transaction: '0xsettletx',
      network: 'eip155:84532' as const,
      amount: '10000',
    };
    const header = serializeSettleResponse(settle);
    const parsed = JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
    expect(parsed.success).toBe(true);
    expect(parsed.transaction).toBe('0xsettletx');
  });

  it('settlement failure response is 502 with a reason', async () => {
    const res = paymentSettlementFailedResponse('settle failed');
    expect(res.status).toBe(502);
    const body = JSON.parse(await res.text());
    expect(body.error).toContain('settlement failed');
    expect(body.reason).toBe('settle failed');
  });
});

describe('auto resolver fallback', () => {
  it('falls back to Mogami when the CDP /supported probe is broken', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('/supported')) {
        throw new Error('probe failed');
      }
      return new Response('{"kinds":[]}', { status: 200 });
    });

    const env: X402Env = {
      X402_FACILITATOR: 'auto',
      X402_NETWORK: 'eip155:84532',
      X402_PAY_TO: '0x51c285Df171C76bE36252e32679F098d90768413',
      CDP_API_KEY_ID: 'key',
      CDP_API_KEY_SECRET: 'secret',
    };
    const logSpy = vi.fn();
    const r = await getX402(env, logSpy);
    expect(r.mode).toBe('mogami');
    expect(logSpy.mock.calls[0][0]).toContain('[auto] → Mogami');
  });

  it('probeSupported returns false on timeout/error, true on 200 and 401 (alive, needs auth)', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('down');
    });
    expect(await probeSupported('https://broken/supported', 50)).toBe(false);

    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('ok', { status: 200 }));
    expect(await probeSupported('https://ok/supported', 50)).toBe(true);

    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('Unauthorized', { status: 401 }));
    expect(await probeSupported('https://auth/supported', 50)).toBe(true);

    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('err', { status: 500 }));
    expect(await probeSupported('https://degraded/supported', 50)).toBe(false);
  });
});