import { describe, it, expect } from 'vitest';
import {
  extractItineraryWithLLM,
  mergeLLMExtractWithExisting,
  ItineraryExtractSchema,
  NON_ATTRACTION_PATTERN,
  LONG_DESC_HEADER_PATTERN,
  isLooseMatch,
} from './itinerary-llm-extractor';

/**
 * 5가지 랜드사 패턴 회귀 차단.
 * 실제 LLM 호출은 mockResponse 로 우회 (unit test 비용 0).
 * 실제 LLM 통합 검증은 `npm run test:llm-integration` 으로 별도 (run on demand).
 */

describe('itinerary-llm-extractor — Zod schema', () => {
  it('정상 schedule 통과', () => {
    const ok = ItineraryExtractSchema.safeParse({
      days: [{ day: 1, schedule: [{ activity: '천문산 등정', type: 'attraction' }] }],
    });
    expect(ok.success).toBe(true);
  });
  it('빈 schedule 거부', () => {
    const fail = ItineraryExtractSchema.safeParse({ days: [{ day: 1, schedule: [] }] });
    expect(fail.success).toBe(false);
  });
  it('day 0 거부', () => {
    const fail = ItineraryExtractSchema.safeParse({ days: [{ day: 0, schedule: [{ activity: 'X' }] }] });
    expect(fail.success).toBe(false);
  });
  it('자유 string type 허용 (후처리에서 normalizeType 으로 매핑)', () => {
    // 2026-05-17 박제: LLM 이 우리 카테고리 밖 enum (arrival/meeting/etc) 자주 사용 →
    //   Zod 거부 시 3회 retry 모두 fail 사고. 자유 string 으로 받고 후처리 정규화.
    const ok = ItineraryExtractSchema.safeParse({
      days: [{ day: 1, schedule: [{ activity: 'X', type: 'arrival' }] }],
    });
    expect(ok.success).toBe(true);
  });
});

