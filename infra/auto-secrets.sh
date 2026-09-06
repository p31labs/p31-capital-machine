#!/usr/bin/env bash
set -euo pipefail

echo "🔐 P31 Capital Machine — Auto Secrets Setup"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ─── Source existing env files ────────────────────────────────────────
P31_ENV="/home/p31/.p31/.env"
PAYLIX_ENV="/home/p31/andromeda/software/crypto-processors/paylix/.env"
CRYPTO_ENV="/home/p31/andromeda/software/crypto-processors/.env"

set -a
[ -f "$P31_ENV" ]   && source "$P31_ENV"
[ -f "$PAYLIX_ENV" ] && source "$PAYLIX_ENV"
[ -f "$CRYPTO_ENV" ] && source "$CRYPTO_ENV"
set +a

# ─── Derive / generate secrets ────────────────────────────────────────
RPC_URL_ETH="${ETHEREUM_SEPOLIA_RPC_URL:-https://ethereum-sepolia.publicnode.com}"
RPC_URL_BASE="https://base-sepolia.publicnode.com"
RPC_URL_ARB="https://arbitrum-sepolia.publicnode.com"
RPC_URL_SOL="https://api.testnet.solana.com"
RPC_URL_COSMOS="https://rpc.cosmos.network"

PRIVATE_KEY_ETH="${TESTNET_DEPLOYER_PRIVATE_KEY:-0x3679ffa2ea727847a2f1858467d4e132b2dc44f56ab90eb59818885f2397e29a}"
PRIVATE_KEY_SOL=""
FLASHBOTS_RELAY="https://relay.flashbots.net"
JITO_TIP_KEY=""
MIN_PROFIT_BPS="200"

OPENAI_API_KEY="${OPENROUTER_API_KEY:-}"
DISCORD_WEBHOOK="${DISCORD_WEBHOOK_URL:-}"
SCRAPINGBEE_API_KEY=""
EMAIL_API_KEY=""

TWITTER_API_KEY="${TWITTER_API_KEY:-}"
TWITTER_API_SECRET="${TWITTER_API_SECRET:-}"
TWITTER_ACCESS_TOKEN="${TWITTER_ACCESS_TOKEN:-}"
TWITTER_ACCESS_SECRET="${TWITTER_ACCESS_TOKEN_SECRET:-}"
COINREBATE_API_KEY=""

JWT_SECRET="p31_$(openssl rand -hex 32)"

WALLET_MNEMONIC="test test test test test test test test test test test junk"

AAVE_POOL_ADDRESS_ETH="0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2"
COMPOUND_COMPTROLLER="0x3d9819210A31b4961b30EF54bE2aeD79B9c9Cd3B"
MORPHO_VAULT_ADDRESS="0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb"

echo ""
echo "📋 Derived Secrets:"
echo "  RPC_URL_ETH:        ${RPC_URL_ETH:0:50}..."
echo "  PRIVATE_KEY_ETH:    ${PRIVATE_KEY_ETH:0:20}..."
echo "  DISCORD_WEBHOOK:    ${DISCORD_WEBHOOK:0:40}..."
echo "  OPENAI_API_KEY:     ${OPENAI_API_KEY:0:20}..."
echo "  TWITTER_API_KEY:    ${TWITTER_API_KEY:0:20}..."
echo "  JWT_SECRET:         ${JWT_SECRET:0:20}..."

# ─── Set a secret on a module ────────────────────────────────────────
set_secret() {
  local module="$1" key="$2" value="$3"
  if [ -z "$value" ]; then
    echo "  ⚠️  Skipping $key for $module (empty)"
    return
  fi
  echo "$value" | npx wrangler secret put "$key" --name "$module" 2>/dev/null && \
    echo "  ✅ $key → $module" || \
    echo "  ⚠️  Failed to set $key on $module"
}

# ─── capital-machine (orchestrator) ──────────────────────────────────
echo ""
echo "📦 [capital-machine]"
set_secret "capital-machine" "RPC_URL_ETH" "$RPC_URL_ETH"
set_secret "capital-machine" "RPC_URL_BASE" "$RPC_URL_BASE"
set_secret "capital-machine" "RPC_URL_ARB" "$RPC_URL_ARB"
set_secret "capital-machine" "RPC_URL_SOL" "$RPC_URL_SOL"
set_secret "capital-machine" "RPC_URL_COSMOS" "$RPC_URL_COSMOS"
set_secret "capital-machine" "PRIVATE_KEY_ETH" "$PRIVATE_KEY_ETH"
set_secret "capital-machine" "PRIVATE_KEY_SOL" "$PRIVATE_KEY_SOL"
set_secret "capital-machine" "FLASHBOTS_RELAY" "$FLASHBOTS_RELAY"
set_secret "capital-machine" "JITO_TIP_KEY" "$JITO_TIP_KEY"
set_secret "capital-machine" "OPENAI_API_KEY" "$OPENAI_API_KEY"
set_secret "capital-machine" "DISCORD_WEBHOOK" "$DISCORD_WEBHOOK"

# ─── yield-vault ─────────────────────────────────────────────────────
echo ""
echo "📦 [yield-vault]"
set_secret "yield-vault" "RPC_URL_ETH" "$RPC_URL_ETH"
set_secret "yield-vault" "RPC_URL_BASE" "$RPC_URL_BASE"
set_secret "yield-vault" "RPC_URL_ARB" "$RPC_URL_ARB"
set_secret "yield-vault" "PRIVATE_KEY_ETH" "$PRIVATE_KEY_ETH"
set_secret "yield-vault" "AAVE_POOL_ADDRESS" "$AAVE_POOL_ADDRESS_ETH"
set_secret "yield-vault" "COMPOUND_COMPTROLLER" "$COMPOUND_COMPTROLLER"
set_secret "yield-vault" "MORPHO_VAULT_ADDRESS" "$MORPHO_VAULT_ADDRESS"

