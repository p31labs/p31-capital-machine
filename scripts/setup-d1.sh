#!/bin/bash
set -e

echo "=== Creating D1 Databases ==="

# Revenue Ledger DB
echo "Creating revenue-db..."
wrangler d1 create revenue-db --config workers/revenue-ledger/wrangler.toml 2>/dev/null || echo "revenue-db may already exist"

# Entitlement DB
echo "Creating entitlement-db..."
wrangler d1 create entitlement-db --config workers/entitlement/wrangler.toml 2>/dev/null || echo "entitlement-db may already exist"

# Capital Allocator DB
echo "Creating allocator-db..."
wrangler d1 create allocator-db --config workers/capital-allocator/wrangler.toml 2>/dev/null || echo "allocator-db may already exist"

echo "=== Applying Migrations ==="

# Apply revenue ledger migration
echo "Applying revenue ledger migration..."
wrangler d1 execute REVENUE_DB --remote --config workers/revenue-ledger/wrangler.toml --file infra/migrations/002_revenue_ledger.sql 2>/dev/null || echo "Migration may already be applied"

# Apply entitlement migration
echo "Applying entitlement migration..."
wrangler d1 execute ENTITLEMENT_DB --remote --config workers/entitlement/wrangler.toml --file workers/entitlement/migration.sql 2>/dev/null || echo "Migration may already be applied"

# Apply allocator migration
echo "Applying allocator migration..."
wrangler d1 execute ALLOCATOR_DB --remote --config workers/capital-allocator/wrangler.toml --file workers/capital-allocator/migration.sql 2>/dev/null || echo "Migration may already be applied"

echo "=== D1 Setup Complete ==="
