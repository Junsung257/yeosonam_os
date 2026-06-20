type AbortableThenable<T> = PromiseLike<T> & {
  abortSignal?: (signal: AbortSignal) => PromiseLike<T>;
};

export async function runSupabaseQueryWithTimeout<T>(
  query: AbortableThenable<T>,
  options: { label: string; timeoutMs?: number },
): Promise<T> {
  const timeoutMs = Math.max(500, options.timeoutMs ?? 8000);
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;

  try {
    const executable =
      typeof query.abortSignal === 'function'
        ? query.abortSignal(controller.signal)
        : query;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error(`TIMEOUT: ${options.label} exceeded ${timeoutMs}ms`));
      }, timeoutMs);
    });
    return await Promise.race([Promise.resolve(executable), timeoutPromise]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[supabase-query] ${options.label} failed`, { message });
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function runOptionalSupabaseQuery<T>(
  query: AbortableThenable<T>,
  fallback: unknown,
  options: { label: string; timeoutMs?: number },
): Promise<T> {
  try {
    return await runSupabaseQueryWithTimeout(query, options);
  } catch {
    return fallback as T;
  }
}
