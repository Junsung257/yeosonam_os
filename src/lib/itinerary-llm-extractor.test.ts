import { describe, it, expect } from 'vitest';
import { extractItineraryWithLLM, mergeLLMExtractWithExisting, ItineraryExtractSchema } from './itinerary-llm-extractor';

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
  it('잘못된 type enum 거부', () => {
    const fail = ItineraryExtractSchema.safeParse({
      days: [{ day: 1, schedule: [{ activity: 'X', type: 'random' as unknown as 'attraction' }] }],
    });
    expect(fail.success).toBe(false);
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
