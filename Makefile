.PHONY: test deploy clean preflight go-live rollback smoke

test:
	pnpm run test:unit
	pnpm run test:integration

preflight:
	bash scripts/preflight.sh

go-live:
	bash scripts/go-live.sh

rollback:
	bash scripts/rollback.sh

smoke:
	bash scripts/test-payment-flow.sh

deploy-revenue-ledger:
	cd infra && wrangler deploy --config wrangler.revenue-ledger.toml

deploy-entitlement:
	cd workers/entitlement && wrangler deploy

deploy-allocator:
	cd workers/capital-allocator && wrangler deploy

deploy-dashboard:
	cd apps/monetization-dashboard && npm run build && wrangler pages project upload monetization-dashboard

deploy-all: deploy-revenue-ledger deploy-entitlement deploy-allocator deploy-dashboard

clean:
	rm -rf node_modules/.cache .astro dist
