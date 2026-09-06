# Phase 23 — Launch the Monetization Engine

## Priority 1: Real Traffic

### Mainnet Migration Checklist

#### 1. Secrets (wrangler secret put)
```bash
cd /home/p31/P31-local-workspace/workers/mcp-x402-gateway
wrangler secret put FACILITATOR_KEY_ID        # CDP API key ID
wrangler secret put FACILITATOR_SECRET_KEY    # CDP API secret
wrangler secret put REVENUE_API_TOKEN         # Optional: protect /api/revenue/ingest
wrangler secret put ENTITLEMENT_API_TOKEN     # Optional: protect entitlement endpoints
wrangler secret put HONEYCOMB_API_KEY         # Observability
wrangler secret put LOVE_AUTH_SECRET          # Axis-6 HMAC (already configured)
```

#### 2. Wrangler Config Changes
```toml
# mcp-x402-gateway/wrangler.toml
NETWORK = "base"                    # Was: base-sepolia
PAY_TO = "0x..."                    # Your mainnet address
FACILITATOR_URL = "https://facilitator.x402.org"  # Production facilitator

# revenue-ledger/wrangler.revenue-ledger.toml
# No changes needed — already configured

# entitlement/wrangler.toml
# No changes needed — already configured

# capital-allocator/wrangler.toml
# No changes needed — already configured
```

#### 3. First Paid Tool
Pick one tool from the PRICING map to enable first:
```typescript
// Recommended: oasis_execute ($0.05)
// Already configured in PRICING map
// Already gated by x402 middleware
// Already wired to revenue ledger
// Already checked by entitlement service
```

#### 4. Test Transaction Flow
```bash
# 1. Ensure testnet has funds
# 2. Call a paid tool via mcp-x402-gateway
# 3. Verify 402 challenge
# 4. Pay via x402
# 5. Verify 200 response
# 6. Check revenue ledger: GET /revenue/summary
# 7. Check entitlement: GET /entitlement/{did}
```

### End-to-End Test Script
See `scripts/test-payment-flow.sh`

## Priority 2: MCP Registry Publishing

### Glama Submission
```bash
cd /home/p31/p31-capital-machine/observability
bash submit-all.sh
```

### AAIF Registry
1. Open PR at https://github.com/aaif/registry
2. Use content from `aaif-pr.md`

### HuggingFace
```bash
export HF_TOKEN=<your-token>
bash prepare-huggingface.sh
bash huggingface-upload.sh $HF_TOKEN
```

## Priority 3: EUDI Wallet Certification

1. Apply for sandbox: https://ec.europa.eu/digital-single-market/en/eu-digital-identity-wallet
2. Follow `docs/EUDI_SANDBOX_APPLICATION.md`
3. Run `tests/eudi-sandbox.test.ts`

## Priority 4: Developer Experience

1. Publish PQC blog: `docs/blog/pqc-reference-implementation.md` → p31ca.org
2. Create quick-start tutorial
3. Launch "Verified by P31" badge

## Priority 5: Cross-Chain Payments

1. Solana support (3 hours)
2. Polygon support (2 hours)
3. Base mainnet settlement (2 hours)

## Revenue Flow Diagram

```
User Agent
    │
    ▼
mcp-x402-gateway
    │
    ├─► Entitlement Preflight (POST /entitlement/check)
    │   └─► 402 if insufficient balance
    │
    ├─► x402 Payment Middleware (v1 or v2)
    │   └─► 402 + payment challenge if unpaid
    │
    ├─► Bridge Forward (POST /mcp → BRIDGE_URL)
    │   └─► Tool execution
    │
    ├─► Consume Entitlement (POST /entitlement/consume)
    │   └─► Deduct balance
    │
    └─► Record Revenue (POST /revenue/record)
        └─► SHA-256 chain append
```

## Success Metrics

| Metric | Target |
|--------|--------|
| First paid transaction | < 24 hours after go-live |
| Revenue ledger events | 100+ in first week |
| Active DIDs with entitlement | 50+ in first week |
| Tool completion rate | > 95% |
| Average payment latency | < 2s |

## Rollback Plan

If issues arise:
1. `wrangler secret put FACILITATOR_KEY_ID` — remove to fall back to testnet
2. `NETWORK = "base-sepolia"` — revert network config
3. Monitor `monetization-alerting.trimtab-signal.workers.dev`
