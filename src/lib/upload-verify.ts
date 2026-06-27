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
import { isScheduleDetailNoise } from '@/lib/itinerary-normalizer';
import { extractPriceIR } from '@/lib/parser/deterministic/price-ir';
import { resolvePriceRecoveryYear } from '@/lib/product-registration/price-year';
import { inferDepartureDaysFromRawText } from '@/lib/product-registration/departure-days';
import { isCustomerVisibleStatus } from '@/lib/visibility-status';
import { selectSourceBackedPriceRows } from '@/lib/source-price-date-repair';

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
  status?: string | null;
  audit_status?: string | null;
  duration?: number | null;
  nights?: number | null;
  price?: number | null;
  display_title?: string | null;
  hero_tagline?: string | null;
  raw_text?: string | null;
  trip_style?: string | null;
  itinerary_data?: {
    meta?: Record<string, unknown> | null;
    days?: Array<{
      day?: number | null;
      regions?: unknown;
      hotel?: { name?: string | null } | null;
      schedule?: Array<{
        activity?: string | null;
        note?: string | null;
        time?: string | null;
        type?: string | null;
        entity_kind?: string | null;
        attraction_ids?: unknown;
        attraction_names?: unknown;
        attraction_note?: string | null;
      } | null> | null;
    } | null> | null;
  } | null;
  accommodations?: string[] | null;
  inclusions?: string[] | string | null;
  optional_tours?: Array<{ name?: string; price?: number | string | null; price_currency?: string | null } | string | null> | null;
  price_dates?: Array<{ date?: string; price?: number; adult_selling_price?: number; selling_price?: number; currency?: string | null }> | null;
  price_list?: Array<{ adult_selling_price?: number; selling_price?: number; currency?: string | null }> | null;
  departure_days?: unknown;
  surcharges?: Array<{ amount?: number | string | null; currency?: string | null } | string | null> | null;
};

type QualityFailedCheck = {
  id?: string;
  severity?: string;
  message?: string;
  passed?: boolean;
};

export type EntityQueueRow = {
  id?: string | null;
  activity?: string | null;
  raw_label?: string | null;
  status?: string | null;
  segment_kind_guess?: string | null;
  suggested_action?: string | null;
  day_number?: number | null;
  resolved_at?: string | null;
};

function qualityStatusFromFailedChecks(checks: QualityFailedCheck[]): VerifyResult['status'] | null {
  const failed = checks.filter(c => c && c.passed === false);
  if (failed.length === 0) return null;
  if (failed.some(c => c.severity === 'critical')) return 'blocked';
  return 'warnings';
}

function mergeAuditStatus(a: VerifyResult['status'], b: VerifyResult['status'] | null): VerifyResult['status'] {
  if (a === 'blocked' || b === 'blocked') return 'blocked';
  if (a === 'warnings' || b === 'warnings') return 'warnings';
  if (a === 'skipped') return b ?? a;
  return a;
}

const ENTITY_BLOCKING_KINDS = new Set(['attraction', 'shopping', 'optional_tour', 'notice', 'unknown']);
const ENTITY_REVIEW_ACTIONS = new Set(['needs_review', 'needs_new_master', 'suggest_alias']);
const ENTITY_NON_BLOCKING_KINDS = new Set(['meal', 'transfer', 'free_time', 'price_noise', 'hotel']);

function normalizeEntityKind(value: string | null | undefined): string {
  const kind = String(value ?? '').trim().toLowerCase();
  return kind || 'unknown';
}

function entityLabel(row: EntityQueueRow): string {
  return String(row.raw_label || row.activity || row.id || 'unknown').trim();
}

