# P31 Activation & Ops Guide (Phase 2 → real yield & monetization)

This guide documents how to activate the three "real-world input" paths in the deployed system.
All worker code is live; the remaining work is supplying real on-chain data and keys.

## 1. Activation Checklist (summary)

| Path | What to supply | Where | Done when |
|------|---------------|-------|-----------|
| Yield APYs (5 protocols) | Real vault contract addresses | `wrangler secret put` on yield-vault | Dashboard Strategies shows real APY % |
| Solana MEV (Jito bundles) | Funded Solana keypair + mainnet RPC | `wrangler secret put` on mev-arbitrage | `/scan`+`/execute` returns real bundleId |
| x402 payments | Cloudflare Monetization Gateway approval | External waitlist | Revenue summary shows new x402 rows from gateway |

---

## 2. Yield Vault — supply real protocol addresses

`yield-vault` reads addresses from its OWN Worker env (`env.*`), NOT the dashboard config.
It safely returns `0` APY when a variable is unset, so missing addresses do not break scans.

```bash
cd workers/yield-vault

wrangler secret put ETHENA_VAULT_ADDRESS      # Ethena sUSDe vault
wrangler secret put BENPAY_VAULT_ADDRESS      # BenPay DeFi Earn vault (non-EVM — not wired)
wrangler secret put MOONWELL_VAULT_ADDRESS    # Moonwell lending pool
wrangler secret put PENDLE_VAULT_ADDRESS      # Pendle fixed-yield vault
wrangler secret put PEAPODS_VAULT_ADDRESS     # Peapods volatility vault
```

### Verifired incoming addresses (2026)

| Protocol | Chain | Address | Status |
|----------|-------|---------|--------|
| Moonwell (mUSDC) | Base | `0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22` | ✅ on-chain calls work |
| Pendle (sUSDS Nov-2026) | Ethereum | `0x9c560ebaf78e596cbcc27411d633a74d628dd7dc` | ✅ 4.81% APY |
| Peapods (pHestia pod) | Base | `0xF760fD8fEB1F5E3bf3651E2E4f227285a82470Ff` | ✅ 5.50% APY |

### Per-protocol rate source

- **Pendle** — `PendleMarketV7.readState(router)` → `lastLnImpliedRate` (index 8),
  APY = (e^rate − 1) × 100. No warm-up; reports on every rebalance.
- **Peapods** — pod `convertToAssets(1e18)` (CBR share price), accrued-to-date yield.
  No warm-up; reports on every rebalance.
- **Moonwell** — `supplyRatePerBlock()` reverts on the V2 proxy market, so APY is
  derived from two `exchangeRateCurrent()` observations persisted to D1
  (`moonwell_rate_observations`), annualized over real elapsed time. Requires ≥300 s
  between observations (the 15-min cron satisfies this), so the first rebalance is a
  0-APY warm-up. Migration: `infra/migrations/006_moonwell_rates.sql`.

### Required RPC secrets

RPCs are read from `env.*` and must be reachable from Cloudflare egress (some public
RPCs rate-limit/block Workers). Working set:

```bash
wrangler secret put RPC_URL_BASE   # https://base-rpc.publicnode.com
wrangler secret put RPC_URL_ETH    # https://ethereum-rpc.publicnode.com
wrangler secret put RPC_URL_ARB    # https://arb1.arbitrum.io/rpc
wrangler secret put RPC_URL_BERA   # https://rpc.berachain.com
wrangler secret put PRIVATE_KEY_ETH
```

To recompute stats immediately after setting a secret:

```bash
curl -s -X POST https://yield-vault.trimtab-signal.workers.dev/rebalance
curl -s https://yield-vault.trimtab-signal.workers.dev/stats
```

---

## 3. Solana MEV — activate Jito bundles

`mev-arbitrage` builds real swap transactions via **Jupiter Swap API v1** (V6 was
sunset) and submits them as atomic **Jito bundles** (swap tx + tip-transfer last).

### Secrets (set as of 2026-09)

