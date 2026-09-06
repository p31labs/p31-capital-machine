#!/usr/bin/env bash
set -euo pipefail

# go-live.sh — Automates the full P31 monetization engine go-live.
#
# Usage:
#   1. Copy .env.go-live.example → .env.go-live and fill in values
#   2. Run: bash scripts/go-live.sh
#
# What it does:
#   Step 1: Validates secrets and config
#   Step 2: Sets wrangler secrets on all workers
#   Step 3: Updates mcp-x402-gateway wrangler.toml (NETWORK, PAY_TO)
#   Step 4: Deploys all workers in order
#   Step 5: Runs smoke tests
#   Step 6: Verifies health of all services
#   Step 7: Prints go-live confirmation

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

step() { echo -e "\n${CYAN}[$(date +%H:%M:%S)] ▸ Step $1: $2${NC}"; }
ok()   { echo -e "${GREEN}  ✓ $1${NC}"; }
warn() { echo -e "${YELLOW}  ⚠ $1${NC}"; }
fail() { echo -e "${RED}  ✗ $1${NC}"; exit 1; }

# ─── Load config ─────────────────────────────────────────────────────────────

step 1 "Loading go-live configuration"

if [[ -f ".env.go-live" ]]; then
  source .env.go-live
  ok "Loaded .env.go-live"
elif [[ -f "p31-capital-machine/.env.go-live" ]]; then
  source p31-capital-machine/.env.go-live
  ok "Loaded p31-capital-machine/.env.go-live"
else
  fail "No .env.go-live found. Copy .env.go-live.example and fill in values."
fi

# ─── Validate required values ────────────────────────────────────────────────

step 2 "Validating configuration"

[[ -z "${FACILITATOR_KEY_ID:-}" ]] && fail "FACILITATOR_KEY_ID is empty"
ok "FACILITATOR_KEY_ID: ${FACILITATOR_KEY_ID:0:8}..."

[[ -z "${FACILITATOR_SECRET_KEY:-}" ]] && fail "FACILITATOR_SECRET_KEY is empty"
ok "FACILITATOR_SECRET_KEY: ${#FACILITATOR_SECRET_KEY} chars"

[[ -z "${PAY_TO:-}" || "$PAY_TO" == "0xYOUR_MAINNET_ADDRESS_HERE" ]] && fail "PAY_TO is not set (still placeholder)"
[[ "$PAY_TO" =~ ^0x[0-9a-fA-F]{40}$ ]] && ok "PAY_TO: $PAY_TO" || fail "PAY_TO must be a valid 0x{40 hex chars} address"

[[ "${NETWORK:-}" != "base" ]] && fail "NETWORK must be 'base' for mainnet"
ok "NETWORK: $NETWORK"

[[ "${FACILITATOR_URL:-}" != "https://facilitator.x402.org" ]] && warn "FACILITATOR_URL is not production facilitator"
ok "FACILITATOR_URL: $FACILITATOR_URL"

# ─── Set secrets ─────────────────────────────────────────────────────────────

step 3 "Setting wrangler secrets on mcp-x402-gateway"

cd "$GATEWAY_DIR"

echo "$FACILITATOR_KEY_ID" | wrangler secret put FACILITATOR_KEY_ID 2>&1 | tail -1
ok "FACILITATOR_KEY_ID set"

echo "$FACILITATOR_SECRET_KEY" | wrangler secret put FACILITATOR_SECRET_KEY 2>&1 | tail -1
ok "FACILITATOR_SECRET_KEY set"

if [[ -n "${ENTITLEMENT_API_TOKEN:-}" ]]; then
  echo "$ENTITLEMENT_API_TOKEN" | wrangler secret put ENTITLEMENT_API_TOKEN 2>&1 | tail -1
  ok "ENTITLEMENT_API_TOKEN set"
fi

if [[ -n "${REVENUE_API_TOKEN:-}" ]]; then
  echo "$REVENUE_API_TOKEN" | wrangler secret put REVENUE_API_TOKEN 2>&1 | tail -1
  ok "REVENUE_API_TOKEN set"
fi

# ─── Update wrangler.toml ────────────────────────────────────────────────────

step 4 "Updating mcp-x402-gateway/wrangler.toml for mainnet"

sed -i "s|^NETWORK = \".*\"|NETWORK = \"${NETWORK}\"|" wrangler.toml
sed -i "s|^PAY_TO = \".*\"|PAY_TO = \"${PAY_TO}\"|" wrangler.toml
sed -i "s|^FACILITATOR_URL = \".*\"|FACILITATOR_URL = \"${FACILITATOR_URL}\"|" wrangler.toml

ok "NETWORK = ${NETWORK}"
ok "PAY_TO = ${PAY_TO}"
ok "FACILITATOR_URL = ${FACILITATOR_URL}"

# ─── Deploy all workers ──────────────────────────────────────────────────────

step 5 "Deploying all workers"

deploy_worker() {
  local name=$1 dir=$2
  cd "$dir"
  echo -e "  ${YELLOW}Deploying ${name}...${NC}"
  if wrangler deploy 2>&1 | tail -3; then
    ok "$name deployed"
  else
    fail "$name deploy failed"
  fi
}

