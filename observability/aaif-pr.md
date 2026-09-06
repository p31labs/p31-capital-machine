# Add P31 MCP Servers to Official Registry

## Servers to Add

### 1. p31-spaceship
- **URL**: https://spaceship-earth.trimtab-signal.workers.dev/mcp
- **Protocol**: MCP 2026-07-28 Streamable HTTP
- **Tools**: 16
- **Description**: Spaceship control system for P31 sovereign infrastructure

### 2. p31-crypto
- **URL**: https://p31-crypto-mcp.trimtab-signal.workers.dev/mcp
- **Protocol**: MCP 2026-07-28 Streamable HTTP
- **Tools**: 12
- **Description**: Post-quantum cryptographic operations (ML-DSA-65, ML-KEM-768, SD-JWT)

### 3. p31-design
- **URL**: https://p31-design-mcp.trimtab-signal.workers.dev/mcp
- **Protocol**: MCP 2026-07-28 Streamable HTTP
- **Tools**: 23
- **Description**: P31 quantum design system MCP server

## Implementation

```json
{
  "servers": [
    {
      "name": "p31-spaceship",
      "url": "https://spaceship-earth.trimtab-signal.workers.dev/mcp",
      "transport": "streamable-http",
      "protocolVersion": "2026-07-28"
    },
    {
      "name": "p31-crypto",
      "url": "https://p31-crypto-mcp.trimtab-signal.workers.dev/mcp",
      "transport": "streamable-http",
      "protocolVersion": "2026-07-28"
    },
    {
      "name": "p31-design",
      "url": "https://p31-design-mcp.trimtab-signal.workers.dev/mcp",
      "transport": "streamable-http",
      "protocolVersion": "2026-07-28"
    }
  ]
}
```
