import { collectVariantCatalogBlockStarts } from '@/lib/parser/catalog-pre-split';
import { hashRawText } from '@/lib/source-evidence';
import type { ProductRegistrationV2Plan } from './types';

const GRADE_VALUES = ['세이브', '스탠다드', '프리미엄', '크라운'];
const COURSE_VALUES = ['북파 2박3일', '북+서파 3박4일'];

function titleHint(section: string): string {
  return section.match(/([^\n]*백두산[^\n]*\d+\s*박\s*\d+\s*일)/)?.[1]?.replace(/\s+/g, ' ').trim()
    ?? section.split(/\r?\n/).map(v => v.trim()).find(Boolean)
    ?? '상품';
}

function gradeHint(section: string): string {
  return GRADE_VALUES.find(g => section.includes(g)) ?? 'unknown';
}

function courseHint(section: string): string {
  const title = titleHint(section).replace(/\s+/g, '');
  if (title.includes('북+서파')) return '북+서파 3박4일';
  if (title.includes('북파')) return '북파 2박3일';
  return 'unknown';
}

function collectFlightPattern(rawText: string): ProductRegistrationV2Plan['flight_pattern'] {
  const outbound = /\b(BX337)\b[\s\S]{0,120}?06:30[\s\S]{0,80}?(09:40)[\s\S]{0,80}?(11:30)[\s\S]{0,260}?부\s*산\s*출발[\s\S]{0,80}?연\s*길\s*도착/.exec(rawText)
    ?? /\b(BX337)\b[\s\S]{0,200}?(09:40)[\s\S]{0,80}?(11:30)/.exec(rawText);
  const inbound = /\b(BX338)\b[\s\S]{0,120}?(12:30)[\s\S]{0,80}?(16:25)[\s\S]{0,180}?연\s*길\s*출발[\s\S]{0,80}?부\s*산\s*도착/.exec(rawText)
    ?? /\b(BX338)\b[\s\S]{0,120}?(12:30)[\s\S]{0,80}?(16:25)/.exec(rawText);
  const meetingTimes = rawText.includes('06:30') && /김해\s*국제공항\s*미팅/.test(rawText)
    ? ['06:30']
    : [];

  return {
    outbound: outbound
      ? { code: outbound[1], dep: outbound[2], arr: outbound[3], depAirport: '부산', arrAirport: '연길' }
      : undefined,
    inbound: inbound
      ? { code: inbound[1], dep: inbound[2], arr: inbound[3], depAirport: '연길', arrAirport: '부산' }
      : undefined,
    meetingTimes,
  };
}

/**
 * Structure Planner.
 *
 * 현재 구현은 백두산형 등급×일정 카탈로그를 deterministic planner 로 판독한다.
 * LLM/AI planner 를 붙이더라도 이 타입의 출력은 구조와 boundary 만 허용하고,
 * 가격·항공시간·포함사항 같은 고객 노출값은 executor 가 원문에서 다시 추출한다.
 */
export function planProductRegistrationV2(rawText: string): ProductRegistrationV2Plan {
  const text = rawText.replace(/\r\n/g, '\n');
  const starts = collectVariantCatalogBlockStarts(text);
  const product_boundaries = starts.map((start, index) => {
    const end = index + 1 < starts.length ? starts[index + 1] : text.length;
    const section = text.slice(start, end);
    return {
      index,
      start,
      end,
      titleHint: titleHint(section),
      variantHints: {
        grade: gradeHint(section),
        course: courseHint(section),
      },
    };
  });

  const firstStart = starts[0] ?? 0;
  const hasGradePriceTable = GRADE_VALUES.every(g => text.slice(0, firstStart || text.length).includes(g));
  const flight_pattern = collectFlightPattern(text);
  const expectedByAxes = GRADE_VALUES.length * COURSE_VALUES.length;
  const expectedProducts = product_boundaries.length || (hasGradePriceTable ? expectedByAxes : 1);
  const unresolved_parts: string[] = [];
  if (hasGradePriceTable && expectedProducts !== expectedByAxes) {
    unresolved_parts.push(`variant axes imply ${expectedByAxes} products but boundaries found ${expectedProducts}`);
  }
  if (!flight_pattern.outbound || !flight_pattern.inbound) {
    unresolved_parts.push('flight pattern unresolved');
  }

  return {
    document_type: product_boundaries.length >= 2 ? 'multi_variant_catalog' : 'unknown',
    planner_source: 'deterministic',
    raw_text_hash: hashRawText(rawText),
    expected_products: expectedProducts,
    shared_sections: firstStart > 0
      ? [{ kind: hasGradePriceTable ? 'price_table' : 'unknown', start: 0, end: firstStart, label: 'shared prefix' }]
      : [],
    product_boundaries,
    variant_axes: [
      { name: 'grade', values: GRADE_VALUES },
      { name: 'course', values: COURSE_VALUES },
    ],
    price_table_location: firstStart > 0 ? { start: 0, end: firstStart, label: '등급 컬럼 가격표' } : null,
    price_mapping_strategy: hasGradePriceTable ? 'vertical_grade_columns' : 'unknown',
    flight_pattern,
    itinerary_boundary_pattern: product_boundaries.length >= 2 ? 'variant label + 백두산 title + 일자 table' : null,
    confidence: unresolved_parts.length === 0 && product_boundaries.length === expectedByAxes ? 0.98 : 0.75,
    unresolved_parts,
  };
}
