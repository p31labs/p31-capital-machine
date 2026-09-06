# @p31/monetization-sdk

TypeScript SDK for the P31 Unified Monetization Engine.

## Installation

```bash
npm install @p31/monetization-sdk
```

## Usage

```typescript
import { RevenueLedgerClient, EntitlementClient, CapitalAllocatorClient } from '@p31/monetization-sdk';

const revenue = new RevenueLedgerClient('https://revenue-ledger.trimtab-signal.workers.dev');
const entitlement = new EntitlementClient('https://entitlement.trimtab-signal.workers.dev');
const allocator = new CapitalAllocatorClient('https://capital-allocator.trimtab-signal.workers.dev');

// Record revenue
await revenue.recordRevenue({
  source: 'x402',
  payer_did: 'did:key:user',
  merchant_did: 'did:key:merchant',
  amount_usdc: '10.00',
  asset: 'USDC',
});

// Check entitlement
const result = await entitlement.check('did:key:user', 'oasis_execute', '0.05');

// Allocate capital
await allocator.allocate({
  source_tx_id: 'tx-123',
  amount_usdc: '100.00',
  targets: [{ target: 'yield', weight: 1.0 }],
});
```

## API Reference

See inline documentation in source files.
