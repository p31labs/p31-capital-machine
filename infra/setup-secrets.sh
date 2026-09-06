#!/usr/bin/env bash
set -euo pipefail

echo "🔐 P31 Capital Machine — Secret Setup"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

MODULES=(
  "capital-machine"
  "yield-vault"
  "mev-arbitrage"
  "fundraising-agent"
  "auto-compounder"
  "cashback-collector"
  "ip-licensing"
  "micro-savings"
  "affiliate-fleet"
  "airdrop-harvester"
  "data-monetization"
)

declare -A SECRETS
SECRETS[capital-machine]="RPC_URL_ETH RPC_URL_BASE RPC_URL_ARB RPC_URL_SOL RPC_URL_COSMOS PRIVATE_KEY_ETH PRIVATE_KEY_SOL FLASHBOTS_RELAY JITO_TIP_KEY OPENAI_API_KEY DISCORD_WEBHOOK"
SECRETS[yield-vault]="RPC_URL_ETH RPC_URL_BASE RPC_URL_ARB PRIVATE_KEY_ETH AAVE_POOL_ADDRESS COMPOUND_COMPTROLLER MORPHO_VAULT_ADDRESS"
SECRETS[mev-arbitrage]="RPC_URL_ETH RPC_URL_BASE RPC_URL_SOL PRIVATE_KEY_ETH FLASHBOTS_RELAY JITO_TIP_KEY MIN_PROFIT_BPS"
SECRETS[fundraising-agent]="OPENAI_API_KEY DISCORD_WEBHOOK SCRAPINGBEE_API_KEY EMAIL_API_KEY"
SECRETS[auto-compounder]="RPC_URL_ETH RPC_URL_BASE RPC_URL_COSMOS PRIVATE_KEY_ETH WALLET_MNEMONIC"
SECRETS[cashback-collector]="RPC_URL_ETH RPC_URL_SOL PRIVATE_KEY_ETH PRIVATE_KEY_SOL"
SECRETS[ip-licensing]="RPC_URL_ETH PRIVATE_KEY_ETH"
SECRETS[micro-savings]="RPC_URL_ETH RPC_URL_BASE PRIVATE_KEY_ETH"
SECRETS[affiliate-fleet]="TWITTER_API_KEY TWITTER_API_SECRET TWITTER_ACCESS_TOKEN TWITTER_ACCESS_SECRET COINREBATE_API_KEY DISCORD_WEBHOOK"
SECRETS[airdrop-harvester]="RPC_URL_ETH RPC_URL_SOL PRIVATE_KEY_ETH PRIVATE_KEY_SOL"
SECRETS[data-monetization]="JWT_SECRET DISCORD_WEBHOOK"

# Shared secrets cache
declare -A SHARED_CACHE

get_value() {
  local key="$1"
  local prompt="$2"
  local hidden="${3:-true}"

  if [ -n "${SHARED_CACHE[$key]:-}" ]; then
    echo "${SHARED_CACHE[$key]}"
    return
  fi

  if [ "$hidden" = "true" ]; then
    read -s -p "$prompt: " value
    echo ""
  else
    read -p "$prompt: " value
  fi

  if [ -n "$value" ]; then
    SHARED_CACHE[$key]="$value"
  fi
  echo "$value"
}

setup_module_secrets() {
  local module="$1"
  local secrets="${SECRETS[$module]:-}"

  if [ -z "$secrets" ]; then
    return
  fi

  echo ""
  echo "📦 [$module]"
  echo "─────────────────"

  for secret in $secrets; do
    # Skip if this secret was already set for a previous module
    if [ -n "${SHARED_CACHE[$secret]:-}" ]; then
      echo "  ↳ $secret (using cached value)"
      echo "${SHARED_CACHE[$secret]}" | npx wrangler secret put "$secret" --name "$module" 2>/dev/null || true
      continue
    fi

    local prompt_text="  Enter $secret"
    if [[ "$secret" == *"KEY"* ]] || [[ "$secret" == *"SECRET"* ]] || [[ "$secret" == *"PRIVATE"* ]] || [[ "$secret" == *"PASSWORD"* ]] || [[ "$secret" == *"MNEMONIC"* ]]; then
      prompt_text="$prompt_text (hidden)"
      local val
      val=$(get_value "$secret" "$prompt_text" true)
    else
      prompt_text="$prompt_text (visible)"
      local val
      val=$(get_value "$secret" "$prompt_text" false)
    fi

    if [ -z "$val" ]; then
      echo "  ⚠️  Skipping $secret (empty)"
      continue
    fi

    SHARED_CACHE[$secret]="$val"
    echo "$val" | npx wrangler secret put "$secret" --name "$module" 2>/dev/null || {
      echo "  ⚠️  Failed to set $secret for $module"
    }
  done
}

# Main
echo ""
echo "This script will set up secrets for all capital-machine modules."
echo "Secrets shared across modules (e.g., RPC_URL_ETH) are cached and"
echo "only prompted once."
echo ""
echo "Press Enter to continue or Ctrl+C to cancel..."
read

# Check auth
echo ""
echo "Checking Cloudflare authentication..."
npx wrangler whoami 2>/dev/null || {
  echo "❌ Not authenticated. Run 'npx wrangler login' first."
  exit 1
}

# Check modules exist
echo ""
echo "Checking deployed Workers..."
for module in "${MODULES[@]}"; do
  npx wrangler deploy --name "$module" --dry-run 2>/dev/null || true
done

# Prompt for each module
TARGET="${1:-all}"
if [ "$TARGET" = "all" ]; then
  for module in "${MODULES[@]}"; do
    echo ""
    read -p "Set up secrets for [$module]? (Y/n): " confirm
    if [ "$confirm" != "n" ] && [ "$confirm" != "N" ]; then
      setup_module_secrets "$module"
    fi
  done
else
  setup_module_secrets "$TARGET"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Secret setup complete!"
echo ""
echo "To verify: npx wrangler secret list --name <module>"
echo "To redeploy: bash infra/deploy.sh <module> production"
