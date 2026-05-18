import { describe, expect, it } from 'vitest';
import { parseSections, classifyByKeyword, classifyItem } from './section-aware-parser';

/**
 * 2026-05-19 박제 (P2-B FACE 통합 점검):
 *   section-aware-parser 는 upload/route.ts:974 에서 활발히 사용되지만 vitest 0건.
 *   PR #125 패턴 — 회귀 차단 fixture 박제.
 */

describe('parseSections — 섹션 컨텍스트 추적 (FACE)', () => {
  it('표준 카탈로그 — 포함/불포함/선택관광 마커 추적', () => {
    const raw = `[BX] 대만 단수이 3박 4일

▶ 포함 사항
- 왕복 항공료
- 호텔 (2인 1실)
- 차량/가이드/입장료

▶ 불포함 사항
- 매너팁 $40/인
- 개인경비

▶ 선택관광
- 101빌딩 전망대 $35/인
- 발마사지(30분) $30/인`;

    const r = parseSections(raw);
    expect(r.markers.length, '3 섹션 마커 추적').toBeGreaterThanOrEqual(3);
    const cats = r.markers.map(m => m.category);
    expect(cats).toContain('inclusion');
    expect(cats).toContain('exclude');
    expect(cats).toContain('optional');
  });

  it('classifyOffset: offset 기반 컨텍스트 lookup', () => {
    const raw = `▶ 포함 사항
- 왕복 항공료
- 호텔

▶ 불포함 사항
- 매너팁`;
    const r = parseSections(raw);
    const inclusionOffset = raw.indexOf('왕복 항공료');
    const excludeOffset = raw.indexOf('매너팁');
    expect(r.classifyOffset(inclusionOffset)).toBe('inclusion');
    expect(r.classifyOffset(excludeOffset)).toBe('exclude');
  });

  it('일정 day 헤더 → schedule 컨텍스트', () => {
    const raw = `▶ 포함 사항
- 항공

DAY 1
- 부산 출발
- 타이페이 도착`;
    const r = parseSections(raw);
    const dayOffset = raw.indexOf('부산 출발');
    expect(r.classifyOffset(dayOffset)).toBe('schedule');
  });

  it('빈 원문 → 마커 0, unknown 반환', () => {
    const r = parseSections('');
    expect(r.markers).toHaveLength(0);
    expect(r.classifyOffset(0)).toBe('unknown');
  });

  it('특전 섹션 ✨ + REMARK 섹션 식별', () => {
    const raw = `✨ 특전
- 망고도시락
- 콩카페

REMARK
- 쇼핑 3회 방문
- 여권 6개월 이상`;
    const r = parseSections(raw);
    const cats = r.markers.map(m => m.category);
    expect(cats).toContain('perk');
    expect(cats).toContain('remark');
  });
});

describe('classifyByKeyword — 키워드 기반 분류 fallback', () => {
  it('PERK: 마사지 60분 → perk', () => {
    expect(classifyByKeyword('전신마사지 60분')).toBe('perk');
  });

  it('OPTIONAL: $35 가격 → optional', () => {
    expect(classifyByKeyword('101빌딩 전망대 $35/인')).toBe('optional');
  });

  it('SURCHARGE: 싱글차지 → surcharge', () => {
    expect(classifyByKeyword('싱글차지 1인 16만원')).toBe('surcharge');
  });

  it('INCLUSION: 왕복항공 → inclusion', () => {
    expect(classifyByKeyword('왕복항공 + 호텔')).toBe('inclusion');
  });

  it('unknown 키워드 → unknown', () => {
    expect(classifyByKeyword('의미없는 텍스트')).toBe('unknown');
  });
});

describe('classifyItem — context + keyword 통합', () => {
  it('명확한 context (inclusion) → 0.95 confidence', () => {
    const r = classifyItem('호텔 2인 1실', 'inclusion');
    expect(r.category).toBe('inclusion');
    expect(r.confidence).toBe(0.95);
    expect(r.reason).toBe('section_context');
  });

  it('schedule context + perk 키워드 → perk (세분화)', () => {
    const r = classifyItem('마사지 60분 (특전)', 'schedule');
    expect(r.category).toBe('perk');
    expect(r.reason).toBe('schedule_keyword');
  });

  it('schedule context + 일반 키워드 → schedule default', () => {
    const r = classifyItem('국립박물관 관람', 'schedule');
    expect(r.category).toBe('schedule');
    expect(r.reason).toBe('schedule_default');
  });

  it('unknown context + 키워드 매칭 → keyword fallback (0.65)', () => {
    const r = classifyItem('왕복 항공료 포함', 'unknown');
    expect(r.category).toBe('inclusion');
    expect(r.confidence).toBe(0.65);
    expect(r.reason).toBe('keyword_only');
  });

  it('완전 unknown → no_signal', () => {
    const r = classifyItem('의미없는 문자열', 'unknown');
    expect(r.category).toBe('unknown');
    expect(r.confidence).toBe(0);
    expect(r.reason).toBe('no_signal');
  });
});