```bash
cd workers/mev-arbitrage

# Funded Solana keypair = base64 of the 64-byte ed25519 secret (secret_seed || pubkey).
wrangler secret put PRIVATE_KEY_SOL
# Solana RPC (low-latency preferred for MEV). Uses Alchemy:
#   https://solana-mainnet.g.alchemy.com/v2/<KEY>
wrangler secret put RPC_URL_SOL
# Jupiter Swap API v1 key (required — V6 sunset; get at developers.jup.ag).
wrangler secret put JUPITER_API_KEY

# Optional tuning:
wrangler secret put JITO_TIP_PCT        # default "60"  (60% of net profit as tip)
wrangler secret put SWAP_MAX_SLIPPAGE_BPS # default "100"
# Override the Jupiter base (default https://api.jup.ag/swap/v1):
wrangler secret put JUPITER_BASE_URL
```

Note: `@solana/web3.js` is bundled into this worker (deploy size ~1.5MB); the
`nodejs_compat` compatibility flag is already set.

### How the flow works

1. `/scan?chain=solana` → Jupiter-quote-based round-trip discovery (Solana is NOT
   EVM; the old generic Uniswap-style scanner was removed for Solana).
2. `buildSolanaSwapBundle` → Jupiter v1 `/quote` then `/swap` (with `x-api-key` +
   `prioritizationFeeLamports: "auto"`) → deserialize base64 `swapTransaction`, sign.
3. Pre-trade safety: `execute` checks `getBalance` ≥ base fee + Jito tip — it refuses
   to submit from an unfunded wallet.
4. `buildJitoTipTx` → `sizeJitoTip(env, opp)` lamports to a random Jito tip account
   (fetched live via block-engine `getTipAccounts`).
5. `submitJitoBundle` → `sendBundle` to `https://mainnet.block-engine.jito.wtf/api/v1/bundles`.
6. `confirmJitoBundleLanding` → polls `getBundleStatuses`; records `landed` vs `pending`
   (a `bundleId` only means Jito *received* it, not that it landed).

```bash
curl -s "https://mev-arbitrage.trimtab-signal.workers.dev/scan?chain=solana"   # find opps
curl -s -X POST https://mev-arbitrage.trimtab-signal.workers.dev/execute \
  -H 'Content-Type: application/json' \
  -d '{"chain":"solana","id":"<oppId>"}'
```

Safety: build/sign failures fail gracefully and record a `failed` execution; a funded
balance check prevents burning Jito tips on an empty wallet. It never submits a
half-built bundle.

---

## 4. x402 / Cloudflare Monetization Gateway

`revenue-ledger` exposes the settlement webhook at:

```
POST https://revenue-ledger.trimtab-signal.workers.dev/webhook/x402
```

It accepts:
```json
{
  "payer_did": "did:...",
  "amount_usdc": "10.00",
  "asset": "USDC",
  "tx_hash": "0x...",
  "merchant_did": "cloudflare-gateway"
}
```

- Records revenue (source `x402`) and appends to the audit hash chain (event `x402_settlement`).
- No auth token required (verified live). If the gateway enforces a shared secret, wrap this
  route in an HMAC check on `merchant_did` before activating.

### To activate

1. Apply / get approved in the Cloudflare Monetization Gateway.
2. Point the gateway's webhook URL to the endpoint above.
3. Verify: `curl -s https://revenue-ledger.trimtab-signal.workers.dev/revenue/summary`
   → `source_breakdown.x402.total_usdc` increases with new settlements.

---

## 5. Billing / premium tiers

Fully live in the dashboard **Billing** tab:
- Plans: Starter (free), Pro ($50/mo), Enterprise ($500/mo).
- Select a plan + enter a wallet/DID → `POST /api/entitlement/tier-set` → tier upgraded,
  monthly allowance reflected in the entitlement check.

---

## 6. Registry of worker URLs (current versions)

| Worker | Version | URL |
|--------|---------|-----|
| config-gateway | `b7b6f065…` | https://config-gateway.trimtab-signal.workers.dev |
| revenue-ledger | `8e9ad4e2…` | https://revenue-ledger.trimtab-signal.workers.dev |
| entitlement | `73fb5eb1…` | https://entitlement.trimtab-signal.workers.dev |
| mev-arbitrage | `f56b47c1…` | https://mev-arbitrage.trimtab-signal.workers.dev |
| yield-vault | `795caa8e…` | https://yield-vault.trimtab-signal.workers.dev |
| dashboard | `d6fbce50…` | https://p31-monetization.trimtab-signal.workers.dev |
