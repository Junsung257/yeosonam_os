/**
 * GET /api/cron/sync-flight-availability
 *
 * 매일 06:00 KST 자동 실행. 항공 좌석 가용성 스냅샷.
 *
 * 현재: **스켈레톤** — Amadeus / Duffel / Sabre 연동 미완료.
 *   - env AMADEUS_CLIENT_ID/SECRET 가 없으면 noop 반환
 *   - 있어도 실제 호출은 별도 PR 에서 구현 (이 라우트는 schema·route 만 박제)
 *
 * 모니터링 대상 경로(예시):
 *   - ICN→DAD(다낭), ICN→FUK(후쿠오카), ICN→DLC(다롄), PUS→DAD
 *   - 30~120일 앞 출발일 sliding window
 *
 * 출력: flight_availability_snapshots 1 row per (route × date × carrier)
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
  const amadeusKey = process.env.AMADEUS_CLIENT_ID;
  const amadeusSecret = process.env.AMADEUS_CLIENT_SECRET;
  if (!amadeusKey || !amadeusSecret) {
    return {
      ok: true,
      skipped: true,
      reason: 'AMADEUS_CLIENT_ID/SECRET 미설정. flight_availability_snapshots 비어있음.',
      next_step: 'Amadeus Self-Service 가입 후 .env 등록 → 이 라우트의 fetch 구현부 채울 것.',
    };
  }

  // ── Amadeus 실제 연동은 별도 PR에서 ────────────────────────
  // 현재 단계에서는 dry-run 만:
  //   1) Amadeus token 발급 (POST /v1/security/oauth2/token)
  //   2) GET /v1/shopping/flight-offers?origin=ICN&destination=DAD&date=YYYY-MM-DD
  //   3) 각 offer → flight_availability_snapshots row 변환
  return {
    ok: true,
    skipped: true,
    reason: 'Amadeus 키는 있지만 fetch 구현부 미완료. 별도 PR에서 채움.',
  };
}

export const GET = withCronLogging('sync-flight-availability', async (request) => {
  if (!isCronAuthorized(request)) return cronUnauthorizedResponse();
  return run();
});
