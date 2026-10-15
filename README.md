# P31 Unified Monetization Engine

**Production-ready agent economy infrastructure.**

A SHA-256 chained, DID-based, cross-rail ledger with entitlement gating, capital allocation, and real-time observability. Built on Cloudflare Workers, D1, and the x402 protocol.

## Live Services

| Service | URL | Status |
|---------|-----|--------|
| **Revenue Ledger** | https://revenue-ledger.trimtab-signal.workers.dev | ✅ Live |
| **Entitlement Service** | https://entitlement.trimtab-signal.workers.dev | ✅ Live |
| **Capital Allocator** | https://capital-allocator.trimtab-signal.workers.dev | ✅ Live |
| **Alerting** | https://monetization-alerting.trimtab-signal.workers.dev | ✅ Live |
| **Dashboard** | `p31-monetization.trimtab-signal.workers.dev` — ✅ 200 (verified 2026-10-14). Legacy `af79c8f3.chump-dashboard.pages.dev` is dead (000) | ✅ Live |

## Honest Status: Revenue Workers

> **Read this before claiming revenue capability.** This repo is *capital-ready infrastructure*, not a running revenue spigot. Several revenue workers are **undeployed stubs** with fabricated endpoints — they exist as scaffolding to be activated once real keys/accounts/capital land. They are **not** live income sources. Framing them otherwise damages grant and customer credibility.

| Worker | Status | Honest disposition |
|--------|--------|--------------------|
| **yield-vault** | ✅ Deployed | Real on-chain APY aggregation (~11.75% weighted). Requires capital to deploy value. |
| **mev-arbitrage** | ✅ Deployed | Jupiter Swap API v1 → Jito bundle path wired + signed end-to-end. **Requires funded SOL wallet**; mainnet-only. MEV margins declining industry-wide. |
| **btcpay-gateway** | ✅ Deployed | **Live at** `https://btcpay-gateway.trimtab-signal.workers.dev`. BTCPay server verified running on this host (`127.0.0.1:8082`). Needs 4 secrets wired (`BTCPAY_API_KEY`, `BTCPAY_API_URL`, `BTCPAY_WEBHOOK_SECRET`, `BTCPAY_STORE_ID`) to process real invoices. D1 binding fixed to `fd439548-...` (capital-db). |
| **affiliate-fleet** | 🧩 Partial | Real Twitter leg; needs Twitter dev app + registered IDs. Discord leg is a stub. |
| **data-monetization** | 🧩 Partial | Real API layer, but no data pipeline populates it yet. |
| **cashback-collector** | 🪧 **STUB** | Hits `api.pump.fun|api.jup.ag|api.1inch.io|api.odos.xyz/cashback` — **these endpoints do not exist.** Not deployable as-is. |
| **airdrop-harvester** | 🪧 **STUB** | 6/10 protocol connectors are dead; `/sell` fabricates a zero TxHash. Airdrops additionally require prior on-chain history. |
| **fundraising-agent** | 🪧 **STUB** | Marks emails "sent" without sending. No real mail path. |
| **nft-royalties / prediction-arb / micro-savings / ip-licensing** | 🧩 Scaffold | Not validated; treat as scaffolding only. |

**Grant framing:** "Capital-ready infrastructure. $0 revenue today; here is exactly what funding unlocks." — not "live magic money makers."

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    PAYMENT SOURCES                           │
│  x402 Gateway  │  Taler Bridge  │  Gumroad  │  BTCPay  │ LOVE│
└──────────────┬──────────────┬──────────────┬──────────────┬──┘
               │              │              │              │
               ▼              ▼              ▼              ▼
┌─────────────────────────────────────────────────────────────┐
│              REVENUE LEDGER (SHA-256 Chained)               │
│  Append-only audit trail. Court-admissible. Cross-rail.     │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│              ENTITLEMENT SERVICE (Preflight Gate)           │
│  Unified balance visibility. Tier-based limits. 402 on fail.│
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│              CAPITAL ALLOCATOR (ROI Engine)                 │
│  10 targets: yield, mev, fundraising, compounder, cashback, │
│  ip, airdrop, predict. Auto-rebalance on ROI divergence.    │
└─────────────────────────────────────────────────────────────┘
```

## Six-Layer Control Stack

| Layer | Implementation |
|-------|---------------|
| **Identity** | DID-based via `payer_did` |
| **Entitlement** | Tier-based preflight credit gate |
| **Preflight Gate** | `POST /entitlement/check` → 402 on insufficient funds |
| **Execution Sandbox** | MCP tools in Cloudflare Workers |
| **Immutable Metering** | SHA-256 chained revenue ledger |
| **Billing Reconciliation** | Automated rebalancing + dashboard |

## Payment Rails

### x402 (AI Agent Standard)
- Protocol: x402 v1/v2
- Network: Base Sepolia (testnet) / Base (mainnet)
- Facilitator: `https://facilitator.x402.org`
- Settlement: USDC on Base

