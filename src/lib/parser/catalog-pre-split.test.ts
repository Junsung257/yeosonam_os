import { describe, expect, it } from 'vitest';
import {
  collectItineraryHeaderStarts,
  countCatalogItineraryHeaders,
  splitCatalogByItineraryHeaders,
  applyLLMSplit,
  detectCatalogBoundariesWithLLM,
  splitCatalogSmart,
  collectPkgBlockStarts,
  extractProductRawTextSection,
  type LLMSplitResult,
} from './catalog-pre-split';

describe('splitCatalogByItineraryHeaders', () => {
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

  it('헤더가 1개면 단일 섹션', () => {
    const raw = '안내\n[OL] 오사카 일정표\n내용';
    const r = splitCatalogByItineraryHeaders(raw);
    expect(r.sections).toHaveLength(1);
    expect(r.sections[0]).toContain('[OL]');
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

    it('[부관훼리] 한글 코드 + 무박3일 — 2 카드 1 상품 (헤더 2건이 같은 이름이면 분리)', () => {
      const raw = `${'사전 안내 텍스트 '.repeat(10)}
[부관훼리] 초특가 가성비 무박3일 패키지
선박 스케쥴 부산-시모노세키 21:00-08:00
포함 사항 왕복훼리비 부두세 가이드 전용버스
${'요금표 행 '.repeat(40)}

[부관훼리] 초특가 가성비 무박3일 PKG
인원 10명부터 출발 확정
일정표
${'일정 본문 '.repeat(30)}`;
      const { sections } = splitCatalogByItineraryHeaders(raw);
      // 헤더 이름이 거의 같지만 분리는 됨 (LLM/judge가 통합 판단 별도 단계)
      expect(sections.length, '[부관훼리] 2 카드 분리 감지').toBeGreaterThanOrEqual(2);
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
제1일 부산 출발
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
제1일 부산 출발
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
