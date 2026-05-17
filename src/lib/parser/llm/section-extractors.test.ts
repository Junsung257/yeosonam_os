import { describe, expect, it } from 'vitest';
import { extractHeroContextL1 } from './section-extractors';

/**
 * 2026-05-18 박제 (CLAUDE.md §12-1 L1 rule):
 *   Hero context 가 L3 (LLM) 직접 호출만 있던 사고. 제목 regex 사전 시도 박제 후
 *   회귀 fixture. PR #125 패턴 (NON_ATTRACTION_PATTERN export + 회귀 차단).
 */
describe('extractHeroContextL1 — Hero L1 rule (regex)', () => {
  it('명확한 단일 도시 제목 → high confidence', () => {
    const raw = '[LJ] 후쿠오카 3박 4일 - 유후인+벳부+아소\n2026년 6월 출발\n...';
    const r = extractHeroContextL1(raw);
    expect(r.confidence).toBe('high');
    expect(r.destination).toContain('후쿠오카');
    expect(r.display_title).toBeDefined();
  });

  it('슬래시 구분 다중 도시 제목', () => {
    const raw = '나트랑/달랏 4박5일 골프투어\n출발일: 5/9, 5/26\n...';
    const r = extractHeroContextL1(raw);
    expect(r.confidence).toBe('high');
    expect(r.destination).toMatch(/나트랑|달랏/);
  });

  it('제목에 destination 토큰 없음 → low + display_title 만', () => {
    const raw = '특가 골프 패키지 4박5일\n프리미엄 골프장 3R\n...';
    const r = extractHeroContextL1(raw);
    expect(r.confidence).toBe('low');
    expect(r.destination).toBeUndefined();
    expect(r.display_title).toBeDefined();
  });

  it('첫 줄이 "일자" 헤더면 skip 후 다음 줄 제목 시도', () => {
    const raw = '일자\n도쿄/오사카 5박 6일\n...';
    const r = extractHeroContextL1(raw);
    expect(r.confidence).toBe('high');
    expect(r.destination).toMatch(/도쿄|오사카/);
  });

  it('80자 초과 첫 줄은 trim 후 매칭', () => {
    const raw = '[부산출발] '.repeat(20) + '\n시즈오카 4박 5일\n...';
    const r = extractHeroContextL1(raw);
    expect(r.display_title).toBeDefined();
    expect((r.display_title?.length ?? 0)).toBeLessThanOrEqual(40);
  });

  it('빈 입력 → low + display_title undefined', () => {
    const r = extractHeroContextL1('');
    expect(r.confidence).toBe('low');
    expect(r.display_title).toBeUndefined();
    expect(r.destination).toBeUndefined();
  });

  it('긴 토큰 우선 매칭 (prefix 충돌 차단)', () => {
    // "후쿠오카" 매칭 시 "후쿠" prefix 가 따로 추가되지 않아야 함.
    // KOREAN_DESTINATION_TO_ISO 에 "후쿠" 가 있다면 substring 매칭으로 둘 다 잡힐 위험.
    const raw = '[FK] 후쿠오카 가족여행 3박4일\n...';
    const r = extractHeroContextL1(raw);
    expect(r.confidence).toBe('high');
    expect(r.destination).toBe('후쿠오카');
  });

  it('display_title 40자 cap', () => {
    const raw = '서울에서 출발하는 푸꾸옥 5박 7일 럭셔리 풀빌라 자유여행 패키지\n...';
    const r = extractHeroContextL1(raw);
    expect((r.display_title?.length ?? 0)).toBeLessThanOrEqual(40);
  });
});
