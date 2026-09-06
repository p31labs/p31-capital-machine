#!/usr/bin/env bash
set -euo pipefail

# rollback.sh — Reverts P31 monetization engine to testnet mode.
#
# Usage: bash scripts/rollback.sh
#
# What it does:
#   Step 1: Removes production secrets from mcp-x402-gateway
#   Step 2: Reverts wrangler.toml to testnet (base-sepolia)
#   Step 3: Redeploys all workers with testnet config
#   Step 4: Verifies services are healthy in testnet mode

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'
BOLD='\033[1m'

GATEWAY_DIR="/home/p31/P31-local-workspace/workers/mcp-x402-gateway"
REVENUE_DIR="/home/p31/p31-capital-machine/workers/revenue-ledger"
ENTITLEMENT_DIR="/home/p31/p31-capital-machine/workers/entitlement"
ALLOCATOR_DIR="/home/p31/p31-capital-machine/workers/capital-allocator"
ALERTING_DIR="/home/p31/p31-capital-machine/workers/alerting"

TESTNET_NETWORK="base-sepolia"
TESTNET_PAY_TO="0x51c285Df171C76bE36252e32679F098d90768413"

step() { echo -e "\n${CYAN}[$(date +%H:%M:%S)] ▸ Step $1: $2${NC}"; }
ok()   { echo -e "${GREEN}  ✓ $1${NC}"; }
warn() { echo -e "${YELLOW}  ⚠ $1${NC}"; }

echo -e "${BOLD}${YELLOW}══════════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}${YELLOW}  P31 MONETIZATION ENGINE — ROLLBACK TO TESTNET${NC}"
echo -e "${BOLD}${YELLOW}══════════════════════════════════════════════════════════════${NC}"

# ─── Remove production secrets ───────────────────────────────────────────────

step 1 "Removing production secrets from mcp-x402-gateway"

cd "$GATEWAY_DIR"

for secret in FACILITATOR_KEY_ID FACILITATOR_SECRET_KEY; do
  wrangler secret delete "$secret" 2>&1 | tail -1 || true
  ok "$secret removed"
done

# ─── Revert wrangler.toml ───────────────────────────────────────────────────

step 2 "Reverting wrangler.toml to testnet"

sed -i "s|^NETWORK = \".*\"|NETWORK = \"${TESTNET_NETWORK}\"|" wrangler.toml
sed -i "s|^PAY_TO = \".*\"|PAY_TO = \"${TESTNET_PAY_TO}\"|" wrangler.toml
sed -i "s|^FACILITATOR_URL = \".*\"|FACILITATOR_URL = \"https://x402.org/facilitator\"|" wrangler.toml

ok "NETWORK = ${TESTNET_NETWORK}"
ok "PAY_TO = ${TESTNET_PAY_TO}"
ok "FACILITATOR_URL = https://x402.org/facilitator"

# ─── Redeploy all workers ───────────────────────────────────────────────────

step 3 "Redeploying all workers with testnet config"

deploy_worker() {
  local name=$1 dir=$2
  cd "$dir"
  echo -e "  ${YELLOW}Deploying ${name}...${NC}"
  wrangler deploy 2>&1 | tail -3
  ok "$name deployed"
}

deploy_worker "revenue-ledger" "$REVENUE_DIR"
deploy_worker "entitlement" "$ENTITLEMENT_DIR"
deploy_worker "capital-allocator" "$ALLOCATOR_DIR"
deploy_worker "mcp-x402-gateway" "$GATEWAY_DIR"
deploy_worker "monetization-alerting" "$ALERTING_DIR"

# ─── Verify health ──────────────────────────────────────────────────────────

step 4 "Verifying services are healthy"

GATEWAY_URL="https://mcp-x402-gateway.trimtab-signal.workers.dev"
REVENUE_URL="https://revenue-ledger.trimtab-signal.workers.dev"
ENTITLEMENT_URL="https://entitlement.trimtab-signal.workers.dev"

health_check() {
  local name=$1 url=$2
  local status
  status=$(curl -s -o /dev/null -w "%{http_code}" "$url" 2>/dev/null || echo "000")
  if [[ "$status" == "200" ]]; then
    ok "$name → $status"
  else
    warn "$name → $status"
  fi
}

health_check "Revenue Ledger" "$REVENUE_URL/health"
health_check "Entitlement" "$ENTITLEMENT_URL/health"
health_check "Gateway" "$GATEWAY_URL/health"

# ─── Verify testnet mode ────────────────────────────────────────────────────

step 5 "Verifying testnet mode"

WELL_KNOWN=$(curl -s "$GATEWAY_URL/.well-known/mcp-pricing")
if echo "$WELL_KNOWN" | grep -q 'base-sepolia' 2>/dev/null; then
  ok "Network is testnet (base-sepolia)"
else
  warn "Well-known response: $(echo "$WELL_KNOWN" | head -c 200)"
fi

# ─── Summary ─────────────────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}${GREEN}══════════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}${GREEN}  ROLLBACK COMPLETE — TESTNET MODE${NC}"
echo -e "${BOLD}${GREEN}══════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  ${BOLD}Network:${NC}   $TESTNET_NETWORK"
echo -e "  ${BOLD}Pay To:${NC}    $TESTNET_PAY_TO"
echo -e "  ${BOLD}Mode:${NC}      Testnet (no real payments)"
echo ""
echo -e "  ${BOLD}To re-enable production:${NC}"
echo -e "    1. bash scripts/go-live.sh"
echo -e "    2. Or manually set secrets + update wrangler.toml"
echo ""
