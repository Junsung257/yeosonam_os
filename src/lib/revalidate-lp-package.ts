import { revalidatePath, revalidateTag } from 'next/cache';

/**
 * 상품 변경 시 `/lp/*` ISR(unstable_cache tag `lp-packages`) 및 경로 캐시 무효화.
 * shortCode 가 있으면 `/lp/{shortCode}` 링크용 경로도 함께 비움.
 */
export function revalidateLandingPagesForPackage(packageId: string, shortCode?: string | null): void {
  try {
    revalidateTag('lp-packages');
  } catch (e) {
    console.warn('[revalidateLandingPagesForPackage] revalidateTag 실패 (비중단):', e);
  }
  try {
    revalidatePath(`/lp/${packageId}`);
    if (shortCode && shortCode !== packageId) {
      revalidatePath(`/lp/${shortCode}`);
    }
  } catch (e) {
    console.warn('[revalidateLandingPagesForPackage] revalidatePath 실패 (비중단):', e);
  }
}

/** 일괄 작업 — tag 한 번 + 각 UUID 경로 */
export function revalidateLandingPagesForPackageIds(packageIds: string[]): void {
  try {
    revalidateTag('lp-packages');
  } catch (e) {
    console.warn('[revalidateLandingPagesForPackageIds] revalidateTag 실패 (비중단):', e);
  }
  for (const id of packageIds) {
    try {
      revalidatePath(`/lp/${id}`);
    } catch (e) {
      console.warn(`[revalidateLandingPagesForPackageIds] /lp/${id}:`, e);
    }
  }
}
