/**
 * 가격/마진 Zod 검증 스크립트
 *
 * 실행: npx tsx scripts/test-price-validator.ts
 *
 * Phase 1-C 배포 전 회귀 방지:
 * - 5천만원 초과 → 차단
 * - 1만원 미만 → 차단
 * - 마진 600% → 차단
 * - 정상 케이스 통과
 * - determineProductStatus() 경로 검증
 */

import { ProductPriceRowSchema, determineProductStatus } from '../src/lib/upload-validator';

type TestCase = {
  name: string;
  input: {
    target_date: string | null;
    day_of_week: 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN' | null;
    net_price: number;
    adult_selling_price: number | null;
    child_price: number | null;
    note: string | null;
  };
  expectPass: boolean;
};

const cases: TestCase[] = [
  {
    name: '정상 케이스 (원가 50만, 판매가 70만, 마진 40%)',
    input: { target_date: '2026-05-01', day_of_week: null, net_price: 500_000, adult_selling_price: 700_000, child_price: 400_000, note: null },
    expectPass: true,
  },
  {
    name: '비정상: 100억원 상품 (max 초과)',
    input: { target_date: '2026-05-01', day_of_week: null, net_price: 10_000_000_000, adult_selling_price: 11_000_000_000, child_price: null, note: null },
    expectPass: false,
  },
  {
    name: '비정상: 5천원 상품 (min 미달)',
    input: { target_date: '2026-05-01', day_of_week: null, net_price: 5_000, adult_selling_price: 10_000, child_price: null, note: null },
    expectPass: false,
  },
  {
    name: '비정상: 마진 600% (원가 10만, 판매가 70만)',
    input: { target_date: '2026-05-01', day_of_week: null, net_price: 100_000, adult_selling_price: 700_000, child_price: null, note: null },
    expectPass: false,
  },
  {
    name: '정상: 마진 500% 경계 (원가 10만, 판매가 60만)',
    input: { target_date: '2026-05-01', day_of_week: null, net_price: 100_000, adult_selling_price: 600_000, child_price: null, note: null },
    expectPass: true,
  },
  {
    name: '비정상: target_date, day_of_week 둘 다 null',
    input: { target_date: null, day_of_week: null, net_price: 500_000, adult_selling_price: 700_000, child_price: null, note: null },
    expectPass: false,
  },
];

let pass = 0;
let fail = 0;

console.log('═══ Phase 1-C: ProductPriceRowSchema 검증 ═══\n');

for (const c of cases) {
  const result = ProductPriceRowSchema.safeParse(c.input);
  const ok = result.success === c.expectPass;
  const label = ok ? '✅' : '❌';
  console.log(`${label} ${c.name}`);
  if (!ok) {
    fail++;
    console.log(`   기대: ${c.expectPass ? 'pass' : 'fail'}, 실제: ${result.success ? 'pass' : 'fail'}`);
    if (!result.success) {
      console.log(`   에러: ${result.error.issues.map(i => i.message).join('; ')}`);
    }
  } else {
    pass++;
  }
}

console.log('\n═══ determineProductStatus() 경로 검증 ═══\n');

const statusCases = [
  { name: '정상 DRAFT', opts: { confidence: 0.8, netPrice: 500_000, priceRowCount: 10 }, expect: 'DRAFT' as const },
  { name: '5천만원 초과 → REVIEW_NEEDED', opts: { confidence: 0.8, netPrice: 60_000_000, priceRowCount: 10 }, expect: 'REVIEW_NEEDED' as const },
  { name: '1만원 미만 → REVIEW_NEEDED', opts: { confidence: 0.8, netPrice: 5_000, priceRowCount: 10 }, expect: 'REVIEW_NEEDED' as const },
  { name: 'confidence 0.5 → REVIEW_NEEDED', opts: { confidence: 0.5, netPrice: 500_000, priceRowCount: 10 }, expect: 'REVIEW_NEEDED' as const },
  { name: '과거 출발일 → expired', opts: { confidence: 0.9, netPrice: 500_000, priceRowCount: 10, departureDateStr: '2020-01-01' }, expect: 'expired' as const },
];

for (const c of statusCases) {
  const result = determineProductStatus(c.opts);
  const ok = result === c.expect;
  const label = ok ? '✅' : '❌';
  console.log(`${label} ${c.name} → ${result}`);
  if (!ok) {
    fail++;
    console.log(`   기대: ${c.expect}, 실제: ${result}`);
  } else {
    pass++;
  }
}

console.log(`\n총 ${pass + fail}건 중 ${pass} 통과, ${fail} 실패`);
process.exit(fail > 0 ? 1 : 0);
