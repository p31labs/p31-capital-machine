#!/bin/bash
set -e

echo "=== Honeycomb Observability Setup ==="
echo ""

WORKERS=(
  "workers/revenue-ledger/wrangler.toml:p31-revenue-ledger"
  "workers/entitlement/wrangler.toml:p31-entitlement"
  "workers/capital-allocator/wrangler.toml:p31-capital-allocator"
)

BASE_DIR="$(cd "$(dirname "$0")/.." && pwd)"

for mapping in "${WORKERS[@]}"; do
  config="${mapping%:*}"
  dataset="${mapping#*:}"
  
  echo ">>> Configuring $dataset..."
  
  echo ""
  echo "  Run this command to set your Honeycomb API key:"
  echo "  cd $BASE_DIR/$(dirname $config)"
  echo "  wrangler secret put HONEYCOMB_API_KEY"
  echo ""
  echo "  Then paste your Honeycomb API key when prompted."
  echo ""
done

echo "=== Setup Complete ==="
echo ""
echo "Verify spans are flowing:"
echo "1. Open https://app.honeycomb.io"
echo "2. Select your dataset ($dataset)"
echo "3. Check that spans appear within 1-2 minutes of traffic"
echo ""
echo "Datasets to create in Honeycomb:"
for mapping in "${WORKERS[@]}"; do
  dataset="${mapping#*:}"
  echo "  - $dataset"
done
