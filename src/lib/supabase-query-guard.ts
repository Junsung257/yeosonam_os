type AbortableThenable<T> = PromiseLike<T> & {
  abortSignal?: (signal: AbortSignal) => PromiseLike<T>;
};

export async function runSupabaseQueryWithTimeout<T>(
  query: AbortableThenable<T>,
  options: { label: string; timeoutMs?: number },
): Promise<T> {
  const timeoutMs = Math.max(500, options.timeoutMs ?? 8000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const executable =
      typeof query.abortSignal === 'function'
        ? query.abortSignal(controller.signal)
        : query;
    return await Promise.resolve(executable);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[supabase-query] ${options.label} failed`, { message });
    throw error;
  } finally {
    clearTimeout(timer);
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