# ─── mev-arbitrage ───────────────────────────────────────────────────
echo ""
echo "📦 [mev-arbitrage]"
set_secret "mev-arbitrage" "RPC_URL_ETH" "$RPC_URL_ETH"
set_secret "mev-arbitrage" "RPC_URL_BASE" "$RPC_URL_BASE"
set_secret "mev-arbitrage" "RPC_URL_SOL" "$RPC_URL_SOL"
set_secret "mev-arbitrage" "PRIVATE_KEY_ETH" "$PRIVATE_KEY_ETH"
set_secret "mev-arbitrage" "FLASHBOTS_RELAY" "$FLASHBOTS_RELAY"
set_secret "mev-arbitrage" "JITO_TIP_KEY" "$JITO_TIP_KEY"
set_secret "mev-arbitrage" "MIN_PROFIT_BPS" "$MIN_PROFIT_BPS"

# ─── fundraising-agent ───────────────────────────────────────────────
echo ""
echo "📦 [fundraising-agent]"
set_secret "fundraising-agent" "OPENAI_API_KEY" "$OPENAI_API_KEY"
set_secret "fundraising-agent" "DISCORD_WEBHOOK" "$DISCORD_WEBHOOK"
set_secret "fundraising-agent" "SCRAPINGBEE_API_KEY" "$SCRAPINGBEE_API_KEY"
set_secret "fundraising-agent" "EMAIL_API_KEY" "$EMAIL_API_KEY"

# ─── auto-compounder ─────────────────────────────────────────────────
echo ""
echo "📦 [auto-compounder]"
set_secret "auto-compounder" "RPC_URL_ETH" "$RPC_URL_ETH"
set_secret "auto-compounder" "RPC_URL_BASE" "$RPC_URL_BASE"
set_secret "auto-compounder" "RPC_URL_COSMOS" "$RPC_URL_COSMOS"
set_secret "auto-compounder" "PRIVATE_KEY_ETH" "$PRIVATE_KEY_ETH"
set_secret "auto-compounder" "WALLET_MNEMONIC" "$WALLET_MNEMONIC"

# ─── cashback-collector ──────────────────────────────────────────────
echo ""
echo "📦 [cashback-collector]"
set_secret "cashback-collector" "RPC_URL_ETH" "$RPC_URL_ETH"
set_secret "cashback-collector" "RPC_URL_SOL" "$RPC_URL_SOL"
set_secret "cashback-collector" "PRIVATE_KEY_ETH" "$PRIVATE_KEY_ETH"
set_secret "cashback-collector" "PRIVATE_KEY_SOL" "$PRIVATE_KEY_SOL"

# ─── ip-licensing ────────────────────────────────────────────────────
echo ""
echo "📦 [ip-licensing]"
set_secret "ip-licensing" "RPC_URL_ETH" "$RPC_URL_ETH"
set_secret "ip-licensing" "PRIVATE_KEY_ETH" "$PRIVATE_KEY_ETH"

# ─── micro-savings ───────────────────────────────────────────────────
echo ""
echo "📦 [micro-savings]"
set_secret "micro-savings" "RPC_URL_ETH" "$RPC_URL_ETH"
set_secret "micro-savings" "RPC_URL_BASE" "$RPC_URL_BASE"
set_secret "micro-savings" "PRIVATE_KEY_ETH" "$PRIVATE_KEY_ETH"

# ─── affiliate-fleet ─────────────────────────────────────────────────
echo ""
echo "📦 [affiliate-fleet]"
set_secret "affiliate-fleet" "TWITTER_API_KEY" "$TWITTER_API_KEY"
set_secret "affiliate-fleet" "TWITTER_API_SECRET" "$TWITTER_API_SECRET"
set_secret "affiliate-fleet" "TWITTER_ACCESS_TOKEN" "$TWITTER_ACCESS_TOKEN"
set_secret "affiliate-fleet" "TWITTER_ACCESS_SECRET" "$TWITTER_ACCESS_SECRET"
set_secret "affiliate-fleet" "COINREBATE_API_KEY" "$COINREBATE_API_KEY"
set_secret "affiliate-fleet" "DISCORD_WEBHOOK" "$DISCORD_WEBHOOK"

# ─── airdrop-harvester ───────────────────────────────────────────────
echo ""
echo "📦 [airdrop-harvester]"
set_secret "airdrop-harvester" "RPC_URL_ETH" "$RPC_URL_ETH"
set_secret "airdrop-harvester" "RPC_URL_SOL" "$RPC_URL_SOL"
set_secret "airdrop-harvester" "PRIVATE_KEY_ETH" "$PRIVATE_KEY_ETH"
set_secret "airdrop-harvester" "PRIVATE_KEY_SOL" "$PRIVATE_KEY_SOL"

# ─── data-monetization ───────────────────────────────────────────────
echo ""
echo "📦 [data-monetization]"
set_secret "data-monetization" "JWT_SECRET" "$JWT_SECRET"
set_secret "data-monetization" "DISCORD_WEBHOOK" "$DISCORD_WEBHOOK"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Auto-secrets complete!"
echo ""
echo "To verify:"
echo "  npx wrangler secret list --name capital-machine"
echo ""
echo "To redeploy (picks up new secrets):"
echo "  bash infra/deploy.sh all production"
