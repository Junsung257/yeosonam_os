'use client';

import { useEffect } from 'react';
import PublicErrorState from '@/components/customer/PublicErrorState';
import { getErrorByCode } from '@/lib/error-codes';

interface Props {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function BlogError({ error, reset }: Props) {
  const errCode = error && typeof error === 'object' && 'code' in error ? (error as { code: string }).code : undefined;
  const def = errCode ? getErrorByCode(errCode) : getErrorByCode('E1401');

  useEffect(() => {
    // 브라우저에서 에러 스택을 DB에 기록 (report만, 페이지 흐름 차단 안 함)
    const digest = error.digest;
    const stack = error.stack;
    if (digest && typeof fetch === 'function') {
      fetch('/api/blog/report-error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ digest, stack: stack?.slice(0, 2000), code: def.code }),
      }).catch(() => { /* noop */ });
    }
  }, [error, def.code]);

  return (
    <PublicErrorState
      error={error}
      code={def.code}
      title={def.message}
      action={def.action ?? '잠시 후 다시 시도해주세요'}
      reset={reset}
      homeHref="/blog"
      homeLabel="블로그 목록"
      accentClassName="bg-orange-50 text-orange-700"
    />
  );
}
