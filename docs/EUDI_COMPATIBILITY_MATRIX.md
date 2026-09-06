# EUDI Wallet Compatibility Matrix

## P31 Components vs EUDI Requirements

| EUDI Requirement | P31 Implementation | Status | Gap |
|------------------|-------------------|--------|-----|
| DID Core v1.0 | did:key, did:jwk, did:web | ✅ Complete | None |
| W3C VC Data Model | SD-JWT VCs (RFC 9901) | ✅ Complete | None |
| Selective Disclosure | SD-JWT salted disclosures | ✅ Complete | None |
| Ed25519 Signatures | Web Crypto API | ✅ Complete | None |
| ML-DSA-65 (PQC) | @noble/post-quantum | ✅ Complete | None |
| Status-List-2021 | Bitstring revocation | ✅ Complete | None |
| EBSI Credential Types | Custom pilot schemas | ⚠️ Partial | Add EBSI schemas |
| DID Web Publication | HTTPS resolution | ⚠️ In Progress | Add content-type header |
| EUDI Wallet App | Not tested | ❌ Missing | Integration testing |
