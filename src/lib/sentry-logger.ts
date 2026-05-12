/**
 * Sentry error logging helper
 * Replaces console.error calls with structured error tracking
 *
 * Usage: import { logError } from '@/lib/sentry-logger';
 *        logError('context', error, { extra data });
 */

import * as Sentry from '@sentry/nextjs';

export interface ErrorContext {
  userId?: string;
  bookingId?: string;
  customerId?: string;
  tenantId?: string;
  [key: string]: unknown;
}

/**
 * Log error to Sentry with context
 */
export function logError(
  message: string,
  error?: Error | unknown,
  context?: ErrorContext,
  level: 'error' | 'warning' = 'error'
): void {
  // Always log to console in development
  const isDev = process.env.NODE_ENV === 'development';
  if (isDev) {
    const consoleMethod = level === 'warning' ? 'warn' : 'error';
    console[consoleMethod](message, error);
  }

  try {
    // Log to Sentry if configured
    if (Sentry && typeof Sentry.captureException === 'function') {
      if (error instanceof Error) {
        Sentry.captureException(error, {
          level,
          tags: { context: message },
          extra: context,
        });
      } else if (error) {
        Sentry.captureException(new Error(message), {
          level,
          tags: { context: message },
          extra: { ...context, originalError: error },
        });
      } else {
        Sentry.captureMessage(message, { level, tags: { context: message }, extra: context });
      }
    }
  } catch (sentryError) {
    // Fail silently if Sentry is not available
    if (isDev) {
      console.warn('[sentry-logger] Failed to report to Sentry:', sentryError);
    }
  }
}

/**
 * Capture exception with automatic context extraction
 */
export function captureError(error: Error, context?: Partial<ErrorContext>): void {
  logError('Uncaught error', error, context);
}

/**
 * Log warning-level error
 */
export function logWarning(message: string, error?: Error | unknown, context?: ErrorContext): void {
  logError(message, error, context, 'warning');
}
