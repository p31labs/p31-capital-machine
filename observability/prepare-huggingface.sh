#!/bin/bash
set -e

echo "=== Preparing HuggingFace MCP Dataset Upload ==="
echo ""

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

DATASET_DIR="$ROOT/observability/huggingface-dataset"
mkdir -p "$DATASET_DIR"

# Copy server metadata
for file in "$ROOT"/observability/glama-submissions/*.json; do
  server_name=$(basename "$file" .json)
  cp "$file" "$DATASET_DIR/$server_name.json"
  echo "  Prepared: $server_name.json"
done

# Create dataset README
cat > "$DATASET_DIR/README.md" << 'EOF'
# P31 MCP Servers

Official MCP server registry for P31 Labs.

## Servers

- `spaceship-earth.json` — Spaceship control system
- `crypto-mcp.json` — Post-quantum crypto operations
- `design-mcp.json` — Quantum design system

## Usage

Upload these files to your HuggingFace dataset repository.
EOF

echo ""
echo "=== Dataset prepared at: $DATASET_DIR ==="
echo ""
echo "To upload to HuggingFace:"
echo "  export HF_TOKEN=<your-huggingface-token>"
echo "  bash $ROOT/observability/huggingface-upload.sh $HF_TOKEN"
