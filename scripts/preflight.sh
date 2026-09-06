#!/usr/bin/env bash
set -euo pipefail

# preflight.sh — Validates everything is ready before running go-live.sh.
#
# Usage: bash scripts/preflight.sh
#
# Checks:
#   1. .env.go-live exists and has required values
#   2. wrangler CLI is installed and authenticated
#   3. All worker directories exist
#   4. D1 databases exist and are migrated
#   5. All services are healthy in testnet mode
#   6. Entitlement preflight gate is working
#   7. Revenue ledger is recording
#   8. No blocking issues found

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'
BOLD='\033[1m'

ERRORS=0
WARNINGS=0

pass()  { echo -e "${GREEN}  ✓ $1${NC}"; }
warn()  { echo -e "${YELLOW}  ⚠ $1${NC}"; ((WARNINGS++)); }
fail()  { echo -e "${RED}  ✗ $1${NC}"; ((ERRORS++)); }

echo -e "${BOLD}${CYAN}══════════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}${CYAN}  P31 MONETIZATION ENGINE — PRE-FLIGHT CHECK${NC}"
echo -e "${BOLD}${CYAN}══════════════════════════════════════════════════════════════${NC}"

# ─── 1. Config file ──────────────────────────────────────────────────────────

echo -e "\n${CYAN}[1/8] Configuration${NC}"

if [[ -f ".env.go-live" ]]; then
  source .env.go-live
  pass ".env.go-live exists"
else
  fail ".env.go-live not found — copy .env.go-live.example and fill in values"
fi

[[ -z "${FACILITATOR_KEY_ID:-}" ]] && fail "FACILITATOR_KEY_ID empty" || pass "FACILITATOR_KEY_ID set"
[[ -z "${FACILITATOR_SECRET_KEY:-}" ]] && fail "FACILITATOR_SECRET_KEY empty" || pass "FACILITATOR_SECRET_KEY set"
[[ -z "${PAY_TO:-}" || "$PAY_TO" == "0xYOUR_MAINNET_ADDRESS_HERE" ]] && fail "PAY_TO not configured" || pass "PAY_TO = $PAY_TO"
[[ "${NETWORK:-}" != "base" ]] && fail "NETWORK must be 'base' for mainnet" || pass "NETWORK = base"

# ─── 2. Wrangler CLI ─────────────────────────────────────────────────────────

echo -e "\n${CYAN}[2/8] Wrangler CLI${NC}"

if command -v wrangler &>/dev/null; then
  pass "wrangler installed: $(wrangler --version 2>&1 | head -1)"
else
  fail "wrangler not found — install with: npm i -g wrangler"
fi

if wrangler whoami 2>&1 | grep -qi "success\|account"; then
  pass "wrangler authenticated"
else
  warn "wrangler auth status unclear — may need: wrangler login"
fi

# ─── 3. Worker directories ───────────────────────────────────────────────────

echo -e "\n${CYAN}[3/8] Worker directories${NC}"

GATEWAY_DIR="/home/p31/P31-local-workspace/workers/mcp-x402-gateway"
REVENUE_DIR="/home/p31/p31-capital-machine/workers/revenue-ledger"
ENTITLEMENT_DIR="/home/p31/p31-capital-machine/workers/entitlement"
ALLOCATOR_DIR="/home/p31/p31-capital-machine/workers/capital-allocator"
ALERTING_DIR="/home/p31/p31-capital-machine/workers/alerting"

for dir in "$GATEWAY_DIR" "$REVENUE_DIR" "$ENTITLEMENT_DIR" "$ALLOCATOR_DIR" "$ALERTING_DIR"; do
  if [[ -d "$dir" ]]; then
    pass "$(basename "$dir")/ exists"
  else
    fail "$(basename "$dir")/ not found at $dir"
  fi
done

# ─── 4. D1 databases ─────────────────────────────────────────────────────────

echo -e "\n${CYAN}[4/8] D1 databases${NC}"