### GNU Taler (Privacy-Preserving)
- Exchange: `https://exchange.demo.taler.net`
- Currency: EUR
- Privacy: Anonymous, libre electronic resources

### LOVE (Care Economy)
- Ledger: `love-ledger` D1
- Settlement: Soulbound token + blind signatures
- Bridge: `mcp-x402-gateway` dual-settlement router

## Quick Start

```bash
# Clone the repo
git clone https://github.com/p31labs/P31-local-workspace.git

# Install dependencies
pnpm install

# Run tests
pnpm run test:unit

# Deploy all workers
bash scripts/deploy-production.sh
```

## API Reference

### Revenue Ledger
- `POST /revenue/record` — Append revenue event with SHA-256 chain
- `GET /revenue/summary?source=x402&range=30d` — Aggregated breakdown
- `GET /revenue/balance/{did}` — Per-DID cross-rail balance
- `GET /revenue/ledger?limit=100&offset=0` — Paginated audit trail
- `GET /revenue/verify-chain` — Chain integrity verification
- `GET /metrics` — Real-time metrics

### Entitlement Service
- `GET /entitlement/{did}` — User balance + tier + usage
- `POST /entitlement/check` — Preflight credit gate
- `POST /entitlement/consume` — Idempotent balance deduction
- `POST /entitlement/tier-set` — Update user tier
- `GET /metrics` — Real-time metrics

### Capital Allocator
- `POST /allocate` — Create allocation instructions
- `GET /allocation/status?target=yield` — Current position + ROI
- `GET /allocation/roi?range=30d` — ROI by target
- `POST /rebalance` — Auto-rebalance on ROI divergence
- `GET /metrics` — Real-time metrics

## Dashboard

Access the unified dashboard at: **`p31-monetization.trimtab-signal.workers.dev`** (verified 200, 2026-10-14). The legacy `af79c8f3.chump-dashboard.pages.dev` domain is dead (000) — redeploy from `apps/monetization-dashboard` only if the new shell is insufficient.

Sections:
- **Revenue**: Time-series by source, summary cards, source breakdown
- **Entitlements**: User balances, tier distribution, usage vs limits
- **Allocations**: Capital positions, ROI by target, rebalance history
- **Reconciliation**: Payment vs ledger vs settlement status

## Observability

### Metrics Endpoints
- Revenue Ledger: `GET /metrics`
- Entitlement: `GET /metrics`
- Capital Allocator: `GET /metrics`

### Alerting
- Worker: https://monetization-alerting.trimtab-signal.workers.dev
- Schedule: Every 15 minutes
- Channels: Slack webhook (configurable)

### OpenTelemetry
- Spans logged to console + optional Honeycomb/Axiom
- Configure backend: `workers/observability/otel.ts`

## D1 Databases

| Database | ID | Purpose |
|----------|----|---------|
| `revenue-db` | `1f219ab8-...` | SHA-256 chained revenue events |
| `entitlement-db` | `e9e18c25-...` | User entitlements + usage metering |
| `allocator-db` | `d12543b9-...` | Capital allocations + results |
| `capital-db` | `fd439548-...` | Shared capital-machine state (yield/mev/btcpay/compounder) |

## Testing

```bash
# Unit tests
pnpm run test:unit

# Integration tests
pnpm run test:integration

# All tests
pnpx vitest run
```

**Current status**: 41/41 tests passing (5 test files)

## Deployment

```bash
# 1. Create D1 databases
bash scripts/setup-d1.sh

# 2. Deploy all workers
bash scripts/deploy-production.sh

# 3. Build dashboard
cd apps/monetization-dashboard && npm run build
```

## Security

- All monetary values stored as strings (no float rounding)
- SHA-256 chained audit trail (court-admissible)
- DID-based identity (no passwords)
- HMAC-SHA256 LOVE settlement auth
- Idempotent transactions (tx_hash dedup)
- Non-blocking payment source wiring

## License

MIT — see LICENSE file
