import * as Sentry from '@sentry/nextjs';

export function initSentryServer() {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV,
    // 서버 성능 샘플링: 낮게 설정 (비용 절감)
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 0.3,
    // 에러만 기록
    sampleRate: 1.0,
    integrations: [
      Sentry.httpIntegration(),
    ],
  });
}

// API 라우트에서 사용할 에러 캡처
export function captureException(error: unknown, context?: Record<string, any>) {
  Sentry.captureException(error, {
    contexts: {
      api: context,
    },
  });
}

// API 라우트에서 사용할 메시지 로깅
export function captureMessage(message: string, level: 'info' | 'warning' | 'error' = 'info') {
  Sentry.captureMessage(message, level);
}

export { Sentry };
