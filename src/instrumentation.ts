export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('../sentry.server.config');

    // 환경변수 누락 체크 (개발 서버 시작 시 경고)
    try {
      const { checkMissingEnvVars } = await import('@/lib/env-check');
      checkMissingEnvVars();
    } catch {
      // env-check 실패해도 서버 시작은 계속
    }

    // OpenTelemetry — Vercel OTel 자동 export.
    // Vercel 배포 환경에서는 OTel collector 가 자동 활성화 (수동 endpoint 불필요).
    // 로컬/타사 환경은 OTEL_EXPORTER_OTLP_ENDPOINT 설정 시 동작.
    try {
      const { registerOTel } = await import('@vercel/otel');
      registerOTel({
        serviceName: process.env.OTEL_SERVICE_NAME || 'yeosonam-os',
      });
    } catch (e) {
      console.warn('[instrumentation] OTel 등록 실패 (Sentry 만 동작):', e instanceof Error ? e.message : String(e));
    }
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('../sentry.edge.config');
  }
}
