/**
 * @file l1-customer-ready-gate.ts — L1 고객 노출(CRC) 게이트
 *
 * postProcess + renderPackage 기준으로 모바일·A4에 그대로 나갈 데이터가
 * BLOCK/WARN 조건을 통과하는지 검사. INSERT 직전 SSOT.
 */

import { LEAK_PATTERNS } from '@/lib/customer-leak-sanitizer';
import { isSynthesizedRawText } from '@/lib/packages/raw-text';
import type { PostProcessCatalogInput, ItineraryLike } from '@/lib/package-post-process';
import { postProcessPackageRow } from '@/lib/package-post-process';
import { renderPackage, isFerryPackage, type RenderPackageInput } from '@/lib/render-contract';

const LANDMARK_WHITELIST = [
  '메르데카 광장',
  '바투동굴',
  '겐팅 하이랜드',
  '푸트라자야',
  '보타닉가든',
  '가든스 바이 더 베이',
  '야경투어',
];

export type L1GateResult = {
  /** BLOCK — pending_review / review_required (고객 공개 금지) */
  reasons: string[];
  /** WARN — draft / pending 유지, 사장님 검수 권장 */
  warnings: string[];
  /** audit 코드 (M7, LEAK_commission_label 등) */
  codes: string[];
};

export type L1GateInput = {
  row: PostProcessCatalogInput & { itinerary_data?: unknown; surcharges?: unknown[] | null };
  rawText?: string | null;
  internalCode?: string | null;
  shortCode?: string | null;
  /** 이미 postProcessPackageRow 적용됐으면 true */
  alreadyProcessed?: boolean;
};

function scanCriticalLeaks(text: string): Array<{ id: string; message: string }> {
  const hits: Array<{ id: string; message: string }> = [];
  if (!text) return hits;
  for (const rule of LEAK_PATTERNS) {
    if (rule.severity !== 'critical') continue;
    const re = new RegExp(rule.pattern.source, rule.pattern.flags);
    const m = text.match(re);
    if (m?.[0]) {
      hits.push({ id: `LEAK_${rule.id}`, message: `${rule.description}: "${m[0].slice(0, 40)}"` });
    }
  }
  return hits;
}

function collectCustomerText(row: Record<string, unknown>): string {
  const parts: string[] = [];
  const pushArr = (arr: unknown, prefix: string) => {
    if (!Array.isArray(arr)) return;
    for (let i = 0; i < arr.length; i++) {
      const v = arr[i];
      if (typeof v === 'string') parts.push(v);
      else if (v && typeof v === 'object' && 'text' in v) {
        parts.push(String((v as { text?: string }).text ?? ''));
      }
    }
  };
  pushArr(row.excludes, 'excludes');
  pushArr(row.inclusions, 'inclusions');
  pushArr(row.notices_parsed, 'notices');
  const itin = row.itinerary_data as { days?: Array<{ schedule?: Array<{ activity?: string }> }> };
  for (const d of itin?.days ?? []) {
    for (const s of d.schedule ?? []) {
      if (s.activity) parts.push(s.activity);
    }
  }
  if (Array.isArray(row.surcharges)) {
    for (const s of row.surcharges) {
      if (s && typeof s === 'object') parts.push(JSON.stringify(s));
    }
  }
  return parts.join('\n');
}

