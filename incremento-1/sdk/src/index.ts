/**
 * LIBERVIA SDK
 *
 * SDK TypeScript para integração com a API Libervia.
 *
 * @example
 * ```typescript
 * import { createLiberviaClient } from '@libervia/sdk';
 *
 * const client = createLiberviaClient({
 *   baseUrl: 'http://localhost:3000',
 *   token: 'my-token',
 *   tenantId: 'acme'
 * });
 *
 * // Health check
 * const health = await client.health.check();
 *
 * // Query dashboard
 * const dashboard = await client.query.getDashboard('acme');
 * ```
 *
 * @packageDocumentation
 */

// Client
export {
  LiberviaClient,
  LiberviaClientOptions,
  RequestResult,
  createLiberviaClient
} from './client';

// Types
export * from './types';

// Errors
export {
  LiberviaError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  TenantConflictError,
  BadRequestError,
  ServerError,
  NetworkError,
  ResponseMetadata,
  createErrorFromResponse
} from './errors';
