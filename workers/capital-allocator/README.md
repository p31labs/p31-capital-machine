# Capital Allocation Engine

Cloudflare Worker that manages the allocation of USDC capital across yield, MEV, fundraising, compounding, cashback, IP licensing, airdrops, and prediction arbitrage targets.

## Architecture

The Capital Allocation Engine sits at the center of the P31 Capital Machine. It receives capital deployment instructions and distributes funds proportionally to registered capital-machine workers.

## Endpoints

### POST /allocate

Distributes USDC across targets proportionally by weight.

```bash
curl -X POST https://capital-allocator.<worker>.workers.dev/allocate \
  -H "Content-Type: application/json" \
  -d '{
    "source_tx_id": "tx-abc123",
    "amount_usdc": "1000",
    "targets": [
      { "target": "yield", "weight": 40 },
      { "target": "mev", "weight": 30 },
      { "target": "fundraising", "weight": 20 },
      { "target": "compounder", "weight": 10 }
    ]
  }'
```

**Response**
```json
{
  "allocations": [
    { "id": "uuid-1", "amount": "400", "target": "yield", "status": "pending", "created_at": 1690000000 },
    { "id": "uuid-2", "amount": "300", "target": "mev", "status": "pending", "created_at": 1690000000 },
    { "id": "uuid-3", "amount": "200", "target": "fundraising", "status": "pending", "created_at": 1690000000 },
    { "id": "uuid-4", "amount": "100", "target": "compounder", "status": "pending", "created_at": 1690000000 }
  ]
}
```

### GET /allocation/status

Returns current allocation and ROI for a specific target.

```bash
curl https://capital-allocator.<worker>.workers.dev/allocation/status?target=yield
```

**Response**
```json
{
  "target": "yield",
  "current_allocation": "5000",
  "roi_bps": 150,
  "health_check": "healthy"
}
```

### GET /allocation/roi

Returns aggregated ROI by target over a time range.

```bash
curl "https://capital-allocator.<worker>.workers.dev/allocation/roi?range=30d"
```

**Response**
```json
{
  "roi_by_target": {
    "yield": 150,
    "mev": 42,
    "fundraising": 80
  }
}
```

Supported ranges: `1d`, `7d`, `30d`, `90d`, `1y`

### POST /rebalance

Evaluates all allocations by ROI and reallocates capital from underperformers to overperformers.

```bash
curl -X POST https://capital-allocator.<worker>.workers.dev/rebalance
```

**Response**
```json
{
  "rebalance_id": "uuid-rebalance",
  "moves": [
    { "from": "mev", "to": "yield", "amount": "250.50" }
  ]
}
```

### GET /health

```bash
curl https://capital-allocator.<worker>.workers.dev/health
```

**Response**
```json
{ "status": "ok", "timestamp": 1690000000 }
}
```

## Supported Targets

| Target | Description |
|--------|-------------|
| `yield` | DeFi yield vaults |
| `mev` | MEV arbitrage |
| `fundraising` | AI fundraising agent |
| `compounder` | Auto-compounder |
| `cashback` | Cashback collector |
| `ip` | IP licensing |
| `airdrop` | Airdrop harvester |
| `predict` | Prediction arbitrage |

## Development

```bash
npx wrangler dev
```

Run tests:

```bash
npx vitest run
```

## Migration

```bash
npx wrangler d1 execute allocator-db --local --file=workers/capital-allocator/migration.sql
```

## ROI Tracking

ROI is tracked in basis points (bps). 1 bps = 0.01%. A 150 bps return equals a 1.5% return.
