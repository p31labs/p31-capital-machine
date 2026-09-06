export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitter?: boolean;
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  jitter: true,
};

export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: RetryOptions
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;

      if (attempt === opts.maxAttempts) {
        throw error;
      }

      const delay = calculateDelay(attempt, opts);
      console.warn(`[Retry] Attempt ${attempt}/${opts.maxAttempts} failed: ${error.message}. Retrying in ${delay}ms`);
      await sleep(delay);
    }
  }

  throw lastError!;
}

export async function withRetryAndFallback<T>(
  fn: () => Promise<T>,
  fallback: T,
  options?: RetryOptions
): Promise<T> {
  try {
    return await withRetry(fn, options);
  } catch {
    return fallback;
  }
}

function calculateDelay(attempt: number, opts: Required<RetryOptions>): number {
  const exponential = Math.min(
    opts.baseDelayMs * Math.pow(2, attempt - 1),
    opts.maxDelayMs
  );

  if (!opts.jitter) return exponential;

  const jitterAmount = exponential * 0.2;
  return exponential + Math.random() * jitterAmount;
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function withTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number
): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`Operation timed out after ${timeoutMs}ms`)), timeoutMs);
  });

  return Promise.race([fn(), timeoutPromise]);
}
