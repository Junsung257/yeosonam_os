'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';
import PublicErrorState from '@/components/customer/PublicErrorState';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (typeof process !== 'undefined' && process.env.NODE_ENV === 'production') {
      Sentry.captureException(error);
    } else {
      console.error('[GlobalError]', error);
    }
  }, [error]);

  return (
    <html lang="ko">
      <body>
        <PublicErrorState
          error={error}
          code="E1001"
          title="페이지를 불러오는 중 문제가 발생했습니다"
          action="잠시 후 다시 시도해주세요"
          reset={reset}
          minHeightClassName="min-h-screen"
        />
      </body>
    </html>
  );
}
