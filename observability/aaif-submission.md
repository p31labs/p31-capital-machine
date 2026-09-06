# AAIF Registry Submission: P31 MCP Servers

## Servers

### 1. p31-spaceship-earth
- **URL**: https://spaceship-earth.trimtab-signal.workers.dev/mcp
- **Protocol**: MCP 2026-07-28 Streamable HTTP
- **Tools**: 16 (DUNA status, system health, dome structure, NeoPixel control, PQC keygen/sign/verify, KEM encapsulate/decapsulate, EUDI export/verify, session list/export, embedding store/search, mesh peers/sync)
- **Description**: Spaceship control system for P31 sovereign infrastructure — dome geometry, DUNA readiness, post-quantum crypto, EUDI Wallet VC 2.1, semantic search, mesh networking

### 2. p31-crypto-mcp
- **URL**: https://p31-crypto-mcp.trimtab-signal.workers.dev/mcp
- **Protocol**: MCP 2026-07-28 Streamable HTTP
- **Tools**: 12 (PQC keygen/sign/verify, KEM encapsulate/decapsulate, SD-JWT issue/present, Taler withdraw/pay, x402 request/accept, PQC audit)
- **Description**: Post-quantum cryptographic operations — ML-DSA-65 (FIPS 204), ML-KEM-768 (FIPS 203), SD-JWT (RFC 9901), GNU Taler blind-signed payments, x402 micropayments

### 3. p31-design-mcp
- **URL**: stdio (local CLI: `node cli/design-mcp-server.js`)
- **Protocol**: MCP 2026-07-28 (stdio transport)
- **Tools**: 8 (token resolve, component schema, component usage, token list, layout generate, validate component, audit tokens, suggest fix)
- **Description**: P31 quantum design system — DTCG token resolution, component schemas, usage audit, layout generation, validation, WCAG compliance, auto-fix suggestions
