import { describe, expect, it } from 'vitest';
import {
  collectItineraryHeaderStarts,
  countCatalogItineraryHeaders,
  splitCatalogByItineraryHeaders,
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
});
