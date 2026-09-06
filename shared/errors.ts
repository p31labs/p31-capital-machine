export class CapitalMachineError extends Error {
  public readonly code: string;
  public readonly module: string;
  public readonly recoverable: boolean;
  public readonly retryable: boolean;

  constructor(params: {
    code: string;
    message: string;
    module: string;
    recoverable?: boolean;
    retryable?: boolean;
    cause?: Error;
  }) {
    super(params.message);
    this.name = 'CapitalMachineError';
    this.code = params.code;
    this.module = params.module;
    this.recoverable = params.recoverable ?? false;
    this.retryable = params.retryable ?? false;
    if (params.cause) {
      this.cause = params.cause;
    }
  }

  static rpc(module: string, message: string, cause?: Error): CapitalMachineError {
    return new CapitalMachineError({
      code: 'RPC_ERROR',
      message,
      module,
      recoverable: true,
      retryable: true,
      cause,
    });
  }

  static rateLimit(module: string, message?: string): CapitalMachineError {
    return new CapitalMachineError({
      code: 'RATE_LIMITED',
      message: message || 'Rate limit exceeded',
      module,
      recoverable: true,
      retryable: true,
    });
  }

  static auth(module: string, message?: string): CapitalMachineError {
    return new CapitalMachineError({
      code: 'AUTH_ERROR',
      message: message || 'Authentication failed',
      module,
      recoverable: false,
      retryable: false,
    });
  }

  static notFound(module: string, resource: string): CapitalMachineError {
    return new CapitalMachineError({
      code: 'NOT_FOUND',
      message: `${resource} not found`,
      module,
      recoverable: false,
      retryable: false,
    });
  }

  static validation(module: string, message: string): CapitalMachineError {
    return new CapitalMachineError({
      code: 'VALIDATION_ERROR',
      message,
      module,
      recoverable: false,
      retryable: false,
    });
  }

  static insufficientFunds(module: string, message?: string): CapitalMachineError {
    return new CapitalMachineError({
      code: 'INSUFFICIENT_FUNDS',
      message: message || 'Insufficient funds for transaction',
      module,
      recoverable: true,
      retryable: false,
    });
  }
}

export function isRetryable(error: Error): boolean {
  if (error instanceof CapitalMachineError) {
    return error.retryable;
  }
  const retryableMessages = [
    'timeout', 'econnrefused', 'econnreset', 'etimedout',
    'network', 'rate limit', 'too many requests', 429, 503,
  ];
  const msg = error.message.toLowerCase();
  return retryableMessages.some((m: any) => msg.includes(m));
}

export function toJSON(error: Error): Record<string, any> {
  if (error instanceof CapitalMachineError) {
    return {
      code: error.code,
      message: error.message,
      module: error.module,
      recoverable: error.recoverable,
      retryable: error.retryable,
      cause: error.cause ? toJSON(error.cause as Error) : undefined,
    };
  }
  return {
    code: 'UNKNOWN_ERROR',
    message: error.message,
  };
}