describe('itinerary-llm-extractor — 5가지 랜드사 패턴 (mocked LLM)', () => {
  // 패턴 A: ▶<이름>(설명) 한 줄 — 북해도 ZE
  it('A — 북해도 ZE: ▶<이름>(설명) 한 줄', async () => {
    const mock = JSON.stringify({
      days: [{ day: 2, schedule: [
        { activity: '호텔 조식 후', type: 'meal' },
        { activity: '도야호 유람선탑승', type: 'attraction', note: '화산분화로 생긴 최대 규모의 칼데라호수' },
        { activity: '쇼와신잔 활화산', type: 'attraction', note: '일본의 특별 명승이자 천연기념물' },
      ] }],
    });
    const r = await extractItineraryWithLLM('▶도야호 유람선탑승(...)', { mockResponse: mock, destination: '북해도' });
    expect(r.success).toBe(true);
    if (!r.success) return;
    const attrNames = r.value.days[0].schedule.filter(s => s.type === 'attraction').map(s => s.activity);
    expect(attrNames).toEqual(['도야호 유람선탑승', '쇼와신잔 활화산']);
  });

  // 패턴 B: ▶<설명>\n   <이름> 두 줄 — 시즈오카
  it('B — 시즈오카: ▶<설명>\\n   <이름> 두 줄을 한 attraction 으로', async () => {
    const mock = JSON.stringify({
      days: [{ day: 2, schedule: [
        { activity: '호텔 조식 후', type: 'meal' },
        { activity: '아라쿠라야마 센겐신사', type: 'attraction', note: '705년에 창건된 후지산의 수호신을 모시는 신사' },
        { activity: '미시마 스카이 워크', type: 'attraction', note: '길이 400m, 높이 70m 일본 최장 현수교' },
      ] }],
    });
    const r = await extractItineraryWithLLM('▶705...신사\n   아라쿠라야마', { mockResponse: mock, destination: '시즈오카' });
    expect(r.success).toBe(true);
    if (!r.success) return;
    const names = r.value.days[0].schedule.filter(s => s.type === 'attraction').map(s => s.activity);
    expect(names).toContain('아라쿠라야마 센겐신사');
    expect(names).toContain('미시마 스카이 워크');
    // 헤딩이 별도 item 으로 들어가지 않아야
    expect(names.some(n => n.startsWith('705년'))).toBe(false);
  });

  // 패턴 C/D: ▶<영역>\n -<부속> — 장가계
  it('C/D — 장가계: ▶<영역>\\n-<부속> 여러 attractions 분리', async () => {
    const mock = JSON.stringify({
      days: [{ day: 2, schedule: [
        { activity: '천자산 등정', type: 'attraction', note: '천자산 풍경구, 2KM 케이블카' },
        { activity: '어필봉', type: 'attraction', note: '붓을 꽂아놓은 듯한 형상' },
        { activity: '선녀헌화', type: 'attraction' },
        { activity: '하룡공원', type: 'attraction', note: '중국의 10대 원수 하룡장군 동상' },
      ] }],
    });
    const r = await extractItineraryWithLLM('▶천자산 풍경구\n-2KM 케이블카...', { mockResponse: mock, destination: '장가계' });
    expect(r.success).toBe(true);
    if (!r.success) return;
    const names = r.value.days[0].schedule.filter(s => s.type === 'attraction').map(s => s.activity);
    expect(names).toContain('어필봉');
    expect(names).toContain('하룡공원');
    expect(names.length).toBeGreaterThanOrEqual(4);
  });

  // 패턴 E: ▶<설명> <이름1 및 이름2> — 대만
  it('E — 대만: "및"으로 묶인 복수 attraction 분리', async () => {
    const mock = JSON.stringify({
      days: [{ day: 2, schedule: [
        { activity: '치메이박물관', type: 'attraction', note: '진귀한 예술품 소장' },
        { activity: '안평수옥', type: 'attraction', note: '트리하우스로 유명' },
        { activity: '안평옛거리', type: 'attraction' },
        { activity: '안평고보', type: 'attraction', note: '네덜란드 식민지 요새' },
      ] }],
    });
    const r = await extractItineraryWithLLM('▶안평수옥 및 안평옛거리', { mockResponse: mock, destination: '대만' });
    expect(r.success).toBe(true);
    if (!r.success) return;
    const names = r.value.days[0].schedule.filter(s => s.type === 'attraction').map(s => s.activity);
    expect(names).toContain('안평수옥');
    expect(names).toContain('안평옛거리');
  });

  // 패턴 F: 항공편 분류 — 모든 패키지
  it('F — 항공편/이동 정확 분류', async () => {
    const mock = JSON.stringify({
      days: [{ day: 1, schedule: [
        { activity: '부산 김해 국제 공항 2층 집결', type: 'transit', time: '07:00' },
        { activity: '부산 출발 ✈ 에어부산 BX1645 직항', type: 'flight', time: '09:05' },
        { activity: '시즈오카 도착', type: 'transit', time: '10:50' },
        { activity: '중식 후', type: 'meal' },
        { activity: '니혼다이라 로프웨이 왕복탑승', type: 'attraction' },
      ] }],
    });
    const r = await extractItineraryWithLLM('07:00 집결\n09:05 출발 BX1645', { mockResponse: mock, destination: '시즈오카' });
    expect(r.success).toBe(true);
    if (!r.success) return;
    const types = r.value.days[0].schedule.map(s => s.type);
    expect(types.filter(t => t === 'flight').length).toBe(1);
    expect(types.filter(t => t === 'attraction').length).toBe(1);
  });
});

// ════════════════════════════════════════════════════════════════════════════
//  2026-05-18 박제 (ERR-loose-match 회귀 차단) — 이번 세션 발견 사고 8건
//  사장님 화면 검수 ground truth 기준 PR #116/#117/#124 가드 회귀 0% 보장.
// ════════════════════════════════════════════════════════════════════════════

