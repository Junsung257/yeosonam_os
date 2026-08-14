export type AbortableBlogPublicQuery<T> = {
  abortSignal: (signal: AbortSignal) => PromiseLike<T>;
};

export class BlogPublicQueryTimeoutError extends Error {
  readonly label: string;
  readonly timeoutMs: number;

  constructor(label: string, timeoutMs: number) {
    super(`blog_public_query_timeout:${label}:${timeoutMs}ms`);
    this.name = 'BlogPublicQueryTimeoutError';
    this.label = label;
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Supabase's abortSignal stops the underlying fetch when possible, but an
 * adapter or socket can fail to settle after abort. Promise.race provides the
 * hard render deadline; abort remains important to release upstream work.
 */
export async function runBlogPublicQueryWithTimeout<T>(
  label: string,
  query: AbortableBlogPublicQuery<T>,
  timeoutMs = 6000,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const boundedTimeoutMs = Number.isFinite(timeoutMs)
    ? Math.max(1, Math.floor(timeoutMs))
    : 6000;

  const queryPromise = Promise.resolve(query.abortSignal(controller.signal));
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new BlogPublicQueryTimeoutError(label, boundedTimeoutMs));
    }, boundedTimeoutMs);
  });

  try {
    return await Promise.race([queryPromise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
