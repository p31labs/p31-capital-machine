#!/bin/bash
# Upload P31 MCP server metadata to HuggingFace MCP dataset

HF_DATASET="p31labs/mcp-servers"
HF_TOKEN=$1

if [ -z "$HF_TOKEN" ]; then
  echo "Usage: ./huggingface-upload.sh <HF_TOKEN>"
  exit 1
fi

# Create dataset repo if it doesn't exist
curl -X POST "https://huggingface.co/api/datasets" \
  -H "Authorization: Bearer $HF_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "p31labs/mcp-servers", "description": "P31 Labs MCP server registry"}' \
  || echo "Dataset may already exist"

# Upload server metadata
for file in glama-submissions/*.json; do
  server_name=$(basename "$file" .json)
  curl -X POST "https://huggingface.co/api/datasets/p31labs/mcp-servers/upload/$server_name.json" \
    -H "Authorization: Bearer $HF_TOKEN" \
    -H "Content-Type: application/json" \
    -d "@$file" \
    || echo "Upload failed for $server_name"
done

echo "Upload complete"
