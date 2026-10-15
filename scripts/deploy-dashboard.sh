#!/bin/bash
set -e

echo "=== Deploying Monetization Dashboard ==="
echo ""

DASHBOARD_DIR="$(cd "$(dirname "$0")/.." && pwd)/apps/monetization-dashboard"
PROJECT_NAME="monetization-dashboard"

cd "$DASHBOARD_DIR"

# Build the dashboard
echo ">>> Building dashboard..."
npm run build
echo "✓ Build complete"
echo ""

# Deploy to Cloudflare Pages
echo ">>> Deploying to Cloudflare Pages..."
wrangler pages project create "$PROJECT_NAME" --production-branch main 2>/dev/null || echo "Project may already exist"
wrangler pages deploy dist --project-name "$PROJECT_NAME" --commit-dirty=true
echo "✓ Deployed"
echo ""

echo "=== Dashboard Deployed ==="
echo "URL: https://monetization-dashboard.pages.dev"
echo "Custom domain: https://monetization.p31ca.org (configure in Cloudflare dashboard)"
