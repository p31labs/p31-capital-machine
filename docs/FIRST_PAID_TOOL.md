# First Paid Tool Onboarding

## Overview

This guide walks through enabling the first paid MCP tool on the P31 monetization engine. We use `oasis_execute` as the reference implementation because it's already configured in the PRICING map.

## Prerequisites

- [x] Revenue ledger live: `https://revenue-ledger.trimtab-signal.workers.dev`
- [x] Entitlement service live: `https://entitlement.trimtab-signal.workers.dev`
- [x] mcp-x402-gateway live: `https://mcp-x402-gateway.trimtab-signal.workers.dev`
- [ ] `FACILITATOR_KEY_ID` secret set (mainnet only)
- [ ] `FACILITATOR_SECRET_KEY` secret set (mainnet only)
- [ ] `ENTITLEMENT_API_TOKEN` secret set (optional but recommended)

## Step 1: Verify Tool is Priced

Check `mcp-x402-gateway/src/index.ts` — `oasis_execute` is already in the PRICING map:

```typescript
"oasis_execute": { price: "0.05", network: "base-sepolia", description: "Host command execution (sandboxed)" }
```

**No code changes needed** — the tool is already gated.

## Step 2: Verify Preflight Gate

The entitlement preflight gate is already wired. When a user calls `oasis_execute`:

1. Middleware extracts `toolName` from request body
2. Looks up price in `PRICING` map → `$0.05`
3. Calls `POST https://entitlement.trimtab-signal.workers.dev/entitlement/check`
4. If `ok: false`, returns `402` with `X-Entitlement-Balance` header
5. If `ok: true`, proceeds to x402 payment middleware

**Test:**
```bash
curl -s -X POST https://mcp-x402-gateway.trimtab-signal.workers.dev/mcp \
  -H "Content-Type: application/json" \
  -H "X-DID: did:key:test" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"oasis_execute","arguments":{"command":"echo test"}}}'
```

Expected: `402` with entitlement error (test DID has $0 balance).

## Step 3: Verify Payment Flow

When a user with sufficient entitlement calls a paid tool:

1. Entitlement preflight passes (`200`)
2. x402 v2 middleware checks `X-Payment-Token` header
3. If no token, v1 middleware issues `402` with `PAYMENT-REQUIRED`
4. User pays via x402 facilitator
5. Payment verified → `next()` → bridge forward
6. **NEW:** `consumeEntitlement()` deducts balance
7. **NEW:** `recordX402Revenue()` records event in ledger

## Step 4: Verify Revenue Recording

After a successful paid tool call:

```bash
curl -s https://revenue-ledger.trimtab-signal.workers.dev/revenue/summary
```

Expected: `transaction_count: 1`, `total_usdc: "0.05"`

## Step 5: Verify Entitlement Deduction

After a successful paid tool call:

```bash
curl -s https://entitlement.trimtab-signal.workers.dev/entitlement/did:key:test
```

Expected: `monthly_used_usdc` increased by `0.05`

## Step 6: Enable Mainnet (Optional)

To move from testnet to mainnet:

```bash
cd /home/p31/production/workers/mcp-x402-gateway
wrangler secret put FACILITATOR_KEY_ID
wrangler secret put FACILITATOR_SECRET_KEY
```

Then update `wrangler.toml`:
```toml
NETWORK = "base"
PAY_TO = "0xYOUR_MAINNET_ADDRESS"
```

## Step 7: Monitor

- **Revenue:** `https://revenue-ledger.trimtab-signal.workers.dev/metrics`
- **Entitlement:** `https://entitlement.trimtab-signal.workers.dev/metrics`
- **Alerting:** `https://monetization-alerting.trimtab-signal.workers.dev/`
- **Dashboard:** `https://af79c8f3.chump-dashboard.pages.dev`

## Troubleshooting

| Issue | Solution |
|-------|----------|
| 402 on all paid tools | Check entitlement balance: `GET /entitlement/{did}` |
| Payment not settling | Verify facilitator URL and auth headers |
| Revenue not recorded | Check `REVENUE_LEDGER_URL` env var |
| Entitlement not deducted | Check `ENTITLEMENT_URL` env var |

## Next Tools to Enable

After `oasis_execute` is proven, enable in order:
1. `phos-adopt` ($0.05)
2. `jitterbug-run` ($0.25)
3. `soulsafe_gate1_self_review` ($0.01)
4. `neo_pixel_control` ($0.01)
