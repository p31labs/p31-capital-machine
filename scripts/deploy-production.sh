#!/bin/bash
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "=== P31 Monetization Engine — Production Deployment ==="
echo ""

# Phase 1: Revenue Ledger
echo ">>> Phase 1: Deploying Revenue Ledger..."
(cd "$ROOT/workers/revenue-ledger" && wrangler deploy)
echo "✓ Revenue Ledger deployed"
echo ""

# Phase 2: Entitlement Service
echo ">>> Phase 2: Deploying Entitlement Service..."
(cd "$ROOT/workers/entitlement" && wrangler deploy)
echo "✓ Entitlement Service deployed"
echo ""

# Phase 3: Capital Allocator
echo ">>> Phase 3: Deploying Capital Allocator..."
(cd "$ROOT/workers/capital-allocator" && wrangler deploy)
echo "✓ Capital Allocator deployed"
echo ""

# Phase 4: BTCPay Gateway
echo ">>> Phase 4: Deploying BTCPay Gateway..."
(cd "$ROOT/workers/btcpay-gateway" && wrangler deploy)
echo "✓ BTCPay Gateway deployed"
echo ""

# Phase 5: Monetization Dashboard
echo ">>> Phase 5: Building Monetization Dashboard..."
(cd "$ROOT/apps/monetization-dashboard" && npm run build)
echo "✓ Dashboard built (deploy to Cloudflare Pages manually or via CI)"
echo ""

echo "=== Deployment Complete ==="
echo ""
echo "Next steps:"
echo "1. Verify all workers are live at their .workers.dev URLs"
echo "2. Set up Cloudflare cron triggers for entitlement reset"
echo "3. Deploy dashboard to Cloudflare Pages"
echo "4. Wire x402 v2 mode in mcp-x402-gateway"