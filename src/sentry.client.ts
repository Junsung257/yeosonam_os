import * as Sentry from '@sentry/nextjs';

export function initSentry() {
  if (typeof window === 'undefined') return;

  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.NODE_ENV,
    integrations: [
      new Sentry.Replay({
        maskAllText: true,
        blockAllMedia: true,
      }),
    ],
    // 성능 샘플링: 프로덕션 10%, 개발 50%
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 0.5,
    // 세션 리플레이: 에러 발생 시 100%, 일반 세션 10%
    replaysOnErrorSampleRate: 1.0,
    replaysSessionSampleRate: 0.1,
    // 에러 필터링: 자체 에러만 추적
    beforeSend: (event, hint) => {
      // 개발 환경에서는 콘솔 에러만 보내기
      if (process.env.NODE_ENV === 'development') {
        console.error('Sentry:', hint.originalException);
      }
      return event;
    },
  });
}

export { Sentry };
