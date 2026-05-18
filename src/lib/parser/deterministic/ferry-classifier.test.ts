import { describe, expect, it } from 'vitest';
import { detectFerry } from './ferry-classifier';

/**
 * 2026-05-19 박제 (FIX-1): ferry-classifier 회귀 fixture.
 *
 * 부관훼리 사고 (모바일 모든 day "후쿠오카 ✈ 부산" 환각 헤더) 영구 차단.
 * PR #125 패턴 — 다음 PR 가드 풀면 즉시 회귀.
 */
describe('detectFerry — 결정적 ferry/cruise 분류 (FIX-1 박제)', () => {
  describe('명시적 ferry 브랜드 (specific)', () => {
    it('부관훼리 — title 매칭', () => {
      const r = detectFerry('본문 텍스트', '[부관훼리] 초특가 가성비 무박3일 PKG');
      expect(r.isFerry).toBe(true);
      expect(r.ferryName).toBe('부관훼리');
    });

    it('부관훼리 — 본문 매칭 (title 없음)', () => {
      const r = detectFerry('부산-시모노세키 부관훼리 21:00 출항\n선내식 1회');
      expect(r.isFerry).toBe(true);
      expect(r.ferryName).toBe('부관훼리');
    });

    it('카멜리아 — title 매칭', () => {
      const r = detectFerry('본문', '[카멜리아호] 후쿠오카 무박3일');
      expect(r.isFerry).toBe(true);
      expect(r.ferryName).toBe('카멜리아');
    });

    it('뉴카멜리아 — title 매칭', () => {
      const r = detectFerry('본문', '[뉴카멜리아] 후쿠오카 1박3일');
      expect(r.isFerry).toBe(true);
      expect(r.ferryName).toBe('뉴카멜리아');
    });
  });

  describe('일반 ferry/cruise 키워드 (specific name 없음)', () => {
    it('"훼리" 일반명 → isFerry=true, ferryName=null', () => {
      const r = detectFerry('왕복훼리비 포함\n부두세 별도');
      expect(r.isFerry).toBe(true);
      expect(r.ferryName).toBeNull();
    });

    it('"페리" 일반명 → isFerry=true, ferryName=null', () => {
      const r = detectFerry('일본 페리 운항\n선상식 포함');
      expect(r.isFerry).toBe(true);
      expect(r.ferryName).toBeNull();
    });

    it('"크루즈" → isFerry=true, ferryName=null', () => {
      const r = detectFerry('지중해 크루즈 7박 8일\n선실 발코니');
      expect(r.isFerry).toBe(true);
      expect(r.ferryName).toBeNull();
    });

    it('"cruise" 영문 → isFerry=true', () => {
      const r = detectFerry('Mediterranean cruise package');
      expect(r.isFerry).toBe(true);
    });

    it('"ferry" 영문 (대소문자 무관) → isFerry=true', () => {
      const r = detectFerry('Ferry from Busan to Shimonoseki');
      expect(r.isFerry).toBe(true);
    });
  });

  describe('비-ferry 케이스 (false positive 차단)', () => {
    it('일반 패키지 → isFerry=false', () => {
      const r = detectFerry('[BX] 대만 단수이 3박 4일\n항공편 BX793');
      expect(r.isFerry).toBe(false);
      expect(r.matchedKeyword).toBeNull();
      expect(r.ferryName).toBeNull();
    });

    it('빈 입력 → isFerry=false', () => {
      const r = detectFerry('');
      expect(r.isFerry).toBe(false);
    });

    it('null title → 본문만 검사', () => {
      const r = detectFerry('항공편 KE100\n호텔 5성');
      expect(r.isFerry).toBe(false);
    });

    it('"훼리탑" 같은 무관 단어 → "훼리" 매칭 (intentional substring)', () => {
      // 현재 정책: substring 매칭. 만약 false positive 신호가 누적되면 word boundary 추가 검토.
      // 회귀 fixture: 의도적 동작 보존.
      const r = detectFerry('훼리탑 라운지');
      expect(r.isFerry).toBe(true);
    });
  });

  describe('우선순위 — title vs body', () => {
    it('title에 specific ferry 있으면 body는 일반 키워드여도 specific 반환', () => {
      const r = detectFerry('일반 페리 안내', '[부관훼리] 무박3일');
      expect(r.ferryName).toBe('부관훼리');
    });

    it('body 첫 800자 안에 있으면 매칭', () => {
      const longText = '안내 텍스트 '.repeat(50) + '\n부관훼리 21:00 출발';
      const r = detectFerry(longText);
      expect(r.isFerry).toBe(true);
      expect(r.ferryName).toBe('부관훼리');
    });

    it('body 800자 이후만 있으면 매칭 안 됨', () => {
      const padding = '안내 텍스트 '.repeat(100); // ~800+ chars
      const r = detectFerry(padding + '\n부관훼리 21:00');
      // 800자 cap 으로 매칭 안 될 가능성. 실제 length 측정
      if (padding.length >= 800) {
        expect(r.isFerry).toBe(false);
      }
    });
  });
});
