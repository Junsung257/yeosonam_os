import { describe, expect, it } from 'vitest';
import { applyHtmlAccents, applyMarkdownAccents, normalizeRangeDashes } from './blog-accent';

describe('normalizeRangeDashes', () => {
  it('normalizes single tildes without touching code spans or strikethrough markers', () => {
    const out = normalizeRangeDashes('25~32℃ and `~/.bashrc` and ~~delete~~');

    expect(out).toContain('25\u201332℃');
    expect(out).toContain('`~/.bashrc`');
    expect(out).toContain('~~delete~~');
  });
});

describe('applyMarkdownAccents', () => {
  it('downgrades body H1 headings to H2 headings', () => {
    const out = applyMarkdownAccents('# Title\n\nBody\n\n### Detail');

    expect(out).toContain('## Title');
    expect(out).toContain('### Detail');
    expect(out).not.toMatch(/^# (?!#)/m);
  });

  it('removes legacy marker syntax instead of rendering highlight markup', () => {
    const out = applyMarkdownAccents('평균 ==25~32℃== 입니다');

    expect(out).toBe('평균 25\u201332℃ 입니다');
    expect(out).not.toContain('<mark>');
  });

  it('keeps tip blocks available', () => {
    const out = applyMarkdownAccents(':::tip\n오전 9~11시 추천\n:::');

    expect(out).toContain('<aside class="tip">');
    expect(out).toContain('9\u201311시');
  });
});

describe('applyHtmlAccents', () => {
  it('wraps decision-useful travel numbers', () => {
    const out = applyHtmlAccents('<p>가격 1,290,000원, 일정 3박 4일, 평균 25–32℃</p>');

    expect(out).toContain('<strong class="num">1,290,000원</strong>');
    expect(out).toContain('<strong class="num">3박 4일</strong>');
    expect(out).toContain('<strong class="num">25–32℃</strong>');
  });

  it('does not wrap numbers inside links, code, strong, or mark tags', () => {
    const out = applyHtmlAccents(
      '<a href="/p/25">25만원</a><code>30분</code><strong>2026년</strong><mark>10월</mark>',
    );

    expect(out).not.toContain('<strong class="num">');
  });

  it('caps automatic numeric accents at 35 per article render', () => {
    const html = `<p>${Array.from({ length: 40 }, (_, i) => `${i + 1}월`).join(' ')}</p>`;
    const out = applyHtmlAccents(html);

    expect((out.match(/<strong class="num">/g) || []).length).toBe(35);
    expect(out).toContain('40월');
  });

  it('does not create marker markup from comparison expressions', () => {
    const out = applyHtmlAccents('<p>호텔보다 패키지가 나은 경우</p>');

    expect(out).not.toContain('<mark>');
  });
});
