/**
 * @file upload-verify.ts — 원문 ↔ DB 결정적 대조 (C1~C6)
 *
 * 박제 사유 (2026-05-13):
 *   기존에는 verify 가 `/api/admin/upload/verify` POST 로 사장님이 어드민 UI 에서
 *   버튼 눌러야 실행됐다. INSERT 직후 `audit_status` 는 NULL 로 남아 컨펌 큐의 SSOT
 *   가 비어있던 문제 — confidence V2 만 신호로 사용 → "0.85 통과했는데 실제 오류
 *   4건" 같은 거짓 신호 발생.
 *
 *   이 파일은 verify 의 검증 로직을 순수 함수로 추출해 두 경로에서 재사용:
 *     1) upload route INSERT 후 fire-and-forget 으로 자동 호출 (E5 의무화)
 *     2) verify route 가 사장님 수동 재실행 시 호출 (기존 UI 유지)
 *
 *   C1~C6 결정적 룰 — LLM 토큰 0. 비용·속도 모두 무손실.
 */

import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { sendSlackAlert } from '@/lib/slack-alert';

export interface VerifyCheck {
  id: string;
  label: string;
  status: 'pass' | 'warn' | 'fail' | 'skip';
  detail?: string;
}

export interface VerifyResult {
  status: 'clean' | 'warnings' | 'blocked' | 'skipped';
  checks: VerifyCheck[];
  fixable: string[];
  passCount: number;
  warnCount: number;
  failCount: number;
}

type PackageRow = {
  id: string;
  title?: string | null;
  display_title?: string | null;
  hero_tagline?: string | null;
  raw_text?: string | null;
  itinerary_data?: { days?: Array<{ hotel?: { name?: string | null } | null; schedule?: Array<{ activity?: string }> | null } | null> } | null;
  inclusions?: string[] | string | null;
  optional_tours?: Array<{ name?: string; price?: number | string | null; price_currency?: string | null } | string | null> | null;
  price_dates?: Array<{ adult_selling_price?: number; selling_price?: number; currency?: string | null }> | null;
  price_list?: Array<{ adult_selling_price?: number; selling_price?: number; currency?: string | null }> | null;
  departure_days?: unknown;
  surcharges?: Array<{ amount?: number | string | null; currency?: string | null } | string | null> | null;
};

