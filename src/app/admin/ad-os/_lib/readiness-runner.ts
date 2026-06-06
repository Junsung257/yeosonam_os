'use client';

import { useCallback } from 'react';
import type { ActionFlagKey } from './action-flags';

export type AdOsReadinessCheckRequest<T> = {
  flag: ActionFlagKey;
  fetchResult: () => Promise<T>;
  onSuccess: (json: T) => void;
  successMessage: (json: T) => string;
  errorMessage: string;
};

export type AdOsReadinessRunnerOptions = {
  setActionFlag: (key: ActionFlagKey, value: boolean) => void;
  setError: (error: string | null) => void;
  setAutomationMessage: (message: string | null) => void;
};

export async function runAdOsReadinessCheck<T>({
  request,
  setActionFlag,
  setError,
  setAutomationMessage,
}: AdOsReadinessRunnerOptions & {
  request: AdOsReadinessCheckRequest<T>;
}): Promise<void> {
  setActionFlag(request.flag, true);
  setError(null);
  setAutomationMessage(null);
  try {
    const json = await request.fetchResult();
    request.onSuccess(json);
    setAutomationMessage(request.successMessage(json));
  } catch (err) {
    setError(err instanceof Error ? err.message : request.errorMessage);
  } finally {
    setActionFlag(request.flag, false);
  }
}

export function useAdOsReadinessRunner({
  setActionFlag,
  setError,
  setAutomationMessage,
}: AdOsReadinessRunnerOptions) {
  return useCallback(
    async <T>(request: AdOsReadinessCheckRequest<T>) => {
      await runAdOsReadinessCheck({
        request,
        setActionFlag,
        setError,
        setAutomationMessage,
      });
    },
    [setActionFlag, setAutomationMessage, setError],
  );
}
