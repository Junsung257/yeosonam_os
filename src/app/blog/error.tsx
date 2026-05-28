'use client';

import { useEffect } from 'react';
import Link from 'next/link';
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
    <div className="min-h-[50vh] flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-orange-50 text-orange-700 text-sm font-mono">
          {def.code}
        </div>

        <div className="text-5xl">📝</div>

        <h1 className="text-xl font-bold text-gray-900">
          {def.message}
        </h1>

        <p className="text-sm text-gray-500">{def.action}</p>

        {(process.env.NODE_ENV === 'development' || error.digest) && (
          <details className="text-left bg-gray-50 rounded-lg p-4">
            <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600">
              기술 정보
            </summary>
            <pre className="mt-2 text-xs text-gray-500 whitespace-pre-wrap break-all max-h-48 overflow-auto">
              {error.digest && `Digest: ${error.digest}\n`}
              Code: {def.code}
              {error.stack && `\n\n${error.stack.split('\n').slice(0, 8).join('\n')}`}
            </pre>
          </details>
        )}

        <div className="flex gap-3 justify-center">
          <button
            onClick={reset}
            className="px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
          >
            다시 시도
          </button>
          <Link
            href="/blog"
            className="px-6 py-2.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors text-sm font-medium"
          >
            블로그 목록
          </Link>
        </div>
      </div>
    </div>
  );
}
