/**
 * 일정표 렌더링 순서 검증 스크립트
 *
 * 실행: npx tsx scripts/test-itinerary-order.ts
 *
 * 목적:
 * - parseDaysWithTransport 호출 결과가 YeosonamA4Template의
 *   unifiedTimeline(정렬 없이 원본 순서 유지)과 동일한지 검증
 * - 5개 실제 상품 day별 기대 시퀀스와 비교
 * - 5개 전부 통과해야 배포 가능
 */
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';
import {
  parseDaysWithTransport,
  isTransportSegment,
  type ParsedScheduleItem,
  type TransportSegment,
} from '../src/lib/transportParser';

// ── Supabase 클라이언트 ──
const envFile = fs.readFileSync('.env.local', 'utf-8');
const env: Record<string, string> = {};
envFile.split('\n').forEach(l => {
  const [k, ...v] = l.split('=');
  if (k) env[k.trim()] = v.join('=').trim();
});
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!);

// ── 기대 시퀀스 타입 ──
type ExpectedEntry =
  | { type: 'item'; contains: string }
  | { type: 'transport'; mode: 'air' | 'ship' | 'train'; depTime?: string; arrTime?: string };

interface TestCase {
  name: string;
  titleQuery: string;
  dayNum: number;
  expected: ExpectedEntry[];
}

// ── 테스트 케이스 5개 (실제 DB 데이터 기반) ──
const TESTS: TestCase[] = [
  {
    name: '1. 부관훼리 day 3',
    titleQuery: '부관훼리',
    dayNum: 3,
    expected: [
      { type: 'item', contains: '조식' },
      { type: 'item', contains: '스즈메' },
      { type: 'item', contains: '다자이후 이동' },
      { type: 'item', contains: '텐만구' },
      { type: 'item', contains: '면세점' },
      { type: 'item', contains: '후쿠오카 이동' },
      { type: 'item', contains: '라라포트' },
      { type: 'item', contains: '시모노세키항 이동' },
      { type: 'item', contains: '부두 도착' },
      { type: 'transport', mode: 'ship', depTime: '19:45' },
    ],
  },
  {
    name: '2. 방비엥 day 2',
    titleQuery: '비엔티엔/루앙프라방/방비엥 노팁풀옵션 3박5일',
    dayNum: 2,
    expected: [
      { type: 'item', contains: '비엔티엔 기차역으로 이동' },
      { type: 'transport', mode: 'train', depTime: '09:50' },
      { type: 'item', contains: '왓 마이' },
      { type: 'item', contains: '왓 씨엥통' },
      { type: 'item', contains: '쾅시폭포' },
      { type: 'item', contains: '푸씨산' },
      { type: 'item', contains: '몽족 야시장' },
      { type: 'item', contains: '호텔 투숙' },
    ],
  },
  {
    name: '3. 방비엥 day 3',
    titleQuery: '비엔티엔/루앙프라방/방비엥 노팁풀옵션 3박5일',
    dayNum: 3,
    expected: [
      { type: 'item', contains: '탁밧행렬' },
      { type: 'item', contains: '아침시장' },
      { type: 'item', contains: '왕궁 박물관' },
      { type: 'transport', mode: 'train', depTime: '14:02' },
      { type: 'item', contains: '블루라군' },
      { type: 'item', contains: '짚라인' },
      { type: 'item', contains: '롱테일보트' },
      { type: 'item', contains: '여행자 거리' },
    ],
  },
  {
    name: '4. 장가계 day 1',
    titleQuery: '장가계 4박5일 #노팁노옵션 #준5성',
    dayNum: 1,
    expected: [
      { type: 'transport', mode: 'air', depTime: '09:00' },
      { type: 'item', contains: '천문산 등정' },
      { type: 'item', contains: '봉우리' },
      { type: 'item', contains: '천문동' },
      { type: 'item', contains: '케이블카' },
      { type: 'item', contains: '천문호선쇼' },
    ],
  },
  {
    name: '5. 나트랑/달랏 라이트 day 4',
    titleQuery: '나트랑/달랏 노팁노옵션 라이트',
    dayNum: 4,
    // 주의: 현재 파서는 cross-day air pair 미지원.
    // day 4 "23:20 나트랑 깜란 국제공항 출발"은 단독이므로 일반 불릿(time 포함 item)로 렌더됨.
    expected: [
      { type: 'item', contains: '쑤언흐엉호수' },
      { type: 'item', contains: '쇼핑관광' },
      { type: 'item', contains: '린푸억사원' },
      { type: 'item', contains: '나트랑으로 이동' },
      { type: 'item', contains: '롱선사' },
      { type: 'item', contains: '나트랑대성당' },
      { type: 'item', contains: '야간시티투어' },
      { type: 'item', contains: '나트랑 깜란 국제공항 출발' },
    ],
  },
];