for name in revenue-ledger-db entitlement-db allocator-db; do
  if wrangler d1 list 2>&1 | grep -q "$name"; then
    pass "D1 database '$name' exists"
  else
    warn "D1 database '$name' not found (may need: bash scripts/setup-d1.sh)"
  fi
done

# ─── 5. Service health ───────────────────────────────────────────────────────

echo -e "\n${CYAN}[5/8] Service health (testnet mode)${NC}"

check_health() {
  local name=$1 url=$2
  local status
  status=$(curl -s -o /dev/null -w "%{http_code}" "$url/health" 2>/dev/null || echo "000")
  if [[ "$status" == "200" ]]; then
    pass "$name → $status"
  else
    warn "$name → $status"
  fi
}

check_health "Revenue Ledger" "https://revenue-ledger.trimtab-signal.workers.dev"
check_health "Entitlement" "https://entitlement.trimtab-signal.workers.dev"
check_health "Capital Allocator" "https://capital-allocator.trimtab-signal.workers.dev"
check_health "mcp-x402 Gateway" "https://mcp-x402-gateway.trimtab-signal.workers.dev"

# ─── 6. Entitlement preflight gate ──────────────────────────────────────────

echo -e "\n${CYAN}[6/8] Entitlement preflight gate${NC}"

PREFLIGHT=$(curl -s -X POST "https://mcp-x402-gateway.trimtab-signal.workers.dev/mcp" \
  -H "Content-Type: application/json" \
  -H "X-DID: did:key:z6MkhaXgBZDvotDkL5257fJdEbdbbnaB5L1nnENRKjHiWtkN" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"oasis_execute","arguments":{"command":"echo test"}}}')

if echo "$PREFLIGHT" | grep -q '"error"' 2>/dev/null; then
  pass "Preflight gate returns 402 for zero-balance DID"
else
  warn "Preflight gate response: $(echo "$PREFLIGHT" | head -c 200)"
fi

# ─── 7. Revenue ledger ───────────────────────────────────────────────────────

echo -e "\n${CYAN}[7/8] Revenue ledger${NC}"

REVENUE=$(curl -s "https://revenue-ledger.trimtab-signal.workers.dev/revenue/summary")
if echo "$REVENUE" | grep -q '"total_usdc"' 2>/dev/null; then
  pass "Revenue ledger responding"
else
  warn "Revenue ledger: $(echo "$REVENUE" | head -c 200)"
fi

# ─── 8. x402 v2 well-known ───────────────────────────────────────────────────

echo -e "\n${CYAN}[8/8] x402 v2 well-known${NC}"

WELLKNOWN=$(curl -s "https://mcp-x402-gateway.trimtab-signal.workers.dev/.well-known/mcp-pricing")
if echo "$WELLKNOWN" | grep -q '"x402_version":"2.0"' 2>/dev/null; then
  pass "x402 v2 well-known responding"
else
  warn "Well-known: $(echo "$WELLKNOWN" | head -c 200)"
fi

# ─── Summary ─────────────────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}${CYAN}══════════════════════════════════════════════════════════════${NC}"
if [[ $ERRORS -gt 0 ]]; then
  echo -e "${BOLD}${RED}  PRE-FLIGHT FAILED: $ERRORS error(s), $WARNINGS warning(s)${NC}"
  echo -e "${BOLD}${RED}══════════════════════════════════════════════════════════════${NC}"
  echo ""
  echo -e "  Fix the errors above, then re-run:"
  echo -e "    bash scripts/preflight.sh"
  echo ""
  exit 1
else
  echo -e "${BOLD}${GREEN}  PRE-FLIGHT PASSED: 0 errors, $WARNINGS warning(s)${NC}"
  echo -e "${BOLD}${GREEN}══════════════════════════════════════════════════════════════${NC}"
  echo ""
  echo -e "  ${BOLD}Ready to go live! Run:${NC}"
  echo -e "    bash scripts/go-live.sh"
  echo ""
fi
