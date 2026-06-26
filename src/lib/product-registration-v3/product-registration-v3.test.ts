import { describe, expect, it } from 'vitest';
import { createSourceLineIndex, parseV3AiStructurePlan, persistProductRegistrationDraftV3, planProductRegistrationV3, runProductRegistrationV3 } from '.';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildStandardNoticeDraft } from './standard-notices';
import { evaluateProductRegistrationV3Gate } from './gate';
import { mapTravelPackageToLandingData } from '../map-travel-package-to-lp';
import { renderPackage } from '../render-contract';
import { buildEntityReviewItem, buildV3EntitySummary } from './entity-normalizer';
import { classifyUnmatchedActivity } from '../unmatched-classifier';

function queuesUnmatchedActivity(item: { raw_text: string; category: string; blocks_publish: boolean; suggested_action: string }) {
  const classified = classifyUnmatchedActivity(item.raw_text, item.category);
  return item.category === 'attraction' &&
    classified.category === 'attraction' &&
    (item.blocks_publish || item.suggested_action === 'needs_review');
}

const testEvidence = { line_start: 1, line_end: 1, char_start: 0, char_end: 1, quote: 'fixture' };

function buildBaekduEightVariantFixture(): string {
  const grades = ['Standard', 'Premium', 'Lilac', 'VIP'];
  const durations = ['2N3D', '3N4D'];
  return [
    '공통 안내: 포함 왕복항공권, 호텔, 식사 / 불포함 개인경비 / 최소출발 10명',
    ...grades.flatMap((grade, gradeIndex) =>
      durations.map((duration, durationIndex) => {
        const idx = gradeIndex * durations.length + durationIndex;
        const outbound = idx % 2 === 0 ? 'BX337' : 'KE337';
        const inbound = idx % 2 === 0 ? 'BX338' : 'KE338';
        const price = (899000 + idx * 50000).toLocaleString('ko-KR');
        return [
          `상품: Baekdu ${grade} ${duration}`,
          `가격 ${price}원 / 최소출발 10명`,
          'DAY 1 부산 공항 미팅 06:30',
          `DAY 1 ${outbound} 부산 출발 09:40 연길 도착 11:30`,
          'DAY 1 전용버스 이동 후 호텔 체크인',
          'DAY 2 백두산 천지 관광',
          'DAY 2 중식 포함',
          `DAY ${duration === '2N3D' ? 3 : 4} ${inbound} 연길 출발 12:30 부산 도착 16:25`,
          '포함 왕복항공권 호텔 식사',
          '불포함 가이드팁 개인경비',
        ].join('\n');
      }),
    ),
  ].join('\n');
}

const fixtures = [
  {
    name: 'optional tour block',
    raw: `
상품: Free Day Option Package
가격 719,000원 / 최소출발 4명
DAY 1 LJ115 부산 출발 21:35 도착 00:25
DAY 2 자유시간
선택관광 현지지불 특식 $30
선택관광 전신 마사지 60분 $30
DAY 3 LJ116 출발 01:00 도착 06:40
포함 호텔
불포함 개인경비
`.trim(),
  },
  {
    name: 'single package',
    raw: `
상품: Simple City 3D
가격 599,000원 / 최소출발 4명
DAY 1 KE123 출발 10:00 도착 12:00
DAY 2 Museum visit
DAY 3 KE124 출발 13:00 도착 15:00
포함 식사
불포함 매너팁
`.trim(),
  },
  {
    name: 'shopping package',
    raw: `
상품: Shopping Included 4D
가격 1,099,000원 / 최소출발 6명
DAY 1 OZ201 출발 08:10 도착 10:30
DAY 2 Old town attraction
쇼핑 면세점 2회
DAY 4 OZ202 출발 20:10 도착 23:00
포함 차량
불포함 옵션
`.trim(),
  },
  {
    name: 'hotel transfer meal decoy',
    raw: `
상품: Decoy Lines 5D
가격 1,299,000원 / 최소출발 8명
DAY 1 7C777 출발 09:00 도착 11:20
DAY 1 airport transfer by private bus
DAY 1 호텔 체크인 및 휴식
DAY 2 조식 호텔식
DAY 2 Central Garden attraction
DAY 5 7C778 출발 14:00 도착 17:00
포함 호텔 조식
불포함 기타차지
`.trim(),
  },
  {
    name: 'nha-trang-dalat-remark-standardization',
    raw: `
상품: 나트랑 달랏 3박5일
가격 619,000원 / 최소출발 4명
DAY 1 LJ115 부산 출발 21:35 도착 00:25
DAY 2 포나가르 사원 관광
REMARK
싱글차지 전일정 기준 인당 18만 원 추가됩니다.
여권만료일은 입국일 기준 6개월 이상 남아있어야 출국 가능합니다.
베트남 자국민 보호법으로 공항미팅/관광지 방문 불가하므로 설명은 차량에서 대체하며 현지 가이드와 동행합니다.
호텔 룸배정(일행과 같은 층, 옆방 배정, 베드 타입) 등은 개런티 불가합니다.
전체 일정 & 식사 순서는 현지 사정에 의해 다소 변경될 수 있습니다.
마사지 팁 기준(나트랑: 60분-$4, 90분-$5, 120분-$6 / 달랏: 60분-$4, 90분-$5, 120분-$7)입니다.
패키지 일정 미참여 시 패널티 1인/1박/$100 청구됩니다.
나트랑 식당들은 주차장 구비된 곳이 많지가 않고 차량 진입이 어려워 도보 이동이 있을 수 있습니다.
베트남 전자담배 반입 불가합니다.
DAY 5 LJ116 출발 01:00 도착 06:40
포함 호텔
불포함 개인경비
`.trim(),
  },
];

