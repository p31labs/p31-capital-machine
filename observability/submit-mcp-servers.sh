#!/bin/bash
set -e

echo "=== P31 MCP Server Registry Submissions ==="
echo ""

# Glama submissions
echo ">>> Submitting to Glama..."
for file in glama-submissions/*.json; do
  echo "  Submitting $(basename $file)..."
  # Glama API endpoint (hypothetical — adjust based on actual API)
  curl -s -X POST "https://glama.ai/api/mcp/servers" \
    -H "Content-Type: application/json" \
    -d "@$file" \
    | jq -r '.id // "submitted"' \
    || echo "  Failed to submit $(basename $file)"
done
echo ""

# AAIF Registry
echo ">>> Submitting to Official AAIF Registry..."
# AAIF uses GitHub PRs — open PR with aaif-submission.md content
echo "  Create PR at https://github.com/aaif/registry"
echo ""

# HuggingFace
echo ">>> Uploading to HuggingFace MCP dataset..."
if [ -z "$HF_TOKEN" ]; then
  echo "  Skipped (set HF_TOKEN env var)"
else
  ./huggingface-upload.sh "$HF_TOKEN"
fi
echo ""

echo "=== Submissions Complete ==="
