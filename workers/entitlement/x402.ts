import {
  x402ResourceServer,
  HTTPFacilitatorClient,
  type FacilitatorClient,
  type OnSettleFailureHook,
} from '@x402/core/server';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import { createCdpFacilitatorClient } from '@coinbase/cdp-sdk/x402';

export interface X402Env {
  X402_FACILITATOR?: string;
  X402_NETWORK?: string;
  X402_PAY_TO?: string;
  X402_ASSET?: string;
  X402_SELF_HOSTED_URL?: string;
  CDP_API_KEY_ID?: string;
  CDP_API_KEY_SECRET?: string;
}

export type FacilitatorMode = 'cdp' | 'mogami' | 'self' | 'auto';

export type Network = `${string}:${string}`;

export interface PaymentRequirements {
  scheme: string;
  network: Network;
  asset: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra: Record<string, unknown>;
}

export interface ResourceInfo {
  url: string;
  description?: string;
  mimeType?: string;
  serviceName?: string;
  tags?: string[];
  iconUrl?: string;
}

export interface PaymentPayload {
  x402Version: number;
  resource?: ResourceInfo;
  accepted: PaymentRequirements;
  payload: Record<string, unknown>;
  extensions?: Record<string, unknown>;
}

export interface SettleResponse {
  success: boolean;
  errorReason?: string;
  errorMessage?: string;
  payer?: string;
  transaction: string;
  network: Network;
  amount?: string;
  extensions?: Record<string, unknown>;
  extensionResponses?: Record<string, unknown>;
  extra?: Record<string, unknown>;
}

export const X402_PRICE = '$0.01';
export const X402_TIMEOUT_SECONDS = 60;

const DEFAULT_NETWORK: Network = 'eip155:84532';
const DEFAULT_PAY_TO = '0x51c285Df171C76bE36252e32679F098d90768413';
const MOGAMI_URL = 'https://v2.facilitator.mogami.tech';
const CDP_SUPPORTED_URL = 'https://api.cdp.coinbase.com/platform/v2/x402/supported';

export interface X402Runtime {
  server: x402ResourceServer;
  scheme: ExactEvmScheme;
  network: Network;
  mode: FacilitatorMode;
  payTo: string;
  asset: string;
  price: string;
  timeoutSeconds: number;
}

let cachedRuntime: X402Runtime | null = null;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function probeSupported(url: string, timeoutMs = 5000): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: 'GET', signal: ctrl.signal });
    // A 401/403 from CDP means "alive, requires auth" (creds provide it on verify/settle).
    // Only 5xx or network/timeout failures count as a dead primary.
    return res.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function resolveFacilitator(env: X402Env): { client: FacilitatorClient; mode: FacilitatorMode } {
  const mode = (env.X402_FACILITATOR || 'auto').toLowerCase() as FacilitatorMode;
  switch (mode) {
    case 'cdp':
      return {
        client: createCdpFacilitatorClient({
          apiKeyId: env.CDP_API_KEY_ID,
          apiKeySecret: env.CDP_API_KEY_SECRET,
        }),
        mode,
      };
    case 'mogami':
      return { client: new HTTPFacilitatorClient({ url: MOGAMI_URL }), mode };
    case 'self':
      return { client: new HTTPFacilitatorClient({ url: env.X402_SELF_HOSTED_URL }), mode };
    case 'auto':
      return { client: new HTTPFacilitatorClient({ url: MOGAMI_URL }), mode };
    default:
      throw new Error(`Unknown X402_FACILITATOR "${env.X402_FACILITATOR}". Use cdp | mogami | self | auto`);
  }
}

function createSettleRetryHook(client: FacilitatorClient): OnSettleFailureHook {
  const delaysMs = [250, 500, 1000];
  return async (ctx) => {
    for (const delay of delaysMs) {
      await sleep(delay);
      try {
        const result = await client.settle(
          ctx.paymentPayload as unknown as PaymentPayload,
          ctx.requirements as unknown as PaymentRequirements
        );
        if (result && result.success) {
          return { recovered: true, result };
        }
      } catch {
        // transient facilitator failure — continue the backoff ladder
      }
    }
    return;
  };
}

