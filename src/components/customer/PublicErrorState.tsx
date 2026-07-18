'use client';

import { AlertTriangle } from 'lucide-react';

type PublicError = Error & { digest?: string };

interface PublicErrorStateProps {
  error: PublicError;
  code: string;
  title: string;
  action: string;
  reset?: () => void;
  retryable?: boolean;
  homeHref?: string;
  homeLabel?: string;
  minHeightClassName?: string;
  accentClassName?: string;
}

export function getPublicErrorDebugText(
  error: PublicError,
  environment: string | undefined = process.env.NODE_ENV,
): string | null {
  if (environment !== 'development') return null;
  return [error.message, error.stack].filter(Boolean).join('\n\n');
}

function getErrorReference(error: PublicError): string | null {
  const safeDigest = error.digest?.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 8);
  return safeDigest || null;
}

export default function PublicErrorState({
  error,
  code,
  title,
  action,
  reset,
  retryable = true,
  homeHref = '/',
  homeLabel = '홈으로',
  minHeightClassName = 'min-h-[50vh]',
  accentClassName = 'bg-red-50 text-red-700',
}: PublicErrorStateProps) {
  const reference = getErrorReference(error);
  const debugText = getPublicErrorDebugText(error);

  return (
    <div className={`${minHeightClassName} flex items-center justify-center px-4 py-12`} role="alert">
      <div className="w-full max-w-md space-y-6 text-center">
        <div className={`inline-flex items-center gap-2 rounded-full px-3 py-1 font-mono text-sm ${accentClassName}`}>
          {code}
        </div>

        <AlertTriangle className="mx-auto h-12 w-12 text-amber-500" aria-hidden="true" />

        <div className="space-y-2">
          <h1 className="text-xl font-bold text-gray-900">{title}</h1>
          <p className="text-sm text-gray-500">{action}</p>
          {reference && (
            <p className="text-xs text-gray-400">오류 참조: {reference}</p>
          )}
        </div>

        {debugText && (
          <details className="rounded-lg bg-gray-50 p-4 text-left">
            <summary className="cursor-pointer text-xs text-gray-400 hover:text-gray-600">
              개발용 기술 정보
            </summary>
            <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all text-xs text-gray-500">
              {debugText}
            </pre>
          </details>
        )}

        <div className="flex flex-wrap justify-center gap-3">
          {retryable && reset && (
            <button
              type="button"
              onClick={reset}
              className="rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700"
            >
              다시 시도
            </button>
          )}
          <a
            href={homeHref}
            className="rounded-lg bg-gray-100 px-6 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200"
          >
            {homeLabel}
          </a>
        </div>
      </div>
    </div>
  );
}
