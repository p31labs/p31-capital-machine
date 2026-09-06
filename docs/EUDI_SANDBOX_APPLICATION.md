# EUDI Wallet Sandbox Application Guide

## Overview
The EUDI Wallet framework requires all EU member states to offer a digital identity wallet by December 2026. P31's sovereign identity stack is positioned to integrate with this framework.

## P31 EUDI-Ready Components

### 1. DID Core Compliance
- `did:key` (Ed25519) — primary sovereign identity
- `did:jwk` (ML-DSA-65) — quantum-safe identity
- `did:web` (HTTPS) — domain-based resolution
- Implementation: `packages/quantum-core/src/did.ts`

### 2. Verifiable Credentials
- SD-JWT VCs (RFC 9901) — selective disclosure
- Ed25519-signed
- SHA-256 salted disclosures
- Implementation: `workers/ledger-bridge/src/sdjwt.ts`

### 3. Wallet Integration Points
- `GET /eudi/:type` — VC export endpoints
- `POST /credential/issue` — VC issuance
- `POST /credential/verify` — VC verification
- `GET /credential/revocation/:id` — Revocation checking

## Sandbox Application Steps

### Step 1: Register for EUDI Sandbox
1. Visit https://ec.europa.eu/digital-single-market/en/eu-digital-identity-wallet
2. Navigate to "Developer Sandbox" section
3. Register organization: "P31 Labs"
4. Request API credentials for sandbox environment

### Step 2: Configure P31 Federation Bridge
The federation-bridge already exposes EUDI-compatible endpoints:
- `GET /.well-known/did.json` — DID document
- `POST /identity/register` — Identity registration
- `POST /credential/issue` — VC issuance (SD-JWT)
- `GET /credential/revocation/list` — Status-List-2021

Environment variables needed:
```
FEDERATION_URL=https://federation.p31ca.org
LEDGER_BRIDGE_URL=https://ledger-bridge.trimtab-signal.workers.dev
ACTOR_PRIVATE_KEY=<Ed25519 PEM>
ACTOR_PUBLIC_KEY=<Ed25519 PEM>
```

### Step 3: Test VC Import into Sandbox Wallet
1. Obtain sandbox wallet from EUDI portal
2. Request VC from P31 federation-bridge:
   ```bash
   curl -X POST https://federation.p31ca.org/credential/issue \
     -H "Content-Type: application/json" \
     -d '{
       "did": "did:key:z6Mk...",
       "vct": "https://p31ca.org/vct/pilot-membership/1.0"
     }'
   ```
3. Import VC into sandbox wallet via QR code or deep link
4. Verify wallet accepts SD-JWT format

### Step 4: Test DID Authentication
1. Create DID via P31 identity registration:
   ```bash
   curl -X POST https://federation.p31ca.org/identity/register \
     -H "Content-Type: application/json" \
     -d '{"did": "did:key:z6Mk..."}'
   ```
2. Test DID-based login in sandbox wallet
3. Verify cross-origin authentication flow

## Compatibility Gaps

### Gap 1: EBSI Credential Types
- Current: P31 issues custom pilot-membership VCs
- Required: EBSI-standard credential types (VerifiableID, VerifiableDiploma, etc.)
- Effort: 2-3 days to add EBSI schema support

### Gap 2: Status-List-2021 Aggregation
- Current: Individual revocation status per VC
- Required: Bitstring status list (RFC 9361)
- Status: CLOSED — `GET /credential/revocation/list` now returns aggregated list

### Gap 3: DID Web Publication
- Current: did:web resolution works via HTTPS fetch
- Required: DID document served with `application/did+json` content type
- Status: In progress — federation-bridge serves DID documents

### Gap 4: EUDI Wallet App Integration
- Current: P31 issues VCs, but no native EUDI Wallet app integration
- Required: Test with official EUDI Wallet reference implementation
- Effort: 1-2 days for integration testing

## Next Steps
1. Apply for sandbox access (see Step 1)
2. Run test procedures in `tests/eudi-sandbox.test.ts`
3. Address compatibility gaps
4. Submit EUDI readiness documentation
