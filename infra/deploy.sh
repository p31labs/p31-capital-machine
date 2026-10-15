#!/usr/bin/env bash
set -euo pipefail

# ─── P31 Capital Machine - One-Shot Deployment ───────────────────
# Usage: ./infra/deploy.sh [module] [env]
#   module: all | capital-machine | yield-vault | mev | compounder | btcpay | alerting
#   env:    production | staging (default: production)
#
# Every module deploys from its own wrangler.toml so D1/KV bindings, crons,
# observability, and vars survive the deploy. Stub/scaffold workers
# (cashback-collector, airdrop-harvester, fundraising-agent, ip-licensing,
# micro-savings, affiliate-fleet, data-monetization) are intentionally NOT
# deployable here until they are real (docs/fix-plans/
# capital-machine-stub-workers-in-deploy-path).

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

# ─── Deploy a single module Worker using its own wrangler.toml ──
deploy_module() {
  local config="$1"
  local env_flag=""

  if [ "$ENV" != "production" ]; then
    env_flag="--env $ENV"
  fi

  echo "📦 Deploying [$(basename "$config")]..."
  npx wrangler deploy --config "$config" $env_flag
}

# ─── Modules map ─────────────────────────────────────────────────
case "$MODULE" in
  all)
    setup_infra
    deploy_module "${ROOT}/workers/capital-machine/wrangler.toml"
    deploy_module "${ROOT}/workers/yield-vault/wrangler.toml"
    deploy_module "${ROOT}/workers/mev-arbitrage/wrangler.toml"
    deploy_module "${ROOT}/workers/auto-compounder/wrangler.toml"
    deploy_module "${ROOT}/workers/btcpay-gateway/wrangler.toml"
    deploy_module "${ROOT}/workers/alerting/wrangler.toml"
    echo "✅ All live modules deployed!"
    ;;

  capital-machine) deploy_module "${ROOT}/workers/capital-machine/wrangler.toml" ;;
  yield-vault)     deploy_module "${ROOT}/workers/yield-vault/wrangler.toml" ;;
  mev)             deploy_module "${ROOT}/workers/mev-arbitrage/wrangler.toml" ;;
  compounder)      deploy_module "${ROOT}/workers/auto-compounder/wrangler.toml" ;;
  btcpay)          deploy_module "${ROOT}/workers/btcpay-gateway/wrangler.toml" ;;
  alerting)        deploy_module "${ROOT}/workers/alerting/wrangler.toml" ;;

  *)
    echo "❌ Unknown module: $MODULE"
    echo "Usage: $0 [all|capital-machine|yield-vault|mev|compounder|btcpay|alerting] [production|staging]"
    exit 1
    ;;
esac

# ─── Print deployed endpoints ────────────────────────────────────
echo ""
echo "📊 Deployment Summary [$ENV]"
echo "─────────────────────────────────"
case "$MODULE" in
  all|capital-machine) echo "  Capital Machine: https://capital-machine.trimtab-signal.workers.dev" ;;
esac
case "$MODULE" in
  all|yield-vault)     echo "  Yield Vault:     https://yield-vault.trimtab-signal.workers.dev" ;;
esac
case "$MODULE" in
  all|mev)             echo "  MEV Engine:      https://mev-arbitrage.trimtab-signal.workers.dev" ;;
esac
case "$MODULE" in
  all|compounder)      echo "  Compounder:      https://p31-auto-compounder.trimtab-signal.workers.dev" ;;
esac
case "$MODULE" in
  all|btcpay)          echo "  BTCPay Gateway:  https://btcpay-gateway.trimtab-signal.workers.dev" ;;
esac
case "$MODULE" in
  all|alerting)        echo "  Alerting:        https://monetization-alerting.trimtab-signal.workers.dev" ;;
esac
echo "─────────────────────────────────"
echo "✨ Done!"