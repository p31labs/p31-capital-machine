#!/bin/bash
set -e

echo "=== End-to-End Payment Flow Test ==="
echo ""

GATEWAY_URL="https://mcp-x402-gateway.trimtab-signal.workers.dev"
REVENUE_URL="https://revenue-ledger.trimtab-signal.workers.dev"
ENTITLEMENT_URL="https://entitlement.trimtab-signal.workers.dev"

# Test DID
TEST_DID="did:key:z6MkhaXgBZDvotDkL5257fJdEbdbbnaB5L1nnENRKjHiWtkN"

echo ">>> Step 1: Check initial entitlement"
curl -s "$ENTITLEMENT_URL/entitlement/$TEST_DID" | jq '.'
echo ""

echo ">>> Step 2: Call FREE tool (no payment required)"
curl -s -X POST "$GATEWAY_URL/mcp" \
  -H "Content-Type: application/json" \
  -H "X-DID: $TEST_DID" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"neo_pixel_control","arguments":{"mode":"test"}}}' | jq '.'
echo ""

echo ">>> Step 3: Call PAID tool without payment (expect 402)"
curl -s -X POST "$GATEWAY_URL/mcp" \
  -H "Content-Type: application/json" \
  -H "X-DID: $TEST_DID" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"oasis_execute","arguments":{"command":"echo test"}}}' | jq '.'
echo ""

echo ">>> Step 4: Check revenue ledger (should be empty)"
curl -s "$REVENUE_URL/revenue/summary" | jq '.'
echo ""

echo ">>> Step 5: Verify x402 v2 well-known"
curl -s "$GATEWAY_URL/.well-known/mcp-pricing" | jq '.'
echo ""

echo "=== Test Complete ==="
echo ""
echo "To test with real x402 payment:"
echo "1. Get x402 testnet tokens from facilitator"
echo "2. Include X-Payment-Token header in request"
echo "3. Verify 200 response"
echo "4. Check revenue ledger for recorded event"
