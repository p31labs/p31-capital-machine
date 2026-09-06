#!/usr/bin/env bash
set -euo pipefail

# ─── P31 Capital Machine - One-Shot Deployment ───────────────────
# Usage: ./infra/deploy.sh [module] [env]
#   module: all | orchestrator | dashboard | yield-vault | mev | fundraising | compounder
#           | cashback | ip-licensing | micro-savings | affiliate | airdrop | data
#   env:    production | staging (default: production)

MODULE="${1:-all}"
ENV="${2:-production}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "🚀 P31 Capital Machine — Deploying [$MODULE] to [$ENV]"

# ─── Setup: Create D1 + KV if not exists ────────────────────────
setup_infra() {
  echo "🔧 Checking infrastructure..."

  # Create D1 database if missing
  if ! npx wrangler d1 list 2>/dev/null | grep -q capital-db; then
    echo "Creating D1 database..."
    npx wrangler d1 create capital-db
  fi

  # Create KV namespace if missing
  if ! npx wrangler kv:namespace list 2>/dev/null | grep -q CAPITAL_KV; then
    echo "Creating KV namespace..."
    npx wrangler kv:namespace create "CAPITAL_KV"
  fi

  # Apply schema migrations
  echo "Applying D1 migrations..."
  npx wrangler d1 execute capital-db --remote --file="${ROOT}/infra/migrations/001_schema.sql"

  # Seed default data
  if [ -f "${ROOT}/infra/seed.sql" ]; then
    echo "Seeding default data..."
    npx wrangler d1 execute capital-db --remote --file="${ROOT}/infra/seed.sql"
  fi
}

# ─── Deploy a single module Worker ──────────────────────────────
deploy_module() {
  local name="$1"
  local source="$2"
  local env_flag=""

  if [ "$ENV" != "production" ]; then
    env_flag="--env $ENV"
  fi

  echo "📦 Deploying [$name]..."
  npx wrangler deploy "$source" \
    --name "$name" \
    --compatibility-date 2026-01-01 \
    --compatibility-flags nodejs_compat \
    $env_flag
}

# ─── Modules map ─────────────────────────────────────────────────
case "$MODULE" in
  all)
    setup_infra
    deploy_module "capital-machine" "${ROOT}/workers/capital-machine/index.ts"
    deploy_module "dashboard" "${ROOT}/workers/dashboard/index.ts"
    deploy_module "yield-vault" "${ROOT}/workers/yield-vault/index.ts"
    deploy_module "mev-arbitrage" "${ROOT}/workers/mev-arbitrage/index.ts"
    deploy_module "fundraising-agent" "${ROOT}/workers/fundraising-agent/index.ts"
    deploy_module "auto-compounder" "${ROOT}/workers/auto-compounder/index.ts"
    deploy_module "cashback-collector" "${ROOT}/workers/cashback-collector/index.ts"
    deploy_module "ip-licensing" "${ROOT}/workers/ip-licensing/index.ts"
    deploy_module "micro-savings" "${ROOT}/workers/micro-savings/index.ts"
    deploy_module "affiliate-fleet" "${ROOT}/workers/affiliate-fleet/index.ts"
    deploy_module "airdrop-harvester" "${ROOT}/workers/airdrop-harvester/index.ts"
    deploy_module "data-monetization" "${ROOT}/workers/data-monetization/index.ts"
    echo "✅ All modules deployed!"
    ;;

  orchestrator)
    setup_infra
    deploy_module "capital-machine" "${ROOT}/workers/capital-machine/index.ts"
    ;;

  dashboard)
    setup_infra
    deploy_module "dashboard" "${ROOT}/workers/dashboard/index.ts"
    ;;

  yield-vault|mev|fundraising|compounder|cashback|ip-licensing|micro-savings|affiliate|airdrop|data)
    setup_infra
    deploy_module "$MODULE" "${ROOT}/workers/${MODULE}/index.ts"
    ;;

  *)
    echo "❌ Unknown module: $MODULE"
    echo "Usage: $0 [all|orchestrator|dashboard|yield-vault|mev|fundraising|compounder|cashback|ip-licensing|micro-savings|affiliate|airdrop|data] [production|staging]"
    exit 1
    ;;
esac

# ─── Print deployed endpoints ────────────────────────────────────
echo ""
echo "📊 Deployment Summary [$ENV]"
echo "─────────────────────────────────"
case "$MODULE" in
  all|orchestrator)  echo "  Orchestrator:  https://capital-machine.trimtab-signal.workers.dev" ;;
esac
case "$MODULE" in
  all|dashboard)    echo "  Dashboard:     https://dashboard.trimtab-signal.workers.dev" ;;
esac
case "$MODULE" in
  all|yield-vault)   echo "  Yield Vault:   https://yield-vault.trimtab-signal.workers.dev" ;;
esac
case "$MODULE" in
  all|mev)           echo "  MEV Engine:    https://mev-arbitrage.trimtab-signal.workers.dev" ;;
esac
case "$MODULE" in
  all|fundraising)   echo "  Fundraising:   https://fundraising-agent.trimtab-signal.workers.dev" ;;
esac
case "$MODULE" in
  all|compounder)    echo "  Compounder:    https://auto-compounder.trimtab-signal.workers.dev" ;;
esac
case "$MODULE" in
  all|cashback)      echo "  Cashback:      https://cashback-collector.trimtab-signal.workers.dev" ;;
esac
case "$MODULE" in
  all|ip-licensing)  echo "  IP Licensing:  https://ip-licensing.trimtab-signal.workers.dev" ;;
esac
case "$MODULE" in
  all|micro-savings) echo "  Micro-Savings: https://micro-savings.trimtab-signal.workers.dev" ;;
esac
case "$MODULE" in
  all|affiliate)     echo "  Affiliate:     https://affiliate-fleet.trimtab-signal.workers.dev" ;;
esac
case "$MODULE" in
  all|airdrop)       echo "  Airdrop:       https://airdrop-harvester.trimtab-signal.workers.dev" ;;
esac
case "$MODULE" in
  all|data)          echo "  Data API:      https://data-monetization.trimtab-signal.workers.dev" ;;
esac
echo "─────────────────────────────────"
echo "✨ Done!"