// ── YeosonamA4Template와 동일한 필터 (동선 노드/지역명 제외) ──
function filterForTimeline(parsed: ParsedScheduleItem[]): ParsedScheduleItem[] {
  return parsed.filter(s => {
    if (isTransportSegment(s)) return true;
    const item = s as { activity?: string; time?: string | null; note?: string | null };
    const a = item.activity || '';
    // 동선 노드 제외 (📍 포함 or → 2개 이상)
    if (a.includes('📍')) return false;
    if ((a.match(/→/g) || []).length >= 2) return false;
    // 단순 지역명 제외 — 동사 포함 항목은 유지
    if (!item.time && !item.note) {
      const trimmed = a.trim();
      if (trimmed) {
        const hasVerb = /이동|관광|도착|출발|체크|휴식|조식|중식|석식|투숙|방문|참석|체험/.test(trimmed);
        if (!hasVerb && /^[가-힣\s/]{1,10}$/.test(trimmed)) return false;
      }
    }
    return true;
  });
}

// ── 테스트 실행 ──
async function runTests() {
  console.log('═'.repeat(70));
  console.log('일정표 렌더링 순서 검증 테스트');
  console.log('═'.repeat(70));
  console.log();

  let passCount = 0;
  let failCount = 0;
  const failures: string[] = [];

  for (const tc of TESTS) {
    const { data } = await sb
      .from('travel_packages')
      .select('title, itinerary_data')
      .ilike('title', `%${tc.titleQuery}%`)
      .in('status', ['active', 'approved', 'pending'])
      .limit(1);

    if (!data || data.length === 0) {
      console.log(`❌ ${tc.name}: 상품을 찾을 수 없음 (query: ${tc.titleQuery})`);
      failures.push(tc.name);
      failCount++;
      continue;
    }

    const pkg = data[0];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawDays = Array.isArray(pkg.itinerary_data)
      ? pkg.itinerary_data
      : (pkg.itinerary_data as any)?.days || [];

    const parsed = parseDaysWithTransport(rawDays);
    const targetDay = parsed.find(d => d.day === tc.dayNum);

    if (!targetDay) {
      console.log(`❌ ${tc.name}: day ${tc.dayNum}을(를) 찾을 수 없음`);
      failures.push(tc.name);
      failCount++;
      continue;
    }

    const timeline = filterForTimeline(targetDay.parsedSchedule);

    // assertion
    const errors: string[] = [];

    if (timeline.length !== tc.expected.length) {
      errors.push(`길이 불일치: expected ${tc.expected.length}, got ${timeline.length}`);
      console.log(`  실제 출력:`);
      timeline.forEach((entry, i) => {
        if (isTransportSegment(entry)) {
          console.log(`    [${i}] TRANSPORT ${entry.mode} dep=${entry.depTime} arr=${entry.arrTime}`);
        } else {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const it = entry as any;
          console.log(`    [${i}] ITEM     time=${it.time || '--'}  ${(it.activity || '').slice(0, 50)}`);
        }
      });
    }

    tc.expected.forEach((exp, i) => {
      const actual = timeline[i];
      if (!actual) {
        errors.push(`[${i}] 누락 (expected: ${JSON.stringify(exp)})`);
        return;
      }
      if (exp.type === 'transport') {
        if (!isTransportSegment(actual)) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          errors.push(`[${i}] expected transport(${exp.mode}), got item "${(actual as any).activity}"`);
          return;
        }
        if (actual.mode !== exp.mode) {
          errors.push(`[${i}] mode 불일치: expected ${exp.mode}, got ${actual.mode}`);
        }
        if (exp.depTime && actual.depTime !== exp.depTime) {
          errors.push(`[${i}] depTime 불일치: expected ${exp.depTime}, got ${actual.depTime}`);
        }
      } else {
        if (isTransportSegment(actual)) {
          errors.push(`[${i}] expected item contains "${exp.contains}", got transport(${actual.mode})`);
          return;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const act = actual as any;
        if (!(act.activity || '').includes(exp.contains)) {
          errors.push(`[${i}] contains 불일치: expected "${exp.contains}", got "${act.activity}"`);
        }
      }
    });

    if (errors.length === 0) {
      console.log(`✓ ${tc.name}`);
      passCount++;
    } else {
      console.log(`❌ ${tc.name}`);
      errors.forEach(e => console.log(`    ${e}`));
      failures.push(tc.name);
      failCount++;
    }
  }

  console.log();
  console.log('═'.repeat(70));
  console.log(`결과: 통과 ${passCount}/${TESTS.length} · 실패 ${failCount}`);
  console.log('═'.repeat(70));

  if (failCount > 0) {
    console.log('\n실패한 테스트:');
    failures.forEach(f => console.log(`  - ${f}`));
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('테스트 실행 중 오류:', err);
  process.exit(1);
});
