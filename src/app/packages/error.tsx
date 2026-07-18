'use client';

import PublicErrorState from '@/components/customer/PublicErrorState';
import { getErrorByCode } from '@/lib/error-codes';

interface Props {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function PackagesError({ error, reset }: Props) {
  const errCode = error && typeof error === 'object' && 'code' in error ? (error as { code: string }).code : undefined;
  const def = errCode ? getErrorByCode(errCode) : getErrorByCode('E1213');

  return (
    <PublicErrorState
      error={error}
      code={def.code}
      title={def.message}
      action={def.action ?? '잠시 후 다시 시도해주세요'}
      reset={reset}
    />
  );
}
