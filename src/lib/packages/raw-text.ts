/**
 * @file src/lib/packages/raw-text.ts
 *
 * 상품 ID → 원문 텍스트 + productMeta 합성.
 *
 * 우선순위:
 *   1. normalized_intakes.raw_text (Phase 1.5 IR 로 등록된 진짜 원문)
 *   2. travel_packages 정형 필드 합성
 *
 * 사용처:
 *   - GET /api/packages/[id]/raw-text   (UI/외부에서 호출)
 *   - GET /api/cron/card-news-seasonal  (cron 내부 직접 호출 — self-fetch 금지)
 *   - 그 외 카드뉴스 생성기 자동 호출 흐름 전반
 *
 * Faithfulness Rule (A0): 이 함수가 반환하는 rawText 만이 LLM 입력의 fact source.
 */

import { supabaseAdmin } from '@/lib/supabase';

export interface PackageRawText {
  rawText: string;
  source: 'normalized_intakes' | 'synthesized';
  productMeta: {
    title: string | null;
    destination: string | null;
    duration: number | null;
    nights: number | null;
    price: number | null;
    highlights: string[];
    departureDates: string[];
  };
}

export type PackageRawTextResult =
  | { ok: true; data: PackageRawText }
  | { ok: false; status: number; error: string };

interface ItineraryDay {
  day?: number;
  date?: string;
  region?: string;
  schedule?: Array<string | { activity?: string; time?: string }>;
}

export async function getPackageRawText(packageId: string): Promise<PackageRawTextResult> {
  if (!packageId) {
    return { ok: false, status: 400, error: 'package id 누락' };
  }

  // 1. Phase 1.5 IR 원문 우선
  const { data: intakes } = await supabaseAdmin
    .from('normalized_intakes')
    .select('raw_text, created_at')
    .eq('package_id', packageId)
    .order('created_at', { ascending: false })
    .limit(1);

  // 2. travel_packages + products(selling_price) 조회
  const { data: pkgRows, error: pkgErr } = await supabaseAdmin
    .from('travel_packages')
    .select(`
      id, title, destination, duration, nights,
      product_summary, product_highlights, inclusions, excludes,
      itinerary_data, special_notes, optional_tours, departure_dates,
      products(selling_price, departure_region, internal_code)
    `)
    .eq('id', packageId)
    .limit(1);

  if (pkgErr) {
    return { ok: false, status: 500, error: `상품 조회 실패: ${pkgErr.message}` };
  }
  const pkg = pkgRows?.[0];
  if (!pkg) {
    return { ok: false, status: 404, error: '상품을 찾을 수 없음' };
  }

  const product = Array.isArray(pkg.products) ? pkg.products[0] : pkg.products;
  const sellingPrice = product?.selling_price ?? null;
  const departureRegion = product?.departure_region ?? null;

  const productMeta: PackageRawText['productMeta'] = {
    title: pkg.title ?? null,
    destination: pkg.destination ?? null,
    duration: pkg.duration ?? null,
    nights: pkg.nights ?? null,
    price: sellingPrice,
    highlights: Array.isArray(pkg.product_highlights) ? pkg.product_highlights : [],
    departureDates: Array.isArray(pkg.departure_dates) ? pkg.departure_dates : [],
  };

  let rawText: string;
  let source: PackageRawText['source'];

  if (
    intakes?.[0]?.raw_text &&
    typeof intakes[0].raw_text === 'string' &&
    intakes[0].raw_text.trim().length > 0
  ) {
    rawText = intakes[0].raw_text;
    source = 'normalized_intakes';
  } else {
    rawText = synthesizeRawText({ ...pkg, sellingPrice, departureRegion });
    source = 'synthesized';
  }

  return { ok: true, data: { rawText, source, productMeta } };
}

