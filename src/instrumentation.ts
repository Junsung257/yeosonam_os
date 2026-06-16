export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    if (process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN) {
      await import('../sentry.server.config');
    }

    try {
      const { checkMissingEnvVars } = await import('@/lib/env-check');
      checkMissingEnvVars();
    } catch {
      // Env diagnostics must never block a serverless cold start.
    }

    if (process.env.VERCEL || process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
      try {
        const { registerOTel } = await import('@vercel/otel');
        registerOTel({
          serviceName: process.env.OTEL_SERVICE_NAME || 'yeosonam-os',
        });
      } catch (error) {
        console.warn('[instrumentation] OTel registration failed:', error instanceof Error ? error.message : String(error));
      }
    }
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    if (process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN) {
      await import('../sentry.edge.config');
    }
  }
}
