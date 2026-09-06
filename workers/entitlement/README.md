# Entitlement Service Worker

Phase 2 of the P31 Unified Monetization Engine — provides unified balance visibility and preflight credit gating for all P31 tools.

## Architecture

```
Entitlement Service (this worker)
    │
    ├── D1 Database: entitlement-db
    │   ├── entitlements — DID balances, tier, monthly usage
    │   ├── usage_meter — per-tool call counts and spend
    │   ├── tier_limits — tier configuration
    │   └── consume_tx_log — idempotency for consume operations
    │
    ├── GET /entitlement/{did}
    ├── POST /entitlement/check
    ├── POST /entitlement/consume
    ├── POST /entitlement/tier-set
    └── GET /health
```

## Endpoints

### GET /entitlement/{did}

Returns the full entitlement state for a DID.

**Response:**
```json
{
  "success": true,
  "data": {
    "balance_usdc": "100.00",
    "balance_love": "50.00",
    "tier": "pro",
    "monthly_remaining": "40.00",
    "usage": []
  }
}
```

**Status codes:**
- `200` — Success
- `404` — DID not found

---

### POST /entitlement/check

Preflight credit gate. Verifies a DID has sufficient balance and monthly allowance for a tool call.

**Request:**
```json
{
  "did": "did:key:z6MkhaXgBZDvotDkL5257fJdEbdbbnaB5L1nnENRKjHiWtkN",
  "tool_id": "oasis_execute",
  "estimated_cost_usdc": "10.00"
}
```

**Response (success):**
```json
{
  "success": true,
  "data": {
    "ok": true,
    "balance": { ... },
    "monthly_remaining": "40.00",
    "message": "Entitlement check passed"
  }
}
```

**Response (failure):**
```json
{
  "success": true,
  "data": {
    "ok": false,
    "message": "Insufficient balance: 5.00 USDC available, 10.00 USDC required",
    "monthly_remaining": "0.00"
  }
}
```

**Status codes:**
- `200` — Check completed (ok field indicates result)
- `402` — Insufficient funds or monthly allowance exceeded
- `400` — Missing required fields

---

### POST /entitlement/consume

Deducts balance after payment. Idempotent — same `tx_hash` returns the same result.

**Request:**
```json
{
  "did": "did:key:z6MkhaXgBZDvotDkL5257fJdEbdbbnaB5L1nnENRKjHiWtkN",
  "tool_id": "oasis_execute",
  "amount_usdc": "10.00",
  "tx_hash": "0xabc123..."
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "0xabc123...",
    "did": "did:key:...",
    "tool_id": "oasis_execute",
    "amount_usdc": "10.00",
    "tx_hash": "0xabc123...",
    "status": "consumed",
    "new_balance_usdc": "90.00",
    "created_at": 1693123456789
  }
}
```

**Status codes:**
- `200` — Success
- `400` — Missing required fields
- `500` — Entitlement not found

---

### POST /entitlement/tier-set

Updates a user's tier and resets monthly usage counters.

**Request:**
```json
{
  "did": "did:key:z6MkhaXgBZDvotDkL5257fJdEbdbbnaB5L1nnENRKjHiWtkN",
  "tier": "pro"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "did": "did:key:...",
    "tier": "pro",
    "monthly_allowance_usdc": "50"
  }
}
```

**Valid tiers:** `free`, `pro`, `enterprise`

---

### GET /health

Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "service": "entitlement",
  "timestamp": 1693123456789
}
```

---

## CURL Examples

```bash
# Health check
curl -X GET https://entitlement.p31.capital/health

# Get entitlement
curl -X GET https://entitlement.p31.capital/entitlement/did:key:z6MkhaXgBZDvotDkL5257fJdEbdbbnaB5L1nnENRKjHiWtkN

# Check entitlement
curl -X POST https://entitlement.p31.capital/entitlement/check \
  -H "Content-Type: application/json" \
  -d '{"did":"did:key:z6MkhaXgBZDvotDkL5257fJdEbdbbnaB5L1nnENRKjHiWtkN","tool_id":"oasis_execute","estimated_cost_usdc":"10.00"}'

# Consume entitlement
curl -X POST https://entitlement.p31.capital/entitlement/consume \
  -H "Content-Type: application/json" \
  -d '{"did":"did:key:z6MkhaXgBZDvotDkL5257fJdEbdbbnaB5L1nnENRKjHiWtkN","tool_id":"oasis_execute","amount_usdc":"10.00","tx_hash":"0xabc123"}'

# Set tier
curl -X POST https://entitlement.p31.capital/entitlement/tier-set \
  -H "Content-Type: application/json" \
  -d '{"did":"did:key:z6MkhaXgBZDvotDkL5257fJdEbdbbnaB5L1nnENRKjHiWtkN","tier":"pro"}'
```

## Tiers

| Tier | Monthly Allowance (USDC) | Monthly Calls per Tool | Burst Multiplier |
|------|--------------------------|------------------------|------------------|
| free | 0 | 100 | 1.0x |
| pro | 50 | 1000 | 2.0x |
| enterprise | 500 | 10000 | 5.0x |

## Development

```bash
# Run tests
npm test

# Deploy
wrangler deploy
```
