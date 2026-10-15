# Monetization Engine Rollout Plan

## Overview

This document outlines the 5-phase rollout of the P31 Unified Monetization Engine. Each phase is designed to minimize risk and maintain backward compatibility where possible.

---

## Phase 1: Deploy Revenue Ledger + Wire Payment Sources

**Status:** Non-breaking

**Goal:** Stand up the revenue-ledger service and begin capturing all payment events from existing sources (x402, Taler, Gumroad, BTCPay, LOVE) without disrupting any existing workflows.

**Steps:**
1. Deploy `revenue-ledger` worker to Cloudflare using `wrangler deploy` from `workers/revenue-ledger/` (per-worker `wrangler.toml`).
2. Run D1 migrations to create `revenue_events` table and indexes.
3. Update payment sources (x402-gateway, taler-worker, etc.) to POST revenue events to `/revenue/record` in addition to their existing logic.
4. Verify revenue flows appear in the ledger via `/revenue/summary`.
5. Enable hash-chain verification via `/revenue/verify-chain` in monitoring only.

**Rollback:** Remove the new POST call from payment sources. Ledger data is append-only and safe to keep.

---

## Phase 2: Deploy Entitlement Service

**Status:** Non-breaking (read-only initially)

**Goal:** Stand up the entitlement service as a read-only source of truth for user balances. No existing flows are gated on it yet.

**Steps:**
1. Deploy `entitlement` worker.
2. Backfill entitlements from existing revenue-ledger data (sum all `payer_did` balances by asset).
3. Expose `/entitlement/balance/{did}` and `/entitlement/check` endpoints.
4. Run shadow traffic: log entitlement checks but do not block any requests.
5. Compare entitlement service responses against direct revenue-ledger queries for consistency.

**Rollback:** Disable entitlement worker routes. All existing systems continue to read from revenue-ledger directly.

---

## Phase 3: Wire Entitlement Check into mcp-x402-gateway

**Status:** Breaking (requires coordination)

**Goal:** Gate x402 payments on available entitlement. This is the first breaking change because previously any valid payment was accepted.

**Steps:**
1. Update `mcp-x402-gateway` to call `/entitlement/check` before finalizing a payment.
2. If entitlement is insufficient, return HTTP 402 with reason `Insufficient balance`.
3. On successful payment, call `/entitlement/consume` to deduct the amount.
4. Add circuit breaker: if entitlement service is unreachable, fail open (allow payment) or fail closed (reject) based on risk tolerance.
5. Monitor 402 rate in logs and dashboards.

**Rollback:** Revert x402-gateway to pre-gate behavior. Entitlement service remains operational.

---

## Phase 4: Deploy Capital Allocator and Refactor Capital-Machine Workers

**Status:** Breaking

**Goal:** Route capital through the new capital-allocator service instead of inline allocation logic in capital-machine workers.

**Steps:**
1. Deploy `capital-allocator` worker.
2. Refactor capital-machine `orchestrator.ts` to call `/allocation/create` on the allocator instead of executing allocation logic inline.
3. Wire ROI reporting from allocator back into `/dashboard/roi`.
4. Migrate existing KV-backed allocation state to the allocator service.
5. Deploy in staging and validate end-to-end with synthetic capital flows.
6. Promote to production.

**Rollback:** Revert orchestrator to inline allocation logic. Allocator data can be archived.

---

## Phase 5: Deploy Dashboard

**Status:** Non-breaking

**Goal:** Launch the monetization dashboard for operators to view revenue, entitlement, allocation, and ROI in one place.

**Steps:**
1. Build and deploy `apps/monetization-dashboard`.
2. Integrate with revenue-ledger `/revenue/summary`, entitlement `/entitlement/balance/{did}`, and allocator `/roi`.
3. Add hash-chain integrity widget to the dashboard.
4. Enable for staging users, then production.
5. Deprecate legacy dashboard endpoints in capital-machine if applicable.

**Rollback:** Remove dashboard routes. No impact on backend services.
