#!/bin/bash
set -euo pipefail

# deploy-live.sh — deploy the live monetization stack from per-worker
# wrangler.toml files, then health-check. Requires authenticated wrangler.
#
# Order matters: the monetization portal requires AUTH_DB (P0-2), so the D1
# auth bootstrap runs first when the placeholder is still present.

CM_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MONET_ROOT="${MONETIZATION_ROOT:-/home/p31/production/monetization}"

echo "🚀 Deploying live monetization stack"
echo "  capital-machine: $CM_ROOT"
echo "  monetization:    $MONET_ROOT"

# 0. Ensure AUTH_DB exists + placeholder patched + migration applied.
if grep -q "REPLACE_ME_WITH_D1_ID" "$MONET_ROOT/wrangler.toml" 2>/dev/null; then
  echo ">>> [0/6] AUTH_DB bootstrap (placeholder present)..."
  (cd "$MONET_ROOT" && node scripts/d1-auth-bootstrap.mjs)
else
  echo ">>> [0/6] AUTH_DB already wired — skipping bootstrap."
fi

deploy() { # <dir> <name>
  echo ">>> Deploying $2..."
  (cd "$1" && npx wrangler deploy)
}

deploy "$CM_ROOT/workers/revenue-ledger" "revenue-ledger"
deploy "$CM_ROOT/workers/entitlement" "entitlement"
deploy "$CM_ROOT/workers/capital-allocator" "capital-allocator"
deploy "$CM_ROOT/workers/config-gateway" "config-gateway"
deploy "$MONET_ROOT" "p31-monetization portal"

echo ">>> Health checks..."
check() { # <url>
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" -m 15 "$1" || echo 000)
  echo "  $1 → $code"
  [ "$code" = "200" ] || [ "$code" = "402" ] || { echo "  ⚠ unexpected status"; }
}

check "https://revenue-ledger.trimtab-signal.workers.dev/health"
check "https://entitlement.trimtab-signal.workers.dev/health"
check "https://capital-allocator.trimtab-signal.workers.dev/health"
check "https://config-gateway.trimtab-signal.workers.dev/health"
check "https://p31-monetization.trimtab-signal.workers.dev/api/health/invariants"
check "https://revenue-ledger.trimtab-signal.workers.dev/revenue/summary?range=30d"

echo "✅ deploy-live done."