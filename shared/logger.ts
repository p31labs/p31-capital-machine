export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  module: string;
  message: string;
  data?: any;
  error?: string;
  durationMs?: number;
  requestId?: string;
}

export class Logger {
  private module: string;
  private env: string;

  constructor(module: string, env: string = 'production') {
    this.module = module;
    this.env = env;
  }

  private createEntry(level: LogLevel, message: string, data?: any, error?: Error): LogEntry {
    return {
      timestamp: new Date().toISOString(),
      level,
      module: this.module,
      message,
      data: data ? this.sanitize(data) : undefined,
      error: error?.message,
      requestId: crypto.randomUUID().slice(0, 8),
    };
  }

  debug(message: string, data?: any) {
    const entry = this.createEntry('debug', message, data);
    if (this.env !== 'production') {
      console.log(JSON.stringify(entry));
    }
  }

  info(message: string, data?: any) {
    const entry = this.createEntry('info', message, data);
    console.log(JSON.stringify(entry));
  }

  warn(message: string, data?: any, error?: Error) {
    const entry = this.createEntry('warn', message, data, error);
    console.warn(JSON.stringify(entry));
  }

  error(message: string, error?: Error, data?: any) {
    const entry = this.createEntry('error', message, data, error);
    console.error(JSON.stringify(entry));
  }

  timed<T>(message: string, fn: () => Promise<T>, data?: any): Promise<T> {
    const start = Date.now();
    return fn()
      .then(result => {
        this.info(message, { ...data, durationMs: Date.now() - start });
        return result;
      })
      .catch(err => {
        this.error(`${message} failed`, err, { ...data, durationMs: Date.now() - start });
        throw err;
      });
  }

  private sanitize(data: any): any {
    if (!data || typeof data !== 'object') return data;
    const sanitized = { ...data };
    const sensitiveKeys = ['key', 'secret', 'password', 'token', 'private', 'mnemonic', 'api_key'];
    for (const key of Object.keys(sanitized)) {
      if (sensitiveKeys.some(sk => key.toLowerCase().includes(sk))) {
        sanitized[key] = '***REDACTED***';
      }
    }
    return sanitized;
  }
}

export function createLogger(module: string, env?: string): Logger {
  return new Logger(module, env);
}
