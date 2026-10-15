#!/bin/bash
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "=== P31 MCP Server Registry Submissions ==="
echo ""

# Step 1: Prepare HuggingFace dataset
echo ">>> Step 1: Preparing HuggingFace dataset..."
bash "$ROOT/observability/prepare-huggingface.sh"
echo ""

# Step 2: Submit to Glama
echo ">>> Step 2: Submitting to Glama..."
bash "$ROOT/observability/submit-to-glama.sh"
echo ""

# Step 3: Print AAIF instructions
echo ">>> Step 3: Official AAIF Registry..."
echo "  Create a PR at https://github.com/aaif/registry with content from:"
echo "  $ROOT/observability/aaif-pr.md"
echo ""

echo "=== All Submissions Prepared ==="
