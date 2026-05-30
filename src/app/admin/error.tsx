'use client';

import { getErrorByCode } from '@/lib/error-codes';

interface Props {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function AdminError({ error, reset }: Props) {
  const errCode = error && typeof error === 'object' && 'code' in error ? (error as { code: string }).code : undefined;
  const def = errCode ? getErrorByCode(errCode) : getErrorByCode('E2001');

  return (
    <div className="min-h-[50vh] flex items-center justify-center px-4 p-8">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-red-50 text-red-700 text-sm font-mono">
          {def.code}
        </div>

        <div className="text-5xl">⚙️</div>

        <h1 className="text-xl font-bold text-gray-900">
          관리자 페이지 오류
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
          <a
            href="/admin"
            className="px-6 py-2.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors text-sm font-medium"
          >
            대시보드로
          </a>
        </div>
      </div>
    </div>
  );
}