export function evaluateVerifyChecks(pkg: PackageRow): VerifyResult {
  const checks: VerifyCheck[] = [];
  const rawText: string = typeof pkg.raw_text === 'string' ? pkg.raw_text : '';
  const hasRaw = rawText.length > 50;

  // C1: 일차 수 대조
  if (hasRaw) {
    const dayNums = [...rawText.matchAll(/제\s*(\d+)\s*일/g)].map(m => parseInt(m[1]));
    const rawDayMax = dayNums.length > 0 ? Math.max(...dayNums) : 0;
    const dbDays: number = Array.isArray(pkg.itinerary_data?.days) ? pkg.itinerary_data!.days!.length : 0;

    if (rawDayMax === 0 || dbDays === 0) {
      checks.push({ id: 'C1', label: '일차 수', status: 'skip', detail: rawDayMax === 0 ? '원문에 일차 표기 없음' : 'DB 일정 없음' });
    } else if (rawDayMax !== dbDays) {
      checks.push({ id: 'C1', label: '일차 수', status: 'warn', detail: `원문 ${rawDayMax}일 vs DB ${dbDays}일 불일치` });
    } else {
      checks.push({ id: 'C1', label: '일차 수', status: 'pass', detail: `${dbDays}일 일치` });
    }
  } else {
    checks.push({ id: 'C1', label: '일차 수', status: 'skip', detail: '원문 없음' });
  }

  // C2: 선택관광 개수
  if (hasRaw) {
    const optSection = rawText.match(/선택\s*관광[^\n]*\n([\s\S]*?)(?=\n{2,}|\[|$)/);
    const rawOptCount = optSection
      ? (optSection[1].match(/\n\s*[-•·▶◆○●]/g) ?? []).length
      : 0;
    const dbOptCount: number = Array.isArray(pkg.optional_tours) ? pkg.optional_tours.length : 0;

    if (rawOptCount === 0) {
      checks.push({ id: 'C2', label: '선택관광 개수', status: 'skip', detail: '원문에 선택관광 섹션 없음' });
    } else if (Math.abs(rawOptCount - dbOptCount) > 1) {
      checks.push({ id: 'C2', label: '선택관광 개수', status: 'warn', detail: `원문 약 ${rawOptCount}건 vs DB ${dbOptCount}건` });
    } else {
      checks.push({ id: 'C2', label: '선택관광 개수', status: 'pass', detail: `약 ${dbOptCount}건 일치` });
    }
  } else {
    checks.push({ id: 'C2', label: '선택관광 개수', status: 'skip', detail: '원문 없음' });
  }

  // C3: 특식 포함 여부
  if (hasRaw) {
    const mealMatch = rawText.match(/특식\s*(\d+)\s*회/);
    if (mealMatch) {
      const rawMealCount = parseInt(mealMatch[1]);
      const inclStr = Array.isArray(pkg.inclusions)
        ? pkg.inclusions.join(' ')
        : (typeof pkg.inclusions === 'string' ? pkg.inclusions : '');
      if (!/특식/.test(inclStr)) {
        checks.push({ id: 'C3', label: '특식 포함', status: 'warn', detail: `원문 "특식 ${rawMealCount}회" 기재, DB inclusions 미반영` });
      } else {
        checks.push({ id: 'C3', label: '특식 포함', status: 'pass', detail: '특식 기재 일치' });
      }
    } else {
      checks.push({ id: 'C3', label: '특식 포함', status: 'skip', detail: '원문에 특식 N회 표기 없음' });
    }
  } else {
    checks.push({ id: 'C3', label: '특식 포함', status: 'skip', detail: '원문 없음' });
  }

  // C4: 최저가 대조
  if (hasRaw) {
    const priceMatch = rawText.match(/(?:최저가|취항특가|특가)[^\d]*(\d[\d,]+)/);
    if (priceMatch) {
      const rawMin = parseInt(priceMatch[1].replace(/,/g, ''));
      const priceList: Array<{ adult_selling_price?: number; selling_price?: number }> = Array.isArray(pkg.price_dates)
        ? pkg.price_dates
        : Array.isArray(pkg.price_list) ? pkg.price_list : [];
      const dbMin = priceList.length > 0
        ? Math.min(...priceList.map(p => p.adult_selling_price ?? p.selling_price ?? Infinity))
        : 0;

      if (dbMin === 0 || dbMin === Infinity) {
        checks.push({ id: 'C4', label: '최저가', status: 'skip', detail: 'DB 가격 데이터 없음' });
      } else {
        const diff = Math.abs(rawMin - dbMin) / rawMin;
        if (diff > 0.05) {
          checks.push({ id: 'C4', label: '최저가', status: 'warn', detail: `원문 ₩${rawMin.toLocaleString()} vs DB ₩${dbMin.toLocaleString()} (${(diff * 100).toFixed(1)}% 차이)` });
        } else {
          checks.push({ id: 'C4', label: '최저가', status: 'pass', detail: `₩${dbMin.toLocaleString()} 일치` });
        }
      }
    } else {
      checks.push({ id: 'C4', label: '최저가', status: 'skip', detail: '원문에 최저가 표기 없음' });
    }
  } else {
    checks.push({ id: 'C4', label: '최저가', status: 'skip', detail: '원문 없음' });
  }

  // C5: departure_days 형식
  if (pkg.departure_days !== null && pkg.departure_days !== undefined) {
    const depStr = typeof pkg.departure_days === 'string' ? pkg.departure_days : JSON.stringify(pkg.departure_days);
    if (/^\[/.test(depStr.trim())) {
      checks.push({ id: 'C5', label: '출발요일 형식', status: 'warn', detail: `JSON 배열 문자열 누출: "${depStr.slice(0, 30)}"` });
    } else {
      checks.push({ id: 'C5', label: '출발요일 형식', status: 'pass', detail: `"${depStr.slice(0, 20)}" 정상` });
    }
  } else {
    checks.push({ id: 'C5', label: '출발요일 형식', status: 'skip', detail: '출발요일 없음' });
  }

  // C6: 가격 행 존재 여부
  const priceRows: Array<{ adult_selling_price?: number; selling_price?: number; currency?: string | null }> = Array.isArray(pkg.price_dates)
    ? pkg.price_dates
    : Array.isArray(pkg.price_list) ? pkg.price_list : [];
  if (priceRows.length === 0) {
    checks.push({ id: 'C6', label: '가격 데이터', status: 'warn', detail: 'price_dates 행 없음 — 수동 입력 필요' });
  } else {
    checks.push({ id: 'C6', label: '가격 데이터', status: 'pass', detail: `${priceRows.length}개 가격 행` });
  }

  // C7: 호텔 수 대조 (원문 "박" 수 ≤ days-1 vs hotel.name 채워진 day 수)
  // 박수 = duration - 1. 마지막 day 는 귀국일이라 hotel null 정상.
  // 호텔 없는 중간 day = 환각 또는 정규화 누락 신호.
  if (hasRaw) {
    const nightsMatch = rawText.match(/(\d+)\s*박\s*(\d+)\s*일/);
    const days = Array.isArray(pkg.itinerary_data?.days) ? pkg.itinerary_data!.days! : [];
    if (nightsMatch && days.length > 0) {
      const expectedHotelDays = parseInt(nightsMatch[1]);
      const filledHotels = days.filter(d => (d?.hotel?.name ?? '').trim().length >= 2).length;
      if (filledHotels < expectedHotelDays) {
        checks.push({
          id: 'C7',
          label: '호텔 채움',
          status: 'warn',
          detail: `${expectedHotelDays}박 기대, hotel.name 채워진 일정 ${filledHotels}일 — 추출 누락 가능`,
        });
      } else {
        checks.push({ id: 'C7', label: '호텔 채움', status: 'pass', detail: `${filledHotels}/${expectedHotelDays}박 충족` });
      }
    } else {
      checks.push({ id: 'C7', label: '호텔 채움', status: 'skip', detail: '원문에 박수 표기 없음' });
    }
  } else {
    checks.push({ id: 'C7', label: '호텔 채움', status: 'skip', detail: '원문 없음' });
  }

  // C8: 통화 일관성 — price_dates / surcharges / optional_tours 모두 동일 currency 또는 NULL.
  // 통화 mix 는 가격 계산 버그 (USD/KRW 환산 누락) 의 흔한 신호.
  const currencies = new Set<string>();
  for (const p of priceRows) {
    const c = (p?.currency ?? '').trim().toUpperCase();
    if (c) currencies.add(c);
  }
  const surcharges = Array.isArray(pkg.surcharges) ? pkg.surcharges : [];
  for (const s of surcharges) {
    if (s && typeof s === 'object') {
      const c = ((s as { currency?: string | null }).currency ?? '').trim().toUpperCase();
      if (c) currencies.add(c);
    }
  }
  const opts = Array.isArray(pkg.optional_tours) ? pkg.optional_tours : [];
  for (const o of opts) {
    if (o && typeof o === 'object') {
      const c = ((o as { price_currency?: string | null }).price_currency ?? '').trim().toUpperCase();
      if (c) currencies.add(c);
    }
  }
  if (currencies.size > 1) {
    checks.push({
      id: 'C8',
      label: '통화 일관성',
      status: 'warn',
      detail: `통화 ${currencies.size}종 혼재: ${Array.from(currencies).join(', ')} — 환산 누락 가능`,
    });
  } else if (currencies.size === 1) {
    checks.push({ id: 'C8', label: '통화 일관성', status: 'pass', detail: `${Array.from(currencies)[0]} 단일` });
  } else {
    checks.push({ id: 'C8', label: '통화 일관성', status: 'skip', detail: '통화 표기 없음 (기본 KRW 가정)' });
  }

  // C9: 일정 activity 중복 — 같은 day 내 activity 텍스트 정확히 중복은 추출 분리 버그.
  const days = Array.isArray(pkg.itinerary_data?.days) ? pkg.itinerary_data!.days! : [];
  const dupHits: string[] = [];
  for (let i = 0; i < days.length; i++) {
    const d = days[i];
    if (!d || !Array.isArray(d.schedule)) continue;
    const seen = new Set<string>();
    for (const item of d.schedule) {
      const key = (item?.activity ?? '').trim();
      if (key.length < 4) continue;            // 너무 짧은 토큰은 자연스러운 반복 가능
      if (seen.has(key)) { dupHits.push(`Day${i + 1}:"${key.slice(0, 30)}"`); break; }
      seen.add(key);
    }
  }
  if (dupHits.length > 0) {
    checks.push({
      id: 'C9',
      label: '일정 중복',
      status: 'warn',
      detail: `같은 day 안 activity 중복 ${dupHits.length}건: ${dupHits.slice(0, 2).join(' / ')}${dupHits.length > 2 ? ' …' : ''}`,
    });
  } else if (days.length > 0) {
    checks.push({ id: 'C9', label: '일정 중복', status: 'pass', detail: '중복 없음' });
  } else {
    checks.push({ id: 'C9', label: '일정 중복', status: 'skip', detail: 'days 없음' });
  }

  // C11: hero 2-tier 정합성 (display_title 5자+, hero_tagline 있으면 8자+).
  // hero 2-tier 사고 — hero 영역이 비거나 너무 짧으면 모바일 카드에 placeholder 노출.
  // display_title 은 package-schema 에서도 min(5) 박혀있으나, 등록 폼이 우회한 케이스 잡기.
  const displayTitle = (pkg.display_title ?? '').trim();
  const heroTagline = (pkg.hero_tagline ?? '').trim();
  if (!displayTitle) {
    checks.push({ id: 'C11', label: 'hero 정합성', status: 'warn', detail: 'display_title 누락 — 모바일 hero 후킹 없음' });
  } else if (displayTitle.length < 5) {
    checks.push({ id: 'C11', label: 'hero 정합성', status: 'warn', detail: `display_title 너무 짧음 "${displayTitle}" (${displayTitle.length}자)` });
  } else if (heroTagline && heroTagline.length < 8) {
    checks.push({ id: 'C11', label: 'hero 정합성', status: 'warn', detail: `hero_tagline 너무 짧음 "${heroTagline}" (${heroTagline.length}자)` });
  } else {
    checks.push({ id: 'C11', label: 'hero 정합성', status: 'pass', detail: heroTagline ? `display+tagline 정상` : `display_title 정상 (tagline 미사용)` });
  }

  // C10: 옵션 투어 가격 유효성 — price 가 음수/문자 그대로 박힌 경우 잡기.
  const badOpt: string[] = [];
  for (const o of opts) {
    if (!o || typeof o !== 'object') continue;
    const obj = o as { name?: string; price?: number | string | null };
    if (obj.price === null || obj.price === undefined || obj.price === '') continue;
    const num = typeof obj.price === 'number' ? obj.price : Number(String(obj.price).replace(/[, ]/g, ''));
    if (!Number.isFinite(num) || num < 0) {
      badOpt.push(`${obj.name ?? '?'} = ${JSON.stringify(obj.price)}`);
    }
  }
  if (badOpt.length > 0) {
    checks.push({
      id: 'C10',
      label: '옵션 가격 유효성',
      status: 'warn',
      detail: `유효하지 않은 가격 ${badOpt.length}건: ${badOpt.slice(0, 2).join(' / ')}`,
    });
  } else if (opts.length > 0) {
    checks.push({ id: 'C10', label: '옵션 가격 유효성', status: 'pass', detail: `${opts.length}건 정상` });
  } else {
    checks.push({ id: 'C10', label: '옵션 가격 유효성', status: 'skip', detail: '옵션 투어 없음' });
  }

  const hasFail = checks.some(c => c.status === 'fail');
  const hasWarn = checks.some(c => c.status === 'warn');
  const status: VerifyResult['status'] = hasFail ? 'blocked' : hasWarn ? 'warnings' : 'clean';

  const fixable: string[] = [];
  if (checks.find(c => c.id === 'C5')?.status === 'warn') fixable.push('C5:departure_days');

  return {
    status,
    checks,
    fixable,
    passCount: checks.filter(c => c.status === 'pass').length,
    warnCount: checks.filter(c => c.status === 'warn').length,
    failCount: checks.filter(c => c.status === 'fail').length,
  };
}

/**
 * INSERT 직후 fire-and-forget 으로 호출되는 자동 verify.
 * 호출자는 await 불필요. 실패 시 로깅만 — 등록 자체엔 영향 없음.
 *
 * 동작:
 *   1. travel_packages 다시 로드 (INSERT 직후라 동일 row 존재 보장)
 *   2. evaluateVerifyChecks() 로 C1~C6 평가
 *   3. travel_packages.audit_status / audit_report / audit_checked_at UPDATE
 *   4. ai_quality_log 최신 행에 verify_checks 추가 (컨펌 큐 SSOT)
 */
export async function runUploadVerify(packageId: string): Promise<VerifyResult | null> {
  if (!isSupabaseConfigured) return null;
  try {
    const { data: rows, error } = await supabaseAdmin
      .from('travel_packages')
      .select(
        'id, title, display_title, hero_tagline, raw_text, itinerary_data, inclusions, optional_tours, price_dates, price_list, departure_days, surcharges',
      )
      .eq('id', packageId)
      .limit(1);

    if (error || !rows?.[0]) {
      console.warn('[upload-verify] pkg load 실패(무시):', error?.message ?? 'no row');
      return null;
    }

    const result = evaluateVerifyChecks(rows[0] as PackageRow);

    await supabaseAdmin
      .from('travel_packages')
      .update({
        audit_status: result.status,
        audit_report: { checks: result.checks, fixable: result.fixable, source: 'auto-upload-verify', version: 1 },
        audit_checked_at: new Date().toISOString(),
      })
      .eq('id', packageId);

    // ai_quality_log 최신 행에 verify failed_checks 병합 (컨펌 큐가 한 화면에 보도록)
    if (result.status !== 'clean') {
      const failedFromVerify = result.checks
        .filter(c => c.status === 'warn' || c.status === 'fail')
        .map(c => ({
          id: `verify_${c.id}`,
          severity: (c.status === 'fail' ? 'critical' : 'high') as 'critical' | 'high',
          passed: false,
          message: `${c.label}: ${c.detail ?? ''}`,
        }));

      if (failedFromVerify.length > 0) {
        const { data: latestLog } = await supabaseAdmin
          .from('ai_quality_log')
          .select('id, confidence, failed_checks')
          .eq('package_id', packageId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (latestLog?.id) {
          const existing = Array.isArray((latestLog as { failed_checks?: unknown[] }).failed_checks)
            ? ((latestLog as { failed_checks: unknown[] }).failed_checks)
            : [];

          // R3-A 박제 (2026-05-22) — Confidence ↔ verify outlier 감지.
          // 본 사고의 본질: V2 confidence 0.85 통과했는데 결정적 룰이 잡는 케이스.
          // confidence ≥ 0.85 AND audit warnings/blocked → 거짓 신호 후보. critical 로 표시.
          const conf = Number((latestLog as { confidence?: number | string }).confidence ?? 0);
          const extraIncidents: typeof failedFromVerify = [];
          if (Number.isFinite(conf) && conf >= 0.85 && (result.status === 'warnings' || result.status === 'blocked')) {
            extraIncidents.push({
              id: 'confidence_verify_mismatch',
              severity: 'critical',
              passed: false,
              message: `confidence ${(conf * 100).toFixed(1)}% 통과했으나 결정적 룰 ${result.status} (warn ${result.warnCount} fail ${result.failCount}) — 거짓 신호 후보, 산식 V2 재학습 시 calibration 대상`,
            });
          }

          await supabaseAdmin
            .from('ai_quality_log')
            .update({ failed_checks: [...existing, ...failedFromVerify, ...extraIncidents] })
            .eq('id', latestLog.id);

          if (extraIncidents.length > 0) {
            console.warn(`[upload-verify] ${packageId}: 거짓 신호 후보 — confidence=${conf.toFixed(3)} but audit=${result.status}`);
            // R4-A 박제 (2026-05-22) — 거짓 신호 즉시 Slack 알림.
            // SLACK_ALERT_WEBHOOK_URL 미설정 시 silent skip — 안전.
            const failedLabels = result.checks
              .filter(c => c.status === 'warn' || c.status === 'fail')
              .map(c => `${c.id} ${c.label}`).slice(0, 5).join(', ');
            void sendSlackAlert(
              `🚨 등록 거짓 신호 감지 — package_id=${packageId}`,
              {
                confidence: Number(conf.toFixed(3)),
                audit_status: result.status,
                warn: result.warnCount,
                fail: result.failCount,
                failed_checks: failedLabels,
              },
            ).catch(() => {});
          }
        }
      }
    }

    console.log(`[upload-verify] ${packageId}: ${result.status} (pass=${result.passCount} warn=${result.warnCount} fail=${result.failCount})`);
    return result;
  } catch (e) {
    console.warn('[upload-verify] 실패(무시):', (e as Error).message);
    return null;
  }
}