/** postProcess된 row 기준 L1 검사 (renderPackage = 모바일 SSOT) */
export function evaluateL1CustomerReadyGate(input: L1GateInput): L1GateResult {
  const reasons: string[] = [];
  const warnings: string[] = [];
  const codes: string[] = [];

  const raw = (input.rawText ?? input.row.raw_text ?? '').trim();
  const processed = input.alreadyProcessed
    ? (input.row as PostProcessCatalogInput & { itinerary_data?: unknown })
    : postProcessPackageRow(input.row as PostProcessCatalogInput & { itinerary_data?: ItineraryLike });

  const pkg = processed as RenderPackageInput;
  const view = renderPackage(pkg);

  // BLOCK: 합성 raw (등록 원문 아님)
  if (isSynthesizedRawText(raw)) {
    codes.push('STUB_RAW_TEXT');
    reasons.push('raw_text가 필드 합성 스텁 — PDF 원문 재업로드 필요');
  }

  // BLOCK: 상품 코드 없음
  if (!input.internalCode?.trim() && !input.shortCode?.trim()) {
    codes.push('MISSING_PRODUCT_CODE');
    reasons.push('internal_code/short_code 없음 — 카탈로그 식별 불가');
  }

  // BLOCK: 일정 없음 (M7)
  if (view.days.length === 0) {
    codes.push('M7_NO_ITINERARY');
    reasons.push('itinerary_data.days 비어 있음 — 모바일 일정표 렌더 불가');
  }

  // BLOCK: CRITICAL leak
  const leakHits = scanCriticalLeaks(collectCustomerText(processed as Record<string, unknown>));
  for (const hit of leakHits) {
    codes.push(hit.id);
    reasons.push(`고객 노출 금지 정보: ${hit.message}`);
  }

  // BLOCK: 쇼핑 패널티 UI (M2/M3)
  const shopRe = /패널티|쇼핑\s*샵|150\s*불|150\s*\$|USD\s*150/i;
  for (const s of view.surchargesMerged) {
    if (shopRe.test(s.label)) {
      codes.push('M2_SHOPPING_IN_SURCHARGES');
      reasons.push(`쇼핑 패널티가 추가요금 UI에 노출: ${s.label.slice(0, 50)}`);
      break;
    }
  }
  for (const e of view.excludes.basic) {
    if (shopRe.test(e)) {
      codes.push('M3_SHOPPING_IN_EXCLUDES');
      reasons.push(`쇼핑 패널티가 불포함 UI에 노출: ${e.slice(0, 50)}`);
      break;
    }
  }

  // BLOCK: 항공 헤더 공란 (M1) — ferry/cruise 제외
  if (!isFerryPackage(pkg)) {
    const daysRaw = (processed.itinerary_data as { days?: Array<{ schedule?: Array<{ type?: string }> }>; flight_segments?: unknown[]; meta?: { flight_out?: string; flight_in?: string } }) ?? {};
    const hasFlightSignal =
      (daysRaw.flight_segments?.length ?? 0) > 0 ||
      Boolean(daysRaw.meta?.flight_out || daysRaw.meta?.flight_in) ||
      (daysRaw.days ?? []).some(d => (d.schedule ?? []).some(s => s.type === 'flight'));

    if (hasFlightSignal) {
      const out = view.flightHeader.outbound;
      const inn = view.flightHeader.inbound;
      const missingOut = !out?.depTime && !out?.arrTime;
      const missingIn = !inn?.depTime && !inn?.arrTime;
      if (missingOut || missingIn) {
        codes.push('M1_FLIGHT_HEADER_EMPTY');
        reasons.push('항공 일정은 있으나 출발/귀국 헤더 시간 누락');
      }
    }
  }

  // BLOCK: W18 교차 오염
  if (raw.length >= 50 && daysRawDays(processed)) {
    for (const { day, activity } of daysRawDays(processed)!) {
      for (const landmark of LANDMARK_WHITELIST) {
        if (activity.includes(landmark) && !raw.includes(landmark)) {
          codes.push('W18_ERR-KUL-02');
          reasons.push(`DAY${day} "${landmark}" — 원문에 없는 랜드마크 (교차 오염)`);
          break;
        }
      }
    }
  }

  // WARN: notices 4타입
  const types = new Set(
    (processed.notices_parsed as Array<{ type?: string }> ?? []).map(n => n.type).filter(Boolean),
  );
  for (const t of ['CRITICAL', 'PAYMENT', 'POLICY', 'INFO']) {
    if (!types.has(t)) {
      codes.push('M6_NOTICE_TYPE_MISSING');
      warnings.push(`notices_parsed ${t} 누락`);
    }
  }

  // WARN: DAY1 미팅 시각 (M4)
  const day1 = view.days[0];
  if (day1) {
    for (const item of day1.schedule) {
      if (/미팅|meeting|공항\s*미팅/i.test(item.activity ?? '') && item.time) {
        codes.push('M4_DAY1_MEETING_TIME');
        warnings.push(`DAY1 미팅 시각 표기: ${item.time} (출발 전 계산값 잔존)`);
        break;
      }
    }
  }

  // WARN: B2B leak (high)
  for (const rule of LEAK_PATTERNS) {
    if (rule.severity !== 'high') continue;
    const blob = collectCustomerText(processed as Record<string, unknown>);
    const re = new RegExp(rule.pattern.source, rule.pattern.flags);
    if (re.test(blob)) {
      codes.push(`LEAK_${rule.id}`);
      warnings.push(`B2B 용어 잔존: ${rule.description}`);
    }
  }

  return { reasons, warnings, codes };
}

function daysRawDays(
  processed: PostProcessCatalogInput & { itinerary_data?: unknown },
): Array<{ day: number; activity: string }> | null {
  const days = (processed.itinerary_data as { days?: Array<{ day?: number; schedule?: Array<{ activity?: string | null }> }> })?.days;
  if (!days?.length) return null;
  const out: Array<{ day: number; activity: string }> = [];
  for (const d of days) {
    for (const s of d.schedule ?? []) {
      const act = s.activity ?? '';
      if (act) out.push({ day: d.day ?? 0, activity: act });
    }
  }
  return out;
}

/** L1 통과 + confidence OK → approved */
export function decidePackageStatusFromL1(
  l1: L1GateResult,
  options?: { confidence?: number; minConfidence?: number; allowWarningsApprove?: boolean },
): 'approved' | 'pending_review' {
  if (l1.reasons.length > 0) return 'pending_review';
  const minConf = options?.minConfidence ?? 0.85;
  const conf = options?.confidence ?? 0;
  if (conf < minConf) return 'pending_review';
  if (l1.warnings.length > 0 && !options?.allowWarningsApprove) return 'pending_review';
  return 'approved';
}
