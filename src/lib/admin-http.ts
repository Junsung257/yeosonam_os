'use client';

export class AdminHttpError extends Error {
  readonly status: number;
  readonly url: string;
  readonly payload: unknown;

  constructor(message: string, input: { status: number; url: string; payload: unknown }) {
    super(message);
    this.name = 'AdminHttpError';
    this.status = input.status;
    this.url = input.url;
    this.payload = input.payload;
  }
}

async function parseResponsePayload(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function adminJson<T>(input: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(input, {
    credentials: 'same-origin',
    ...init,
    headers,
  });
  const payload = await parseResponsePayload(response);

  if (!response.ok) {
    const detail =
      typeof payload === 'string'
        ? payload.slice(0, 200)
        : payload && typeof payload === 'object' && 'error' in payload
          ? String((payload as { error?: unknown }).error)
          : response.statusText;

    throw new AdminHttpError(`fetch ${response.status}: ${detail}`, {
      status: response.status,
      url: input,
      payload,
    });
  }

  return payload as T;
}

export function shouldRetryAdminQuery(failureCount: number, error: unknown): boolean {
  if (failureCount >= 2) return false;
  if (error instanceof AdminHttpError) {
    if (error.status === 408 || error.status === 429) return true;
    return error.status >= 500;
  }
  return true;
}
