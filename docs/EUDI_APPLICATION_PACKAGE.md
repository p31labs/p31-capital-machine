# EUDI Wallet Sandbox Application Package

## Package Contents

1. **Organization Information**
   - Name: P31 Labs
   - Website: https://p31ca.org
   - Contact: trimtab.signal@proton.me
   - Country: [Your country]

2. **Technical Implementation Summary**
   - DID Core v1.0 compliant (did:key, did:jwk, did:web)
   - W3C VC Data Model with SD-JWT (RFC 9901)
   - Ed25519 + ML-DSA-65 hybrid signatures
   - Status-List-2021 revocation
   - Cloudflare Workers runtime

3. **API Endpoints**
   - `GET https://federation.p31ca.org/.well-known/did.json`
   - `POST https://federation.p31ca.org/credential/issue`
   - `POST https://federation.p31ca.org/credential/verify`
   - `GET https://federation.p31ca.org/credential/revocation/list`

4. **Test Plan**
   - See `tests/eudi-sandbox.test.ts`
   - See `docs/EUDI_SANDBOX_APPLICATION.md`

5. **Compatibility Matrix**
   - See `docs/EUDI_COMPATIBILITY_MATRIX.md`
