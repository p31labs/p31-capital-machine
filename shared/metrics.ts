export interface MetricPoint {
  name: string;
  value: number;
  tags?: Record<string, string>;
  timestamp: number;
}

export class MetricsCollector {
  private kv: KVNamespace;
  private module: string;
  private buffer: MetricPoint[] = [];
  private flushInterval: number;

  constructor(kv: KVNamespace, module: string, flushIntervalMs: number = 60000) {
    this.kv = kv;
    this.module = module;
    this.flushInterval = flushIntervalMs;
  }

  gauge(name: string, value: number, tags?: Record<string, string>) {
    this.buffer.push({ name, value, tags, timestamp: Date.now() });
  }

  increment(name: string, tags?: Record<string, string>) {
    this.buffer.push({ name, value: 1, tags, timestamp: Date.now() });
  }

  timing(name: string, durationMs: number, tags?: Record<string, string>) {
    this.buffer.push({ name: `${name}_ms`, value: durationMs, tags, timestamp: Date.now() });
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    const points = [...this.buffer];
    this.buffer = [];

    try {
      const key = `metrics:${this.module}:${Date.now()}`;
      await this.kv.put(key, JSON.stringify(points), {
        expirationTtl: 86400 * 7,
      });

      await this.aggregate(points);
    } catch {
      // If flush fails, add points back to buffer
      this.buffer.unshift(...points);
      if (this.buffer.length > 1000) {
        this.buffer = this.buffer.slice(-500);
      }
    }
  }

  private async aggregate(points: MetricPoint[]): Promise<void> {
    const aggregations: Record<string, { sum: number; count: number; min: number; max: number }> = {};

    for (const point of points) {
      const tagKey = point.tags
        ? `${point.name}:${Object.entries(point.tags).map(([k, v]) => `${k}=${v}`).join(',')}`
        : point.name;

      if (!aggregations[tagKey]) {
        aggregations[tagKey] = { sum: 0, count: 0, min: Infinity, max: -Infinity };
      }

      const agg = aggregations[tagKey];
      agg.sum += point.value;
      agg.count++;
      agg.min = Math.min(agg.min, point.value);
      agg.max = Math.max(agg.max, point.value);
    }

    const aggKey = `metrics_agg:${this.module}:${Math.floor(Date.now() / 3600000)}`;
    const existing = await this.kv.get(aggKey);
    const aggData = existing ? JSON.parse(existing) : {};

    for (const [key, val] of Object.entries(aggregations)) {
      if (!aggData[key]) {
        aggData[key] = val;
      } else {
        const existing = aggData[key];
        existing.sum += val.sum;
        existing.count += val.count;
        existing.min = Math.min(existing.min, val.min);
        existing.max = Math.max(existing.max, val.max);
      }
    }

    await this.kv.put(aggKey, JSON.stringify(aggData), {
      expirationTtl: 86400 * 30,
    });
  }

  startAutoFlush(): void {
    setInterval(() => this.flush(), this.flushInterval);
  }
}

export function createMetricsCollector(kv: KVNamespace, module: string): MetricsCollector {
  return new MetricsCollector(kv, module);
}
