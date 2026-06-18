const DEFAULT_PUBLIC_QUERY_TIMEOUT_MS = Math.max(
  1000,
  Number(process.env.PUBLIC_PAGE_QUERY_TIMEOUT_MS || '3500') || 3500,
);

type AbortablePromiseLike<T> = PromiseLike<T> & {
  abortSignal?: (signal: AbortSignal) => PromiseLike<T>;
};

export async function withPublicQueryFallback<T, F>(
  promise: AbortablePromiseLike<T>,
  fallback: F,
  timeoutMs = DEFAULT_PUBLIC_QUERY_TIMEOUT_MS,
): Promise<T | F> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const abortSignal = promise.abortSignal;
  const controller = typeof abortSignal === 'function' ? new AbortController() : null;
  const source = controller && typeof abortSignal === 'function'
    ? abortSignal.call(promise, controller.signal)
    : Promise.resolve(promise);
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller?.abort();
      reject(new Error(`public query timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([source, timeout]);
  } catch {
    return fallback;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