export function evaluateEntityQueueChecks(rows: EntityQueueRow[]): VerifyCheck[] {
  const pending = rows.filter(row => {
    const status = String(row.status ?? '').trim().toLowerCase();
    return !row.resolved_at && (status === '' || status === 'pending' || status === 'review');
  });

  if (pending.length === 0) {
    return [{
      id: 'C15',
      label: 'entity review gate',
      status: 'pass',
      detail: 'no pending customer-visible entity rows',
    }];
  }

  const blockers = pending.filter(row => {
    const kind = normalizeEntityKind(row.segment_kind_guess);
    const action = String(row.suggested_action ?? '').trim().toLowerCase();
    if (ENTITY_NON_BLOCKING_KINDS.has(kind) && action !== 'needs_review') return false;
    return ENTITY_BLOCKING_KINDS.has(kind) || ENTITY_REVIEW_ACTIONS.has(action);
  });

  const hotelReview = pending.filter(row => normalizeEntityKind(row.segment_kind_guess) === 'hotel');
  if (blockers.length > 0) {
    const byKind = blockers.reduce<Record<string, number>>((acc, row) => {
      const kind = normalizeEntityKind(row.segment_kind_guess);
      acc[kind] = (acc[kind] ?? 0) + 1;
      return acc;
    }, {});
    const counts = Object.entries(byKind).map(([kind, count]) => `${kind}:${count}`).join(', ');
    const examples = blockers.slice(0, 5).map(entityLabel).join(' / ');
    return [{
      id: 'C15',
      label: 'entity review gate',
      status: 'fail',
      detail: `pending customer-visible entities (${counts}) examples: ${examples}`,
    }];
  }

  if (hotelReview.length > 0) {
    return [{
      id: 'C15',
      label: 'entity review gate',
      status: 'warn',
      detail: `pending hotel canonical review ${hotelReview.length} row(s): ${hotelReview.slice(0, 3).map(entityLabel).join(' / ')}`,
    }];
  }

  return [{
    id: 'C15',
    label: 'entity review gate',
    status: 'pass',
    detail: `pending non-blocking entities only (${pending.length})`,
  }];
}

function appendChecks(result: VerifyResult, extraChecks: VerifyCheck[]): VerifyResult {
  if (extraChecks.length === 0) return result;
  const checks = [...result.checks, ...extraChecks];
  const warnCount = checks.filter(c => c.status === 'warn').length;
  const failCount = checks.filter(c => c.status === 'fail').length;
  return {
    ...result,
    checks,
    warnCount,
    failCount,
    passCount: checks.filter(c => c.status === 'pass').length,
    status: failCount > 0 ? 'blocked' : warnCount > 0 ? 'warnings' : result.status,
  };
}

function asNumber(value: unknown): number | null {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(numeric) ? numeric : null;
}

