import { revalidatePath, revalidateTag } from 'next/cache';

/**
 * Invalidate the shared landing-page cache and the package-specific routes.
 * Existing callers keep best-effort behavior; the V5 outbox can request a
 * strict result so a failed invalidation is retried instead of acknowledged.
 */
export function revalidateLandingPagesForPackage(
  packageId: string,
  shortCode?: string | null,
  options: { throwOnError?: boolean } = {},
): void {
  const errors: unknown[] = [];
  try {
    revalidateTag('lp-packages');
  } catch (error) {
    errors.push(error);
    console.warn('[revalidateLandingPagesForPackage] revalidateTag failed:', error);
  }
  try {
    revalidatePath(`/lp/${packageId}`);
    if (shortCode && shortCode !== packageId) {
      revalidatePath(`/lp/${shortCode}`);
    }
  } catch (error) {
    errors.push(error);
    console.warn('[revalidateLandingPagesForPackage] revalidatePath failed:', error);
  }
  if (options.throwOnError && errors.length > 0) {
    const first = errors[0];
    throw first instanceof Error ? first : new Error(String(first));
  }
}

/** Shared tag invalidation plus package-specific UUID paths. */
export function revalidateLandingPagesForPackageIds(packageIds: string[]): void {
  try {
    revalidateTag('lp-packages');
  } catch (error) {
    console.warn('[revalidateLandingPagesForPackageIds] revalidateTag failed:', error);
  }
  for (const id of packageIds) {
    try {
      revalidatePath(`/lp/${id}`);
    } catch (error) {
      console.warn(`[revalidateLandingPagesForPackageIds] /lp/${id}:`, error);
    }
  }
}
