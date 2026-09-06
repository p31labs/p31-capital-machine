#!/bin/bash
set -e

echo "=== P31 MCP Server Registry Submissions ==="
echo ""

# Step 1: Prepare HuggingFace dataset
echo ">>> Step 1: Preparing HuggingFace dataset..."
bash /home/p31/p31-capital-machine/observability/prepare-huggingface.sh
echo ""

# Step 2: Submit to Glama
echo ">>> Step 2: Submitting to Glama..."
bash /home/p31/p31-capital-machine/observability/submit-to-glama.sh
echo ""

# Step 3: Print AAIF instructions
echo ">>> Step 3: Official AAIF Registry..."
echo "  Create a PR at https://github.com/aaif/registry with content from:"
echo "  /home/p31/p31-capital-machine/observability/aaif-pr.md"
echo ""

echo "=== All Submissions Prepared ==="