describe('product-registration-v3 draft ledger pipeline', () => {
  it.each(fixtures)('builds a gated draft ledger for $name', async ({ raw, name }) => {
    const result = await runProductRegistrationV3(raw);

    expect(result.source_index.length).toBeGreaterThan(0);
    expect(result.structure_plan.expected_products).toBe(1);
    expect(result.ledger.variants).toHaveLength(1);
    expect(result.ledger.variants[0].price_calendar.length).toBeGreaterThan(0);
    expect(result.ledger.variants[0].flight_segments.length).toBeGreaterThan(0);
    expect(result.ledger.variants[0].days.length).toBeGreaterThan(0);
    if (name !== 'nha-trang-dalat-remark-standardization') {
      expect(result.gate_result.status).not.toBe('blocked');
    }
    expect(result.render_contract_preview).toHaveLength(1);
  });

  it('does not block golf notices as optional tours and recovers separated ZE flight times', async () => {
    const raw = `
상품: 푸꾸옥 2색골프 3박5일
가격 459,000원 / 최소출발 2명
DAY 1
ZE981
부산 출발 19:05
푸꾸옥 도착 22:25
DAY 2 빈펄CC 18홀 라운딩
* 골프장 라운딩 순서 및 골프장 선택은 현지사정에 따라 변동될 수 있습니다.
* 설날 기간 : 2/14 ~2/22 기간 미팅 샌딩비 50% 추가비용 발생됩니다.
※ 마사지 팁 [60분-$3, 90분-$4, 120분-$5] 기준입니다.
DAY 5
ZE982
푸꾸옥 출발 23:25
부산 도착 06:55
포함 호텔, 조식
불포함 개인경비
`.trim();

    const result = await runProductRegistrationV3(raw);
    const variant = result.ledger.variants[0];

    expect(result.structure_plan.option_section_locations).toEqual([]);
    expect(variant.flight_segments).toMatchObject([
      { code: 'ZE981', dep_time: '19:05', arr_time: '22:25' },
      { code: 'ZE982', dep_time: '23:25', arr_time: '06:55' },
    ]);
    expect(result.gate_result.checks.some(check =>
      check.status === 'fail'
      && (check.id.endsWith('options_reflected')
        || check.id.endsWith('high_risk_notice_values')
        || check.id.endsWith('high_risk_structured_fact_values')),
    )).toBe(false);
    expect(result.gate_result.status).not.toBe('blocked');
  });

  it('splits a Baekdu catalog into 8 draft variants with per-variant evidence', async () => {
    const result = await runProductRegistrationV3(buildBaekduEightVariantFixture());

    expect(result.structure_plan.document_type).toBe('catalog');
    expect(result.structure_plan.expected_products).toBe(8);
    expect(result.ledger.variants).toHaveLength(8);
    expect(result.structure_plan.variant_axes.map(axis => axis.name)).toEqual(['grade', 'duration']);
    for (const variant of result.ledger.variants) {
      expect(variant.price_calendar).toHaveLength(1);
      expect(variant.flight_segments).toHaveLength(2);
      expect(variant.days.length).toBeGreaterThanOrEqual(3);
      expect(variant.minimum_departure?.value).toBe(10);
      expect(variant.evidence_coverage.price).toBe(true);
      expect(variant.evidence_coverage.flight).toBe(true);
    }
  });

  it('does not assume a fixed catalog size and can plan six variants from one source', async () => {
    const raw = Array.from({ length: 6 }, (_, index) => {
      const n = index + 1;
      return [
        `Product: Variable Catalog ${n} 3N5D`,
        `Price: ${(699000 + index * 10000).toLocaleString('ko-KR')} KRW / minimum 4`,
        `DAY 1 LJ11${n} departure 21:35 arrival 00:25`,
        'DAY 2 City attraction',
        `DAY 5 LJ12${n} departure 01:00 arrival 06:40`,
        'Include hotel meal',
        'Exclude personal expense',
      ].join('\n');
    }).join('\n\n');

    const result = await runProductRegistrationV3(raw);

    expect(result.structure_plan.document_type).toBe('catalog');
    expect(result.structure_plan.expected_products).toBe(6);
    expect(result.ledger.variants).toHaveLength(6);
    expect(result.gate_result.checks.find(check => check.id === 'expected_products_match')?.status).toBe('pass');
  });

  it('keeps Guilin schedule noise out of unmatched attractions and matches descriptive attraction lines', async () => {
    const raw = [
      'Product: Guilin 3N5D High Grade',
      'Price: 1,429,000 KRW / minimum 4',
      'DAY 1 BX341 departure 10:00 arrival 12:00',
      'DAY 1 00:45(+1)',
      'DAY 2 -자연이 수억년의 세월동안 빚어낸 종유석과 석순의 향연 노적암동굴',
      'DAY 3 양  삭',
      'DAY 4 백  사',
      'DAY 4 -계림의 비경 그림 같은 산수 풍경 세외도원(나룻배)',
      'DAY 5 [공통 가격표 원문 근거]',
      'DAY 5 ● 연휴 출발 ★★',
      'DAY 5 BX342 departure 13:00 arrival 15:00',
      'Include hotel meal',
      'Exclude personal expense',
    ].join('\n');

    const result = await runProductRegistrationV3(raw, {
      destination: '계림',
      attractions: [
        { id: 'reed-flute-cave', name: '노적암동굴', region: '구이린' },
        { id: 'shangri-la-guilin', name: '세외도원', region: '구이린' },
        { id: 'xian-huashan', name: '화산', region: '서안' },
      ],
    });

    expect(result.match_summary.attraction_unmatched_count).toBe(0);
    expect(result.match_summary.attraction_matched_count).toBe(2);
    expect(result.match_summary.unmatched.map(item => item.raw_text)).toEqual([]);
    const eventTypes = result.ledger.variants[0].days.flatMap(day => day.events.map(event => ({
      text: event.raw_text,
      type: event.type,
      status: event.match_status,
    })));
    expect(eventTypes).toEqual(expect.arrayContaining([
      expect.objectContaining({ text: '00:45(+1)', type: 'price_noise' }),
      expect.objectContaining({ text: '양  삭', type: 'transfer' }),
      expect.objectContaining({ text: '백  사', type: 'transfer' }),
      expect.objectContaining({ text: '[공통 가격표 원문 근거]', type: 'price_noise' }),
      expect.objectContaining({ text: '● 연휴 출발 ★★', type: 'price_noise' }),
    ]));
  });

  it('uses explicit PKG boundaries before variant labels for Xian/Huashan catalogs', () => {
    const raw = readFileSync(
      join(process.cwd(), 'src/lib/product-registration/golden-corpus/fixtures/xian-huashan-bx-multiproduct.txt'),
      'utf8',
    );

    const plan = planProductRegistrationV3(createSourceLineIndex(raw));

    expect(plan.document_type).toBe('catalog');
    expect(plan.expected_products).toBe(4);
    const titleHints = plan.product_boundaries.map(boundary => boundary.title_hint);
    expect(titleHints).toHaveLength(4);
    expect(titleHints.every(title => title.includes('BX'))).toBe(true);
    expect(titleHints.some(title => /\b3/.test(title))).toBe(true);
    expect(titleHints.some(title => /\b4/.test(title))).toBe(true);
  });

  it('keeps airport meeting time as meeting, not flight departure', async () => {
    const result = await runProductRegistrationV3(buildBaekduEightVariantFixture());
    const variant = result.ledger.variants[0];
    const meeting = variant.days.flatMap(day => day.events).find(event => event.type === 'meeting');

    expect(meeting?.time).toBe('06:30');
    expect(variant.flight_segments.map(segment => segment.dep_time)).not.toContain('06:30');
    expect(result.gate_result.checks.find(check => check.id.endsWith('meeting_not_flight'))?.status).toBe('pass');
  });

  it('blocks customer readiness when flight segments lack source-backed arrival times', async () => {
    const raw = [
      'Product: Incomplete Flight Times 3D',
      'Price: 999,000 KRW / minimum 4',
      'DAY 1 KE123 departure 10:00',
      'DAY 2 City attraction',
      'DAY 3 KE124 departure 13:00',
      'Include hotel meal',
      'Exclude personal expense',
    ].join('\n');

    const result = await runProductRegistrationV3(raw);

    expect(result.ledger.variants[0].flight_segments).toHaveLength(2);
    expect(result.gate_result.status).toBe('blocked');
    expect(result.gate_result.checks.find(check => check.id.endsWith('flight_times_complete'))?.status).toBe('fail');
  });

  it('pairs adjacent arrival-only flight lines with the source flight segment', async () => {
    const raw = [
      'Product: Phu Quoc Golf 4N6D',
      'Price: 459,000 KRW / minimum 2',
      'DAY 1 부산 ZE981 19:05 김해 국제공항 출발',
      'DAY 1 푸꾸옥 22:10 푸꾸옥 국제공항 도착',
      'DAY 2 빈펄CC 18홀 라운딩 조:호텔식',
      'DAY 5 푸꾸옥 ZE982 23:25 푸꾸옥 국제공항 출발',
      'DAY 6 부산 06:55 김해 국제공항 도착',
      'Include hotel meal',
      'Exclude personal expense',
    ].join('\n');

    const result = await runProductRegistrationV3(raw, {
      attractions: [{ id: 'golf', name: '빈펄 CC', aliases: ['빈펄CC'], region: '푸꾸옥' }],
      destination: '푸꾸옥',
    });

    expect(result.ledger.variants[0].flight_segments).toMatchObject([
      { code: 'ZE981', dep_time: '19:05', arr_time: '22:10' },
      { code: 'ZE982', dep_time: '23:25', arr_time: '06:55' },
    ]);
    expect(result.gate_result.checks.find(check => check.id.endsWith('flight_times_complete'))?.status).toBe('pass');
  });

  it('classifies itinerary table noise and shopping fragments away from attraction review', async () => {
    const raw = [
      'Product: Da Nang Spot 3N5D',
      'Price: 599,000 KRW / minimum 4',
      'DAY 1 LJ112 부산 출발 21:00 다낭 도착 23:30',
      'DAY 2 다낭',
      'DAY 2 전용차랑',
      'DAY 2 오 전',
      'DAY 2 베트남 특산품 관광 3회',
      'DAY 3 (콜드밀)',
      'DAY 4 ■상기 일정은 항공 및 현지 사정에 의하여 변동될 수 있사오니 양해하여 주시기 바랍니다■',
      'DAY 5 LJ113 다낭 출발 01:00 부산 도착 07:00',
      'Include hotel meal',
      'Exclude personal expense',
    ].join('\n');

    const result = await runProductRegistrationV3(raw, { destination: '다낭' });
    const reviewTexts = result.match_summary.entity_summary?.review_items
      .filter(item => item.category === 'attraction')
      .map(item => item.raw_text) ?? [];

    expect(reviewTexts).not.toContain('다낭');
    expect(reviewTexts).not.toContain('전용차랑');
    expect(reviewTexts).not.toContain('오 전');
    expect(reviewTexts).not.toContain('베트남 특산품 관광 3회');
    expect(reviewTexts).not.toContain('(콜드밀)');
  });

  it('keeps Guangzhou transport/table fragments out of attraction review while preserving real sights', async () => {
    const raw = [
      'Product: 광저우 천저우 3박5일 고속철',
      'Price: 1,369,000 KRW / minimum 4',
      'DAY 1 BX123 부산 출발 10:00 광저우 도착 12:30',
      'DAY 2 광저우',
      'DAY 2 천저우',
      'DAY 2 G397',
      'DAY 2 (2등석)',
      'DAY 2 변경가능',
      'DAY 2 고의령',
      'DAY 2 ▶멀리서도 눈에 띄는 거대한 언덕이 높은 의자와 같다고 하여',
      'DAY 2 이름 붙여진 고의령',
      'DAY 2 ▶붉은색의 협곡으로 퇴적암이 옹기종기 솟아있는 신비로운 풍경의',
      'DAY 2 마황구대협곡(차창)',
      'DAY 2 ▶명/청대 역사가 살아 숨쉬는 고대 역사문화마을 와요평고촌',
      'DAY 2 ▶천저우에서 가장 오래된 아름다운 옛거리 유후거리',
      'DAY 3 케이블카(20분)-전망대-에스컬레이터-도경지-팔괘대-오지봉관망대-인심대',
      'DAY 3 -협곡식당-폭포-도해관음-후루와-성삭-마천령(엘리베이터)-금편대협곡-금편신주',
      'DAY 5 BX124 광저우 출발 13:00 부산 도착 16:00',
      'Include hotel meal',
      'Exclude personal expense',
    ].join('\n');

    const result = await runProductRegistrationV3(raw, { destination: '광저우' });
    const reviewTexts = result.match_summary.entity_summary?.review_items
      .filter(item => item.category === 'attraction')
      .map(item => item.raw_text) ?? [];

    expect(reviewTexts).toEqual(expect.arrayContaining([
      '고의령',
      '마황구대협곡',
      '와요평고촌',
      '유후거리',
    ]));
    for (const noise of [
      '광저우',
      '천저우',
      'G397',
      '(2등석)',
      '변경가능',
      '▶멀리서도 눈에 띄는 거대한 언덕이 높은 의자와 같다고 하여',
      '이름 붙여진 고의령',
      '▶붉은색의 협곡으로 퇴적암이 옹기종기 솟아있는 신비로운 풍경의',
      '케이블카(20분)-전망대-에스컬레이터-도경지-팔괘대-오지봉관망대-인심대',
      '-협곡식당-폭포-도해관음-후루와-성삭-마천령(엘리베이터)-금편대협곡-금편신주',
    ]) {
      expect(reviewTexts).not.toContain(noise);
    }
  });

  it('recognizes vertical per-person minimum departure lines', async () => {
    const raw = [
      'Product: Da Nang Spot 3N5D',
      'Price: 599,000 KRW',
      '\uC778 \uC6D0',
      '4\uBA85\uBD80\uD130 \uCD9C\uBC1C',
      'DAY 1 LJ111 Busan departure 21:00 Da Nang arrival 23:30',
      'DAY 2 Da Nang tour',
      'DAY 3 Hoi An tour',
      'DAY 4 Free time',
      'DAY 5 LJ112 Da Nang departure 01:00 Busan arrival 07:00',
      'Include hotel meal',
      'Exclude personal expense',
    ].join('\n');

    const result = await runProductRegistrationV3(raw, { destination: 'Da Nang' });
    const variant = result.ledger.variants[0];

    expect(variant.minimum_departure?.value).toBe(4);
    expect(result.gate_result.checks.find(check => check.id.endsWith('minimum_departure'))?.status).toBe('pass');
  });

  it('uses line-level evidence and never whole raw text as fallback evidence', async () => {
    const result = await runProductRegistrationV3(fixtures[0].raw);
    const option = result.ledger.variants[0].options.find(item => item.duration_minutes === 60);

    expect(option).toBeDefined();
    if (!option) throw new Error('expected 60-minute option');
    expect(option.evidence.line_start).toBe(option.evidence.line_end);
    expect(option.evidence.quote).toContain('$30');
    expect(option.evidence.quote.length).toBeLessThan(fixtures[0].raw.length);
    expect(option.duration_minutes).toBe(60);
  });

  it('matches only existing attractions and queues the rest for review', async () => {
    const result = await runProductRegistrationV3(fixtures[1].raw, {
      attractions: [{ id: 'museum-1', name: 'Museum', region: 'City' }],
      destination: 'City',
    });
    expect(result.match_summary.attraction_matched_count).toBeGreaterThanOrEqual(1);
    expect(result.match_summary.attraction_unmatched_count).toBe(0);

    const unmatched = await runProductRegistrationV3(fixtures[2].raw, {
      attractions: [],
      destination: 'City',
    });
    expect(unmatched.match_summary.unmatched.length).toBeGreaterThanOrEqual(1);
    expect(unmatched.gate_result.checks.find(check => check.id === 'attraction_unmatched_queue_clear')?.status).toBe('fail');
  });

  it('does not queue price-table and legal-tail lines as unmatched attractions', async () => {
    const raw = [
      '스팟특가',
      '6/20,21,28',
      '999,-',
      '출발일',
      '요일',
      '상품: 클락 품격 풀빌라 더비스타 2색골프 + 단독차량 4박6일',
      'Price: 1,159,000 KRW / minimum 4',
      '제1일 LJ065 부산 김해 국제공항 출발',
      '제2일 더 비스타 18홀 라운딩',
      '제3일 디 하이츠 18홀 라운딩',
      '제6일 LJ066 클락 국제공항 출발',
      '필리핀 골프상품 취소규정 안내',
      '취소시기',
      '수수료',
      '100% 환불 불가',
      '현금영수증 발급 안내 드립니다',
    ].join('\n');

    const result = await runProductRegistrationV3(raw, {
      attractions: [],
      destination: '클락',
    });
    const unmatched = result.match_summary.unmatched.map(item => item.raw_text);
    const variant = result.ledger.variants[0];

    expect(unmatched).toHaveLength(0);
    expect(variant.days.flatMap(day => day.events)
      .filter(event => event.type === 'activity')
      .map(event => event.raw_text)
    ).toEqual(expect.arrayContaining([
      '더 비스타 18홀 라운딩',
      '디 하이츠 18홀 라운딩',
    ]));
    expect(variant.minimum_departure?.value).toBe(4);
    for (const noise of [
      '스팟특가',
      '999,-',
      '출발일',
      '요일',
      '필리핀 골프상품 취소규정 안내',
      '취소시기',
      '수수료',
      '100% 환불 불가',
      '현금영수증 발급 안내 드립니다',
    ]) {
      expect(unmatched).not.toContain(noise);
    }
  });

  it('removes price noise events from the render schedule', async () => {
    const raw = [
      'Package: Noise Render Guard',
      'Price: 999,000 KRW / minimum 2',
      'DAY 1 Airport meeting',
      'DAY 1 999,-',
      'DAY 1 City Garden attraction',
      'DAY 2 free time',
    ].join('\n');

    const result = await runProductRegistrationV3(raw, {
      attractions: [],
      destination: 'City',
    });
    const events = result.ledger.variants[0].days.flatMap(day => day.events);
    const days = result.render_contract_preview[0]?.itinerary_data?.days ?? [];
    const scheduleActivities = days.flatMap(day => (day.schedule ?? []).map(item => item.activity));

    expect(events.find(event => event.raw_text === '999,-')?.type).toBe('price_noise');
    expect(scheduleActivities).not.toContain('999,-');
    expect(scheduleActivities).toContain('City Garden attraction');
  });

  it('keeps Baekdu price matrix labels out of itinerary entities and fallback-matches existing scoped attractions', async () => {
    const raw = [
      '6/11(목) 까지 항공권 발권조건 2명부터 출발확정',
      '출발일',
      '6/1 월 3박',
      '999,000',
      '연길/백두산(북+서파) 3박4일',
      'Price: 859,000 KRW / minimum 2',
      'BX3175',
      'BX3185',
      '일 자',
      '제1일',
      '연  길',
      '도  문',
      'BX3175',
      '06:00',
      '부산 출발',
      '▶중국-북한 두만강 중조국경지대, 두만강 강변공원',
      '중:냉면+',
      '꿔바로우',
      '󰆹 금수학호텔 또는 동급 (준5성)',
      '제2일',
      '연  길',
      'BX3185',
      '16:00',
      '부산 도착',
      '조:호텔식',
      '포함 호텔',
      '불포함 개인경비',
    ].join('\n');

    const result = await runProductRegistrationV3(raw, {
      destination: '연길/백두산',
      attractions: [
        {
          id: 'tumen-river-park',
          name: '두만강 강변공원',
          region: '도문',
          country: 'CN',
        },
      ],
    });
    const events = result.ledger.variants[0].days.flatMap(day => day.events);

    expect(result.ledger.variants[0].days.map(day => day.day)).toEqual([1, 2]);
    expect(events.map(event => event.raw_text)).not.toContain('/11(목) 까지 항공권 발권조건 2명부터 출발확정');
    expect(events.find(event => event.raw_text === '연  길')?.type).toBe('transfer');
    expect(events.find(event => event.raw_text === '도  문')?.type).toBe('transfer');
    expect(events.find(event => event.raw_text === '꿔바로우')?.type).toBe('meal');
    expect(result.match_summary.attraction_unmatched_count).toBe(0);
    expect(result.match_summary.attraction_matched_count).toBe(1);
  });

  it('keeps Phu Quoc optional golf details out of the attraction unmatched queue', async () => {
    const raw = [
      '상품: [부산출발][가족여행] 푸꾸옥 뉴월드 풀빌라 자유여행 5일',
      '가격: 959,000원 / 최소출발 4명',
      'DAY 1 ZE981 부산 출발 18:55 푸꾸옥 도착 22:25',
      'DAY 1 푸꾸옥',
      'DAY 1 : 푸꾸옥 뉴월드 - 가든풀빌라 2BED룸',
      'DAY 2 추천관광 (1) 빈펄CC - [1인] 18홀당 주중$100 / 주말 $120',
      'DAY 2 1. 골프장 정보',
      'DAY 2 코스정보: 18홀/72파/7224야드',
      'DAY 2 티타임: 06:00 ~ 11:36 & 12:00 ~ 14:00',
      'DAY 2 그린피 + 캐디피 + 카트피',
      'DAY 2 캐디팁 $20/18홀/인 (현장결제)',
      'DAY 2 홀수 인원 예약 시 싱글카트 추가금 발생(1인 45만동 / 현장 결제)',
      'DAY 2 클럽 렌탈: 1인 95만동/1세트당(타이틀리스트 or 테일러메이드)',
      'DAY 3 자유시간',
      'DAY 5 ZE982 푸꾸옥 출발 23:25 부산 도착 06:55',
      '포함사항 왕복항공료, 유류할증료, 숙박, 조식',
      '불포함사항 기타 개인경비 및 매너팁',
      '* 2베드룸풀빌라 기준 최소 성인 4인이상 예약조건 상품가이며, 인원충족이 안될 경우 추가요금 발생됩니다.',
    ].join('\n');

    const result = await runProductRegistrationV3(raw, {
      attractions: [],
      destination: '푸꾸옥',
    });
    const unmatched = result.match_summary.unmatched.map(item => item.raw_text);
    const highRiskReviewNeeded = result.ledger.variants[0].structured_facts
      .filter(fact => fact.risk_level === 'high' && fact.review_status === 'review_needed');

    expect(result.gate_result.status).not.toBe('blocked');
    expect(unmatched).toHaveLength(0);
    expect(highRiskReviewNeeded).toHaveLength(0);
    expect(result.match_summary.option_review_count).toBeGreaterThan(0);
    expect(result.gate_result.status).not.toBe('blocked');
    expect(result.gate_result.checks.find(check => check.id === 'option_review_queue_clear')?.status).toBe('warn');
  });

  it('keeps core golf round schedule lines out of the attraction unmatched queue', async () => {
    const raw = [
      '상품: 클락 품격 풀빌라 더비스타 2색골프 + 단독차량 4박6일',
      '가격: 1,159,000원 / 최소 4명',
      '제1일 LJ065 부산 김해 국제공항 출발 22:10 클락 국제공항 도착 00:40',
      '제1일 풀빌라 투숙 및 휴식',
      '제2일 풀빌라 조식 후 골프장으로 이동',
      '제2일 더 비스타 18홀 라운딩 (2부 TEE 조건)',
      '제3일 더 비스타 18홀 라운딩 (2부 TEE 조건)',
      '제4일 디 하이츠 18홀 라운딩',
      '제5일 라운딩 후 클락 공항으로 이동',
      '제6일 LJ066 클락 국제공항 출발 01:45 부산 김해 국제공항 도착 06:25',
      '포함사항: 왕복항공료, 숙박, 조식, 그린피, 여행자보험, 단독차량',
      '불포함사항: 개인경비, 주말골프추가금, 전일정 주유비',
    ].join('\n');

    const result = await runProductRegistrationV3(raw, {
      attractions: [],
      destination: '클락',
    });
    const activities = result.ledger.variants[0].days
      .flatMap(day => day.events)
      .filter(event => event.type === 'activity')
      .map(event => event.raw_text);

    expect(result.match_summary.unmatched).toHaveLength(0);
    expect(result.match_summary.attraction_unmatched_count).toBe(0);
    expect(result.gate_result.checks.find(check => check.id === 'attraction_unmatched_queue_clear')?.status).toBe('pass');
    expect(activities).toEqual(expect.arrayContaining([
      '더 비스타 18홀 라운딩 (2부 TEE 조건)',
      '디 하이츠 18홀 라운딩',
    ]));
  });

  it('does not fall back to cross-region attraction matches when destination is known', async () => {
    const raw = [
      '상품: 푸꾸옥 4박6일',
      '가격: 549,000원',
      'DAY 1 푸꾸옥 도착',
      'DAY 2 베트남의 베네치아! 복합 엔터테이먼트 단지 그랜드월드 나이트투어',
    ].join('\n');

    const result = await runProductRegistrationV3(raw, {
      destination: '푸꾸옥',
      attractions: [{ id: 'bohol-night', name: '나이트투어', region: '보홀' }],
    });
    const events = result.ledger.variants[0].days.flatMap(day => day.events);

    expect(events.some(event => event.canonical_id === 'bohol-night')).toBe(false);
    expect(result.match_summary.unmatched.map(item => item.raw_text)).toContain(
      '베트남의 베네치아! 복합 엔터테이먼트 단지 그랜드월드 나이트투어',
    );
  });

  it('keeps golf cart fees out of customer optional tours', async () => {
    const raw = [
      '상품: PKG ZE 푸꾸옥 2색골프 에스츄리+빈펄 4박6일',
      '가격: 1,319,000원',
      'DAY 1 에스츄리CC 18홀 라운딩 *클럽식 포함',
      '비 고',
      '* 싱글카트비 18홀 기준 빈펄 450,000동 / 에스츄리 500,000동 추가 됩니다.',
      '* 골프장 라운딩 순서 및 골프장 선택은 현지사정에 따라 변동될 수 있습니다.',
    ].join('\n');

    const result = await runProductRegistrationV3(raw, {
      destination: '푸꾸옥',
      attractions: [{ id: 'estury', name: '에스츄리CC', region: '푸꾸옥' }],
    });
    const preview = result.render_contract_preview[0];

    expect(preview?.optional_tours ?? []).toEqual([]);
    expect(result.match_summary.entity_summary.option_review_needed_count).toBe(0);
  });

  it('keeps Cebu semi-package transit, shopping, options, and passport notices out of unmatched attractions', async () => {
    const raw = [
      '상품: 부산出 세부 세미 PKG 3박 5일 진에어(LJ)',
      '출발일 요일 솔레아[준특급] 두짓타니[특급] 제이파크[특급]',
      '7/24~8/7',
      '토일월화 859,000 1,029,000 1,079,000',
      '수목금 889,000 1,079,000 1,119,000',
      '포 함 사 항 항공요금+유류/텍스, 여행자보험, 전 일정 호텔(2인1실), 조식 및 일정상 식사, 스쿠버다이빙 강습, 특식2회',
      '불포함 사항 가이드 & 기사팁 별도(성인&아동 동일) : 3박 $50 P/P, 써차지 및 의무디너, 싱글차지',
      '선 택 관 광',
      '체험다이빙&씨워크($120), 파라세일링($80), 럭셔리스톤&스파2시간30분($160), 스톤마사지2시간($100)',
      '쇼 핑 센 터',
      '진주, 토산품, 건강보조식품, 잡화 중 3회 방문예정',
      '제1일',
      '세   부',
      'LJ 061',
      '(+1)',
      '부산 출발 / 세부 향발',
      '세부 국제 공항 도착 후 가이드 미팅',
      '리조트 이동 투숙 및 휴식',
      'HOTEL : 상기 호텔 또는 동급',
      '제2일',
      '세   부',
      '호텔 조식 후',
      '▶해양 스포츠 체험 스쿠버다이빙 무료강습(※체험 다이빙 별도)',
      '- 이론 교육 및 수영장 실습 (신비한 바닷속을 체험할 수 있는 기회)',
      '▶세부 디스커버리 투어(재래시장, 열대과일 상점 방문)',
      '▶필리핀 전통 오일마사지 60분 1회 (성인만/팁별도/아동불포함)',
      '제3일',
      '♣ 추천 선택관광',
      '세부 아일랜드 호핑투어 (스노쿨링+중식BBQ) / 현지 옵션가 $80/인',
      '제4일',
      '▶세부 막탄 시내관광 (막탄슈라인, 막탄 산토니뇨 성당)',
      '▶여행의 또 다른 재미 필리핀 기념품 및 토산품관광',
      '기 내 박',
      '제5일',
      'LJ 062',
      '세부 출발 / 부산 향발',
      '부산 국제 공항 도착 후 해산',
      '살펴보기',
      '♣ 여권 유효기간은 6개월 이상 남아 있어야 합니다.',
      '♣ 필리핀 입국시 이트래블 QR코드 필수입니다.',
    ].join('\n');

    const result = await runProductRegistrationV3(raw, {
      attractions: [],
      destination: '세부',
    });
    const allEvents = result.ledger.variants[0].days.flatMap(day => day.events);
    const options = result.ledger.variants[0].options;

    expect(result.match_summary.attraction_unmatched_count).toBe(0);
    expect(result.match_summary.unmatched).toHaveLength(0);
    expect(result.match_summary.shopping_count).toBeGreaterThan(0);
    expect(result.gate_result.status).not.toBe('blocked');
    expect(result.gate_result.checks.find(check => check.id === 'attraction_unmatched_queue_clear')?.status).toBe('pass');
    expect(allEvents.find(event => event.raw_text === '부산 출발 / 세부 향발')?.type).toBe('flight');
    expect(allEvents.find(event => event.raw_text === '기 내 박')?.type).toBe('hotel');
    expect(allEvents.find(event => event.raw_text.includes('기념품'))?.type).toBe('shopping');
    expect(allEvents.map(event => event.raw_text)).not.toContain('살펴보기');
    expect(allEvents.some(event => event.raw_text.includes('여권 유효기간'))).toBe(false);
    expect(options.map(option => option.raw_name)).toEqual(expect.arrayContaining([
      '체험다이빙&씨워크($120)',
      '파라세일링($80)',
      '럭셔리스톤&스파2시간30분($160)',
      '스톤마사지2시간($100)',
      '세부 아일랜드 호핑투어 (스노쿨링+중식BBQ) / 현지 옵션가 $80/인',
    ]));
    expect(options.some(option => option.raw_name.includes('추천 선택관광'))).toBe(false);
    expect(options.some(option => option.raw_name.includes('쇼 핑 센 터'))).toBe(false);
    expect(options.some(option => option.raw_name.includes('무료강습'))).toBe(false);
    expect(options.find(option => option.raw_name.includes('호핑투어'))?.normalized_name).toBe('세부 아일랜드 호핑투어 (스노쿨링+중식BBQ)');
  });

  it('persists V3 draft and forwards unmatched attractions to the review queue', async () => {
    const result = await runProductRegistrationV3(fixtures[2].raw, {
      attractions: [],
      destination: 'City',
    });
    const rpcCalls: unknown[] = [];
    const candidateUpserts: unknown[] = [];
    const fakeSupabase = {
      from(table: string) {
        if (table === 'product_registration_drafts') {
          return {
            insert() {
              return {
                select() {
                  return {
                    single: async () => ({ data: { id: 'draft-1' }, error: null }),
                  };
                },
              };
            },
          };
        }
        if (table === 'entity_master_candidates') {
          return {
            select() {
              return {
                in: async () => ({ data: [], error: null }),
              };
            },
            upsert: async (payload: unknown, options: unknown) => {
              candidateUpserts.push({ payload, options });
              return { error: null };
            },
          };
        }
        return {
          upsert: async () => ({ error: null }),
        };
      },
      rpc(name: string, payload: unknown) {
        rpcCalls.push({ name, payload });
        return {
          single: async () => ({ data: null, error: null }),
        };
      },
    };

    const persisted = await persistProductRegistrationDraftV3(fakeSupabase as never, {
      packageId: '00000000-0000-0000-0000-000000000001',
      packageTitle: 'Shopping Included 4D',
      destination: 'City',
      rawText: fixtures[2].raw,
      result,
    });

    expect(persisted.id).toBe('draft-1');
    expect(persisted.error).toBeNull();
    const queuedReviewItems = result.match_summary.entity_summary.review_items.filter(queuesUnmatchedActivity);
    expect(persisted.queuedUnmatched).toBe(queuedReviewItems.length);
    expect(rpcCalls).toHaveLength(queuedReviewItems.length);
    expect(rpcCalls[0]).toMatchObject({ name: 'upsert_unmatched_activity' });
    expect(rpcCalls[0]).toMatchObject({
      payload: expect.objectContaining({
        p_segment_kind_guess: expect.any(String),
        p_suggested_action: expect.any(String),
        p_source_context: expect.any(Object),
      }),
    });
    expect(candidateUpserts).toHaveLength(1);
    expect(candidateUpserts[0]).toMatchObject({
      options: { onConflict: 'candidate_key' },
      payload: expect.arrayContaining([
        expect.objectContaining({
          category: 'attraction',
          source_context: expect.objectContaining({
            draft_ids: ['draft-1'],
            package_ids: ['00000000-0000-0000-0000-000000000001'],
            mobile_landing_impact: true,
            analyzer: 'product-registration-v3-draft',
          }),
        }),
      ]),
    });
  });

  it('uses package-scoped fallback upsert for unmatched attractions when the RPC is unavailable', async () => {
    const result = await runProductRegistrationV3(fixtures[2].raw, {
      attractions: [],
      destination: 'City',
    });
    const upserts: unknown[] = [];
    const candidateUpserts: unknown[] = [];
    const fakeSupabase = {
      from(table: string) {
        if (table === 'product_registration_drafts') {
          return {
            insert() {
              return {
                select() {
                  return {
                    single: async () => ({ data: { id: 'draft-1' }, error: null }),
                  };
                },
              };
            },
          };
        }
        if (table === 'entity_master_candidates') {
          return {
            select() {
              return {
                in: async () => ({ data: [], error: null }),
              };
            },
            upsert: async (payload: unknown, options: unknown) => {
              candidateUpserts.push({ payload, options });
              return { error: null };
            },
          };
        }
        return {
          upsert: async (payload: unknown, options: unknown) => {
            upserts.push({ payload, options });
            return { error: null };
          },
        };
      },
      rpc() {
        throw new Error('rpc unavailable');
      },
    };

    await persistProductRegistrationDraftV3(fakeSupabase as never, {
      packageId: '00000000-0000-0000-0000-000000000001',
      packageTitle: 'Shopping Included 4D',
      destination: 'City',
      rawText: fixtures[2].raw,
      result,
    });

    const queuedReviewItems = result.match_summary.entity_summary.review_items.filter(queuesUnmatchedActivity);
    expect(upserts).toHaveLength(queuedReviewItems.length);
    expect(upserts[0]).toMatchObject({
      options: { onConflict: 'unmatched_scope_key,activity' },
      payload: expect.objectContaining({
        segment_kind_guess: expect.any(String),
        suggested_action: expect.any(String),
        source_context: expect.any(Object),
      }),
    });
    expect(candidateUpserts).toHaveLength(1);
  });

  it('feeds the same V3 render contract into mobile LP and A4 canonical rendering', async () => {
    const result = await runProductRegistrationV3(buildBaekduEightVariantFixture());
    const renderInput = result.render_contract_preview[0];
    const canonicalView = renderPackage(renderInput);
    const landingData = mapTravelPackageToLandingData({
      id: 'v3-draft-preview',
      destination: '백두산',
      duration: renderInput.itinerary_data?.days?.length ?? 0,
      price_dates: renderInput.price_dates,
      inclusions: renderInput.inclusions,
      excludes: renderInput.excludes,
      itinerary_data: renderInput.itinerary_data,
      optional_tours: renderInput.optional_tours,
      title: renderInput.title,
      product_type: renderInput.product_type,
    }, null);

    expect(canonicalView.days.length).toBeGreaterThan(0);
    expect(landingData.itinerary.days).toHaveLength(canonicalView.days.length);
    expect(landingData.flightSummary?.outbound?.code).toBe('BX337');
    expect(landingData.flightSummary?.outbound?.depTime).toBe('09:40');
    expect(landingData.flightSummary?.outbound?.depTime).not.toBe('06:30');
    expect(landingData.itinerary.includes.length).toBeGreaterThan(0);
    expect(landingData.itinerary.excludes.length).toBeGreaterThan(0);
  });

  it('does not classify hotel, transfer, meal, shopping, or option lines as attractions', async () => {
    const result = await runProductRegistrationV3(fixtures[3].raw);
    const events = result.ledger.variants[0].days.flatMap(day => day.events);

    expect(events.some(event => event.type === 'hotel')).toBe(true);
    expect(events.some(event => event.type === 'transfer')).toBe(true);
    expect(events.some(event => event.type === 'meal')).toBe(true);
    expect(events.filter(event => event.type === 'attraction').map(event => event.raw_text)).toEqual(['Central Garden attraction']);
  });

  it('does not block matched attraction detail bullets as separate attractions', () => {
    const summary = buildV3EntitySummary({
      destination: '광저우',
      ledger: {
        document: { type: 'single_package', expected_products: 1, variant_axes: [] },
        variants: [{
          variant_key: 'v1',
          grade: null,
          course: '광저우',
          duration_days: 1,
          nights: 0,
          title_parts: [],
          price_calendar: [],
          flight_segments: [],
          days: [{
            day: 1,
            route: [],
            meals: { breakfast: {}, lunch: {}, dinner: {} },
            hotel: {},
            events: [
              {
                type: 'attraction',
                time: null,
                raw_text: '풍경과 복이 깃든 성스러운 곳 소선령',
                canonical_id: 'attraction-sosun',
                canonical_type: 'attraction',
                match_status: 'matched',
                evidence: testEvidence,
              },
              {
                type: 'attraction',
                time: null,
                raw_text: '- 산 곳곳에 복자가 새겨진 돌들이 가득한 만복산',
                canonical_id: null,
                canonical_type: 'attraction',
                match_status: 'unmatched',
                evidence: testEvidence,
              },
              {
                type: 'attraction',
                time: null,
                raw_text: '▶광저우에서 가장 유명한 사찰로 대불탑과 전통정원을 볼 수 있는 대불사',
                canonical_id: null,
                canonical_type: 'attraction',
                match_status: 'unmatched',
                evidence: testEvidence,
              },
            ],
          }],
          inclusions: [],
          exclusions: [],
          options: [],
          shopping: [],
          structured_facts: [],
          standard_notices: [],
          minimum_departure: null,
          evidence_coverage: {},
        }],
      },
    });

    expect(summary.review_items.some(item => item.raw_text === '만복산' && item.blocks_publish)).toBe(false);
    expect(summary.review_items.some(item => item.raw_text === '대불사' && item.blocks_publish)).toBe(true);
    expect(summary.attraction_unresolved_count).toBe(1);
  });

  it('uses entity unresolved attraction count ahead of legacy unmatched event count in V3 gate', () => {
    const baseVariant = {
      variant_key: 'v1',
      grade: null,
      course: '광저우',
      duration_days: 1,
      nights: 0,
      title_parts: [],
      price_calendar: [],
      flight_segments: [{ leg: 'outbound' as const, code: 'BX0000', dep_time: '10:00', arr_time: '11:00', evidence: testEvidence }],
      days: [{ day: 1, route: [], events: [], meals: { breakfast: { text: '조식' }, lunch: {}, dinner: {} }, hotel: { name: '호텔' } }],
      inclusions: [{ value: '항공', evidence: testEvidence }],
      exclusions: [{ value: '개인경비', evidence: testEvidence }],
      options: [],
      shopping: [],
      structured_facts: [],
      standard_notices: [],
      minimum_departure: { value: 6, evidence: testEvidence },
      evidence_coverage: {},
    };
    const gate = evaluateProductRegistrationV3Gate(
      {
        document_type: 'single_package',
        planner_source: 'deterministic',
        expected_products: 1,
        shared_sections: [],
        product_boundaries: [{ index: 0, line_start: 1, line_end: 1, title_hint: '광저우' }],
        variant_axes: [],
        price_table_location: null,
        price_mapping_strategy: 'none',
        flight_pattern: { outbound_codes: [], inbound_codes: [], meeting_times: [] },
        itinerary_boundary_pattern: null,
        option_section_locations: [],
        shopping_section_locations: [],
        confidence: 1,
        unresolved_parts: [],
      },
      {
        document: { type: 'single_package', expected_products: 1, variant_axes: [] },
        variants: [baseVariant],
      },
      {
        attraction_matched_count: 1,
        attraction_unmatched_count: 3,
        option_review_count: 0,
        shopping_count: 0,
        unmatched: [],
        entity_summary: {
          counts: {
            attraction: 1,
            hotel: 0,
            meal: 0,
            transfer: 0,
            shopping: 0,
            optional_tour: 0,
            free_time: 0,
            notice: 3,
            price_noise: 0,
            unknown: 0,
          },
          review_required_count: 0,
          attraction_unresolved_count: 0,
          shopping_review_needed_count: 0,
          option_review_needed_count: 0,
          unknown_customer_visible_count: 0,
          auto_ignored_noise_count: 0,
          meal_structured_count: 0,
          transfer_structured_count: 0,
          hotel_structured_count: 0,
          free_time_structured_count: 0,
          review_items: [],
        },
      },
    );

    expect(gate.checks.find(check => check.id === 'attraction_unmatched_queue_clear')?.status).toBe('pass');
    expect(gate.status).toBe('ready_to_publish');
  });

  it('keeps regional meal terms scoped by destination without attraction queue pollution', async () => {
    const raw = [
      'Product: Regional Meal Scope',
      'Price: 699,000 KRW / minimum 4',
      'DAY 1 KE123 Busan departure 10:00 Da Nang arrival 12:00',
      'DAY 2 Da Nang rice noodle pho lunch',
      'DAY 3 KE124 Da Nang departure 13:00 Busan arrival 17:00',
      'Include hotel meal',
      'Exclude personal expenses',
    ].join('\n');

    const daNang = await runProductRegistrationV3(raw, { destination: 'Da Nang' });
    const osaka = await runProductRegistrationV3(raw.replace('Da Nang rice noodle pho lunch', 'Osaka rice noodle pho lunch'), { destination: 'Osaka' });
    const daNangMeal = daNang.ledger.variants[0].days.flatMap(day => day.events).find(event => event.type === 'meal');
    const osakaMeal = osaka.ledger.variants[0].days.flatMap(day => day.events).find(event => event.type === 'meal');

    expect(daNangMeal).toBeDefined();
    expect(osakaMeal).toBeDefined();
    expect(daNang.match_summary.attraction_unmatched_count).toBe(0);
    expect(osaka.match_summary.attraction_unmatched_count).toBe(0);
    expect(daNang.match_summary.entity_summary.meal_structured_count).toBeGreaterThan(0);
    expect(osaka.match_summary.entity_summary.meal_structured_count).toBeGreaterThan(0);

    const daNangItem = buildEntityReviewItem({ event: daNangMeal!, dayNumber: 2, destination: 'Da Nang' });
    const osakaItem = buildEntityReviewItem({ event: osakaMeal!, dayNumber: 2, destination: 'Osaka' });
    expect(daNangItem.suggested_resolution.global_term).toBe('rice_noodle');
    expect(osakaItem.suggested_resolution.global_term).toBe('rice_noodle');
    expect(daNangItem.suggested_resolution.destination_scope).toBe('Da Nang');
    expect(osakaItem.suggested_resolution.destination_scope).toBe('Osaka');
  });

  it('blocks customer publish for unpriced shopping and option entities without blocking the draft', async () => {
    const result = await runProductRegistrationV3([
      '상품: Review Needed Option Package',
      '가격: 719,000원 / 최소출발 4명',
      'DAY 1 LJ115 부산 출발 21:35 세부 도착 00:25',
      'DAY 2 자유시간',
      'DAY 2 optional tour local payment extra',
      '쇼핑센터 방문 예정',
      'DAY 3 LJ116 세부 출발 01:00 부산 도착 06:40',
      '포함 호텔',
      '불포함 개인경비',
    ].join('\n'));

    expect(result.gate_result.status).toBe('needs_review');
    expect(result.gate_result.customer_publishable).toBe(false);
    expect(result.gate_result.checks.find(check => check.id === 'entity_option_review_clear')?.status).toBe('fail');
    expect(result.match_summary.entity_summary.option_review_needed_count).toBeGreaterThan(0);
  });

  it('auto-structures local paid options and shopping count when source names and amounts are explicit', async () => {
    const raw = [
      '상품: 백두산 현지지불옵션 패키지 3박4일',
      'Price: 1,129,000 KRW / minimum 2 people',
      'DAY 1 BX3175 부산 출발 06:00 연길 도착 08:00',
      'DAY 1 hotel check-in',
      'DAY 2 백두산 천지 관광',
      'DAY 2 lunch local meal',
      'DAY 3 자유시간',
      'DAY 4 BX3185 연길 출발 16:00 부산 도착 20:00',
      'Include flights hotels meals',
      '왕복항공권, 호텔, 식사',
      'Exclude personal expenses',
      '기사/가이드경비 $40/인, 매너팁 및 개인경비, 선택관광비용, 유류변동분',
      '★현지지불옵션 : 삼겹살 무제한 $30/인, 전신마사지(발제외/50분) $30/인',
      '∎관광 : 5D비행체험 $40, 북파 VIP $65',
      '쇼핑센터',
      '2회+농산물) 침향, 한약방, 라텍스, 차가버섯, 죽탄, 콜라겐, 보이차 中',
    ].join('\n');

    const result = await runProductRegistrationV3(raw, {
      attractions: [{ id: 'baekdu-cheonji', name: '백두산 천지', country: 'CN', region: '백두산' }],
      destination: '백두산',
    });
    const preview = result.render_contract_preview[0];

    const failedEntityChecks = result.gate_result.checks
      .filter(check => check.status === 'fail')
      .map(check => check.id)
      .filter(id => id.startsWith('entity_'));

    expect(failedEntityChecks).toEqual([]);
    expect(result.match_summary.entity_summary.shopping_review_needed_count).toBe(0);
    expect(result.match_summary.entity_summary.option_review_needed_count).toBe(0);
    expect((preview.optional_tours ?? []).map(tour => tour.name)).toEqual(expect.arrayContaining([
      '삼겹살 무제한',
      '전신마사지(발제외/50분)',
      '5D비행체험',
      '북파 VIP',
    ]));
    expect(preview.itinerary_data?.highlights?.shopping).toContain('2회+농산물');
  });

  it('accepts only strict AI structure-plan schema, not extracted customer values', () => {
    const plan = parseV3AiStructurePlan({
      document_type: 'single_package',
      planner_source: 'deterministic',
      expected_products: 1,
      shared_sections: [],
      product_boundaries: [{ index: 0, line_start: 1, line_end: 3, title_hint: 'sample' }],
      variant_axes: [],
      price_table_location: null,
      price_mapping_strategy: 'unknown',
      flight_pattern: { outbound_codes: [], inbound_codes: [], meeting_times: [] },
      itinerary_boundary_pattern: null,
      option_section_locations: [],
      shopping_section_locations: [],
      confidence: 0.5,
      unresolved_parts: [],
    });
    expect(plan.planner_source).toBe('ai_schema');

    expect(() => parseV3AiStructurePlan({
      document_type: 'single_package',
      planner_source: 'ai_schema',
      expected_products: 1,
      shared_sections: [],
      product_boundaries: [],
      variant_axes: [],
      price_table_location: null,
      price_mapping_strategy: 'unknown',
      flight_pattern: { outbound_codes: [], inbound_codes: [], meeting_times: [] },
      itinerary_boundary_pattern: null,
      option_section_locations: [],
      shopping_section_locations: [],
      confidence: 0.5,
      unresolved_parts: [],
      final_price: 999000,
    })).toThrow();
  });

  it('extracts nha-trang/dalat REMARK into standard categories with template values', async () => {
    const raw = fixtures.find(f => f.name === 'nha-trang-dalat-remark-standardization')!.raw;
    const result = await runProductRegistrationV3(raw);
    const notices = result.ledger.variants[0].standard_notices;
    const categories = notices.map(n => n.category);
    expect(categories).toEqual(expect.arrayContaining([
      'single_room_surcharge',
      'passport_validity',
      'local_law_restriction',
      'room_assignment',
      'itinerary_change',
      'tip_guideline',
      'group_schedule_penalty',
      'restaurant_access',
      'local_guide_operation',
    ]));
    const single = notices.find(n => n.category === 'single_room_surcharge');
    const passport = notices.find(n => n.category === 'passport_validity');
    const localLaw = notices.find(n => n.category === 'local_law_restriction');
    const penalty = notices.find(n => n.category === 'group_schedule_penalty');
    expect(single?.values.amount).toBe(180000);
    expect(single?.standard_text).toContain('18만 원');
    expect(passport?.values.months).toBe(6);
    expect(localLaw?.values.item).toBeTruthy();
    expect(penalty?.values.amount).toBe(100);
    expect(notices.every(n => n.standard_text && n.standard_text !== n.source_text)).toBe(true);
    expect(notices.every(n => n.evidence.length > 0 && n.evidence[0].quote === n.source_text)).toBe(true);
  });

  it('renders customer notices with Yeosonam standard text only (no supplier remark leakage)', async () => {
    const raw = fixtures.find(f => f.name === 'nha-trang-dalat-remark-standardization')!.raw;
    const result = await runProductRegistrationV3(raw);
    const preview = result.render_contract_preview[0];
    const customerNotes = String(preview.customer_notes ?? '');
    expect(customerNotes).toContain('여권 만료일은 입국일 기준 6개월 이상 남아 있어야 합니다.');
    expect(customerNotes).not.toContain('전체 일정 & 식사 순서는 현지 사정에 의해 다소 변경될 수 있습니다.');
    expect(customerNotes).not.toContain('나트랑 식당들은 주차장 구비된 곳이 많지가 않고');
    expect(JSON.stringify(preview.notices_parsed ?? [])).not.toContain('나트랑 식당들은 주차장 구비된 곳이 많지가 않고');
  });

  it('does not leak supplier remark raw text into mobile LP/A4 render surfaces', async () => {
    const raw = fixtures.find(f => f.name === 'nha-trang-dalat-remark-standardization')!.raw;
    const result = await runProductRegistrationV3(raw);
    const preview = result.render_contract_preview[0];
    const canonicalView = renderPackage(preview);
    const landingData = mapTravelPackageToLandingData({
      id: 'nha-v3',
      destination: '나트랑/달랏',
      duration: preview.itinerary_data?.days?.length ?? 0,
      price_dates: preview.price_dates,
      inclusions: preview.inclusions,
      excludes: preview.excludes,
      itinerary_data: preview.itinerary_data,
      optional_tours: preview.optional_tours,
      title: preview.title,
      product_type: preview.product_type,
    }, null);
    const blob = JSON.stringify({ canonicalView, landingData, customerNotes: preview.customer_notes, notices: preview.notices_parsed });
    expect(blob).not.toContain('전체 일정 & 식사 순서는 현지 사정에 의해 다소 변경될 수 있습니다.');
    expect(blob).not.toContain('나트랑 식당들은 주차장 구비된 곳이 많지가 않고');
  });

  it('keeps amount-less single room surcharge as review instead of blocking publish', async () => {
    const raw = `
상품: 하이리스크 검증
가격 499,000원 / 최소출발 4명
DAY 1 KE123 출발 10:00 도착 12:00
REMARK
싱글차지 발생합니다.
DAY 3 KE124 출발 13:00 도착 15:00
`.trim();
    const result = await runProductRegistrationV3(raw);
    const notice = result.ledger.variants[0].standard_notices.find(n => n.category === 'single_room_surcharge');
    expect(notice?.template_key).toBe('single_room_surcharge.inquiry_required');
    expect(notice?.risk_level).toBe('medium');
    expect(notice?.review_status).toBe('review_needed');
    expect(result.gate_result.status).not.toBe('blocked');
    expect(result.gate_result.checks.some(c => c.id.endsWith('high_risk_notice_values') && c.status === 'fail')).toBe(false);
  });

  it('extracts prohibited e-cigarette notice even when supplier omits country name', async () => {
    const raw = `
상품: 전자담배 고위험 검증
가격 499,000원 / 최소출발 4명
DAY 1 KE123 출발 10:00 도착 12:00
REMARK
전자담배 반입금지입니다.
DAY 3 KE124 출발 13:00 도착 15:00
`.trim();
    const result = await runProductRegistrationV3(raw);
    const notice = result.ledger.variants[0].standard_notices.find(n => n.category === 'local_law_restriction');
    expect(notice?.values.item).toBe('전자담배');
    expect(notice?.values.country).toBeNull();
    expect(notice?.review_status).toBe('review_needed');
    expect(notice?.standard_text).toBe('현지에서는 전자담배 반입이 금지되어 있습니다.');
    expect(notice?.source_text).toBe('전자담배 반입금지입니다.');
    expect(result.gate_result.status).toBe('blocked');
    expect(result.gate_result.checks.some(c => c.id.endsWith('high_risk_notice_values') && c.status === 'fail')).toBe(true);
  });

  it('marks customer-visible high-risk notices review_needed when evidence is missing', () => {
    const notice = buildStandardNoticeDraft({
      source_text: '싱글차지 전 일정 기준 인당 18만 원 추가됩니다.',
      category: 'single_room_surcharge',
      values: { amount: 180000, currency: '원' },
      evidence: [],
    });

    expect(notice?.risk_level).toBe('high');
    expect(notice?.visibility).toBe('customer_visible');
    expect(notice?.review_status).toBe('review_needed');
  });
});