describe('NON_ATTRACTION_PATTERN — L1 skip 정규식 회귀 (PR #116)', () => {
  it('마사지/쇼핑/샤워/드랍/픽업/샌딩 라인 skip', () => {
    expect(NON_ATTRACTION_PATTERN.test('여행의 피로를 풀어주는 발+전신마사지(90분)')).toBe(true);
    expect(NON_ATTRACTION_PATTERN.test('면세점 쇼핑 1시간')).toBe(true);
    expect(NON_ATTRACTION_PATTERN.test('호텔 샤워 후 휴식')).toBe(true);
    expect(NON_ATTRACTION_PATTERN.test('공항 드랍')).toBe(true);
    expect(NON_ATTRACTION_PATTERN.test('호텔 픽업 후 이동')).toBe(true);
  });

  it('도착·이동·체크인 라인 skip (장가계 사고 패턴)', () => {
    expect(NON_ATTRACTION_PATTERN.test('장가계 도착 / 가이드 미팅 후 중식')).toBe(true);
    expect(NON_ATTRACTION_PATTERN.test('동인으로 이동(4시간)')).toBe(true);
    expect(NON_ATTRACTION_PATTERN.test('호텔 조식 후')).toBe(true);
    expect(NON_ATTRACTION_PATTERN.test('호텔 투숙 및 휴식')).toBe(true);
  });

  it('정상 attraction 라인은 통과 (skip 안 함)', () => {
    expect(NON_ATTRACTION_PATTERN.test('범정산 관광 (셔틀버스-케이블카-...)')).toBe(false);
    expect(NON_ATTRACTION_PATTERN.test('중국 최고의 협곡 장가계대협곡')).toBe(false);
    expect(NON_ATTRACTION_PATTERN.test('-붓을 꽂아놓은 듯한 형상의 어필봉')).toBe(false);
  });
});

describe('LONG_DESC_HEADER_PATTERN — 본문 carry-over 라인 skip (PR #117)', () => {
  it('측정값 시작 라인 skip (장가계 DAY 4 "총길이 430M..." 사고)', () => {
    expect(LONG_DESC_HEADER_PATTERN.test('총길이 430M, 넓이 6M, 계곡에서의 높이 300M')).toBe(true);
    expect(LONG_DESC_HEADER_PATTERN.test('넓이 6M, 계곡에서의 높이 300M')).toBe(true);
    expect(LONG_DESC_HEADER_PATTERN.test('높이 300M에 달하는 세계 최고의 스카이 워크')).toBe(true);
    expect(LONG_DESC_HEADER_PATTERN.test('면적 567만 평방미터')).toBe(true);
    expect(LONG_DESC_HEADER_PATTERN.test('해발 2,494M의 높이')).toBe(true);
  });

  it('서술문 본문 (측정값 시작 아님) 통과', () => {
    expect(LONG_DESC_HEADER_PATTERN.test('중국 5대 불교명산 중 하나')).toBe(false);
    expect(LONG_DESC_HEADER_PATTERN.test('미륵보살의 도장으로 인정')).toBe(false);
    // "약 2KM" — "약\s*\d" 후 "\s*[\d,]" 못 매칭 → false (보수적 통과)
    expect(LONG_DESC_HEADER_PATTERN.test('약 2KM의 협곡')).toBe(false);
  });
});

