#!/bin/bash
set -e

SERVICES=(
  "https://revenue-ledger.trimtab-signal.workers.dev/health"
  "https://entitlement.trimtab-signal.workers.dev/health"
  "https://capital-allocator.trimtab-signal.workers.dev/health"
)

echo "=== Monetization Engine Health Check ==="
echo ""

FAILED=0
for url in "${SERVICES[@]}"; do
  echo -n "Checking $url... "
  if curl -s -o /dev/null -w "%{http_code}" "$url" | grep -q "200"; then
    echo "✓ OK"
  else
    echo "✗ FAILED"
    FAILED=$((FAILED + 1))
  fi
done

echo ""
if [ $FAILED -eq 0 ]; then
  echo "All services healthy ✓"
  exit 0
else
  echo "$FAILED service(s) failing ✗"
  exit 1
fi
