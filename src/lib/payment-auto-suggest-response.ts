type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Accept both the standardized `{ ok, data }` response and the legacy root
 * payload while the payment admin UI is rolled out independently of the API.
 */
export function extractPaymentAutoSuggestResponse<T extends { candidates?: unknown[] }>(
  payload: unknown,
): T | null {
  if (!isRecord(payload) || payload.ok === false) return null;

  const data = isRecord(payload.data) ? payload.data : payload;
  if (!Array.isArray(data.candidates)) return null;

  return data as T;
}

export function getPaymentApiErrorMessage(payload: unknown, fallback: string): string {
  if (!isRecord(payload)) return fallback;

  if (typeof payload.error === 'string' && payload.error.trim()) {
    return payload.error;
  }

  if (isRecord(payload.error) && typeof payload.error.message === 'string' && payload.error.message.trim()) {
    return payload.error.message;
  }

  return fallback;
}
