/**
 * LIBERVIA SDK - Erros
 *
 * Erros tipados para tratamento de falhas da API.
 */

import { ErrorCode, LiberviaErrorResponse } from './types';

/**
 * Metadados da resposta HTTP
 */
export interface ResponseMetadata {
  /** Status HTTP */
  status: number;
  /** ID de rastreabilidade (X-Request-Id) */
  requestId?: string;
  /** Headers da resposta */
  headers: Record<string, string>;
}

/**
 * Erro base do SDK Libervia
 */
export class LiberviaError extends Error {
  /** Status HTTP */
  public readonly status: number;
  /** Código estruturado do erro */
  public readonly code?: ErrorCode | string;
  /** ID de rastreabilidade */
  public readonly requestId?: string;
  /** Resposta original do servidor */
  public readonly response?: LiberviaErrorResponse;

  constructor(
    message: string,
    status: number,
    code?: ErrorCode | string,
    requestId?: string,
    response?: LiberviaErrorResponse
  ) {
    super(message);
    this.name = 'LiberviaError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.response = response;

    // Mantém stack trace correto em V8
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, LiberviaError);
    }
  }

  /**
   * Formata erro para log
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      status: this.status,
      code: this.code,
      requestId: this.requestId
    };
  }
}

/**
 * Erro de autenticação (401)
 */
export class UnauthorizedError extends LiberviaError {
  constructor(message: string, requestId?: string, response?: LiberviaErrorResponse) {
    super(message, 401, response?.code || 'MISSING_TOKEN', requestId, response);
    this.name = 'UnauthorizedError';
  }
}

/**
 * Erro de permissão (403)
 */
export class ForbiddenError extends LiberviaError {
  constructor(message: string, requestId?: string, response?: LiberviaErrorResponse) {
    super(message, 403, response?.code || 'INSUFFICIENT_ROLE', requestId, response);
    this.name = 'ForbiddenError';
  }
}

/**
 * Erro de recurso não encontrado (404)
 */
export class NotFoundError extends LiberviaError {
  constructor(message: string, requestId?: string, response?: LiberviaErrorResponse) {
    super(message, 404, response?.code || 'NOT_FOUND', requestId, response);
    this.name = 'NotFoundError';
  }
}

/**
 * Erro de conflito de tenant (400)
 */
export class TenantConflictError extends LiberviaError {
  constructor(message: string, requestId?: string, response?: LiberviaErrorResponse) {
    super(message, 400, 'TENANT_CONFLICT', requestId, response);
    this.name = 'TenantConflictError';
  }
}

/**
 * Erro de requisição inválida (400)
 */
export class BadRequestError extends LiberviaError {
  constructor(message: string, requestId?: string, response?: LiberviaErrorResponse) {
    super(message, 400, response?.code, requestId, response);
    this.name = 'BadRequestError';
  }
}

/**
 * Erro de servidor (5xx)
 */
export class ServerError extends LiberviaError {
  constructor(message: string, status: number, requestId?: string, response?: LiberviaErrorResponse) {
    super(message, status, response?.code, requestId, response);
    this.name = 'ServerError';
  }
}

/**
 * Erro de rede/conexão
 */
export class NetworkError extends LiberviaError {
  public readonly cause?: Error;

  constructor(message: string, cause?: Error) {
    super(message, 0, 'NETWORK_ERROR');
    this.name = 'NetworkError';
    this.cause = cause;
  }
}

/**
 * Cria erro apropriado baseado no status HTTP
 */
export function createErrorFromResponse(
  status: number,
  body: LiberviaErrorResponse,
  requestId?: string
): LiberviaError {
  const message = body.message || body.error || 'Unknown error';

  switch (status) {
    case 401:
      return new UnauthorizedError(message, requestId, body);
    case 403:
      return new ForbiddenError(message, requestId, body);
    case 404:
      return new NotFoundError(message, requestId, body);
    case 400:
      if (body.code === 'TENANT_CONFLICT') {
        return new TenantConflictError(message, requestId, body);
      }
      return new BadRequestError(message, requestId, body);
    default:
      if (status >= 500) {
        return new ServerError(message, status, requestId, body);
      }
      return new LiberviaError(message, status, body.code, requestId, body);
  }
}
