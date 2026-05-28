'use client';

import Link from 'next/link';
import { ErrorCodes, getErrorByCode } from '@/lib/error-codes';

interface Props {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function RootError({ error, reset }: Props) {
  // 에러 코드 추론 (커스텀 에러에 code가 있을 수 있음)
  const errCode = error && typeof error === 'object' && 'code' in error ? (error as { code: string }).code : undefined;
  const def = errCode ? getErrorByCode(errCode) : getErrorByCode('E1001');

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center space-y-6">
        {/* 에러 코드 뱃지 */}
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-red-50 text-red-700 text-sm font-mono">
          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          {def.code}
        </div>

        {/* 아이콘 */}
        <div className="text-5xl">⚠️</div>

        {/* 제목 */}
        <h1 className="text-xl font-bold text-gray-900">
          {def.message}
        </h1>

        {/* 설명 */}
        <p className="text-sm text-gray-500">{def.action}</p>

        {/* 기술 정보 (개발 환경에서만) */}
        {(process.env.NODE_ENV === 'development' || error.digest) && (
          <details className="text-left bg-gray-50 rounded-lg p-4">
            <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600">
              기술 정보
            </summary>
            <pre className="mt-2 text-xs text-gray-500 whitespace-pre-wrap break-all max-h-48 overflow-auto">
              {error.digest && `Digest: ${error.digest}\n`}
              Code: {def.code}
              {error.stack && `\n\n${error.stack.split('\n').slice(0, 10).join('\n')}`}
            </pre>
          </details>
        )}

        {/* 액션 버튼 */}
        <div className="flex gap-3 justify-center">
          {def.retryable && (
            <button
              onClick={reset}
              className="px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
            >
              다시 시도
            </button>
          )}
          <Link
            href="/"
            className="px-6 py-2.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors text-sm font-medium"
          >
            홈으로
          </Link>
        </div>
      </div>
    </div>
  );
}
