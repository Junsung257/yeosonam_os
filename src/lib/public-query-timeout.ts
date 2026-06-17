const DEFAULT_PUBLIC_QUERY_TIMEOUT_MS = Math.max(
  1000,
  Number(process.env.PUBLIC_PAGE_QUERY_TIMEOUT_MS || '3500') || 3500,
);

export async function withPublicQueryFallback<T, F>(
  promise: PromiseLike<T>,
  fallback: F,
  timeoutMs = DEFAULT_PUBLIC_QUERY_TIMEOUT_MS,
): Promise<T | F> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`public query timed out after ${timeoutMs}ms`)), timeoutMs);
  });

  try {
    return await Promise.race([Promise.resolve(promise), timeout]);
  } catch {
    return fallback;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
