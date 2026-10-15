# Revenue Ledger Worker

Unified append-only sink for all P31 payment sources. SHA-256 chained for court-admissible audit trail.

## Deployment

```bash
cd /home/p31/production/p31-capital-machine/workers/revenue-ledger
wrangler deploy
```

## Schema

See `../../infra/migrations/002_revenue_ledger.sql`.

## API Endpoints

### POST /revenue/record

Record a revenue event. Chains SHA-256 hash.

**Body:**
```json
{
  "source": "x402",
  "payer_did": "did:key:z6Mk...",
  "merchant_did": "did:key:z6Mk...",
  "amount_usdc": "10.50",
  "asset": "USDC",
  "metadata": { "tool": "oasis_execute" },
  "settlement_tx": "0xabc123..."
}
```

**Response (201):**
```json
{
  "id": "uuid",
  "hash": "sha256-hex-string",
  "created_at": 1690000000000
}
```

### GET /revenue/summary?source=x402&range=30d

Aggregated revenue summary.

**Response:**
```json
{
  "total_usdc": "100.50",
  "total_eur": "50.00",
  "total_love": "200.00",
  "count": 42,
  "avg_per_transaction": "2.39",
  "source_breakdown": {
    "x402": { "count": 30, "total_usdc": "100.50" }
  }
}
```

### GET /revenue/balance/{did}

Per-DID balance across all assets.

**Response:**
```json
{
  "did": "did:key:z6Mk...",
  "total_earned_usdc": "50.00",
  "total_earned_eur": "0.00",
  "total_earned_love": "100.00",
  "transaction_count": 15
}
```

### GET /revenue/ledger?limit=100&offset=0&source=x402

Paginated ledger entries.

**Response:**
```json
{
  "entries": [
    {
      "id": "uuid",
      "source": "x402",
      "payer_did": "did:key:...",
      "amount_usdc": "10.50",
      "asset": "USDC",
      "created_at": 1690000000000,
      "hash": "sha256...",
      "prev_hash": "sha256..."
    }
  ],
  "total": 100
}
```

### GET /revenue/verify-chain

Verify SHA-256 chain integrity.

**Response:**
```json
{
  "valid": true,
  "total_entries": 42,
  "last_hash": "sha256..."
}
```

## Wire Payment Sources

1. **mcp-x402-gateway** → `POST /revenue/record` on successful x402 payment
2. **taler-bridge-billing** → `POST /revenue/record` on Taler settlement
3. **p31-gumroad-webhook** → `POST /revenue/record` on Gumroad webhook
4. **btcpay-gateway** → `POST /revenue/record` on BTCPay donation
5. **production/shell/loveEngine.ts** → `POST /revenue/record` on LOVE mint/spend
