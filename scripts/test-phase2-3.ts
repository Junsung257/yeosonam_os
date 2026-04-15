/**
 * Phase 2 + 3 회귀 테스트
 *
 * 실행: npx tsx scripts/test-phase2-3.ts
 *
 * 검증 대상:
 *   - parseAmountString, toSurcharge (pricing.ts)
 *   - checkAiCopyConsistency (ai-consistency-checker.ts)
 *   - getStrictPriceDates (price-dates.ts)
 */

import { parseAmountString, toSurcharge, groupSurcharges } from '../src/types/pricing';
import { checkAiCopyConsistency } from '../src/lib/ai-consistency-checker';
import { getStrictPriceDates, getEffectivePriceDates } from '../src/lib/price-dates';

let pass = 0;
let fail = 0;

function assert(name: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`✅ ${name}`);
    pass++;
  } else {
    console.log(`❌ ${name}${detail ? `\n   ${detail}` : ''}`);
    fail++;
  }
}

console.log('═══ Phase 2-A: parseAmountString ═══\n');
const amt1 = parseAmountString('8만원/인');
assert('8만원/인 → 80000원, 인', amt1.amount_krw === 80_000 && amt1.unit === '인', JSON.stringify(amt1));

const amt2 = parseAmountString('$40/인');
assert('$40/인 → usd=40, unit=인', amt2.amount_usd === 40 && amt2.unit === '인', JSON.stringify(amt2));

const amt3 = parseAmountString('룸당/박당 8만원');
assert('룸당/박당 8만원 → 80000원, 룸당', amt3.amount_krw === 80_000 && amt3.unit === '룸당', JSON.stringify(amt3));

const amt4 = parseAmountString('12만원/인/박');
assert('12만원/인/박 → 120000원, 인/박', amt4.amount_krw === 120_000 && amt4.unit === '인/박', JSON.stringify(amt4));

console.log('\n═══ Phase 2-A: toSurcharge ═══\n');
const s1 = toSurcharge('8만원/인', 'single');
assert('single 8만원 → Surcharge{kind:single, krw:80000}', s1?.kind === 'single' && s1?.amount_krw === 80_000);

const s2 = toSurcharge('포함', 'guide');
assert('"포함" → null (의미 없음)', s2 === null);

const s3 = toSurcharge('', 'guide');
assert('빈 문자열 → null', s3 === null);

console.log('\n═══ Phase 2-A: groupSurcharges ═══\n');
const grouped = groupSurcharges([
  { amount_krw: 80_000, note: '달랏 써차지', kind: 'hotel' },
  { amount_krw: 120_000, note: '싱글차지', kind: 'single' },
  { amount_krw: null, amount_usd: 40, note: '가이드경비', kind: 'guide' },
]);
assert('hotel 1개, single 1개, guide 1개로 그룹됨',
  grouped.hotel.length === 1 && grouped.single.length === 1 && grouped.guide.length === 1);

console.log('\n═══ Phase 2-D: checkAiCopyConsistency ═══\n');
const c1 = checkAiCopyConsistency({
  generatedCopy: '노팁/노옵션, 추가비용 없음',
  rawText: '불포함: 기사/가이드 경비 $40/인',
  surcharges: [{ kind: 'guide', note: '가이드경비 $40/인', amount_krw: 52_000 }],
});
assert('노옵션 주장 vs 실제 가이드팁 → severity high', c1.severity === 'high',
  `severity=${c1.severity}, conflicts=${JSON.stringify(c1.conflicts)}`);

const c2 = checkAiCopyConsistency({
  generatedCopy: '5성급 호텔에서 편안한 휴식',
  rawText: '호텔: 3성급 시내 호텔',
});
assert('5성급 주장 vs 원문 3성급 → conflict 있음', c2.conflicts.length > 0, JSON.stringify(c2.conflicts));

const c3 = checkAiCopyConsistency({
  generatedCopy: '129만원부터 즐기는 나트랑 여행',
  rawText: '요금표: 990,000원 ~ 1,190,000원',
  minPrice: 990_000,
});
assert('129만원 vs 99만원 (30% 차이) → conflict', c3.conflicts.some(c => c.rule === 'price_mismatch'),
  JSON.stringify(c3.conflicts));

const c4 = checkAiCopyConsistency({
  generatedCopy: '나트랑 5일 여행',
  rawText: '나트랑 5일 일정. 포함: 항공료, 호텔, 식사',
});
assert('정상 케이스 → severity none', c4.severity === 'none', JSON.stringify(c4));

console.log('\n═══ Phase 3-A: getStrictPriceDates vs getEffectivePriceDates ═══\n');
const strict = getStrictPriceDates({ id: 'test-1', price_dates: [] });
assert('Strict with empty → 빈 배열', strict.length === 0);

const strict2 = getStrictPriceDates({
  id: 'test-2',
  price_dates: [{ date: '2026-05-01', price: 900_000, confirmed: true }],
});
assert('Strict with data → 원본 반환', strict2.length === 1 && strict2[0].price === 900_000);

// Effective: tiers 폴백 동작 확인
const eff = getEffectivePriceDates({
  price_dates: [],
  price_tiers: [
    { period_label: '5월', departure_dates: ['2026-05-01'], adult_price: 900_000, status: 'available' },
  ],
});
assert('Effective with tiers only → 폴백 동작', eff.length === 1 && eff[0].price === 900_000);

console.log(`\n총 ${pass + fail}건 중 ${pass} 통과, ${fail} 실패`);
process.exit(fail > 0 ? 1 : 0);
