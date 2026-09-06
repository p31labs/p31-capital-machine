# Honeycomb Observability Setup

## 1. Create Honeycomb Account
Sign up at https://honeycomb.io (free tier available)

## 2. Create Datasets
Create 3 datasets:
- `p31-revenue-ledger`
- `p31-entitlement`
- `p31-capital-allocator`

## 3. Set API Key
Run for each worker:
```bash
cd /path/to/worker
wrangler secret put HONEYCOMB_API_KEY
# Enter your Honeycomb API key
```

## 4. Verify
Check that spans appear in Honeycomb within 1-2 minutes of traffic.