function synthesizeRawText(p: {
  title?: string | null;
  destination?: string | null;
  departureRegion?: string | null;
  duration?: number | null;
  nights?: number | null;
  sellingPrice?: number | null;
  product_summary?: string | null;
  product_highlights?: string[] | null;
  inclusions?: string[] | null;
  excludes?: string[] | null;
  itinerary_data?: ItineraryDay[] | { days?: ItineraryDay[] } | null;
  special_notes?: string | string[] | null;
  optional_tours?: Array<string | { name?: string; price?: string | number }> | null;
  departure_dates?: string[] | null;
}): string {
  const lines: string[] = [];

  if (p.title) lines.push(`# ${p.title}`);
  if (p.destination) lines.push(`목적지: ${p.destination}`);
  if (p.departureRegion) lines.push(`출발지: ${p.departureRegion}`);
  if (p.duration && p.nights != null) {
    lines.push(`기간: ${p.nights}박${p.duration}일`);
  }
  if (p.sellingPrice) {
    lines.push(`가격: ${p.sellingPrice.toLocaleString('ko-KR')}원~ (1인 기준)`);
  }

  if (p.product_summary && typeof p.product_summary === 'string') {
    lines.push('');
    lines.push('## 상품 소개');
    lines.push(p.product_summary.trim());
  }

  const highlights = Array.isArray(p.product_highlights) ? p.product_highlights : [];
  if (highlights.length) {
    lines.push('');
    lines.push('## 핵심 특징');
    highlights.forEach((h) => {
      if (h && typeof h === 'string') lines.push(`- ${h}`);
    });
  }

  const inclusions = Array.isArray(p.inclusions) ? p.inclusions : [];
  if (inclusions.length) {
    lines.push('');
    lines.push('## 포함 사항');
    inclusions.forEach((i) => {
      if (i && typeof i === 'string') lines.push(`- ${i}`);
    });
  }

  const excludes = Array.isArray(p.excludes) ? p.excludes : [];
  if (excludes.length) {
    lines.push('');
    lines.push('## 불포함');
    excludes.forEach((e) => {
      if (e && typeof e === 'string') lines.push(`- ${e}`);
    });
  }

  const itinerary = p.itinerary_data;
  const days: ItineraryDay[] = Array.isArray(itinerary)
    ? itinerary
    : Array.isArray((itinerary as { days?: ItineraryDay[] } | null)?.days)
      ? ((itinerary as { days: ItineraryDay[] }).days)
      : [];
  if (days.length) {
    lines.push('');
    lines.push('## 일정');
    days.forEach((day, idx) => {
      const dayNum = day.day ?? idx + 1;
      const region = day.region ? ` (${day.region})` : '';
      const schedule = Array.isArray(day.schedule) ? day.schedule : [];
      const activities = schedule
        .map((s) => (typeof s === 'string' ? s : s?.activity))
        .filter((s): s is string => !!s && typeof s === 'string')
        .slice(0, 6);
      const summary = activities.length ? activities.join(', ') : '';
      lines.push(`${dayNum}일차${region}${summary ? `: ${summary}` : ''}`);
    });
  }

  const optionalTours = Array.isArray(p.optional_tours) ? p.optional_tours : [];
  if (optionalTours.length) {
    lines.push('');
    lines.push('## 선택 관광 (참고)');
    optionalTours.slice(0, 5).forEach((t) => {
      if (typeof t === 'string') lines.push(`- ${t}`);
      else if (t?.name) lines.push(`- ${t.name}${t.price ? ` (${t.price})` : ''}`);
    });
  }

  if (p.special_notes) {
    lines.push('');
    lines.push('## 비고');
    if (typeof p.special_notes === 'string') {
      lines.push(p.special_notes.trim());
    } else if (Array.isArray(p.special_notes)) {
      p.special_notes.forEach((n) => {
        if (typeof n === 'string') lines.push(`- ${n}`);
      });
    }
  }

  const departureDates = Array.isArray(p.departure_dates) ? p.departure_dates : [];
  if (departureDates.length) {
    lines.push('');
    lines.push(`출발일: ${departureDates.join(', ')}`);
  }

  return lines.join('\n').trim();
}
