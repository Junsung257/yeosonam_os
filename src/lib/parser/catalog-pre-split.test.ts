import { describe, expect, it } from 'vitest';
import {
  collectItineraryHeaderStarts,
  countCatalogItineraryHeaders,
  splitCatalogByItineraryHeaders,
  applyLLMSplit,
  detectCatalogBoundariesWithLLM,
  detectEvidenceBoundCatalogBoundariesWithLLM,
  shouldTryEvidenceAiCatalogSplit,
  splitCatalogSmart,
  collectPkgBlockStarts,
  extractProductRawTextSection,
  type LLMSplitResult,
} from './catalog-pre-split';

describe('splitCatalogByItineraryHeaders', () => {
  it('does not split one product at an inclusion mentioning itinerary meals', () => {
    const raw = [
      '[KE] 다낭/호이안 3박4일 노팁노옵션',
      '499,000원',
      '9/13, 14, 15',
      '▶ 왕복 국제선 항공료',
      '▶ 호텔 숙박, 차량, 관광지 입장료, 일정표 상의 식사',
      '포함사항',
      '▶ 호이안 관광과 바나힐',
      '불포함사항',
      '▶ 개인경비',
      'DAY 1 인천 출발',
      'DAY 2 호이안 관광',
    ].join('\n');

    expect(collectItineraryHeaderStarts(raw)).toEqual([0]);
    expect(splitCatalogByItineraryHeaders(raw).sections).toHaveLength(1);
  });

  it('folds a title-only envelope into the following decorated itinerary card', () => {
    const raw = [
      '큐슈 초석 시내 1박2일',
      '♡유후인♡태재부♡이토시마',
      '+++ 가성비 甲, 실속 후쿠오카 +++',
      '★ 초석 패턴 1박 2일 특가 ★',
      '상품가',
      '8/27 (목)',
      '319,000원',
      '9/15 (화)',
      '299,000원',
      '포함사항 왕복항공료 호텔',
      '불포함사항 개인경비',
      '제1일 부산 출발',
      '제2일 부산 도착',
    ].join('\\n');

    const result = splitCatalogByItineraryHeaders(raw);

    expect(result.sections).toHaveLength(1);
    expect(result.sections[0]).toContain('큐슈 초석 시내 1박2일');
    expect(result.sections[0]).toContain('319,000원');
    expect(result.sections[0]).toContain('제2일 부산 도착');
  });

  it('keeps a destination title when the itinerary card starts with a date line', () => {
    const raw = [
      '몽골 울란바토르 테를지 4박6일',
      '출 발 일',
      '5/8 또는 5/15 출발 (4박6일)',
      '상품가 1,419,000원',
      '포함사항 왕복항공료 호텔',
      '불포함사항 개인경비',
      '제1일 부산 출발',
      '제6일 부산 도착',
    ].join('\\n');

    const result = splitCatalogByItineraryHeaders(raw);

    expect(result.sections).toHaveLength(1);
    expect(result.sections[0]).toContain('몽골 울란바토르 테를지 4박6일');
    expect(result.sections[0]).toContain('상품가 1,419,000원');
  });

  it('does not turn a price-matrix duration column into an extra product', () => {
    const raw = [
      '공통 가격표',
      '울란바토르+테를지+엘승사막 4박6일',
      '패 턴', '날 짜', '요 일', '1,299,000', '9/9~9/19',
      '몽골 울란바토르 테를지 노팁 노옵션 3박5일',
      '출 발 일', '요금표 참고', '상 품 가', '요금표 참고',
      '포함사항', '왕복항공료, 호텔, 차량', '불포함사항', '개인경비',
      '제1일차', '7C5257 부산 출발',
      '몽골 울란바토르 엘승 노팁 노옵션 4박6일',
      '출 발 일', '요금표 참고', '상 품 가', '요금표 참고',
      '포함사항', '왕복항공료, 호텔, 차량', '불포함사항', '개인경비',
      '제1일차', '7C5257 부산 출발',
    ].join('\n');

    const result = splitCatalogByItineraryHeaders(raw);
    expect(result.sections).toHaveLength(2);
    expect(result.sharedPrefix).toContain('1,299,000');
    expect(result.sections[0]).toContain('3박5일');
    expect(result.sections[1]).toContain('4박6일');
  });

  it('keeps every duration and grade product when PKG is line-wrapped for one grade', () => {
    const raw = [
      '공통 출발일 가격표',
      '출발일 | 실속 | 품격(노팁+노옵션)',
      '8/29 (토) | 849,000 | 1,049,000',
      '부산출발 연길/백두산(북파) 2박3일 실속PKG',
      '포함 왕복항공료 호텔', '불포함 개인경비', '제1일 BX337 부산 출발', '제2일 관광', '제3일 부산 도착',
      '부산출발 연길/백두산(북+서파) 3박4일 실속PKG',
      '포함 왕복항공료 호텔', '불포함 개인경비', '제1일 BX337 부산 출발', '제2일 관광', '제3일 관광', '제4일 부산 도착',
      '부산출발 연길/백두산(북파) 2박3일',
      '품격PKG (노팁+노옵션)',
      '포함 왕복항공료 호텔 가이드팁', '불포함 개인경비', '제1일 BX337 부산 출발', '제2일 관광', '제3일 부산 도착',
      '부산출발 연길/백두산(북+서파) 3박4일',
      '품격PKG (노팁+노옵션)',
      '포함 왕복항공료 호텔 가이드팁', '불포함 개인경비', '제1일 BX337 부산 출발', '제2일 관광', '제3일 관광', '제4일 부산 도착',
    ].join('\n');

    const result = splitCatalogByItineraryHeaders(raw);

    expect(result.sections).toHaveLength(4);
    expect(result.sharedPrefix).toContain('공통 출발일 가격표');
    expect(result.sections.map(section => section.split('\n').slice(0, 2).join(' '))).toEqual([
      expect.stringContaining('2박3일 실속PKG'),
      expect.stringContaining('3박4일 실속PKG'),
      expect.stringContaining('2박3일 품격PKG'),
      expect.stringContaining('3박4일 품격PKG'),
    ]);
  });
  it('각 일정표 헤더마다 한 섹션(공통 가격은 sharedPrefix)', () => {
    const raw = `공통 가격표
성인 100만
[ZE] 치앙마이 5일 일정표
1일차 A
[BK] 치앙마이 6일 일정표
1일차 B
[CJ] 치앙마이 프리미엄 일정표
1일차 C`;

    const { sharedPrefix, sections } = splitCatalogByItineraryHeaders(raw);
    expect(sharedPrefix).toContain('공통 가격표');
    expect(sections).toHaveLength(3);
    expect(sections[0]).toMatch(/^\[ZE\]/);
    expect(sections[1]).toMatch(/^\[BK\]/);
    expect(sections[2]).toMatch(/^\[CJ\]/);
    expect(countCatalogItineraryHeaders(raw)).toBe(3);
  });

  it('splits strict golf product headers written as 4일 and 5일', () => {
    const raw = `송백 골프 공통 안내
【노쇼핑】 황산 송백CC 무제한 골프 4일 BX (에어부산)
출 발 일 4월10일부터 ~ 5월29일까지 매주 화 출발
인 원 8명
여 행 경 비
5월 19, 26일 849,000원
5월 5일 999,000원
제1일 BX321 부산 출발
제4일 부산 도착

【노쇼핑】 황산 송백CC 무제한 골프 5일 BX (에어부산)
출 발 일 4월10일부터 ~ 5월29일까지 매주 금 출발
인 원 8명
여 행 경 비
5월 15, 22, 29일 1,069,000원
제1일 BX321 부산 출발
제5일 부산 도착`;

    const { sharedPrefix, sections } = splitCatalogByItineraryHeaders(raw);

    expect(sharedPrefix).toContain('송백 골프 공통 안내');
    expect(sections).toHaveLength(2);
    expect(sections[0]).toContain('골프 4일');
    expect(sections[0]).not.toContain('골프 5일');
    expect(sections[1]).toContain('골프 5일');
  });

  it('does not split a day-count sentence without product-commercial context', () => {
    const raw = `황산 골프 4일 체류 안내
현지에서 4일 동안 자유시간을 드립니다.
참고사항과 준비물 안내입니다.`;

    expect(collectItineraryHeaderStarts(raw)).toHaveLength(0);
  });

  it('does not treat a 30-day visa notice as a tour duration header', () => {
    const raw = `BX 장가계 3박4일
여행기간 2026년 6월~8월
출발일 매주 토요일
포함 왕복항공료 호텔
불포함 개인비용
중국 입국 관광 목적 시 30일까지 무비자 체류가능
제1일 BX321 부산 출발
제4일 부산 도착`;

    expect(splitCatalogByItineraryHeaders(raw).sections).toHaveLength(1);
  });

  it('does not treat 전용차량2일 in an inclusion line as a product duration', () => {
    const raw = `부산-후쿠오카 온천 2박3일 관광PKG
출발일 6/7
상품가 519,000원
포함 왕복항공료, 호텔, 식사, 전용차량2일, 관광지 입장료
불포함 싱글차지, 개인경비
제1일 부산 출발
제3일 부산 도착`;

    expect(splitCatalogByItineraryHeaders(raw).sections).toHaveLength(1);
  });

  it('does not split an itinerary at a duration-specific conditional day note', () => {
    const raw = `보홀 직항 슬림패키지 5일/6일
행사일자 상부 기재 일자
포함내역 왕복 항공료 숙박
불포함내역 개인경비
제1일 부산 출발
*제3일* 4박6일일 경우: 하루 자유시간 (중/석식 불포함)
HOTEL: 예약호텔(리조트)
제5일 부산 도착`;

    const { sections } = splitCatalogByItineraryHeaders(raw);

    expect(sections).toHaveLength(1);
    expect(sections[0]).toContain('4박6일일 경우');
    expect(sections[0]).toContain('HOTEL: 예약호텔');
  });

  it('does not split one resort product at weekday-duration price patterns or longer-duration day conditions', () => {
    const raw = [
      '발리 솔리아(4성) 스팟특가',
      '출발기간 2026년 8월~10월 특정일',
      '금/일요일 – 3박5일',
      '월/수요일 - 4박6일',
      '출발일',
      '8/30 | 879,000',
      '발리 솔리아 스팟특가 패키지 [3박5일 / 4박6일]',
      '포함 왕복항공료, 호텔, 차량',
      '불포함 가이드기사팁, 개인경비',
      '제1일 BX601 부산 출발',
      '제2일 발리 관광',
      '호텔 조식 후 전일 자유시간 [4박6일 일정 시]',
      '(제4일) 전일 자유일정',
      '제5일 BX602 부산 도착',
    ].join('\n');

    expect(collectItineraryHeaderStarts(raw)).toHaveLength(1);
    const { sections } = splitCatalogByItineraryHeaders(raw);
    expect(sections).toHaveLength(1);
    expect(sections[0]).toContain('월/수요일 - 4박6일');
    expect(sections[0]).toContain('[4박6일 일정 시]');
  });

  it('헤더가 1개면 단일 섹션', () => {
    const raw = '안내\n[OL] 오사카 일정표\n내용';
    const r = splitCatalogByItineraryHeaders(raw);
    expect(r.sections).toHaveLength(1);
    expect(r.sections[0]).toContain('[OL]');
    expect(countCatalogItineraryHeaders(raw)).toBe(1);
  });

  it('RMK 연합행사 안내의 다른 박수 문구를 상품 헤더로 세지 않는다', () => {
    const raw = [
      '[노옵션노팁] 다낭&호이안/바나힐 3박 5일 [비엣젯항공]',
      '출 발 일 자',
      '2026년 7월 29일 출발예정',
      'R M K',
      '▶ 타항공사 / 4박6일 팀과 연합행사이며, 현지에서 옵션안내 같이 드립니다.',
      '날 짜',
      '제1일',
      '부산 김해국제공항 출발',
      '제2일',
      '호이안 구시가지 관광',
    ].join('\n');

    expect(countCatalogItineraryHeaders(raw)).toBe(1);
  });

  it('월별 가격표에서 같은 PKG 제목이 반복되어도 단일 상품으로 센다', () => {
    const raw = [
      '북해도 실속비에이 3박4일 PKG',
      '비에이ㆍ오타루ㆍ도야ㆍ노보리베츠',
      '6월',
      '6/28, 30',
      '1,169,000원',
      '북해도 실속비에이 3박4일 PKG',
      '비에이ㆍ오타루ㆍ도야ㆍ노보리베츠',
      '8/1~8/16',
      '1,049,000원',
      '북해도 실속비에이 3박4일 PKG',
      '비에이ㆍ오타루ㆍ도야ㆍ노보리베츠',
      '포함사항',
      '왕복항공료, 호텔',
      '불포함사항',
      '개인경비',
      '일자',
      '제1일 부산 출발',
    ].join('\n');

    expect(collectPkgBlockStarts(raw)).toHaveLength(1);
    expect(countCatalogItineraryHeaders(raw)).toBe(1);
  });

  it('전각 대괄호·일정 표 띄어쓰기 허용', () => {
    const raw = `앞
【BX】 방콕 일정 표
상세1
【NY】 파타야 일정표
상세2`;
    expect(countCatalogItineraryHeaders(raw)).toBe(2);
    const { sections } = splitCatalogByItineraryHeaders(raw);
    expect(sections).toHaveLength(2);
    expect(sections[0]).toContain('【BX】');
  });

  it('■/◆ 글머리 일정표 헤더도 분할', () => {
    const raw = `공통
■ 치앙마이 A 일정표
본문1
◆ 치앙마이 B 일정표
본문2`;
    expect(collectItineraryHeaderStarts(raw).length).toBe(2);
    const { sections } = splitCatalogByItineraryHeaders(raw);
    expect(sections).toHaveLength(2);
    expect(sections[0]).toContain('■');
    expect(sections[1]).toContain('◆');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 2026-05-19 박제 (사장님 실제 5 카탈로그 회귀 차단):
  //
  // 지금까지 fixture 는 "[ZE]…일정표" 같은 이상화된 헤더만 있었음.
  // 사장님이 실제로 매일 받는 BX/LJ/VJ/VN/부관훼리 헤더는 "일정표" 키워드 없음.
  // 2달 동안 catalog-pre-split.ts 0회 수정 + 32 PR 우회한 근본 사고.
  //
  // 다음 PR 이 가드 풀면 즉시 회귀.
  // ═══════════════════════════════════════════════════════════════════════════
  describe('실제 카탈로그 5 케이스 회귀 차단 (2026-05-19 박제)', () => {
    it('[BX] 대만 — 3 상품 카탈로그 분리', () => {
      const raw = `공통 요금표 + 하계 써차지 표
정기 5/1~6/30: 859,000원
하계 5/3 등: 999,000원

[BX] 대만 단수이 3박 4일
행 사 날 짜  2026년 5월 1일 ~ 2026년 10월 24일
최 소 출 발  성인 8명 이상 출발 가능
포함내역: 항공/호텔/차량/가이드/입장료/식사/여행자보험
${'단수이 일정 상세 본문 '.repeat(20)}

[BX] 대만 베이토우 3박 4일
행 사 날 짜  2026년 5월 1일 ~ 2026년 10월 24일
${'베이토우 일정 상세 본문 '.repeat(20)}

[BX] 대만 우라이 3박 4일
행 사 날 짜  2026년 5월 1일 ~ 2026년 10월 24일
${'우라이 일정 상세 본문 '.repeat(20)}`;
      const { sharedPrefix, sections } = splitCatalogByItineraryHeaders(raw);
      expect(sections, '[BX] 3 상품 분리').toHaveLength(3);
      expect(sharedPrefix, '공통 요금표 보존').toContain('공통 요금표');
      expect(sections[0]).toContain('단수이');
      expect(sections[1]).toContain('베이토우');
      expect(sections[2]).toContain('우라이');
    });

    it('[LJ] 몽골 — 대괄호 코드 없음 + 전각 요일【금】/【월】', () => {
      const raw = `광활한 대초원과 황금빛 사막
4명부터 출발 노팁노옵션노쇼핑

울란바토르, 테를지초원 3박 5일【금】
최소출발 성인 4명 이상
포함 항공료 호텔 차량 가이드
${'테를지 일정 상세 '.repeat(25)}

울란바토르, 테를지초원 엘승타사르하이사막 4박 6일【월】
최소출발 성인 4명 이상
포함 항공료 호텔 차량 가이드
${'엘승타사르하이 일정 상세 '.repeat(25)}`;
      const { sections } = splitCatalogByItineraryHeaders(raw);
      expect(sections, '[LJ] 2 상품 분리').toHaveLength(2);
      expect(sections[0]).toMatch(/3박\s*5일/);
      expect(sections[1]).toMatch(/4박\s*6일/);
    });

    it('[VJ]/[VN] 베트남 — 항공사 코드 다른 2 상품 (같은 일정)', () => {
      const raw = `공통: 옌뜨국립공원 + 하롱베이 + 마사지

[VJ] 베트남 하노이/하롱/옌뜨 3박5일 ☑노팁노옵션
출 발 일 6/10 - 14
상 품 가 1인 759,000원
포함 호텔 차량 식사 가이드
${'VJ 일정 상세 본문 '.repeat(30)}

[VN] 베트남 하노이/하롱베이/옌뜨 3박5일 ☑노팁노옵션
출 발 일 6/10 - 14
상 품 가 1인 959,000원
${'VN 일정 상세 본문 '.repeat(30)}`;
      const { sections } = splitCatalogByItineraryHeaders(raw);
      expect(sections, '[VJ][VN] 2 상품 분리').toHaveLength(2);
      expect(sections[0]).toContain('[VJ]');
      expect(sections[1]).toContain('[VN]');
    });

    it('[부관훼리] 한글 코드 + 무박3일 — 같은 상품의 요금 카드와 일정 카드를 합친다', () => {
      const raw = `${'사전 안내 텍스트 '.repeat(10)}
[부관훼리] 초특가 가성비 무박3일 패키지
선박 스케쥴 부산-시모노세키 21:00-08:00
출 발 일 판 매 가 (아동동일)
4/1~4/30 159,000원
포함 사항 왕복훼리비 부두세 가이드 전용버스
${'요금표 행 '.repeat(40)}

[부관훼리] 초특가 가성비 무박3일 PKG
인원 10명부터 출발 확정
일정표
제1일 부산항 출항
제2일 시모노세키 관광
제3일 부산 도착
${'일정 본문 '.repeat(30)}`;
      const { sections } = splitCatalogByItineraryHeaders(raw);
      expect(sections, '가격과 일정이 한 상품에 함께 남아야 한다').toHaveLength(1);
      expect(sections[0]).toContain('159,000원');
      expect(sections[0]).toContain('제3일 부산 도착');
    });

    it('합계 라벨이 없는 월력형 요금 카드도 같은 상품의 일정 카드와 합친다', () => {
      const raw = `[카멜리아] 후쿠오카 시내숙박 2박3일 패키지
2026년 5월
일
월
화
수
목
금
토
1
2
249,000
259,000
269,000

[카멜리아] 후쿠오카 시내숙박 2박3일 PKG
포함사항 왕복훼리비 호텔식
불포함사항 개인경비
제1일 부산항 출항
제2일 후쿠오카 관광
제3일 부산 도착`;

      const { sections } = splitCatalogByItineraryHeaders(raw);

      expect(sections).toHaveLength(1);
      expect(sections[0]).toContain('249,000');
      expect(sections[0]).toContain('제3일 부산 도착');
    });

    // false positive 차단(본문 "3박 5일" 표기)은 별도 layer (consistency-judge, LLM validate)
    // 책임. catalog-pre-split 은 헤더 후보를 *넓게* 감지하고, 검증은 후속 단계.
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 2026-05-19 박제 (P1-B): LLM split fallback
  //
  // regex 매칭 실패 시 LLM 이 character offset 으로 boundary 결정.
  // 실제 LLM 호출은 mock — 결과 처리 로직만 검증 (applyLLMSplit).
  // ═══════════════════════════════════════════════════════════════════════════
  describe('LLM split fallback (P1-B 박제)', () => {
    it('applyLLMSplit: 2 products → 2 sections + sharedPrefix', () => {
      const raw = `공통 안내 텍스트
전체 약관 등
[새포맷] 도시A 3박4일 특가
일정 본문 A
[새포맷] 도시B 4박5일 럭셔리
일정 본문 B`;
      const llm: LLMSplitResult = {
        products: [
          { start_char: raw.indexOf('[새포맷] 도시A'), name_hint: '[새포맷] 도시A 3박4일' },
          { start_char: raw.indexOf('[새포맷] 도시B'), name_hint: '[새포맷] 도시B 4박5일' },
        ],
      };
      const r = applyLLMSplit(raw, llm);
      expect(r.sections, '2 sections').toHaveLength(2);
      expect(r.sharedPrefix, '공통 prefix 보존').toContain('공통 안내');
      expect(r.sections[0]).toContain('도시A');
      expect(r.sections[1]).toContain('도시B');
    });

    it('applyLLMSplit: 1 product → 1 section', () => {
      const raw = '단일 상품 카탈로그\n일정 본문';
      const llm: LLMSplitResult = {
        products: [{ start_char: 0, name_hint: '단일 상품' }],
      };
      const r = applyLLMSplit(raw, llm);
      expect(r.sections).toHaveLength(1);
      expect(r.sharedPrefix, '시작 0이면 prefix 없음').toBe('');
    });

    it('applyLLMSplit: 빈 products → 전체를 1 section 으로', () => {
      const raw = '내용';
      const r = applyLLMSplit(raw, { products: [] });
      expect(r.sections).toHaveLength(1);
      expect(r.sections[0]).toBe('내용');
    });

    it('applyLLMSplit: start_char 역순도 자동 정렬', () => {
      const raw = `prefix
[B] 두번째
본문B
[A] 첫번째
본문A`;
      const llm: LLMSplitResult = {
        products: [
          { start_char: raw.indexOf('[A]'), name_hint: 'A' },
          { start_char: raw.indexOf('[B]'), name_hint: 'B' },
        ],
      };
      // 입력은 [A, B] 순서지만 char offset 은 B 먼저 → 정렬 후 [B 먼저]
      const r = applyLLMSplit(raw, llm);
      expect(r.sections[0]).toContain('[B]');
      expect(r.sections[1]).toContain('[A]');
    });

    it('detectCatalogBoundariesWithLLM: 짧은 텍스트면 skip', async () => {
      const r = await detectCatalogBoundariesWithLLM('짧은 텍스트');
      expect(r.skipped).toBe(true);
      expect(r.reason).toBe('too-short');
    });

    it('detectCatalogBoundariesWithLLM: env disabled 면 skip', async () => {
      const original = process.env.UPLOAD_CATALOG_LLM_SPLIT;
      process.env.UPLOAD_CATALOG_LLM_SPLIT = '0';
      try {
        const longText = '본문 텍스트 '.repeat(500);
        const r = await detectCatalogBoundariesWithLLM(longText);
        expect(r.skipped).toBe(true);
        expect(r.reason).toBe('env-disabled');
      } finally {
        if (original === undefined) delete process.env.UPLOAD_CATALOG_LLM_SPLIT;
        else process.env.UPLOAD_CATALOG_LLM_SPLIT = original;
      }
    });

    it('splitCatalogSmart: regex 가 잡으면 LLM 우회 (source=regex)', async () => {
      const raw = `공통
[ZE] 치앙마이 5일 일정표
본문1
[BK] 방콕 6일 일정표
본문2`;
      const r = await splitCatalogSmart(raw);
      expect(r.source).toBe('regex');
      expect(r.sections).toHaveLength(2);
    });

    it('splitCatalogSmart: regex miss + 짧은 텍스트 → single (LLM skip)', async () => {
      const raw = '짧은 단일 상품 내용';
      const r = await splitCatalogSmart(raw);
      expect(r.source).toBe('single');
      expect(r.sections).toHaveLength(1);
    });
  });

  describe('PKG 블록 분할 (2026-05-22 보홀 슬림팩)', () => {
    const boholCatalog = `PKG
보홀 슬림팩 3박5일
출 발 일
5/31 (일)
판 매 가
499,000/인
제1일 VN421 부산 출발
제2일 보홀
제3일 보홀
제4일 보홀
제5일 부산 도착

PKG
보홀 슬림팩 4박6일
출 발 일
5/30 (토)
판 매 가
519,000/인
제1일 VN423 부산 출발
제2일 보홀
제3일 보홀
제4일 보홀
제5일 보홀
제6일 부산 도착

필리핀여행상품 취소규정 안내`;

    it('collectPkgBlockStarts: PKG 헤더 2건', () => {
      const starts = collectPkgBlockStarts(boholCatalog);
      expect(starts).toHaveLength(2);
    });

    it('extractProductRawTextSection: 상품별 일차 max가 분리됨', () => {
      const s0 = extractProductRawTextSection(boholCatalog, '보홀 슬림팩 3박5일', 0, 2);
      const s1 = extractProductRawTextSection(boholCatalog, '보홀 슬림팩 4박6일', 1, 2);
      expect(s0).toContain('3박5일');
      expect(s0).not.toContain('4박6일');
      expect([...s0.matchAll(/제\s*(\d+)\s*일/g)].map(m => parseInt(m[1]))).toEqual([1, 2, 3, 4, 5]);
      expect(s1).toContain('4박6일');
      expect(s1).not.toMatch(/3박5일/);
      expect([...s1.matchAll(/제\s*(\d+)\s*일/g)].map(m => parseInt(m[1]))).toEqual([1, 2, 3, 4, 5, 6]);
    });
  });
});

describe('inline PKG catalog headers', () => {
  it('splits line-end PKG titles even when pasted directly after the last price', () => {
    const raw = `5. 부산출발 :양방향_화살표: 서안 칠채산 PKG
(황하석림/바단지린사막)
항공 스케줄
부산-서안 BX341 22:00/00:35+1
서안-부산 BX342 02:10/06:30
주 2회 운항 -- 수 3박5일 / 토 4박6일

출 발 일
칠채산+황하석림+바단지린사막
10월
(토) 17
4박6일
1,299,000부산-서안 칠채산(황하석림/바단지린사막) 3박5일 PKG
출발날짜
2026년 수요일출발
날 짜
제1일
부산 김해 국제공항 출발
제5일
부산 도착

부산-서안 칠채산(황하석림/바단지린사막) 4박6일 PKG
출발날짜
2026년 토요일출발
날 짜
제1일
부산 김해 국제공항 출발
제6일
부산 도착`;

    expect(collectPkgBlockStarts(raw)).toHaveLength(2);

    const { sharedPrefix, sections } = splitCatalogByItineraryHeaders(raw);
    expect(sharedPrefix).toContain('주 2회 운항 -- 수 3박5일 / 토 4박6일');
    expect(sections).toHaveLength(2);
    expect(sections[0]).toContain('3박5일 PKG');
    expect(sections[0]).not.toContain('4박6일 PKG');
    expect(sections[1]).toContain('4박6일 PKG');
  });

  it('splits 출발지出 + PKG + duration product titles', () => {
    const raw = `공통 가격표
출발일
실속
고품격(노옵션)
5/31
679,000
969,000

부산出 푸꾸옥 실속 PKG 3박5일 이스타항공(ZE)
출 발 날 짜
2026년 3월29일 ~ 10월24일
일 자
제1일
본문 A

부산出 푸꾸옥 실속 PKG 4박6일 이스타항공(ZE)
출 발 날 짜
2026년 3월29일 ~ 10월24일
일 자
제1일
본문 B

부산出 푸꾸옥 고품격(노옵션) PKG 3박5일 이스타항공(ZE)
출 발 날 짜
2026년 3월29일 ~ 10월24일
일 자
제1일
본문 C

부산出 푸꾸옥 고품격(노옵션) PKG 4박6일 이스타항공(ZE)
출 발 날 짜
2026년 3월29일 ~ 10월24일
일 자
제1일
본문 D`;

    expect(collectPkgBlockStarts(raw)).toHaveLength(4);
    expect(countCatalogItineraryHeaders(raw)).toBe(4);

    const { sharedPrefix, sections } = splitCatalogByItineraryHeaders(raw);
    expect(sharedPrefix).toContain('공통 가격표');
    expect(sections).toHaveLength(4);
    expect(sections[0]).toContain('실속 PKG 3박5일');
    expect(sections[1]).toContain('실속 PKG 4박6일');
    expect(sections[2]).toContain('고품격(노옵션) PKG 3박5일');
    expect(sections[3]).toContain('고품격(노옵션) PKG 4박6일');
  });

  it('splits newline PKG golf catalogs with shared price tables into four products', () => {
    const raw = `공통 가격표
스팟특가
6/20,21,28
999,-
1,159,-

PKG
클락 알뜰 3색골프 + 단독차량 3박5일
2026.4.1
출 발 일
6/1~10/24 (수,목)
일정 A

PKG
클락 알뜰 3색골프 + 단독차량 4박6일
2026.4.1
출 발 일
6/1~10/24 (토,일)
일정 B

PKG
클락 품격 풀빌라 더비스타 2색골프 + 단독차량 3박5일
2026.4.1
출 발 일
6/1~10/24 (수,목)
일정 C

PKG
클락 품격 풀빌라 더비스타 2색골프 + 단독차량 4박6일
2026.4.1
출 발 일
6/1~10/24 (토,일)
일정 D`;

    expect(collectPkgBlockStarts(raw)).toHaveLength(4);
    expect(countCatalogItineraryHeaders(raw)).toBe(4);

    const { sharedPrefix, sections } = splitCatalogByItineraryHeaders(raw);
    expect(sharedPrefix).toContain('공통 가격표');
    expect(sections).toHaveLength(4);
    expect(sections.map(section => section.split(/\r?\n/)[1])).toEqual([
      '클락 알뜰 3색골프 + 단독차량 3박5일',
      '클락 알뜰 3색골프 + 단독차량 4박6일',
      '클락 품격 풀빌라 더비스타 2색골프 + 단독차량 3박5일',
      '클락 품격 풀빌라 더비스타 2색골프 + 단독차량 4박6일',
    ]);
  });

  it('splits PKG markers appended to the previous sentence before the next product title', () => {
    const raw = `클락 골프 공통 요금표
출발일
6/20,21,28
999,-
1,159,-
예약시 날짜별 상품가 다시 체크 부탁드립니다.  PKG
클락 알뜰 3색골프 + 단독차량 3박5일
2026.4.1
일 자
제1일
부산 출발
제5일
부산 도착
* 상기 일정은 현지 사정으로 변경될 수 있습니다.  PKG
클락 알뜰 3색골프 + 단독차량 4박6일
2026.4.1
일 자
제1일
부산 출발
제6일
부산 도착`;

    expect(collectPkgBlockStarts(raw)).toHaveLength(2);
    expect(countCatalogItineraryHeaders(raw)).toBe(2);

    const { sharedPrefix, sections } = splitCatalogByItineraryHeaders(raw);
    expect(sharedPrefix).toContain('클락 골프 공통 요금표');
    expect(sections).toHaveLength(2);
    expect(sections[0]).toContain('클락 알뜰 3색골프 + 단독차량 3박5일');
    expect(sections[0]).not.toContain('클락 알뜰 3색골프 + 단독차량 4박6일');
    expect(sections[1]).toContain('클락 알뜰 3색골프 + 단독차량 4박6일');
  });

  it('splits PKG markers when a markdown separator appears before the product title', () => {
    const raw = `공통 요금표
PKG
BX 서안/진시황릉+병마용 4박6일
일 자
제1일
서안 도착
제6일
부산 도착
PKG

---

[노팁/노옵션/노쇼핑] BX 서안/화산 품격 패키지 4박6일
일 자
제1일
서안 도착
제6일
부산 도착`;

    expect(collectPkgBlockStarts(raw)).toHaveLength(2);
    const { sections } = splitCatalogByItineraryHeaders(raw);
    expect(sections).toHaveLength(2);
    expect(sections[0]).toContain('BX 서안/진시황릉+병마용 4박6일');
    expect(sections[0]).not.toContain('[노팁/노옵션/노쇼핑]');
    expect(sections[1]).toContain('[노팁/노옵션/노쇼핑] BX 서안/화산 품격 패키지 4박6일');
  });

  it('does not split a product again at its duration applicability line', () => {
    const raw = `공통 요금표
[7C 저녁출발] 싱가포르 1일자유 패키지 3박5일
26년 8월 ~ 10월 출발기준 (3박5일)
2026년 8월~11월 출발 3박5일
제1일
부산 출발
포함사항 항공 및 호텔
불포함사항 개인경비

[7C 저녁출발] 싱가포르 전일관광 패키지 3박5일
26년 8월 ~ 10월 출발기준 (3박5일)
2026년 8월~11월 출발 3박5일
제1일
부산 출발
포함사항 항공 및 호텔
불포함사항 개인경비`;

    const { sharedPrefix, sections } = splitCatalogByItineraryHeaders(raw);

    expect(sharedPrefix).toContain('공통 요금표');
    expect(sections).toHaveLength(2);
    expect(sections[0]).toContain('1일자유 패키지');
    expect(sections[0]).toContain('26년 8월 ~ 10월 출발기준');
    expect(sections[1]).toContain('전일관광 패키지');
  });

  it('keeps a dated duration applicability row inside its product', () => {
    const raw = `부산-계림 3박5일 품격PKG [노팁/노옵션]
정부 운항 허가 조건 안내
26년 4/14 (화) 3박5일
출발날짜
4/14 출발 969,000원/인
상품가
포함
왕복항공료, 호텔, 식사
불포함
개인경비
제1일 부산 출발
제2일 계림 관광`;

    const { sections } = splitCatalogByItineraryHeaders(raw);

    expect(sections).toHaveLength(1);
    expect(sections[0]).toContain('969,000원');
  });

  it('drops a duration roster boundary that contains only a previous itinerary tail and shared terms', () => {
    const raw = `[D7] 쿠알라룸푸르/싱가포르/말라카 3박5일
출발일
6/17
상품가
1,249,000
제1일
부산 출발
제2일
싱가포르 관광
포함 왕복항공권
불포함 개인경비
금 4박 6일 – 쿠알라룸푸르 & 싱가포르 & 말라카 & 겐팅
왕복항공권, 텍스 및 유류할증료
포함
전일정 숙박, 식사, 차량
제5일
쿠알라룸푸르 공항 출발
불포함
가이드 팁, 기타 개인경비
[D7] 쿠알라룸푸르/싱가포르/말라카/겐팅 4박6일
출발일
6/19
상품가
1,399,000
포함
전일정 숙박, 식사, 차량
불포함
가이드 팁, 기타 개인경비
제1일
부산 출발
제2일
싱가포르 관광`;

    const { sections } = splitCatalogByItineraryHeaders(raw);

    expect(sections).toHaveLength(2);
    expect(sections[0]).toContain('3박5일');
    expect(sections[1]).toContain('[D7] 쿠알라룸푸르/싱가포르/말라카/겐팅 4박6일');
  });

  it('accepts AI boundaries only after two exact source-anchored runs agree', async () => {
    const raw = `[BX] 방콕 3박5일\n제1일 부산 출발\n${'본문 '.repeat(40)}\n[VJ] 다낭 4박6일\n제1일 부산 출발`;
    const secondStart = raw.indexOf('[VJ]');
    const proposal = {
      products: [
        { start_char: 0, name_hint: '[BX] 방콕 3박5일' },
        { start_char: secondStart, name_hint: '[VJ] 다낭 4박6일' },
      ],
    };
    const result = await detectEvidenceBoundCatalogBoundariesWithLLM(raw, async () => proposal);
    expect(result.products).toHaveLength(2);
    expect(result.evidence).toHaveLength(2);
    expect(result.evidence?.[1]?.quote_hash).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('requests the evidence AI fallback only for a repeated product envelope', () => {
    expect(shouldTryEvidenceAiCatalogSplit(`상품명\n방콕 A\n여행기간\n3박5일\n포함\n항공\n불포함\n개인경비\n${'본문 '.repeat(800)}\n상품명\n방콕 B\n여행기간\n4박6일\n포함\n항공\n불포함\n개인경비`)).toBe(true);
    expect(shouldTryEvidenceAiCatalogSplit(`[BX] 방콕 3박5일\n상품명\n방콕\n포함\n항공\n불포함\n개인경비\n${'일정 '.repeat(500)}`)).toBe(false);
  });

  it('rejects a repeated AI answer when its offset is not a source heading anchor', async () => {
    const raw = `[BX] 방콕 3박5일\n제1일 부산 출발\n본문\n[VJ] 다낭 4박6일\n제1일 부산 출발`;
    const proposal = {
      products: [
        { start_char: 0, name_hint: '[BX] 방콕 3박5일' },
        { start_char: raw.indexOf('다낭'), name_hint: '[VJ] 다낭 4박6일' },
      ],
    };
    const result = await detectEvidenceBoundCatalogBoundariesWithLLM(raw, async () => proposal);
    expect(result.products).toEqual([]);
    expect(result.reason).toBe('evidence-source-anchor-invalid');
  });

  it('combines full-duration headers with a composite-night PKG title', () => {
    const raw = `하노이/옌뜨/하롱베이 3박5일
포함사항 항공 및 호텔
불포함사항 개인경비
제1일 부산 출발

하노이/메가월드/하롱베이 3박5일
포함사항 항공 및 호텔
불포함사항 개인경비
제1일 부산 출발

베트남<사파2박+하노이1박> 노팁노옵션 PKG
포함사항 항공 및 호텔
불포함사항 개인경비
제1일 VN425 부산 출발`;

    const { sections } = splitCatalogByItineraryHeaders(raw);

    expect(sections).toHaveLength(3);
    expect(sections[2]).toContain('<사파2박+하노이1박>');
  });

  it('ignores departure-only duration lines and keeps the ordinal grade with its product', () => {
    const raw = `공통 요금표
4박6일(일 출발)
729,000

❶스마트
라오스 (비엔티엔1/방비엥2) 3박5일
출발날짜
목 출발 3박5일
포함사항 항공 및 호텔
불포함사항 개인경비
제1일 BX746 부산 출발

❶프리미엄
라오스 (비엔티엔1/방비엥2) 3박5일
출발날짜
목 출발 3박5일
포함사항 항공 및 호텔
불포함사항 개인경비
제1일 BX746 부산 출발`;

    const { sharedPrefix, sections } = splitCatalogByItineraryHeaders(raw);

    expect(sharedPrefix).toContain('4박6일(일 출발)');
    expect(sections).toHaveLength(2);
    expect(sections[0].startsWith('❶스마트')).toBe(true);
    expect(sections[1].startsWith('❶프리미엄')).toBe(true);
  });

  it('drops a long catalog cover price block that has no product body', () => {
    const cover = `방콕 파타야 관광 PKG 3박5일 (스팟+선발특가)\n${'요금표 안내 '.repeat(320)}`;
    const product = (grade: string, code: string) => `${grade} 방콕 파타야 PKG 3박5일 [BX]
포함사항 항공 및 호텔
불포함사항 개인경비
제1일 ${code} 부산 출발
제2일 파타야 관광`;
    const raw = [cover, product('❶ 실속', 'BX721'), product('❷ 품격', 'BX723'), product('❸ 특급', 'BX725')].join('\n');

    const { sharedPrefix, sections } = splitCatalogByItineraryHeaders(raw);

    expect(sharedPrefix).toContain('스팟+선발특가');
    expect(sections).toHaveLength(3);
    expect(sections[0]).toContain('❶ 실속');
  });

  it('keeps an orphan price-table card with the only detailed product', () => {
    const raw = `출발일 [3박 4일]
상품가
9/14
1,079,000
9/21
1,109,000
${'요금 행 '.repeat(320)}

서안 3박 4일 노팁,노옵션 [쇼핑 2회]
포함내역 왕복 항공권, 호텔, 식사
불포함내역 개인경비
제1일 KE141 인천 출발
제2일 병마용 관광
제3일 서안 관광
제4일 KE142 인천 도착`;

    const { sections } = splitCatalogByItineraryHeaders(raw);

    expect(sections).toHaveLength(1);
    expect(sections[0]).toContain('1,079,000');
    expect(sections[0]).toContain('제4일 KE142');
  });

  it('keeps a monthly roster price card with its adjacent same-product itinerary', () => {
    const raw = [
      '부산-후쿠오카 조석 정석패키지 2박3일',
      '5월',
      '23 토',
      '1,029,000',
      '25, 26, 27 월-수',
      '519,000',
      '6월',
      '1, 2 월,화',
      '699,000',
      '부산-후쿠오카 조석 정석패키지 2박3일 관광PKG',
      '포함 왕복항공료, 호텔, 식사',
      '불포함 개인경비',
      '제1일 BX142 부산 출발',
      '제2일 아소 관광',
      '제3일 BX143 부산 도착',
    ].join('\n');

    const { sections } = splitCatalogByItineraryHeaders(raw);

    expect(sections).toHaveLength(1);
    expect(sections[0]).toContain('1,029,000');
    expect(sections[0]).toContain('제3일 BX143');
  });

  it('keeps a row-spanned weekday price card with its repeated same-product itinerary', () => {
    const raw = [
      '부산-청도 골프 실속3색특가PKG 3박4일 54H',
      '출 발 일 [컴 12%]',
      '3박4일 54H',
      '8/1',
      '–',
      '8/16',
      '월',
      '709,000',
      '화/수',
      '769,000',
      '목',
      '879,000',
      '금/토',
      '919,000',
      '부산-청도 3박4일 54H 골프 실속3색특가PKG',
      '포함 왕복항공료, 호텔3박, 그린피',
      '불포함 기사가이드팁, 개인경비',
      '제1일 BX321 부산 출발',
      '제2일 청도 골프',
      '제3일 청도 골프',
      '제4일 BX322 부산 도착',
    ].join('\n');

    const { sections } = splitCatalogByItineraryHeaders(raw);

    expect(sections).toHaveLength(1);
    expect(sections[0]).toContain('709,000');
    expect(sections[0]).toContain('제4일 BX322');
  });

  it('merges a repeated price/detail card when USJ is written in Korean on one heading', () => {
    const raw = [
      '부산-오사카 1일자유orUSJor고베 3박4일 [중중] 관광PKG',
      '출 발 일',
      '상 품 가',
      '8/1-8/31',
      '2, 3, 4, 5',
      '969,000',
      '부산-오사카 1일 자유OR유니버셜OR고베 3박4일 [중중] 관광PKG',
      '출발날짜',
      '26년 8월 – 10월 매일 출발',
      '포함 왕복항공료, 호텔, 식사',
      '불포함 개인경비',
      '제1일 BX126 부산 출발',
      '제2일 오사카 관광',
      '제3일 교토 관광',
      '제4일 BX125 부산 도착',
    ].join('\n');

    const { sections } = splitCatalogByItineraryHeaders(raw);

    expect(sections).toHaveLength(1);
    expect(sections[0]).toContain('969,000');
    expect(sections[0]).toContain('제4일 BX125 부산 도착');
  });

  it('keeps a 출발 요일 price card with the adjacent same-product itinerary', () => {
    const raw = [
      '[VN] 베트남 호치민 3박5일 일정표',
      '출발 요일',
      '상품가',
      '4/1~29',
      '799,000',
      '요금표 설명 '.repeat(320),
      '베트남 호치민 3박5일 PKG',
      '포함 왕복항공료, 호텔, 식사',
      '불포함 개인경비',
      '제1일 VN423 인천 출발',
      '제2일 호치민 시내관광',
      '제3일 메콩델타 관광',
      '제4일 자유일정',
      '제5일 VN422 인천 도착',
    ].join('\n');

    const { sections } = splitCatalogByItineraryHeaders(raw);

    expect(sections).toHaveLength(1);
    expect(sections[0]).toContain('799,000');
    expect(sections[0]).toContain('제5일 VN422');
  });

  it('keeps a standalone itinerary label attached to the product title above it', () => {
    const pricePrefix = [
      '[BX-에어부산] 지정일 특가',
      '출발일 상품가 라이트 품격',
      '9/18 529,000 659,000',
    ].join('\n');
    const product = (grade: string, flight: string) => [
      grade === '라이트' ? '♥ 실속 ♥' : '★ 高품격 ★',
      `[BX] 나트랑/달랏 ${grade}(노팁/노옵션) 3박5일 PKG`,
      '일정표',
      '요금표 참고 지정일 (3박5일)',
      '포함 항공, 호텔, 식사',
      '불포함 개인경비, 싱글차지',
      `제1일 ${flight} 부산 출발`,
      '제2일 달랏 관광',
      '제3일 달랏 관광',
      '제4일 나트랑 관광',
      '제5일 부산 도착',
    ].join('\n');
    const raw = [pricePrefix, product('라이트', 'BX751'), product('품격', 'BX753')].join('\n');

    const { sharedPrefix, sections } = splitCatalogByItineraryHeaders(raw);

    expect(sharedPrefix).toContain('[BX-에어부산] 지정일 특가');
    expect(sections).toHaveLength(2);
    expect(sections[0]?.startsWith('♥ 실속 ♥\n[BX] 나트랑/달랏 라이트')).toBe(true);
    expect(sections[1]?.startsWith('★ 高품격 ★\n[BX] 나트랑/달랏 품격')).toBe(true);
  });
});