describe('isLooseMatch — loose 매칭 차단 (PR #116/#117)', () => {
  it('exact match 통과', () => {
    expect(isLooseMatch('범정산', '범정산')).toBe(false);
    expect(isLooseMatch('천문산사', '천문산사')).toBe(false);
    expect(isLooseMatch('장가계대협곡', '장가계대협곡')).toBe(false);
  });

  it('3자 미만 키워드 reject (단어 단편)', () => {
    expect(isLooseMatch('가', '가나')).toBe(true);
    expect(isLooseMatch('동인', '동인대협곡')).toBe(true);  // "동인으로 이동" 사고 — 짧은 prefix
    expect(isLooseMatch('산', '천문산')).toBe(true);
  });

  it('case 3: 괄호 안 region prefix 차단 (장가계 → 전신마사지60분(장가계) 사고)', () => {
    expect(isLooseMatch('장가계', '전신마사지60분(장가계)')).toBe(true);
    expect(isLooseMatch('청도', '전신마사지60분(청도)')).toBe(true);
    expect(isLooseMatch('나트랑', '전신마사지60분(나트랑)')).toBe(true);
  });

  it('case 2: 긴 attraction.name 25자+ 단어경계 매칭 강제', () => {
    // "유리다리" → "장가계해외국제-[장가계]대협곡B코스(유리다리/VR/미끄럼/유람선)티켓"
    // 코어 = "장가계해외국제-대협곡B코스티켓" (괄호·대괄호 제거). "유리다리" 단어경계 매칭 안 됨 → reject
    expect(isLooseMatch('유리다리', '장가계해외국제-[장가계]대협곡B코스(유리다리/VR/미끄럼/유람선)티켓')).toBe(true);
  });

  it('정상 단어경계 매칭 통과', () => {
    // 5자 키워드 + 정확 매칭 attraction.name
    expect(isLooseMatch('미혼대', '미혼대')).toBe(false);
    // 정상 fuzzy 음역
    expect(isLooseMatch('센겐신사', '아라쿠라야마 센겐신사')).toBe(false);  // 24자 < 25 case 2 skip, 24 / 4 = 6배 > 2.5, 단어경계 매칭 OK
  });
});

describe('mergeLLMExtractWithExisting — attraction_ids 보존', () => {
  it('LLM 결과의 activity 가 기존 schedule 의 attraction_ids 를 부분일치로 복원', () => {
    const llmResult = {
      days: [{ day: 1, schedule: [
        { activity: '아라쿠라야마 센겐신사', type: 'attraction' as const, note: '705년 창건' },
      ] }],
    };
    const existing = {
      days: [{ day: 1, schedule: [
        { activity: '아라쿠라야마 센겐신사', attraction_ids: ['95db1c9e-fake-uuid'], attraction_names: ['아라쿠라야마 센겐신사'] },
      ] }],
    };
    const merged = mergeLLMExtractWithExisting(llmResult, existing);
    expect(merged.days[0].schedule[0]).toMatchObject({
      activity: '아라쿠라야마 센겐신사',
      attraction_ids: ['95db1c9e-fake-uuid'],
    });
  });

  it('기존 itinerary_data 가 비어있으면 LLM 결과 그대로', () => {
    const llmResult = { days: [{ day: 1, schedule: [{ activity: 'X', type: 'attraction' as const }] }] };
    const merged = mergeLLMExtractWithExisting(llmResult, null);
    expect(merged._replaced).toBe(true);
    expect(merged.days[0].schedule[0].activity).toBe('X');
  });

  it('부분일치: "후지산 파노라마 로프웨이" → 기존 "후지산 파노라마 로프웨이 ♥왕복 로프웨이 탑승♥" 매칭', () => {
    const llmResult = {
      days: [{ day: 2, schedule: [
        { activity: '후지산 파노라마 로프웨이', type: 'attraction' as const, note: '왕복 탑승' },
      ] }],
    };
    const existing = {
      days: [{ day: 2, schedule: [
        { activity: '후지산 파노라마 로프웨이 ♥왕복 로프웨이 탑승♥', attraction_ids: ['7c46307d'], attraction_names: ['후지산 파노라마 로프웨이'] },
      ] }],
    };
    const merged = mergeLLMExtractWithExisting(llmResult, existing);
    const first = merged.days[0].schedule[0] as typeof merged.days[0]['schedule'][0] & { attraction_ids?: string[] };
    expect(first.attraction_ids).toEqual(['7c46307d']);
  });
});
