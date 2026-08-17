import { apiResponse } from '@/lib/api-response';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { withCronGuard } from '@/lib/cron-auth';
import { logError, logWarning } from '@/lib/sentry-logger';
import { CUSTOMER_VISIBLE_STATUSES } from '@/lib/visibility-status';
import { automaticArchiveReason } from '@/lib/product-registration/package-archive-policy';

/**
 * 자동 아카이브 크론 — 매일 새벽 1시 실행
 *
 * 조건: 원문에 근거한 모든 출발일(price_dates / price_tiers)이 지난 상품
 *
 * 발권기한 경과는 상품 만료가 아니다. 출발일과 가격은 유지하고
 * V6가 상담 전용 축약 공개와 현재 좌석·요금 재확인 안내를 맡는다.
 *
 * 대상: status가 approved, active, pending, pending_review, draft 인 상품만
 */
export const dynamic = 'force-dynamic';
const getHandler = async () => {
  if (!isSupabaseConfigured) {
    return apiResponse({ skipped: true, reason: 'Supabase not configured' });
  }

  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  let archivedCount = 0;

  try {
    // 판매 중/승인/검토 대기 상품만 조회
    const { data: packages, error } = await supabaseAdmin
      .from('travel_packages')
      .select('id, tenant_id, catalog_product_id, price_tiers, price_dates')
      .in('status', [...CUSTOMER_VISIBLE_STATUSES, 'pending', 'pending_review', 'draft']);

    if (error) throw error;
    if (!packages || packages.length === 0) {
      return apiResponse({ archivedCount: 0, message: 'No packages to archive' });
    }

    const toArchive: Array<{ id: string; tenant_id: string; catalog_product_id: string }> = [];
    let identityMissingCount = 0;

    for (const pkg of packages) {
      if (automaticArchiveReason(pkg, today)) {
        if (pkg.tenant_id && pkg.catalog_product_id) {
          toArchive.push({
            id: String(pkg.id),
            tenant_id: String(pkg.tenant_id),
            catalog_product_id: String(pkg.catalog_product_id),
          });
        } else {
          identityMissingCount += 1;
          logWarning('[cron/auto-archive] immutable catalog identity missing; left unchanged', {
            packageId: pkg.id,
          });
        }
      }
    }

    if (toArchive.length > 0) {
      for (const pkg of toArchive) {
        const { error: overlayError } = await supabaseAdmin.rpc('set_product_registration_availability_overlay', {
          p_payload: {
            tenant_id: pkg.tenant_id,
            catalog_product_id: pkg.catalog_product_id,
            channel: 'customer',
            sale_state: 'closed',
            reason: `AUTO_ARCHIVED_NO_FUTURE_DEPARTURES:${today}`,
          },
        });
        if (overlayError) throw overlayError;
      }
      archivedCount = toArchive.length;

      try {
        const { skipBlogQueueForPackages } = await import('@/lib/blog-queue-lifecycle');
        await skipBlogQueueForPackages(toArchive.map(item => item.id), 'auto_archived_package');
      } catch (e) {
        logWarning('[cron/auto-archive] blog queue skip failed (non-blocking)', e);
      }
    }

    console.log(`[auto-archive] archived ${archivedCount} packages`);
    return apiResponse({
      archivedCount,
      identityMissingCount,
      message: `Closed ${archivedCount} products through availability overlays`,
    });

  } catch (err) {
    logError('[cron/auto-archive] archive failed', err);
    return apiResponse({ error: 'Auto archive failed' }, { status: 500 });
  }
}

export const GET = withCronGuard(getHandler);