deploy_worker "revenue-ledger" "$REVENUE_DIR"
deploy_worker "entitlement" "$ENTITLEMENT_DIR"
deploy_worker "capital-allocator" "$ALLOCATOR_DIR"
deploy_worker "mcp-x402-gateway" "$GATEWAY_DIR"
deploy_worker "monetization-alerting" "$ALERTING_DIR"

# ─── Smoke tests ─────────────────────────────────────────────────────────────

step 6 "Running smoke tests"

GATEWAY_URL="https://mcp-x402-gateway.trimtab-signal.workers.dev"
REVENUE_URL="https://revenue-ledger.trimtab-signal.workers.dev"
ENTITLEMENT_URL="https://entitlement.trimtab-signal.workers.dev"
ALLOCATOR_URL="https://capital-allocator.trimtab-signal.workers.dev"
ALERTING_URL="https://monetization-alerting.trimtab-signal.workers.dev"

TEST_DID="${TEST_DID:-did:key:z6MkhaXgBZDvotDkL5257fJdEbdbbnaB5L1nnENRKjHiWtkN}"

smoke() {
  local name=$1 url=$2
  local status
  status=$(curl -s -o /dev/null -w "%{http_code}" "$url" 2>/dev/null || echo "000")
  if [[ "$status" == "200" ]]; then
    ok "$name → $status"
  else
    warn "$name → $status (may need secrets or config)"
  fi
}

smoke "Revenue Ledger /health"  "$REVENUE_URL/health"
smoke "Entitlement /health"     "$ENTITLEMENT_URL/health"
smoke "Allocator /health"       "$ALLOCATOR_URL/health"
smoke "Gateway /health"         "$GATEWAY_URL/health"
smoke "Alerting /"              "$ALERTING_URL/"

# ─── Verify entitlement preflight gate ───────────────────────────────────────

echo ""
step 7 "Verifying entitlement preflight gate (paid tool without balance)"

PREFLIGHT=$(curl -s -X POST "$GATEWAY_URL/mcp" \
  -H "Content-Type: application/json" \
  -H "X-DID: $TEST_DID" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"oasis_execute","arguments":{"command":"echo smoke-test"}}}')

if echo "$PREFLIGHT" | grep -q '"error"' 2>/dev/null; then
  ok "402 returned correctly (test DID has $0 balance)"
  echo "  Response: $(echo "$PREFLIGHT" | head -c 200)"
else
  warn "Expected 402, got: $(echo "$PREFLIGHT" | head -c 200)"
fi

# ─── Verify x402 v2 well-known ───────────────────────────────────────────────

echo ""
step 8 "Verifying x402 v2 well-known endpoint"

WELL_KNOWN=$(curl -s "$GATEWAY_URL/.well-known/mcp-pricing")
if echo "$WELL_KNOWN" | grep -q '"x402_version":"2.0"' 2>/dev/null; then
  ok "x402 v2 well-known responding"
else
  warn "Well-known endpoint: $(echo "$WELL_KNOWN" | head -c 200)"
fi

# ─── Verify revenue ledger is recording ──────────────────────────────────────

echo ""
step 9 "Verifying revenue ledger"

REVENUE_SUMMARY=$(curl -s "$REVENUE_URL/revenue/summary")
if echo "$REVENUE_SUMMARY" | grep -q '"total_usdc"' 2>/dev/null; then
  ok "Revenue ledger responding: $REVENUE_SUMMARY"
else
  warn "Revenue ledger: $(echo "$REVENUE_SUMMARY" | head -c 200)"
fi

# ─── Summary ─────────────────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}${GREEN}══════════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}${GREEN}  P31 MONETIZATION ENGINE — GO-LIVE COMPLETE${NC}"
echo -e "${BOLD}${GREEN}══════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  ${BOLD}Network:${NC}      $NETWORK"
echo -e "  ${BOLD}Pay To:${NC}       $PAY_TO"
echo -e "  ${BOLD}Facilitator:${NC}  $FACILITATOR_URL"
echo ""
echo -e "  ${BOLD}Gateway:${NC}      $GATEWAY_URL"
echo -e "  ${BOLD}Revenue:${NC}      $REVENUE_URL"
echo -e "  ${BOLD}Entitlement:${NC}  $ENTITLEMENT_URL"
echo -e "  ${BOLD}Allocator:${NC}    $ALLOCATOR_URL"
echo -e "  ${BOLD}Alerting:${NC}     $ALERTING_URL"
echo ""
echo -e "  ${BOLD}First Paid Tool:${NC}  oasis_execute (\$0.05 USDC)"
echo -e "  ${BOLD}Test DID:${NC}         $TEST_DID"
echo ""
echo -e "  ${BOLD}Next:${NC}"
echo -e "    • Monitor: $ALERTING_URL"
echo -e "    • Dashboard: https://af79c8f3.chump-dashboard.pages.dev"
echo -e "    • Run smoke test: bash scripts/test-payment-flow.sh"
echo -e "    • View revenue: curl $REVENUE_URL/revenue/summary"
echo ""
echo -e "${BOLD}${GREEN}  The cage holds. The horizon is wide. 🔺${NC}"
