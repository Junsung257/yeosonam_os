import * as Sentry from '@sentry/nextjs';
import { scrubSentryEvent } from './src/lib/telemetry/sentry-scrubber';

const SENTRY_DSN = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: process.env.NODE_ENV,
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.05 : 1.0,
    beforeSend(event: Sentry.ErrorEvent) {
      return scrubSentryEvent(event);
    },
  });
}
