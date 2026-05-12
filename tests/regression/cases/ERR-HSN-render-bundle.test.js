/**
 * @case ERR-HSN-render-bundle (2026-04-21 origin / 2026-04-27 fixture)
 * @summary 호화호특(HSN) 등록 시 발견된 3종 렌더 번들 깨짐 — A4·모바일 양쪽 깨짐 유발.
 *   - W26: inclusions 콤마 포함 단일 문자열 ("항공료, 택스, 유류세") → A4 아이콘 매칭 실패
 *   - W27: 하루 flight activity 2개 분리 ("출발", "도착" 별행) → 모바일 히어로 도착시간 "—" 표시
 *   - W28: "라운드 후 석식 및 호텔 투숙" 같은 호텔 앞절 붙이기 → DetailClient 매칭 시 앞부분 손실
 *
 * 수정: insert-template.js validatePackage 의 Phase 1 CRC Zod strict 검증 (ZOD_STRICT default ON).
 *
 * 회귀: 검증 로직을 추출해 단위 테스트.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

// W26: 콤마 포함 inclusions (단, 숫자 콤마 1,000 같은 건 보호)
function checkW26InclusionsComma(item) {
  if (typeof item !== 'string') return null;
  let depth = 0;
  for (let i = 0; i < item.length; i++) {
    const ch = item[i];
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth = Math.max(0, depth - 1);
    else if (ch === ',' && depth === 0) {
      const prev = item[i - 1] || '';
      const nextRest = item.slice(i + 1, i + 4);
      // 숫자 콤마 (예: "1,000") 가 아닌 경우만 위반
      if (!(/\d/.test(prev) && /^\d{3}/.test(nextRest))) {
        return `[W26] inclusions 콤마: "${item.slice(0, 40)}..."`;
      }
    }
  }
  return null;
}

// W27: 하루 flight 활동 여러 개 + → 토큰 누락
function checkW27FlightSplit(daySchedule) {
  const flights = (daySchedule || []).filter(s => s?.type === 'flight');
  if (flights.length <= 1) return null;
  const unmerged = flights.some(f => !/→|↦|⇒/.test(f.activity || ''));
  if (unmerged) return `[W27] flight ${flights.length}개 + → 토큰 누락`;
  return null;
}

// W28: "호텔 투숙/휴식/체크인" 키워드가 있는데 첫 단어가 "호텔" 이 아닌 활동
function checkW28HotelPrefix(activity) {
  if (typeof activity !== 'string') return null;
  const hasHotelSuffix = /호텔\s*(?:투숙|휴식|체크인|체크 인)/.test(activity);
  const startsWithHotel = /^[*\s]*호텔/.test(activity);
  if (hasHotelSuffix && !startsWithHotel) return `[W28] 호텔 앞절: "${activity.slice(0, 40)}..."`;
  return null;
}

// ── W26 ──
test('ERR-HSN-render-bundle W26: 콤마 포함 inclusions → 위반', () => {
  assert.match(checkW26InclusionsComma('항공료, 택스, 유류세'), /W26/);
});

test('ERR-HSN-render-bundle W26: 숫자 콤마 ("1,000원") → 통과', () => {
  assert.equal(checkW26InclusionsComma('현지 가이드비 1,000엔'), null);
});

test('ERR-HSN-render-bundle W26: 괄호 안 콤마 → 통과', () => {
  assert.equal(checkW26InclusionsComma('식사 (조식, 중식, 석식 포함)'), null);
});

test('ERR-HSN-render-bundle W26: 단일 토큰 → 통과', () => {
  assert.equal(checkW26InclusionsComma('왕복 항공료'), null);
});

// ── W27 ──
test('ERR-HSN-render-bundle W27: flight 1개 → 통과', () => {
  assert.equal(checkW27FlightSplit([{ type: 'flight', activity: 'BX321 부산 출발' }]), null);
});

test('ERR-HSN-render-bundle W27: flight 2개 분리 (→ 토큰 없음) → 위반', () => {
  const result = checkW27FlightSplit([
    { type: 'flight', activity: '김해 출발' },
    { type: 'flight', activity: '청도 도착' },
  ]);
  assert.match(result, /W27/);
});

test('ERR-HSN-render-bundle W27: flight 2개 + → 토큰 → 통과', () => {
  const result = checkW27FlightSplit([
    { type: 'flight', activity: '김해 출발 → 청도 도착 11:35' },
    { type: 'flight', activity: '청도 출발 → 김해 도착 15:30' },
  ]);
  assert.equal(result, null);
});

// ── W28 ──
test('ERR-HSN-render-bundle W28: "호텔 투숙 및 휴식" 단독 → 통과', () => {
  assert.equal(checkW28HotelPrefix('호텔 투숙 및 휴식'), null);
});

test('ERR-HSN-render-bundle W28: "라운드 후 석식 및 호텔 투숙" → 위반', () => {
  assert.match(checkW28HotelPrefix('라운드 후 석식 및 호텔 투숙'), /W28/);
});

test('ERR-HSN-render-bundle W28: "관광 후 호텔 체크인" → 위반', () => {
  assert.match(checkW28HotelPrefix('관광 후 호텔 체크인'), /W28/);
});

test('ERR-HSN-render-bundle W28: "호텔 체크인 후 자유시간" (시작이 호텔) → 통과', () => {
  assert.equal(checkW28HotelPrefix('호텔 체크인 후 자유시간'), null);
});
