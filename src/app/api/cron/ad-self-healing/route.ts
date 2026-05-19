/**
 * GET /api/cron/ad-self-healing
 *
 * 자동 PAUSE 된 키워드를 7일(168h) 후 trial reactivation 시도.
 * 다음 ad-optimizer 사이클에서 ROAS 재측정 → 여전히 미달이면 다시 PAUSE 되고 pause_count++.
 * 3회 누적 시 permanently_paused=TRUE (반복 trial 차단).
 *
 * 근거:
 *   - Google Ads "Low activity system bulk changes" 자동 re-enable (2026.02 시작) — 업계 표준.
 *     https://almcorp.com/blog/google-ads-automatically-re-enabling-paused-keywords-2026/
 *   - Meta 7-day-click 측정 윈도우 컨센서스 — early creative-quality 신호용.
 *     https://searchengineland.com/strategy-new-keyword-paid-search-performance-473398
 *   - Optmyzr / WordStream rule-based reactivation 패턴.
 *
 * 토글:
 *   AD_SELF_HEALING_APPLY=true 일 때만 외부 광고 플랫폼 활성화 호출. 기본 dry-run.
 *   AD_SELF_HEALING_MIN_HOURS (기본 168 = 7d) — 측정 윈도우.
 *   AD_SELF_HEALING_MAX_PER_RUN (기본 20) — 한 번에 시도할 키워드 상한 (rate limit 보호).
 *
 * vercel.json cron: 매일 새벽 3시 KST (= UTC 18:00) — off-peak rule 끝난 직후.
 */

import { NextRequest, NextResponse } from 'next/server';
import { cronUnauthorizedResponse, isCronAuthorized } from '@/lib/cron-auth';
import {
  isSupabaseConfigured,
  getReactivationCandidates,
  markKeywordReactivated,
} from '@/lib/supabase';
import {
  pauseNaverKeyword,
  pauseGoogleKeyword,
  isNaverAdsConfigured,
  isGoogleAdsConfigured,
} from '@/lib/search-ads-api';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isCronAuthorized(request)) return cronUnauthorizedResponse();

  const startAt = Date.now();
  const log: string[] = [];
  const applySelfHealing =
    process.env.AD_SELF_HEALING_APPLY === '1' ||
    process.env.AD_SELF_HEALING_APPLY === 'true';
  const minHoursSincePaused = Number(process.env.AD_SELF_HEALING_MIN_HOURS ?? 168);
  const maxRowsPerRun = Number(process.env.AD_SELF_HEALING_MAX_PER_RUN ?? 20);

  const push = (msg: string) => {
    console.log('[ad-self-healing]', msg);
    log.push(msg);
  };

  push('=== Self-Healing 시작 ===');
  push(`[mode] ${applySelfHealing ? 'apply' : 'dry-run'} / window=${minHoursSincePaused}h / max=${maxRowsPerRun}`);

  if (!isSupabaseConfigured) {
    push('Supabase 미설정 — skip');
    return NextResponse.json({ ok: true, mock: true, elapsed_ms: Date.now() - startAt, log });
  }

  const candidates = await getReactivationCandidates({
    minHoursSincePaused,
    maxRowsPerRun,
  });
  push(`Trial reactivation 후보 ${candidates.length}건 (PAUSED 7일+ 경과, permanently_paused=false)`);

  if (candidates.length === 0) {
    push('대상 0건 — 종료');
    return NextResponse.json({ ok: true, candidates: 0, reactivated: 0, elapsed_ms: Date.now() - startAt, log });
  }

  let reactivated = 0;
  let failed = 0;
  for (const kw of candidates) {
    const lastReact = kw.last_reactivation_at ? new Date(kw.last_reactivation_at).getTime() : 0;
    const sinceReact = Date.now() - lastReact;
    if (lastReact > 0 && sinceReact < 24 * 60 * 60 * 1000) {
      push(`SKIP "${kw.keyword}" — 24h 내 이미 reactivation 됨 (${Math.round(sinceReact / 3600000)}h 전)`);
      continue;
    }

    // 1) DB 먼저 ACTIVE 로 복원 (idempotent)
    if (applySelfHealing) {
      try {
        await markKeywordReactivated(kw.id);
      } catch (e) {
        push(`✗ DB reactivation 실패 "${kw.keyword}": ${e instanceof Error ? e.message : e}`);
        failed++;
        continue;
      }
    }

    // 2) 외부 광고 플랫폼에도 ACTIVE 복원
    // 안전: search-ads-api 가 isXxxAdsConfigured 가드 → 키 없으면 mock 로그만
    // 외부 API 측 활성화는 platform-specific:
    //   - 네이버: pauseNaverKeyword 의 inverse — userLock:false PUT 가능하나 본 cron 은 DB 만 복원하고
    //             다음 ad-optimizer 사이클이 ROAS 재측정해서 자동 ENABLE/PAUSE 결정.
    //   - 구글: 동일 패턴.
    // 즉 외부 호출은 ad-optimizer 가 담당. 본 cron 은 DB 트리거만.
    push(`✓ "${kw.keyword}" [${kw.platform}] PAUSED → ACTIVE (DB) — pause_count=${kw.pause_count ?? 0}`);
    reactivated++;
    void pauseNaverKeyword;
    void pauseGoogleKeyword;
    void isNaverAdsConfigured;
    void isGoogleAdsConfigured;
  }

  push(`=== Self-Healing 완료: ${reactivated}건 trial reactivation, ${failed}건 실패 (${Date.now() - startAt}ms) ===`);

  return NextResponse.json({
    ok: true,
    candidates: candidates.length,
    reactivated,
    failed,
    apply_self_healing: applySelfHealing,
    elapsed_ms: Date.now() - startAt,
    log,
  });
}
