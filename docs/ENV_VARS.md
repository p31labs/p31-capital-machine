# P31 Unified Monetization Engine — Environment Variables Checklist

This document lists all required environment variables for each service in the P31 Monetization Engine.

---

## Revenue Ledger (`revenue-ledger`)

**No environment variables required.**

Configured via:
- D1 binding: `REVENUE_DB`
- D1 database: `revenue-ledger-db`

---

## Entitlement Service (`entitlement`)

**No environment variables required.**

Configured via:
- D1 binding: `ENTITLEMENT_DB`
- D1 database: `entitlement-db`

---

## Capital Allocator (`capital-allocator`)

| Variable | Required | Description |
|----------|----------|-------------|
| `REVENUE_LEDGER_URL` | Yes | Base URL of the revenue ledger worker (e.g., `https://revenue-ledger.trimtab-signal.workers.dev`) |

Configured via:
- D1 binding: `ALLOCATOR_DB`
- D1 database: `allocator-db`

---

## MCP x402 Gateway (`mcp-x402-gateway`)

| Variable | Required | Description |
|----------|----------|-------------|
| `REVENUE_LEDGER_URL` | Yes | Base URL of the revenue ledger worker |
| `REVENUE_API_TOKEN` | Optional | Bearer token for authenticating with the revenue ledger API |

---

## Taler Bridge Billing (`taler-bridge-billing`)

| Variable | Required | Description |
|----------|----------|-------------|
| `REVENUE_LEDGER_URL` | Yes | Base URL of the revenue ledger worker |

---

## P31 Gumroad Webhook (`p31-gumroad-webhook`)

| Variable | Required | Description |
|----------|----------|-------------|
| `REVENUE_LEDGER_URL` | Yes | Base URL of the revenue ledger worker |
| `MERCHANT_DID` | Yes | The merchant's decentralized identifier (e.g., `did:web:p31ca.org`) |

---

## BTC Pay Gateway (`btcpay-gateway`)

| Variable | Required | Description |
|----------|----------|-------------|
| `REVENUE_LEDGER_URL` | Yes | Base URL of the revenue ledger worker |
| `MERCHANT_DID` | Yes | The merchant's decentralized identifier (e.g., `did:web:p31ca.org`) |

Configured via:
- D1 binding: `CAPITAL_DB`
- KV namespace: `CAPITAL_KV`

---

## Setting Environment Variables

Use Wrangler secrets for sensitive values:

```bash
# Set a secret
wrangler secret put REVENUE_API_TOKEN --config workers/mcp-x402-gateway/wrangler.toml

# Or use vars in wrangler.toml for non-sensitive values
[vars]
REVENUE_LEDGER_URL = "https://revenue-ledger.trimtab-signal.workers.dev"
```

---

## Notes

- All workers use `nodejs_compat` compatibility flag.
- All D1 databases are created via `scripts/setup-d1.sh`.
- See `scripts/deploy-production.sh` for full deployment ordering.