export async function getX402(env: X402Env, log: (msg: string) => void): Promise<X402Runtime> {
  if (cachedRuntime) return cachedRuntime;

  const mode = (env.X402_FACILITATOR || 'auto').toLowerCase() as FacilitatorMode;
  let facilitator: { client: FacilitatorClient; mode: FacilitatorMode };

  if (mode === 'auto') {
    const cdpReachable = await probeSupported(CDP_SUPPORTED_URL);
    const hasCdpCreds = !!env.CDP_API_KEY_ID && !!env.CDP_API_KEY_SECRET;
    if (cdpReachable && hasCdpCreds) {
      log('x402 resolver [auto] → CDP facilitator (probe ok + credentials present)');
      facilitator = {
        client: createCdpFacilitatorClient({
          apiKeyId: env.CDP_API_KEY_ID,
          apiKeySecret: env.CDP_API_KEY_SECRET,
        }),
        mode: 'cdp',
      };
    } else {
      log(`x402 resolver [auto] → Mogami facilitator (cdp probe ok=${cdpReachable}, creds=${hasCdpCreds})`);
      facilitator = { client: new HTTPFacilitatorClient({ url: MOGAMI_URL }), mode: 'mogami' };
    }
  } else {
    facilitator = resolveFacilitator(env);
    log(`x402 resolver [${mode}] → facilitator configured`);
  }

  const scheme = new ExactEvmScheme();
  const server = new x402ResourceServer(facilitator.client);
  server.register((env.X402_NETWORK || DEFAULT_NETWORK) as Network, scheme);
  server.onSettleFailure(createSettleRetryHook(facilitator.client));

  const network = (env.X402_NETWORK || DEFAULT_NETWORK) as Network;
  const parsed = await scheme.parsePrice(X402_PRICE, network);

  cachedRuntime = {
    server,
    scheme,
    network,
    mode: facilitator.mode,
    payTo: env.X402_PAY_TO || DEFAULT_PAY_TO,
    asset: env.X402_ASSET || parsed.asset,
    price: X402_PRICE,
    timeoutSeconds: X402_TIMEOUT_SECONDS,
  };
  return cachedRuntime;
}

export function resetX402RuntimeForTest(): void {
  cachedRuntime = null;
}

export async function buildRequirements(r: X402Runtime): Promise<PaymentRequirements> {
  const parsed = await r.scheme.parsePrice(r.price, r.network);
  return {
    scheme: 'exact',
    network: r.network,
    asset: r.asset,
    amount: parsed.amount,
    payTo: r.payTo,
    maxTimeoutSeconds: r.timeoutSeconds,
    extra: {},
  };
}

export function buildResourceInfo(requestUrl: string, did: string): ResourceInfo {
  return {
    url: requestUrl,
    description: `Entitlement state for ${did} — ${X402_PRICE}`,
    mimeType: 'application/json',
    serviceName: 'entitlement',
  };
}

export interface PaymentRequiredBody {
  x402Version: number;
  error?: string;
  resource?: unknown;
  accepts: PaymentRequirements[];
}

export function paymentRequiredResponse(pr: PaymentRequiredBody): Response {
  return new Response(JSON.stringify(pr), {
    status: 402,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Expose-Headers': 'X-PAYMENT-RESPONSE',
    },
  });
}

export function paymentSettlementFailedResponse(reason: string): Response {
  return new Response(
    JSON.stringify({
      success: false,
      error: 'Payment settlement failed after resource handler ran',
      reason,
      status: 502,
      timestamp: Date.now(),
    }),
    {
      status: 502,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    }
  );
}

export function base64Decode(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  return atob(padded);
}

export function base64Encode(value: string): string {
  return btoa(value);
}

export function parsePaymentPayload(headerValue: string): PaymentPayload {
  const json = base64Decode(headerValue);
  return JSON.parse(json) as PaymentPayload;
}

export function serializeSettleResponse(settle: SettleResponse): string {
  return base64Encode(JSON.stringify(settle));
}