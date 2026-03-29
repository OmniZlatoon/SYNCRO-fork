/**
 * Logger Interface for SDK Observability
 * Provides structured logging for request lifecycle, retries, reconnects, and batch operations.
 */

export interface Logger {
  /**
   * Log informational messages
   */
  info(message: string, meta?: Record<string, unknown>): void;

  /**
   * Log warning messages
   */
  warn(message: string, meta?: Record<string, unknown>): void;

  /**
   * Log error messages
   */
  error(message: string, meta?: Record<string, unknown>): void;

  /**
   * Log debug messages
   */
  debug(message: string, meta?: Record<string, unknown>): void;
}

/**
 * Default silent logger - no console output, safe for production
 */
export const silentLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

/**
 * Console logger - outputs to console
 * Useful for development environments
 */
export function createConsoleLogger(): Logger {
  return {
    info: (message: string, meta?: Record<string, unknown>) => {
      console.log(`[INFO] ${message}`, meta || '');
    },
    warn: (message: string, meta?: Record<string, unknown>) => {
      console.warn(`[WARN] ${message}`, meta || '');
    },
    error: (message: string, meta?: Record<string, unknown>) => {
      console.error(`[ERROR] ${message}`, meta || '');
    },
    debug: (message: string, meta?: Record<string, unknown>) => {
      console.debug(`[DEBUG] ${message}`, meta || '');
    },
  };
}

/**
 * Custom logger factory
 * Creates a logger by combining multiple logger instances
 */
export function createCompositeLogger(loggers: Logger[]): Logger {
  return {
    info: (message: string, meta?: Record<string, unknown>) => {
      loggers.forEach((logger) => logger.info(message, meta));
    },
    warn: (message: string, meta?: Record<string, unknown>) => {
      loggers.forEach((logger) => logger.warn(message, meta));
    },
    error: (message: string, meta?: Record<string, unknown>) => {
      loggers.forEach((logger) => logger.error(message, meta));
    },
    debug: (message: string, meta?: Record<string, unknown>) => {
      loggers.forEach((logger) => logger.debug(message, meta));
    },
  };
}
