#!/usr/bin/env node
/**
 * X4-4 박제 (2026-05-15): 사장님 사고 패키지 매칭률 주간 회귀 측정.
 *
 * Latitude GEPA 패턴: production failure → 자동 test case.
 * 사장님이 발견한 사고 패키지 N개를 매주 자동으로 ai_quality_log fetch → 매칭률 baseline 측정 → 임계치 미달 시 admin_alerts.
 *
 * 환경변수:
 *   - SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (필수)
 *   - SLACK_ALERTS_WEBHOOK (선택)
 *
 * 회귀 monitor 패키지 ID: db/error-registry.md / docs/incident-log.md (이전) 참고.
 * 현재 박힌 사고 baseline:
 *   - 3a136d76-79c0-44f2-aa1a-8e8d4cbdb12a (인천/계림/양삭 3박5일)
 *   - f54cc782-9f13-46dd-ba0b-97c05f2086be (인천/계림/양삭 4박6일)
 *   사장님이 사고 발견 → docs/register-changelog.md 에 패키지 ID append → 자동 monitor 확장.
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('[Regression] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 누락');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Y4 박제 (2026-05-15): 사고 패키지 IDs DB 기반 자동화.
//   travel_packages.meta_tags 에 'regression_fixture' 박힌 패키지 자동 monitor.
//   사장님이 어드민 검수 큐에서 "회귀 fixture 등록" 1-click → DB 갱신 → 다음 cron 자동 포함.
//   fallback: 정적 baseline (계림 사고 2건) — DB 조회 실패 시 최소 회귀 보장.
const STATIC_FALLBACK_IDS = [
  '3a136d76-79c0-44f2-aa1a-8e8d4cbdb12a', // ERR-KWL 인천/계림/양삭 3박5일
  'f54cc782-9f13-46dd-ba0b-97c05f2086be', // ERR-KWL 인천/계림/양삭 4박6일
];

async function getIncidentPackageIds() {
  try {
    const { data } = await supabase
      .from('travel_packages')
      .select('id')
      .contains('product_tags', ['regression_fixture'])
      .limit(50);
    const dbIds = ((data ?? [])).map(r => r.id);
    // DB 등록분 + static fallback union (중복 제거)
    const merged = new Set([...dbIds, ...STATIC_FALLBACK_IDS]);
    return [...merged];
  } catch (e) {
    console.warn('[Regression] DB fetch 실패 → static fallback:', e.message);
    return STATIC_FALLBACK_IDS;
  }
}

const MATCH_RATE_THRESHOLD = 0.7; // 회귀 임계치 — 70% 미달 시 alert (G5 의 0.6 보다 엄격)

async function postAlert(args) {
  try {
    await supabase.from('admin_alerts').insert({
      category: 'general',
      severity: args.severity,
      title: args.title,
      message: args.message,
      meta: args.meta,
    });
  } catch (e) {
    console.warn('[Regression] admin_alert 적재 실패:', e.message);
  }
}

async function checkPackage(packageId) {
  // 1. 패키지 정보
  const { data: pkg } = await supabase
    .from('travel_packages')
    .select('id, title, destination, status')
    .eq('id', packageId)
    .maybeSingle();
  if (!pkg) {
    console.warn(`  ${packageId}: package not found`);
    return null;
  }

  // 2. 최신 ai_quality_log
  const { data: ql } = await supabase
    .from('ai_quality_log')
    .select('attraction_matched_count, attraction_unmatched_count, attraction_seeded_count, attraction_reflected_count, confidence')
    .eq('package_id', packageId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!ql) {
    console.warn(`  ${packageId}: ai_quality_log not found`);
    return null;
  }

  const matched = ql.attraction_matched_count ?? 0;
  const unmatched = ql.attraction_unmatched_count ?? 0;
  const denom = matched + unmatched;
  const rate = denom > 0 ? matched / denom : 1;

  const result = {
    package_id: packageId,
    title: pkg.title,
    destination: pkg.destination,
    matched,
    unmatched,
    rate,
    seeded: ql.attraction_seeded_count ?? 0,
    reflected: ql.attraction_reflected_count ?? 0,
    confidence: ql.confidence ?? null,
  };

  if (denom >= 3 && rate < MATCH_RATE_THRESHOLD) {
    await postAlert({
      severity: 'warning',
      title: `회귀 감지 — ${pkg.destination} 매칭률 ${(rate * 100).toFixed(0)}%`,
      message: `${pkg.title} (${packageId.slice(0, 8)}…): ${matched}/${denom} 매칭, 임계치 ${(MATCH_RATE_THRESHOLD * 100).toFixed(0)}% 미달 — attractions 시드 회귀 의심`,
      meta: result,
    });
    console.log(`  ❌ ${packageId.slice(0, 8)} ${(rate * 100).toFixed(0)}% (${matched}/${denom}) — ALERT 적재`);
  } else {
    console.log(`  ✅ ${packageId.slice(0, 8)} ${(rate * 100).toFixed(0)}% (${matched}/${denom})`);
  }

  return result;
}

async function main() {
  const ids = await getIncidentPackageIds();
  console.log(`🔁 사고 패키지 회귀 측정 시작 (${ids.length}건 — DB ${ids.length - STATIC_FALLBACK_IDS.length}+ static ${STATIC_FALLBACK_IDS.length})`);
  const results = [];
  for (const id of ids) {
    const r = await checkPackage(id);
    if (r) results.push(r);
  }

  // baseline 출력
  const avgRate = results.length > 0
    ? results.reduce((s, r) => s + r.rate, 0) / results.length
    : 0;
  console.log(`\n📊 평균 매칭률: ${(avgRate * 100).toFixed(1)}% (${results.length}건)`);

  if (avgRate < MATCH_RATE_THRESHOLD && results.length >= 2) {
    await postAlert({
      severity: 'critical',
      title: `사고 패키지 평균 매칭률 ${(avgRate * 100).toFixed(0)}% — 회귀 의심`,
      message: `${results.length}건 baseline 평균이 임계치 ${(MATCH_RATE_THRESHOLD * 100).toFixed(0)}% 미달. attractions 시드 / matcher 회귀 점검 필요.`,
      meta: { results, avgRate },
    });
  }

  console.log('✅ 종료');
}

main().catch(e => {
  console.error('[Regression] 치명적 오류:', e);
  process.exit(1);
});
