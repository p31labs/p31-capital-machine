export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
  timestamp: number;
  requestId: string;
}

export class Responder {
  private corsHeaders: Record<string, string>;

  constructor(origin: string = '*') {
    this.corsHeaders = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
      'Access-Control-Max-Age': '86400',
    };
  }

  handleOptions(): Response {
    return new Response(null, {
      status: 204,
      headers: this.corsHeaders,
    });
  }

  ok<T>(data: T, status: number = 200): Response {
    const body: ApiResponse<T> = {
      success: true,
      data,
      timestamp: Date.now(),
      requestId: crypto.randomUUID().slice(0, 12),
    };
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json', ...this.corsHeaders },
    });
  }

  created<T>(data: T): Response {
    return this.ok(data, 201);
  }

  error(message: string, status: number = 500, code?: string): Response {
    const body: ApiResponse = {
      success: false,
      error: message,
      code,
      timestamp: Date.now(),
      requestId: crypto.randomUUID().slice(0, 12),
    };
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json', ...this.corsHeaders },
    });
  }

  badRequest(message: string): Response {
    return this.error(message, 400, 'BAD_REQUEST');
  }

  notFound(message: string = 'Resource not found'): Response {
    return this.error(message, 404, 'NOT_FOUND');
  }

  rateLimited(message: string = 'Rate limit exceeded'): Response {
    return new Response(JSON.stringify({
      success: false,
      error: message,
      code: 'RATE_LIMITED',
      timestamp: Date.now(),
      requestId: crypto.randomUUID().slice(0, 12),
    }), {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': '60',
        ...this.corsHeaders,
      },
    });
  }

  unauthorized(message: string = 'Unauthorized'): Response {
    return this.error(message, 401, 'UNAUTHORIZED');
  }

  forbidden(message: string = 'Forbidden'): Response {
    return this.error(message, 403, 'FORBIDDEN');
  }
}

export const respond = new Responder();
