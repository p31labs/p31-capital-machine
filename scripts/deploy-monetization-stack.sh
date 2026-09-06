#!/bin/bash
set -e

echo "=== Phase 1: Revenue Ledger ==="
cd /home/p31/p31-capital-machine/infra
wrangler deploy --config wrangler.revenue-ledger.toml

echo "=== Phase 2: Entitlement Service ==="
cd /home/p31/p31-capital-machine/workers/entitlement
wrangler deploy

echo "=== Phase 3: Capital Allocator ==="
cd /home/p31/p31-capital-machine/workers/capital-allocator
wrangler deploy

echo "=== Phase 4: Monetization Dashboard ==="
cd /home/p31/p31-capital-machine/apps/monetization-dashboard
npm run build

echo "=== Deployment Complete ==="
