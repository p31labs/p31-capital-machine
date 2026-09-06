# PQC Implementation Checklist

## FIPS 204 — ML-DSA (Digital Signatures)

| Check | Status | Notes |
|-------|--------|-------|
| ML-DSA-44 keygen | ✅ | `packages/quantum-core/src/pqc/fips203-204.ts:114` |
| ML-DSA-65 keygen | ✅ | `packages/quantum-core/src/pqc/fips203-204.ts:114` |
| ML-DSA-87 keygen | ✅ | `packages/quantum-core/src/pqc/fips203-204.ts:114` |
| ML-DSA-65 sign/verify | ✅ | Used in care-proof co-signature (`ledger-bridge/src/index.ts:159`), SD-JWT (`ledger-bridge/src/sdjwt.ts:262`), federation mesh (`federation-bridge/src/index.ts:312`) |
| ML-DSA-44 sign/verify | ✅ | Available in `quantum-core`; used in PHOS PQC keys |
| ML-DSA-87 sign/verify | ✅ | Available in `quantum-core` |
| did:jwk with kty:AKP | ✅ | IANA RFC 9964 compliant — `apps/phos/src/lib/crypto.ts:258`, `packages/quantum-core/src/did.ts:54` |
| Key rotation | ⚠️ | PHOS shell has `registerPqcOnChain` (`production/shell/src/lib/pqc.ts:130`); no dedicated `/identity/rotate` endpoint found in ledger-bridge |

## FIPS 203 — ML-KEM (Key Encapsulation)

| Check | Status | Notes |
|-------|--------|-------|
| ML-KEM-512 keygen | ✅ | `packages/quantum-core/src/pqc/fips203-204.ts:80` |
| ML-KEM-768 keygen | ✅ | `packages/quantum-core/src/pqc/fips203-204.ts:80` |
| ML-KEM-1024 keygen | ✅ | `packages/quantum-core/src/pqc/fips203-204.ts:80` |
| ML-KEM-768 encap/decap | ✅ | Used in X-Wing KEM (`ledger-bridge/src/kem.ts:59`, `ledger-bridge/src/kem.ts:79`) |
| Hybrid KEM (X25519MLKEM768) | ✅ | X-Wing implementation (`ledger-bridge/src/kem.ts:43-82`) |
| Hybrid KEM (Cloudflare TLS) | ⚠️ | Zone-level setting only; not a per-Worker flag. Enable at Cloudflare dashboard → SSL/TLS → Edge Certificates. |

## FIPS 180-4 — SHA-256

| Check | Status | Notes |
|-------|--------|-------|
| SHA-256 for hashing | ✅ | Web Crypto API + `@noble/hashes/sha256` (`ledger-bridge/src/sdjwt.ts:23`) |
| SHA-256 for HMAC | ✅ | LOVE settlement auth (`mcp-x402-gateway/src/index.ts:151`, `X-Love-Auth-MAC` header) |
| SHA-256 for SD-JWT | ✅ | Salted disclosures (`ledger-bridge/src/sdjwt.ts:180`) |
| SHA-256 for hash chain | ✅ | Revenue ledger (`p31-capital-machine/workers/revenue-ledger/ledger.ts`) |

## FIPS 205 — SLH-DSA (Hash-Based Signatures)

| Check | Status | Notes |
|-------|--------|-------|
| SLH-DSA-128s keygen | ✅ | `production/shell/src/__tests__/pqc-eudi.test.ts:113` |
| SLH-DSA-128s sign/verify | ✅ | `production/shell/src/__tests__/pqc-eudi.test.ts:121` |
| Triple-signature (Ed25519 + ML-DSA + SLH-DSA) | ✅ | `production/shell/src/__tests__/pqc-eudi.test.ts:233` |

## Integration Points

| Component | PQC Usage | Status | Source |
|-----------|-----------|--------|--------|
| `ledger-bridge` | ML-DSA-65 VC signing, X-Wing KEM, care-proof co-signature | ✅ Live | `ledger-bridge/src/sdjwt.ts`, `ledger-bridge/src/kem.ts`, `ledger-bridge/src/index.ts` |
| `federation-bridge` | ML-DSA-65 Object Integrity Proofs, did:web with AKP | ✅ Live | `federation-bridge/src/index.ts:312`, `federation-bridge/src/index.ts:728` |
| `p31-crypto-mcp` | 12 MCP tools (ML-DSA-65, ML-KEM-768, SD-JWT, Taler, x402) | ✅ Live | `workers/p31-crypto-mcp/src/index.ts:32-57` |
| `quantum-core` | MLKEM, MLDSA, HybridPQCScheme classes | ✅ Live | `software/packages/quantum-core/src/pqc/fips203-204.ts` |
| `PHOS` | ML-DSA-65 / SLH-DSA-128s key management, did:jwk | ✅ Live | `production/shell/src/lib/pqc.ts`, `apps/phos/src/lib/crypto.ts` |
| `mcp-x402-gateway` | HMAC-SHA-256 (`X-Love-Auth-MAC`) | ✅ Live | `mcp-x402-gateway/src/index.ts:151` |

## Testing

| Test | Command | Status | Source |
|------|---------|--------|--------|
| Quantum core unit tests | `cd software/packages/quantum-core && npx vitest run` | ✅ Pass | `software/packages/quantum-core/test/quantum-core.test.ts` |
| PQC EUDI tests | `cd production/shell && npx vitest run src/__tests__/pqc-eudi.test.ts` | ✅ Pass | `production/shell/src/__tests__/pqc-eudi.test.ts` |
| Federation bridge tests (FEP-8b32 + credentialing + EUDI) | `cd software/workers/federation-bridge && npx vitest run` | ✅ 10/10 pass | `test/fep8b32.test.ts` (4) + `test/credentialing.test.ts` (6) |
| Ledger bridge tests | `cd software/workers/ledger-bridge && npx vitest run` | ✅ Pass | `test/sdjwt.test.mjs`, `test/kem.test.ts`, `test/mldsa65-verify.test.mjs` |
| Care proof co-signature | `POST /care-proof` with `mldsa65_sig` | ✅ Live | `ledger-bridge/src/index.ts:328` |

## Standards Compliance

| Standard | Implementation | Status |
|----------|---------------|--------|
| FIPS 204 (ML-DSA) | ML-DSA-44, ML-DSA-65, ML-DSA-87 via `@noble/post-quantum` | ✅ |
| FIPS 203 (ML-KEM) | ML-KEM-512, ML-KEM-768, ML-KEM-1024 via `@noble/post-quantum` | ✅ |
| FIPS 180-4 (SHA-256) | Web Crypto API + `@noble/hashes` | ✅ |
| FIPS 205 (SLH-DSA) | SLH-DSA-128s via `@noble/post-quantum` | ✅ Tests / shell |
| RFC 9964 (did:jwk AKP) | `did:jwk` with `kty: "AKP"`, `alg: "ML-DSA-65"` | ✅ |
| RFC 9901 (SD-JWT) | Selective Disclosure JWT with salted disclosures | ✅ |
| FEP-8b32 (Object Integrity Proofs) | Ed25519 + ML-DSA-65 composite proofs | ✅ |
| W3C DID Core v1.1 | did:key, did:jwk, did:web resolution | ✅ |
| draft-ietf-lamp-xwing-00 | X-Wing hybrid KEM (ML-KEM-768 + X25519) | ✅ |
