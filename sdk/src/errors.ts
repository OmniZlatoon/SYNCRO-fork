/**
 * Base error class for all Syncro SDK errors.
 */
export class SyncroError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "SyncroError";
    // Maintains proper stack trace for where error was thrown (V8 engines)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * Thrown when a requested resource is not found (HTTP 404).
 */
export class NotFoundError extends SyncroError {
  constructor(message: string = "Resource not found") {
    super(message, "NOT_FOUND");
    this.name = "NotFoundError";
  }
}

/**
 * Thrown when the API key is missing or invalid (HTTP 401).
 */
export class AuthenticationError extends SyncroError {
  constructor(message: string = "Authentication failed") {
    super(message, "AUTHENTICATION_ERROR");
    this.name = "AuthenticationError";
  }
}

/**
 * Thrown when the API rate limit is exceeded (HTTP 429).
 */
export class RateLimitError extends SyncroError {
  constructor(
    public readonly retryAfter: number,
    message: string = "Rate limit exceeded",
  ) {
    super(message, "RATE_LIMIT_EXCEEDED");
    this.name = "RateLimitError";
  }
}

/**
 * Thrown when request input fails validation (HTTP 400).
 */
export class ValidationError extends SyncroError {
  constructor(
    message: string = "Validation failed",
    public readonly field?: string,
  ) {
    super(message, "VALIDATION_ERROR");
    this.name = "ValidationError";
  }
}

/**
 * Maps HTTP status codes and API error codes to the appropriate SDK error class.
 * @param status HTTP status code from the response
 * @param message Error message
 * @param code Optional API error code string
 * @param retryAfter Optional Retry-After value in seconds (for 429)
 */
export function createApiError(
  status: number,
  message: string,
  code?: string,
  retryAfter?: number,
): SyncroError {
  switch (status) {
    case 401:
      return new AuthenticationError(message);
    case 404:
      return new NotFoundError(message);
    case 429:
      return new RateLimitError(retryAfter ?? 60, message);
    case 400:
      return new ValidationError(message);
    default:
      return new SyncroError(message, code ?? `HTTP_${status}`);
  }
}
