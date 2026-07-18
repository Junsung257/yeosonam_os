'use client';

import PublicErrorState from '@/components/customer/PublicErrorState';
import { getErrorByCode } from '@/lib/error-codes';

interface Props {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function RootError({ error, reset }: Props) {
  // 에러 코드 추론 (커스텀 에러에 code가 있을 수 있음)
  const errCode = error && typeof error === 'object' && 'code' in error ? (error as { code: string }).code : undefined;
  const def = errCode ? getErrorByCode(errCode) : getErrorByCode('E1001');

  return (
    <PublicErrorState
      error={error}
      code={def.code}
      title={def.message}
      action={def.action ?? '잠시 후 다시 시도해주세요'}
      reset={reset}
      retryable={def.retryable}
      minHeightClassName="min-h-[60vh]"
    />
  );
}
