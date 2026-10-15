#!/bin/bash
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "=== Phase 1: Revenue Ledger ==="
(cd "$ROOT/workers/revenue-ledger" && wrangler deploy)

echo "=== Phase 2: Entitlement Service ==="
(cd "$ROOT/workers/entitlement" && wrangler deploy)

echo "=== Phase 3: Capital Allocator ==="
(cd "$ROOT/workers/capital-allocator" && wrangler deploy)

echo "=== Phase 4: BTCPay Gateway ==="
(cd "$ROOT/workers/btcpay-gateway" && wrangler deploy)

echo "=== Phase 5: Monetization Dashboard ==="
(cd "$ROOT/apps/monetization-dashboard" && npm run build)

echo "=== Deployment Complete ==="