# P31 Capital Machine - Secrets Reference

Set each secret with: `echo "<value>" | npx wrangler secret put <KEY> --name <module>`

## Shared Secrets (capital-machine orchestrator)

| Secret | Description | Required |
|--------|-------------|----------|
| `RPC_URL_ETH` | Ethereum mainnet RPC URL | For yield vault + MEV |
| `RPC_URL_BASE` | Base L2 RPC URL | For yield vault |
| `RPC_URL_ARB` | Arbitrum RPC URL | For yield vault |
| `RPC_URL_SOL` | Solana RPC URL | For MEV + staking |
| `RPC_URL_COSMOS` | Cosmos RPC URL | For staking |
| `PRIVATE_KEY_ETH` | Ethereum wallet private key | For tx signing |
| `PRIVATE_KEY_SOL` | Solana wallet private key (base58) | For Solana tx signing |
| `FLASHBOTS_RELAY` | Flashbots relay URL | For MEV bundles |
| `JITO_TIP_KEY` | Jito tip payment key | For Solana MEV |
| `OPENAI_API_KEY` | OpenAI API key | For AI lead scoring |
| `DISCORD_WEBHOOK` | Discord webhook URL | For notifications |
| `EMAIL_API_KEY` | SendGrid / Resend API key | For email outreach |
| `TWITTER_API_KEY` | Twitter API v2 key | For affiliate bots |
| `TWITTER_API_SECRET` | Twitter API v2 secret | For affiliate bots |
| `TWITTER_ACCESS_TOKEN` | Twitter access token | For affiliate bots |
| `TWITTER_ACCESS_SECRET` | Twitter access secret | For affiliate bots |

## Module-Specific Secrets

### yield-vault
| Secret | Description |
|--------|-------------|
| `AAVE_POOL_ADDRESS` | Aave pool contract address |
| `COMPOUND_COMPTROLLER` | Compound comptroller address |
| `MORPHO_VAULT_ADDRESS` | Morpho vault address |

### mev-arbitrage
| Secret | Description |
|--------|-------------|
| `FLASHBOTS_RELAY` | Flashbots relay URL |
| `JITO_BLOCK_ENGINE` | Jito block engine URL |
| `MIN_PROFIT_BPS` | Minimum profit basis points to execute |

### fundraising-agent
| Secret | Description |
|--------|-------------|
| `OPENAI_API_KEY` | OpenAI API key |
| `SCRAPINGBEE_API_KEY` | ScrapingBee API key (for GoFundMe) |
| `APIFY_API_KEY` | Apify API key (for web scraping) |

### affiliate-fleet
| Secret | Description |
|--------|-------------|
| `TWITTER_API_KEY` | Twitter API v2 key |
| `TWITTER_API_SECRET` | Twitter API v2 secret |
| `TWITTER_ACCESS_TOKEN` | Twitter access token |
| `TWITTER_ACCESS_SECRET` | Twitter access secret |
| `COINREBATE_API_KEY` | CoinRebate API key |

### data-monetization
| Secret | Description |
|--------|-------------|
| `JWT_SECRET` | JWT signing secret for API keys |

## Setting Secrets via Script

```bash
# Set all secrets at once (you'll be prompted)
for secret in RPC_URL_ETH RPC_URL_BASE RPC_URL_ARB RPC_URL_SOL RPC_URL_COSMOS \
              PRIVATE_KEY_ETH PRIVATE_KEY_SOL \
              FLASHBOTS_RELAY JITO_TIP_KEY \
              OPENAI_API_KEY DISCORD_WEBHOOK; do
  echo "Enter $secret:"
  read -s value
  echo "$value" | npx wrangler secret put "$secret" --name capital-machine
done
```

## Rotating Secrets

1. Generate new key
2. Set new value: `echo "<new_value>" | npx wrangler secret put <KEY> --name <module>`
3. Redeploy: `npx wrangler deploy --name <module>`
4. Verify: `npx wrangler secret list --name <module>`
5. Revoke old key at source
