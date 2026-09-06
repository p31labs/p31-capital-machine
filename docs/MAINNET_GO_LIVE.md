# Mainnet Go-Live Checklist

## Pre-Flight (Complete Before Launch)

### Infrastructure
- [x] Revenue Ledger deployed and healthy
- [x] Entitlement Service deployed and healthy
- [x] Capital Allocator deployed and healthy
- [x] mcp-x402-gateway deployed with v1/v2 support
- [x] Alerting worker deployed with 15-min cron
- [x] Dashboard deployed and accessible
- [x] All D1 migrations applied
- [x] All 5 payment sources wired (non-blocking)

### Secrets
- [ ] `FACILITATOR_KEY_ID` set (mainnet CDP auth)
- [ ] `FACILITATOR_SECRET_KEY` set (mainnet CDP auth)
- [ ] `REVENUE_API_TOKEN` set (optional but recommended)
- [ ] `ENTITLEMENT_API_TOKEN` set (optional but recommended)
- [ ] `HONEYCOMB_API_KEY` set (observability)
- [ ] `LOVE_AUTH_SECRET` set (already configured)

### Configuration
- [ ] `NETWORK = "base"` (was `base-sepolia`)
- [ ] `PAY_TO = "0x..."` (mainnet address)
- [ ] `FACILITATOR_URL = "https://facilitator.x402.org"` (production)
- [ ] `REVENUE_LEDGER_URL` points to production
- [ ] `ENTITLEMENT_URL` points to production
- [ ] `ALLOCATOR_URL` points to production

### Testing
- [x] Unit tests pass (49/49)
- [x] SDK tests pass (6/6)
- [x] TypeScript compiles clean
- [ ] End-to-end payment test passes
- [ ] First paid tool (`oasis_execute`) tested
- [ ] Revenue recorded in ledger after payment
- [ ] Entitlement deducted after payment
- [ ] 402 returned for insufficient balance

### Observability
- [ ] Honeycomb datasets created (3)
- [ ] Honeycomb API keys configured
- [ ] Grafana dashboard imported
- [ ] Alerting Slack webhook configured (optional)

### Documentation
- [x] README.md complete
- [x] LAUNCH.md complete
- [x] FIRST_PAID_TOOL.md complete
- [x] EUDI documentation complete
- [x] PQC documentation complete
- [ ] Blog post published to p31ca.org
- [ ] MCP registry submissions submitted

## Launch Sequence

### T-24 Hours
1. [ ] Set all secrets via `wrangler secret put`
2. [ ] Update `NETWORK` to `base` in wrangler.toml
3. [ ] Update `PAY_TO` to mainnet address
4. [ ] Deploy mcp-x402-gateway: `wrangler deploy`
5. [ ] Run e2e test: `bash scripts/test-payment-flow.sh`

### T-1 Hour
1. [ ] Verify all workers healthy: `bash scripts/health-check.sh`
2. [ ] Verify metrics endpoints responding
3. [ ] Verify Honeycomb spans flowing
4. [ ] Notify team in Slack

### T-0 (Launch)
1. [ ] Enable first paid tool (`oasis_execute`)
2. [ ] Monitor `monetization-alerting.trimtab-signal.workers.dev`
3. [ ] Watch revenue ledger: `GET /revenue/summary`
4. [ ] Watch entitlement: `GET /entitlement/{did}`

### T+1 Hour
1. [ ] Verify first real transaction recorded
2. [ ] Verify entitlement deduction
3. [ ] Check alerting for any errors
4. [ ] Update dashboard with live data

### T+24 Hours
1. [ ] Review all transactions
2. [ ] Verify hash chain integrity: `GET /revenue/verify-chain`
3. [ ] Check capital allocator: `GET /allocation/roi`
4. [ ] Document any issues

## Rollback Plan

If critical issues arise:

### Option 1: Disable Payments (Fast)
```bash
cd /home/p31/P31-local-workspace/workers/mcp-x402-gateway
# Remove FACILITATOR_KEY_ID and FACILITATOR_SECRET_KEY secrets
wrangler secret delete FACILITATOR_KEY_ID
wrangler secret delete FACILITATOR_SECRET_KEY
# Redeploy — gateway falls back to testnet mode
wrangler deploy
```

### Option 2: Revert to Testnet (Fast)
```bash
# Update wrangler.toml
NETWORK = "base-sepolia"
PAY_TO = "0x51c285Df171C76bE36252e32679F098d90768413"
# Redeploy
wrangler deploy
```

### Option 3: Disable Paid Tools (Fastest)
```typescript
// In mcp-x402-gateway/src/index.ts, set all prices to "0"
const PRICING = {
  "oasis_execute": { price: "0", ... },
  // ...
};
// Redeploy
wrangler deploy
```

## Success Criteria

| Metric | Target | Measurement |
|--------|--------|-------------|
| First paid transaction | < 24h | Revenue ledger `transaction_count` |
| Payment success rate | > 95% | Revenue events / 402 count |
| Entitlement accuracy | 100% | Ledger balance vs entitlement balance |
| Alert latency | < 15 min | Cron schedule |
| Dashboard availability | 99.9% | HTTP 200 on `/health` |

## Contact

- **Technical:** P31 Engineering
- **Financial:** P31 Finance
- **Emergency:** P31 On-Call
