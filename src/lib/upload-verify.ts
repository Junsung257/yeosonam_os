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
  raw_text?: string | null;
  itinerary_data?: { days?: unknown[] } | null;
  inclusions?: string[] | string | null;
  optional_tours?: unknown[] | null;
  price_dates?: Array<{ adult_selling_price?: number; selling_price?: number }> | null;
  price_list?: Array<{ adult_selling_price?: number; selling_price?: number }> | null;
  departure_days?: unknown;
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
  const priceRows: unknown[] = Array.isArray(pkg.price_dates)
    ? pkg.price_dates
    : Array.isArray(pkg.price_list) ? pkg.price_list : [];
  if (priceRows.length === 0) {
    checks.push({ id: 'C6', label: '가격 데이터', status: 'warn', detail: 'price_dates 행 없음 — 수동 입력 필요' });
  } else {
    checks.push({ id: 'C6', label: '가격 데이터', status: 'pass', detail: `${priceRows.length}개 가격 행` });
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
        'id, title, raw_text, itinerary_data, inclusions, optional_tours, price_dates, price_list, departure_days',
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
          .select('id, failed_checks')
          .eq('package_id', packageId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (latestLog?.id) {
          const existing = Array.isArray((latestLog as { failed_checks?: unknown[] }).failed_checks)
            ? ((latestLog as { failed_checks: unknown[] }).failed_checks)
            : [];
          await supabaseAdmin
            .from('ai_quality_log')
            .update({ failed_checks: [...existing, ...failedFromVerify] })
            .eq('id', latestLog.id);
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
