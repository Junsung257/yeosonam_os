'use client';

import { useEffect, type ReactNode } from 'react';
import * as Sentry from '@sentry/nextjs';

export default function FinancePrivacyBoundary({ children }: { children: ReactNode }) {
  useEffect(() => {
    // Financial screens keep error reporting but stop session replay before any ledger detail is inspected.
    const replay = Sentry.getReplay();
    void replay?.stop();
  }, []);

  return children;
}
