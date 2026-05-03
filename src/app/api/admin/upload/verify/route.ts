import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

interface VerifyCheck {
  id: string;
  label: string;
  status: 'pass' | 'warn' | 'fail' | 'skip';
  detail?: string;
}

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });

  try {
    const { packageId } = await request.json();
    if (!packageId) return NextResponse.json({ error: 'packageId 필요' }, { status: 400 });

    const { data: rows, error } = await supabaseAdmin
      .from('travel_packages')
      .select(
        'id, title, raw_text, itinerary_data, inclusions, optional_tours, price_dates, price_list, departure_days',
      )
      .eq('id', packageId)
      .limit(1);

    if (error) throw error;
    const pkg = rows?.[0];
    if (!pkg) return NextResponse.json({ error: '상품 없음' }, { status: 404 });

    const checks: VerifyCheck[] = [];
    const rawText: string = typeof pkg.raw_text === 'string' ? pkg.raw_text : '';
    const hasRaw = rawText.length > 50;

    // C1: 일차 수 대조 (원문 "제N일" vs itinerary_data.days.length)
    if (hasRaw) {
      const dayNums = [...rawText.matchAll(/제\s*(\d+)\s*일/g)].map(m => parseInt(m[1]));
      const rawDayMax = dayNums.length > 0 ? Math.max(...dayNums) : 0;
      const dbDays: number = Array.isArray(pkg.itinerary_data?.days) ? pkg.itinerary_data.days.length : 0;

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

    // C2: 선택관광 개수 (원문 "선택관광" 섹션 항목 수 vs optional_tours.length)
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

    // C3: 특식 포함 여부 (원문 "특식 N회" vs inclusions)
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

    // C4: 최저가 대조 (원문 "최저가/취항특가" vs price_dates 최저가)
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

    // C5: departure_days 형식 (W16 — JSON 배열 문자열 누출 감지)
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
    const auditStatus = hasFail ? 'blocked' : hasWarn ? 'warnings' : 'clean';

    const fixable: string[] = [];
    if (checks.find(c => c.id === 'C5')?.status === 'warn') fixable.push('C5:departure_days');

    await supabaseAdmin
      .from('travel_packages')
      .update({
        audit_status: auditStatus,
        audit_report: { checks, fixable, source: 'upload-verify', version: 1 },
        audit_checked_at: new Date().toISOString(),
      })
      .eq('id', packageId);

    return NextResponse.json({
      status: auditStatus,
      checks,
      fixable,
      passCount: checks.filter(c => c.status === 'pass').length,
      warnCount: checks.filter(c => c.status === 'warn').length,
      failCount: checks.filter(c => c.status === 'fail').length,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '검증 실패' },
      { status: 500 },
    );
  }
}
