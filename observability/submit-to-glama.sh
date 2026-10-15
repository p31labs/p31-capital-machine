#!/bin/bash
set -e

echo "=== Submitting P31 MCP Servers to Glama ==="
echo ""

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

SERVERS=(
  "spaceship-earth.json:p31-spaceship"
  "crypto-mcp.json:p31-crypto"
  "design-mcp.json:p31-design"
)

for mapping in "${SERVERS[@]}"; do
  file="${mapping%:*}"
  name="${mapping#*:}"
  echo ">>> Submitting $name..."
  
  payload=$(cat "$ROOT/observability/glama-submissions/$file")
  
  # Glama API endpoint (update if actual endpoint differs)
  response=$(curl -s -X POST "https://glama.ai/api/mcp/servers" \
    -H "Content-Type: application/json" \
    -d "$payload" 2>&1) || true
  
  echo "  Response: $response"
  echo ""
done

echo "=== Glama Submission Complete ==="
echo ""
echo "Manual verification:"
echo "1. Check https://glama.ai/mcp/servers for your submissions"
echo "2. Verify server cards appear with correct metadata"
echo "3. Test tool discovery from each server"