function asText(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function activityLabel(item: { activity?: string | null } | null | undefined): string {
  return asText(item?.activity) || 'unknown schedule item';
}

function parseTripStyle(value: string | null | undefined): { nights: number; days: number } | null {
  const match = asText(value).match(/(\d+)\s*박\s*(\d+)\s*일/);
  if (!match) return null;
  return { nights: Number(match[1]), days: Number(match[2]) };
}

export function evaluateCustomerRenderContractChecks(pkg: PackageRow): VerifyCheck[] {
  const checks: VerifyCheck[] = [];
  const days = Array.isArray(pkg.itinerary_data?.days) ? pkg.itinerary_data.days : [];
  const meta = pkg.itinerary_data?.meta ?? {};
  const duration = asNumber(pkg.duration);
  const nights = asNumber(pkg.nights);
  const metaDays = asNumber(meta.days);
  const metaNights = asNumber(meta.nights);
  const tripStyle = parseTripStyle(pkg.trip_style) ?? parseTripStyle(pkg.title);

  const durationIssues: string[] = [];
  if (duration && days.length > 0 && days.length !== duration) {
    durationIssues.push(`itinerary days ${days.length} != product duration ${duration}`);
  }
  if (metaDays && duration && metaDays !== duration) {
    durationIssues.push(`itinerary_data.meta.days ${metaDays} != product duration ${duration}`);
  }
  if (tripStyle && duration && tripStyle.days !== duration) {
    durationIssues.push(`trip_style days ${tripStyle.days} != product duration ${duration}`);
  }
  if (tripStyle && nights !== null && tripStyle.nights !== nights) {
    durationIssues.push(`trip_style nights ${tripStyle.nights} != product nights ${nights}`);
  }
  if (metaNights !== null && nights !== null && metaNights !== nights) {
    durationIssues.push(`itinerary_data.meta.nights ${metaNights} != product nights ${nights}`);
  }

  const dayNumbers = days.map(day => asNumber(day?.day)).filter((value): value is number => value !== null);
  const duplicateDay = dayNumbers.find((value, index) => dayNumbers.indexOf(value) !== index);
  if (duplicateDay !== undefined) {
    durationIssues.push(`duplicate itinerary day number ${duplicateDay}`);
  }

  checks.push(durationIssues.length > 0
    ? {
        id: 'C16',
        label: 'customer render duration contract',
        status: 'fail',
        detail: durationIssues.slice(0, 4).join(' | '),
      }
    : {
        id: 'C16',
        label: 'customer render duration contract',
        status: days.length > 0 ? 'pass' : 'skip',
        detail: days.length > 0 ? `${days.length} itinerary day(s) consistent` : 'itinerary days unavailable',
      });

  const contaminationIssues: string[] = [];
  const mealOnlyRe = /^(?:호텔식|현지식|김밥|냉면|꿔바로우|꿔바로우|샤브샤브|삼겹살|양꼬치|비빔밥|무제한|매운탕|오리구이|산천어회)$/;
  const shoppingRe = /(?:쇼핑센터|쇼핑|면세점|침향|한약방|라텍스|차가버섯|죽탄|콜라겐|보이차|농산물|특산품|기념품)/;
  const hotelRe = /(?:HOTEL|hotel|호텔|리조트|골프텔|동급|준\s*5성|정\s*5성|5성)/i;
  const nonAttractionKinds = new Set(['meal', 'shopping', 'optional_tour', 'notice', 'hotel', 'transfer', 'price_noise', 'free_time']);

  for (const day of days) {
    for (const item of Array.isArray(day?.schedule) ? day.schedule : []) {
      const activity = activityLabel(item);
      const compact = activity.replace(/\s+/g, '');
      const kind = asText(item?.entity_kind).toLowerCase();
      const type = asText(item?.type).toLowerCase();
      const attractionIds = asArray(item?.attraction_ids).filter(Boolean);
      const hasAttractionCard = attractionIds.length > 0 || asArray(item?.attraction_names).filter(Boolean).length > 0;

      if (!activity || activity === 'unknown schedule item') continue;
      if (hasAttractionCard && (nonAttractionKinds.has(kind) || nonAttractionKinds.has(type))) {
        contaminationIssues.push(`day ${day?.day ?? '?'} non-attraction has attraction card: ${activity}`);
      }
      if (hasAttractionCard && shoppingRe.test(activity)) {
        contaminationIssues.push(`day ${day?.day ?? '?'} shopping line has attraction card: ${activity}`);
      }
      if (mealOnlyRe.test(compact) || kind === 'meal' || type === 'meal') {
        contaminationIssues.push(`day ${day?.day ?? '?'} meal-only line visible in schedule: ${activity}`);
      }
      if (hasAttractionCard && hotelRe.test(activity) && !/(?:CC|골프|라운딩|온천욕|체험|특전|상당)/i.test(activity)) {
        contaminationIssues.push(`day ${day?.day ?? '?'} hotel-like line has attraction card: ${activity}`);
      }
    }
  }

  checks.push(contaminationIssues.length > 0
    ? {
        id: 'C17',
        label: 'customer render entity contract',
        status: 'fail',
        detail: contaminationIssues.slice(0, 5).join(' | '),
      }
    : {
        id: 'C17',
        label: 'customer render entity contract',
        status: days.length > 0 ? 'pass' : 'skip',
        detail: days.length > 0 ? 'no schedule entity/card contamination detected' : 'itinerary days unavailable',
      });

  return checks;
}

async function mergeEntityQueueChecks(packageId: string, result: VerifyResult): Promise<VerifyResult> {
  const { data, error } = await supabaseAdmin
    .from('unmatched_activities')
    .select('id, activity, raw_label, status, segment_kind_guess, suggested_action, day_number, resolved_at')
    .eq('package_id', packageId)
    .limit(200);

  if (error) {
    return appendChecks(result, [{
      id: 'C15',
      label: 'entity review gate',
      status: 'warn',
      detail: `entity queue audit unavailable: ${error.message}`,
    }]);
  }

  return appendChecks(result, evaluateEntityQueueChecks((data ?? []) as EntityQueueRow[]));
}

function inferDurationDays(pkg: PackageRow): number | null {
  if (typeof pkg.duration === 'number' && Number.isFinite(pkg.duration) && pkg.duration > 0) return pkg.duration;
  const titleMatch = pkg.title?.match(/(\d+)\s*박\s*(\d+)\s*일/);
  if (titleMatch) return Number(titleMatch[2]);
  return null;
}

function priceValue(row: { price?: number; adult_price?: number; adult_selling_price?: number; selling_price?: number } | null | undefined): number | null {
  const value = row?.price ?? row?.adult_price ?? row?.adult_selling_price ?? row?.selling_price;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function isValidOptionalTourPrice(value: number | string | null | undefined): boolean {
  if (value === null || value === undefined || value === '') return true;
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0;

  const raw = String(value).trim();
  if (!raw) return true;
  if (/^(?:무료|포함|없음)$/i.test(raw)) return true;
  if (/^(?:미정|문의|현지문의|별도문의|TBD)$/i.test(raw)) return false;

  const compact = raw.replace(/\s+/g, '');
  if (/^-/.test(compact) || /(?:^|[^0-9])-[$＄₩￦￥¥€]?\d/.test(compact)) return false;

  const hasPriceUnit = /(?:[$＄₩￦￥¥€]|USD|KRW|JPY|CNY|RMB|VND|달러|불|원|엔|위안|동|\/인|1인|인당|perperson|pp)/i.test(compact);
  const numericOnly = /^[+]?\d[\d,]*(?:\.\d+)?$/.test(compact);
  const priceLike = compact.match(/[+]?(?:[$＄₩￦￥¥€])?\d[\d,]*(?:\.\d+)?(?:USD|KRW|JPY|CNY|RMB|VND|달러|불|원|엔|위안|동)?/i);

  if (!numericOnly && !hasPriceUnit) return false;
  if (!priceLike) return false;

  const amount = Number(priceLike[0].replace(/[^\d.]/g, ''));
  return Number.isFinite(amount) && amount >= 0;
}

function minPrice(rows: Array<{ price?: number; adult_price?: number; adult_selling_price?: number; selling_price?: number }>): number | null {
  const prices = rows.map(priceValue).filter((value): value is number => value != null);
  return prices.length > 0 ? Math.min(...prices) : null;
}

function todayKstDateKey(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const byType = new Map(parts.map(part => [part.type, part.value]));
  return `${byType.get('year')}-${byType.get('month')}-${byType.get('day')}`;
}

function isIsoDateKey(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function sourceMonthDayDatesForYear(rawText: string, year: number): Date[] {
  const dates: Date[] = [];
  const seen = new Set<string>();
  const monthDayRe = /(^|[^\d])(\d{1,2})\s*\/\s*(\d{1,2})(?!\s*\/?\d)/g;
  for (const line of rawText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!/^\d{1,2}\s*\/\s*\d{1,2}/.test(trimmed)) continue;
    for (const match of trimmed.matchAll(monthDayRe)) {
      const month = Number(match[2]);
      const day = Number(match[3]);
      if (!Number.isInteger(month) || !Number.isInteger(day) || month < 1 || month > 12 || day < 1 || day > 31) continue;
      const date = new Date(Date.UTC(year, month - 1, day));
      if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) continue;
      const key = date.toISOString().slice(0, 10);
      if (seen.has(key)) continue;
      seen.add(key);
      dates.push(date);
    }
  }
  return dates;
}

function shouldPreferFutureDbPriceYear(pkg: PackageRow, rawText: string, sourceYear: number, dbYear: number): boolean {
  if (dbYear <= sourceYear) return false;

  const now = new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const existingRows = (pkg.price_dates ?? [])
    .map(row => (typeof row.date === 'string' && isIsoDateKey(row.date) ? new Date(`${row.date}T00:00:00Z`) : null))
    .filter((date): date is Date => date instanceof Date && Number.isFinite(date.getTime()));
  const allExistingFuture = existingRows.length > 0 && existingRows.every(date => date.getTime() >= todayUtc);
  if (!allExistingFuture || sourceYear > now.getUTCFullYear()) return false;

  const sourceDates = sourceMonthDayDatesForYear(rawText, sourceYear);
  return sourceDates.length > 0 && sourceDates.every(date => date.getTime() < todayUtc);
}

function inferPriceVerifyYear(pkg: PackageRow, rawText: string): number {
  const sourceYear = resolvePriceRecoveryYear({ rawText });
  const dbYear = (pkg.price_dates ?? [])
    .map(row => (typeof row.date === 'string' ? Number(row.date.slice(0, 4)) : NaN))
    .find(year => Number.isFinite(year) && year >= 2000);
  if (sourceYear && dbYear && dbYear > sourceYear) {
    if (shouldPreferFutureDbPriceYear(pkg, rawText, sourceYear, dbYear)) return dbYear;
  }
  if (sourceYear) return sourceYear;

  if (dbYear) return dbYear;

  const rawYear = Number(rawText.match(/\b(20\d{2})\b/)?.[1] ?? 0);
  if (rawYear >= 2000) return rawYear;

  return new Date().getFullYear();
}

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
    const standardOptSection = rawText.includes('YSN-PRODUCT-MD')
      ? rawText.match(/^##\s*선택관광\s*\n([\s\S]*?)(?=^##\s+)/m)
      : null;
    const optSection = standardOptSection ?? rawText.match(/선택\s*관광[^\n]*\n([\s\S]*?)(?=\n{2,}|\[|$)/);
    const optLines = optSection ? optSection[1].split(/\r?\n/) : [];
    const rawOptCount = standardOptSection
      ? optLines
          .map(line => line.replace(/^\s*[-•·▶◆○●]\s*/, '').trim())
          .filter(line => line && !/^#+/.test(line) && !/^없음$/i.test(line))
          .length
      : optLines.filter(line => /^\s*[-•·▶◆○●]/.test(line)).length;
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
  const inferredDepartureDays = hasRaw ? inferDepartureDaysFromRawText(rawText) : null;
  if (pkg.departure_days !== null && pkg.departure_days !== undefined) {
    const depStr = typeof pkg.departure_days === 'string' ? pkg.departure_days : JSON.stringify(pkg.departure_days);
    if (/^\[/.test(depStr.trim())) {
      checks.push({ id: 'C5', label: '출발요일 형식', status: 'warn', detail: `JSON 배열 문자열 누출: "${depStr.slice(0, 30)}"` });
    } else if (inferredDepartureDays && !depStr.includes(inferredDepartureDays)) {
      checks.push({ id: 'C5', label: '출발요일 원문 대조', status: 'warn', detail: `원문 "${inferredDepartureDays}" vs DB "${depStr}" 불일치` });
    } else {
      checks.push({ id: 'C5', label: '출발요일 형식', status: 'pass', detail: `"${depStr.slice(0, 20)}" 정상` });
    }
  } else if (inferredDepartureDays) {
    checks.push({ id: 'C5', label: '출발요일 원문 대조', status: 'fail', detail: `원문에 "${inferredDepartureDays}" 출발요일이 있으나 DB departure_days 없음` });
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

  // C12: deterministic 가격 재대조 — 공통 가격표의 다중 컬럼/박수/요일 오매칭 차단.
  if (hasRaw) {
    const datedPriceRows = Array.isArray(pkg.price_dates)
      ? pkg.price_dates.filter(row => isIsoDateKey(row.date))
      : [];
    if (datedPriceRows.length > 0) {
      const today = todayKstDateKey();
      const activeRows = datedPriceRows.filter(row => (row.date as string) >= today);
      if (activeRows.length === 0) {
        checks.push({
          id: 'C14',
          label: 'departure date freshness',
          status: 'fail',
          detail: `all ${datedPriceRows.length} departure dates are before today ${today}`,
        });
      } else {
        checks.push({
          id: 'C14',
          label: 'departure date freshness',
          status: 'pass',
          detail: `${activeRows.length}/${datedPriceRows.length} departure dates remain bookable`,
        });
      }
    } else {
      checks.push({
        id: 'C14',
        label: 'departure date freshness',
        status: 'skip',
        detail: 'no ISO departure dates',
      });
    }

    const durationDays = inferDurationDays(pkg);
    const depDays = typeof pkg.departure_days === 'string'
      ? pkg.departure_days
      : inferredDepartureDays;
    const expected = extractPriceIR(rawText, {
      year: inferPriceVerifyYear(pkg, rawText),
      title: pkg.title,
      durationDays,
      departureDays: depDays,
      accommodations: pkg.accommodations ?? [],
    });
    const expectedRows = selectSourceBackedPriceRows(pkg, expected.rows);
    const dbPriceDates = Array.isArray(pkg.price_dates) ? pkg.price_dates : [];
    if (expectedRows.length === 0) {
      checks.push({ id: 'C12', label: '가격표 원문 재대조', status: 'skip', detail: 'deterministic 가격표 미인식' });
    } else if (dbPriceDates.length === 0) {
      checks.push({ id: 'C12', label: '가격표 원문 재대조', status: 'fail', detail: `원문 가격 ${expectedRows.length}건 인식, DB price_dates 없음` });
    } else {
      const expectedMin = minPrice(expectedRows);
      const dbMin = minPrice(dbPriceDates);
      const expectedByDate = new Map(expectedRows.map(row => [row.date, row.adult_price]));
      const dbByDate = new Map(
        dbPriceDates
          .filter(row => typeof row.date === 'string')
          .map(row => [row.date as string, priceValue(row)]),
      );
      const mismatches: string[] = [];
      for (const [date, expectedPrice] of expectedByDate) {
        const actual = dbByDate.get(date);
        if (actual == null || actual !== expectedPrice) {
          mismatches.push(`${date}:${actual ?? '없음'}!=${expectedPrice}`);
          if (mismatches.length >= 3) break;
        }
      }
      const extraDates = [...dbByDate.keys()]
        .filter(date => !expectedByDate.has(date))
        .sort()
        .slice(0, 3);

      if (expectedMin != null && dbMin != null && expectedMin !== dbMin) {
        checks.push({
          id: 'C12',
          label: '가격표 원문 재대조',
          status: 'fail',
          detail: `최저가 불일치: 원문 ${expectedMin.toLocaleString()}원 vs DB ${dbMin.toLocaleString()}원`,
        });
      } else if (mismatches.length > 0) {
        checks.push({
          id: 'C12',
          label: '가격표 원문 재대조',
          status: 'fail',
          detail: `날짜별 가격 불일치 ${mismatches.join(' / ')}`,
        });
      } else if (extraDates.length > 0) {
        checks.push({
          id: 'C12',
          label: '가격표 원문 재대조',
          status: 'fail',
          detail: `원문에 없는 출발일 포함 ${extraDates.join(', ')}`,
        });
      } else {
        checks.push({
          id: 'C12',
          label: '가격표 원문 재대조',
          status: 'pass',
          detail: `원문 ${expectedRows.length}건 ↔ DB ${dbPriceDates.length}건 정합`,
        });
      }
    }
  } else {
    checks.push({ id: 'C12', label: '가격표 원문 재대조', status: 'skip', detail: '원문 없음' });
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
      if (isScheduleDetailNoise(key)) continue;
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
    if (!isValidOptionalTourPrice(obj.price)) {
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

  const renderContractChecks = evaluateCustomerRenderContractChecks(pkg);
  checks.push(...renderContractChecks);

  if (pkg.status === undefined && pkg.audit_status === undefined) {
    checks.push({
      id: 'C13',
      label: 'customer visibility gate',
      status: 'skip',
      detail: 'status fields unavailable',
    });
  } else if (!isCustomerVisibleStatus(pkg.status)) {
    checks.push({
      id: 'C13',
      label: 'customer visibility gate',
      status: 'fail',
      detail: `status=${pkg.status ?? 'null'} is not customer-visible`,
    });
  } else {
    checks.push({
      id: 'C13',
      label: 'customer visibility gate',
      status: 'pass',
      detail: `status=${pkg.status}`,
    });
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
        'id, title, status, audit_status, duration, nights, price, display_title, hero_tagline, raw_text, trip_style, itinerary_data, accommodations, inclusions, optional_tours, price_dates, price_list, departure_days, surcharges',
      )
      .eq('id', packageId)
      .limit(1);

    if (error || !rows?.[0]) {
      console.warn('[upload-verify] pkg load 실패(무시):', error?.message ?? 'no row');
      return null;
    }

    let result = evaluateVerifyChecks(rows[0] as PackageRow);
    result = await mergeEntityQueueChecks(packageId, result);

    const { data: latestQualityLog } = await supabaseAdmin
      .from('ai_quality_log')
      .select('id, confidence, failed_checks')
      .eq('package_id', packageId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const existingQualityChecks = Array.isArray((latestQualityLog as { failed_checks?: unknown[] } | null)?.failed_checks)
      ? ((latestQualityLog as { failed_checks: QualityFailedCheck[] }).failed_checks)
      : [];
    const qualityStatus = qualityStatusFromFailedChecks(existingQualityChecks);
    const mergedStatus = mergeAuditStatus(result.status, qualityStatus);

    await supabaseAdmin
      .from('travel_packages')
      .update({
        audit_status: mergedStatus,
        audit_report: {
          checks: result.checks,
          fixable: result.fixable,
          source: 'auto-upload-verify',
          version: 2,
          quality_status: qualityStatus,
          quality_failed_checks: existingQualityChecks.filter(c => c && c.passed === false).slice(0, 20),
        },
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
        const latestLog = latestQualityLog;

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

    if (mergedStatus !== result.status) {
      console.warn(`[upload-verify] ${packageId}: quality log escalated audit ${result.status} -> ${mergedStatus}`);
    }
    console.log(`[upload-verify] ${packageId}: ${mergedStatus} (pass=${result.passCount} warn=${result.warnCount} fail=${result.failCount})`);
    return { ...result, status: mergedStatus };
  } catch (e) {
    console.warn('[upload-verify] 실패(무시):', (e as Error).message);
    return null;
  }
}
