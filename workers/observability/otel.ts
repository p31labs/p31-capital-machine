export interface SpanOptions {
  service: string;
  operation: string;
  attributes?: Record<string, string | number>;
}

interface TelemetryBackend {
  url: string;
  dataset?: string;
  apiKey?: string;
}

let backend: TelemetryBackend | null = null;

export function configureBackend(config: TelemetryBackend) {
  backend = config;
}

export function configureFromEnv(env: Record<string, string | undefined>) {
  const honeycombKey = env.HONEYCOMB_API_KEY;
  const honeycombDataset = env.HONEYCOMB_DATASET || 'p31-workers';
  const axiomUrl = env.AXIOM_URL;
  const axiomToken = env.AXIOM_TOKEN;
  const axiomDataset = env.AXIOM_DATASET || 'p31-workers';

  if (honeycombKey) {
    configureBackend({
      url: 'https://api.honeycomb.io',
      dataset: honeycombDataset,
      apiKey: honeycombKey,
    });
  } else if (axiomUrl && axiomToken) {
    configureBackend({
      url: axiomUrl,
      dataset: axiomDataset,
      apiKey: axiomToken,
    });
  }
}

export async function startSpan(options: SpanOptions): Promise<{ end: () => void }> {
  const startTime = Date.now();

  return {
    end: () => {
      const duration = Date.now() - startTime;
      const span = {
        type: 'span',
        service: options.service,
        operation: options.operation,
        duration_ms: duration,
        attributes: options.attributes,
        timestamp: new Date().toISOString(),
      };

      console.log(JSON.stringify(span));

      if (backend) {
        shipToBackend(span);
      }
    },
  };
}

export function recordMetric(name: string, value: number, tags?: Record<string, string>) {
  const metric = {
    type: 'metric',
    name,
    value,
    tags,
    timestamp: new Date().toISOString(),
  };

  console.log(JSON.stringify(metric));

  if (backend) {
    shipToBackend(metric);
  }
}

async function shipToBackend(payload: Record<string, any>) {
  if (!backend) return;

  try {
    if (backend.url.includes('axiom.co')) {
      await fetch(backend.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${backend.apiKey}`,
          'X-Axiom-Dataset': backend.dataset || 'p31-workers',
        },
        body: JSON.stringify([payload]),
      });
    } else if (backend.url.includes('honeycomb.io')) {
      await fetch(`${backend.url}/1/events/${backend.dataset}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Honeycomb-Team': backend.apiKey,
        },
        body: JSON.stringify([{
          ...payload,
          service_name: payload.service || 'unknown',
        }]),
      });
    }
  } catch {
    // Telemetry backend unreachable — fail silently
  }
}
