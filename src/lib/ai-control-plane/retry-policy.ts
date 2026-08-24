import { AiControlPlaneError } from './types';

export function isRetryableProviderError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /(?:timeout|rate.?limit|429|5\d\d|ECONNRESET|ECONNREFUSED|ETIMEDOUT|fetch failed|network)/i.test(message);
}

/** The control plane owns one provider call. Outer workflow retries a stage. */
export async function runSingleProviderCall<T>(input: {
  maxProviderCalls: 1;
  execute: () => Promise<T>;
}): Promise<T> {
  try {
    return await input.execute();
  } catch (error) {
    throw new AiControlPlaneError(
      error instanceof Error ? error.message : String(error),
      'provider_failed',
      isRetryableProviderError(error),
    );
  }
}
