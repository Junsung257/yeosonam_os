'use client';

import { useCallback } from 'react';
import type { ActionFlagKey } from './action-flags';

type JsonRecord = Record<string, unknown>;

export type AdOsJsonActionRunnerOptions = {
  setActionFlag: (key: ActionFlagKey, value: boolean) => void;
  setError: (error: string | null) => void;
  setAutomationMessage: (message: string | null) => void;
  refresh: () => Promise<void>;
};

export type AdOsJsonActionRequest<T extends JsonRecord = JsonRecord> = {
  flag: ActionFlagKey;
  url: string;
  body?: Record<string, unknown>;
  errorMessage: string;
  successMessage?: string | ((json: T) => string);
  method?: 'GET' | 'POST' | 'PATCH';
  refresh?: boolean;
  onSuccess?: (json: T) => Promise<void> | void;
};

export type AdOsJsonBatchActionItem = {
  key: string;
  url: string;
  body?: Record<string, unknown>;
  errorMessage?: string;
  method?: 'GET' | 'POST' | 'PATCH';
};

export type AdOsJsonBatchActionRequest<T extends Record<string, JsonRecord> = Record<string, JsonRecord>> = {
  flag: ActionFlagKey;
  requests: AdOsJsonBatchActionItem[];
  errorMessage: string;
  successMessage?: string | ((json: T) => string);
  refresh?: boolean;
  onSuccess?: (json: T) => Promise<void> | void;
};

export type AdOsJsonIdActionRunnerOptions = Omit<AdOsJsonActionRunnerOptions, 'setActionFlag'> & {
  setActionId: (id: string | null) => void;
};

export type AdOsJsonIdActionRequest<T extends JsonRecord = JsonRecord> = {
  activeId: string;
  url: string;
  body?: Record<string, unknown>;
  errorMessage: string;
  successMessage?: string | ((json: T) => string);
  method?: 'GET' | 'POST' | 'PATCH';
  refresh?: boolean;
  onSuccess?: (json: T) => Promise<void> | void;
};

function isJsonRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export async function parseAdOsJsonResponse(response: Response, fallbackError: string): Promise<JsonRecord> {
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new Error(fallbackError);
  }
  if (!isJsonRecord(json)) {
    throw new Error(fallbackError);
  }
  if (!response.ok || !json.ok) {
    throw new Error(String(json.error || fallbackError));
  }
  return json;
}

export function useAdOsJsonActionRunner({
  setActionFlag,
  setError,
  setAutomationMessage,
  refresh,
}: AdOsJsonActionRunnerOptions) {
  return useCallback(
    async <T extends JsonRecord = JsonRecord>({
      flag,
      url,
      body,
      errorMessage,
      successMessage = 'Action completed.',
      method = body === undefined ? 'GET' : 'POST',
      refresh: shouldRefresh = true,
      onSuccess,
    }: AdOsJsonActionRequest<T>) => {
      setActionFlag(flag, true);
      setError(null);
      setAutomationMessage(null);
      try {
        const response = await fetch(url, {
          method,
          headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        const json = await parseAdOsJsonResponse(response, errorMessage) as T;
        if (onSuccess) await onSuccess(json);
        if (shouldRefresh) await refresh();
        setAutomationMessage(typeof successMessage === 'function' ? successMessage(json) : successMessage);
      } catch (err) {
        setError(err instanceof Error ? err.message : errorMessage);
      } finally {
        setActionFlag(flag, false);
      }
    },
    [refresh, setActionFlag, setAutomationMessage, setError],
  );
}

export function useAdOsJsonIdActionRunner({
  setActionId,
  setError,
  setAutomationMessage,
  refresh,
}: AdOsJsonIdActionRunnerOptions) {
  return useCallback(
    async <T extends JsonRecord = JsonRecord>({
      activeId,
      url,
      body,
      errorMessage,
      successMessage = 'Action completed.',
      method = body === undefined ? 'GET' : 'POST',
      refresh: shouldRefresh = true,
      onSuccess,
    }: AdOsJsonIdActionRequest<T>) => {
      setActionId(activeId);
      setError(null);
      setAutomationMessage(null);
      try {
        const response = await fetch(url, {
          method,
          headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        const json = await parseAdOsJsonResponse(response, errorMessage) as T;
        if (onSuccess) await onSuccess(json);
        if (shouldRefresh) await refresh();
        setAutomationMessage(typeof successMessage === 'function' ? successMessage(json) : successMessage);
      } catch (err) {
        setError(err instanceof Error ? err.message : errorMessage);
      } finally {
        setActionId(null);
      }
    },
    [refresh, setActionId, setAutomationMessage, setError],
  );
}

export function useAdOsJsonBatchActionRunner({
  setActionFlag,
  setError,
  setAutomationMessage,
  refresh,
}: AdOsJsonActionRunnerOptions) {
  return useCallback(
    async <T extends Record<string, JsonRecord> = Record<string, JsonRecord>>({
      flag,
      requests,
      errorMessage,
      successMessage = 'Action completed.',
      refresh: shouldRefresh = true,
      onSuccess,
    }: AdOsJsonBatchActionRequest<T>) => {
      setActionFlag(flag, true);
      setError(null);
      setAutomationMessage(null);
      try {
        const entries = await Promise.all(
          requests.map(async (request) => {
            const response = await fetch(request.url, {
              method: request.method || (request.body === undefined ? 'GET' : 'POST'),
              headers: request.body === undefined ? undefined : { 'Content-Type': 'application/json' },
              body: request.body === undefined ? undefined : JSON.stringify(request.body),
            });
            const json = await parseAdOsJsonResponse(response, request.errorMessage || errorMessage);
            return [request.key, json] as const;
          }),
        );
        const json = Object.fromEntries(entries) as T;
        if (onSuccess) await onSuccess(json);
        if (shouldRefresh) await refresh();
        setAutomationMessage(typeof successMessage === 'function' ? successMessage(json) : successMessage);
      } catch (err) {
        setError(err instanceof Error ? err.message : errorMessage);
      } finally {
        setActionFlag(flag, false);
      }
    },
    [refresh, setActionFlag, setAutomationMessage, setError],
  );
}
