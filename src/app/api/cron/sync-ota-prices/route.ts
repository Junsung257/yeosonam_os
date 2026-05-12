/**
 * GET /api/cron/sync-ota-prices
 *
 * 매일 07:00 KST 자동 실행. 경쟁 OTA 가격 스냅샷.
 *
 * 현재: **스켈레톤** — Agoda Affiliate / Skyscanner / Klook 연동 미완료.
 *   - 우리 패키지 목적지 별 동일 기간 가격 비교
 *   - matched_package_id 있으면 price_gap_pct 자동 산정 (우리 가격 대비)
 *
 * 모니터링 대상 (초기):
 *   - 다낭 / 후쿠오카 / 장가계 / 보라카이 — 우리 주력 4개 목적지
 *
 * 출력: ota_price_snapshots 1 row per (source × ref_key × date)
 */
import { isCronAuthorized, cronUnauthorizedResponse } from '@/lib/cron-auth';
import { isSupabaseConfigured } from '@/lib/supabase';
import { withCronLogging } from '@/lib/cron-observability';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

async function run() {
  if (!isSupabaseConfigured) return { ok: true, mock: true };

  // 미등록 secret 키 — secret-registry 외부이므로 process.env 직접 사용
  const agodaKey = process.env.AGODA_AFFILIATE_API_KEY;
  const skyscannerKey = process.env.SKYSCANNER_API_KEY;
  if (!agodaKey && !skyscannerKey) {
    return {
      ok: true,
      skipped: true,
      reason: 'AGODA / SKYSCANNER 키 미설정. ota_price_snapshots 비어있음.',
      next_step: 'Agoda Affiliate API 또는 Skyscanner 무료 티어 가입 → 키 등록 → fetch 구현',
    };
  }

  // ── 실제 연동은 별도 PR에서 ───────────────────────────────
  return {
    ok: true,
    skipped: true,
    reason: '키는 있으나 fetch 구현부 미완료. 별도 PR에서 채움.',
  };
}

export const GET = withCronLogging('sync-ota-prices', async (request) => {
  if (!isCronAuthorized(request)) return cronUnauthorizedResponse();
  return run();
});
