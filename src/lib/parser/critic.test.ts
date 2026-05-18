import { describe, expect, it } from 'vitest';
import { detectIssues, autoFixIssues } from './critic';

/**
 * 2026-05-19 박제 (FIX-2): critic 결정적 검증 회귀 fixture.
 *
 * cross-field consistency 검증 — LLM 환각 차단. 부관훼리 ✈ 환각 사고 영구 차단.
 * PR #125 패턴.
 */
describe('detectIssues — Critic 결정적 검증 (FIX-2)', () => {
  describe('C-title↔destination', () => {
    it('title "후쿠오카" + destination "오사카" → HIGH', () => {
      const issues = detectIssues({ title: '후쿠오카 3박4일', destination: '오사카' });
      expect(issues.some(i => i.rule === 'C-title↔destination' && i.severity === 'high')).toBe(true);
    });

    it('title "후쿠오카" + destination "후쿠오카/벳부" → 통과 (substring match)', () => {
      const issues = detectIssues({ title: '[BX] 후쿠오카 패키지', destination: '후쿠오카/벳부' });
      expect(issues.filter(i => i.rule === 'C-title↔destination')).toHaveLength(0);
    });

    it('title에 도시 키워드 없음 → 통과', () => {
      const issues = detectIssues({ title: '특가 패키지', destination: '오사카' });
      expect(issues.filter(i => i.rule === 'C-title↔destination')).toHaveLength(0);
    });
  });

  describe('C-ferry↔product_type / ↔airline', () => {
    it('Ferry 키워드 + product_type=package → HIGH (cruise 권장)', () => {
      const issues = detectIssues({
        title: '[부관훼리] 무박3일',
        product_type: 'package',
        rawText: '부산-시모노세키 부관훼리',
      });
      expect(issues.some(i => i.rule === 'C-ferry↔product_type' && i.severity === 'high')).toBe(true);
    });

    it('Ferry 키워드 + airline="에어부산" → CRITICAL (✈ 환각)', () => {
      const issues = detectIssues({
        title: '[부관훼리] 무박3일',
        airline: '에어부산',
        rawText: '부산-시모노세키 부관훼리',
      });
      expect(issues.some(i => i.rule === 'C-ferry↔airline' && i.severity === 'critical')).toBe(true);
    });

    it('Ferry 키워드 + airline="부관훼리" → 통과 (ferry name 매칭)', () => {
      const issues = detectIssues({
        title: '[부관훼리] 무박3일',
        airline: '부관훼리',
        product_type: 'cruise',
        rawText: '부산-시모노세키 부관훼리',
      });
      expect(issues.filter(i => i.rule === 'C-ferry↔airline')).toHaveLength(0);
    });

    it('Ferry 키워드 없음 + airline="대한항공" → 통과', () => {
      const issues = detectIssues({
        title: '[KE] 일본 패키지',
        airline: '대한항공',
        product_type: 'package',
      });
      expect(issues.filter(i => i.rule.startsWith('C-ferry'))).toHaveLength(0);
    });
  });

  describe('C-days↔nights', () => {
    it('duration=4 + nights=3 → 통과 (정확)', () => {
      const issues = detectIssues({ duration: 4, nights: 3 });
      expect(issues.filter(i => i.rule === 'C-days↔nights')).toHaveLength(0);
    });

    it('duration=4 + nights=2 → MEDIUM (부정합)', () => {
      const issues = detectIssues({ duration: 4, nights: 2 });
      expect(issues.some(i => i.rule === 'C-days↔nights' && i.severity === 'medium')).toBe(true);
    });

    it('duration 또는 nights null → 통과 (검증 안 함)', () => {
      const issues = detectIssues({ duration: 4 });
      expect(issues.filter(i => i.rule === 'C-days↔nights')).toHaveLength(0);
    });
  });

  describe('C-price-range', () => {
    it('price=859 → HIGH (천원 단위 의심)', () => {
      const issues = detectIssues({ price: 859 });
      expect(issues.some(i => i.rule === 'C-price-range' && /1만/.test(i.message))).toBe(true);
    });

    it('price=859000 → 통과', () => {
      const issues = detectIssues({ price: 859000 });
      expect(issues.filter(i => i.rule === 'C-price-range')).toHaveLength(0);
    });

    it('price=99999999 → HIGH (비현실적)', () => {
      const issues = detectIssues({ price: 99_999_999 });
      expect(issues.some(i => i.rule === 'C-price-range' && /5천만/.test(i.message))).toBe(true);
    });
  });
});

describe('autoFixIssues — 자동 수정 (FIX-2)', () => {
  it('C-ferry↔product_type 자동 수정 → product_type=cruise', () => {
    const ed: Record<string, unknown> = { product_type: 'package' };
    const issues = detectIssues({ title: '[부관훼리] 무박3일', product_type: 'package', rawText: '부관훼리 출항' });
    autoFixIssues(ed, issues);
    expect(ed.product_type).toBe('cruise');
  });

  it('C-ferry↔airline 자동 수정 → airline=부관훼리', () => {
    const ed: Record<string, unknown> = { airline: '에어부산' };
    const issues = detectIssues({
      title: '[부관훼리] 무박3일',
      airline: '에어부산',
      rawText: '부관훼리 출항',
    });
    autoFixIssues(ed, issues);
    expect(ed.airline).toBe('부관훼리');
  });

  it('C-price-range 천원단위 → price × 1000', () => {
    const ed: Record<string, unknown> = { price: 859 };
    const issues = detectIssues({ price: 859 });
    autoFixIssues(ed, issues);
    expect(ed.price).toBe(859000);
  });

  it('fix 결과 배열에 rule 명시', () => {
    const ed: Record<string, unknown> = { product_type: 'package' };
    const issues = detectIssues({ title: '[부관훼리] 무박3일', product_type: 'package', rawText: '부관훼리' });
    const { fixed } = autoFixIssues(ed, issues);
    expect(fixed).toContain('C-ferry↔product_type');
  });
});
