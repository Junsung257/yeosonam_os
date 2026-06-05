import { describe, expect, it } from 'vitest';
import { appendOfficialReferenceLinksIfNeeded, forceAppendOfficialReferenceLinks } from './blog-official-links';
import { checkLinks } from './blog-quality-gate';

describe('appendOfficialReferenceLinksIfNeeded', () => {
  it('adds enough official external links to pass the links gate', () => {
    const markdown = [
      '# 보홀 여행 준비물',
      '',
      '본문입니다.',
      '',
      '[여소남 상담](/packages?destination=bohol)',
    ].join('\n');

    const withOfficialLinks = appendOfficialReferenceLinksIfNeeded(markdown);
    const gate = checkLinks(withOfficialLinks, 'https://yeosonam.com');

    expect(gate.passed).toBe(true);
    expect(gate.evidence?.external).toBe(2);
  });

  it('does not count image links as official references', () => {
    const markdown = [
      '# 보홀 여행 준비물',
      '',
      '![보홀 바다](https://images.pexels.com/photos/123/pexels-photo-123.jpeg?auto=compress)',
      '[여소남 상담](/packages?destination=bohol)',
    ].join('\n');

    const withOfficialLinks = appendOfficialReferenceLinksIfNeeded(markdown);
    const gate = checkLinks(withOfficialLinks, 'https://yeosonam.com');

    expect(gate.passed).toBe(true);
    expect(gate.evidence?.external).toBe(2);
  });

  it('can force a final official reference section for retry repairs', () => {
    const markdown = [
      '# 보홀 환전',
      '',
      '[여소남 상담](/packages?destination=bohol)',
      '[기존 외부](https://example.com)',
    ].join('\n');

    const repaired = forceAppendOfficialReferenceLinks(markdown);
    const gate = checkLinks(repaired, 'https://yeosonam.com');

    expect(gate.passed).toBe(true);
    expect(gate.evidence?.external).toBeGreaterThanOrEqual(2);
  });
});
