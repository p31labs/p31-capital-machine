import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CapitalAllocatorClient } from './capital-allocator';

describe('CapitalAllocatorClient', () => {
  let client: CapitalAllocatorClient;

  beforeEach(() => {
    client = new CapitalAllocatorClient('https://capital-allocator.trimtab-signal.workers.dev');
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ allocations: [{ id: '1', amount: '100', target: 'yield', status: 'pending', created_at: 1234567890 }] }),
    });
  });

  it('should allocate capital', async () => {
    const result = await client.allocate({
      source_tx_id: 'tx-123',
      amount_usdc: '100.00',
      targets: [{ target: 'yield', weight: 1.0 }],
    });
    expect(result.allocations).toHaveLength(1);
  });

  it('should get ROI', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ yield: 150, mev: 42 }),
    });
    const roi = await client.getRoi('30d');
    expect(roi.yield).toBe(150);
  });
});
