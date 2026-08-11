type DatabaseErrorShape = {
  code?: unknown;
  message?: unknown;
  details?: unknown;
  hint?: unknown;
};

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function describeRegistrationError(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  if (error && typeof error === 'object') {
    const candidate = error as DatabaseErrorShape;
    const code = nonEmptyString(candidate.code);
    const message = nonEmptyString(candidate.message);
    const details = nonEmptyString(candidate.details);
    const hint = nonEmptyString(candidate.hint);
    const parts = [code, message, details && `details=${details}`, hint && `hint=${hint}`].filter(Boolean);
    if (parts.length > 0) return parts.join(':');
  }
  const fallback = String(error);
  return fallback === '[object Object]' ? 'REGISTRATION_UNKNOWN_STRUCTURED_ERROR' : fallback;
}

export function registrationErrorCode(error: unknown, fallback: string): string {
  if (error && typeof error === 'object') {
    const code = nonEmptyString((error as DatabaseErrorShape).code);
    if (code) return code;
  }
  const detail = describeRegistrationError(error);
  const prefix = detail.split(':')[0]?.trim();
  return prefix && prefix !== 'Error' ? prefix : fallback;
}

export function registrationDatabaseError(operation: string, error: unknown): Error {
  return new Error(`${operation}:${describeRegistrationError(error)}`, { cause: error });
}
