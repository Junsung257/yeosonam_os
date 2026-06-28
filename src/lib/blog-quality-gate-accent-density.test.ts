import { describe, expect, it, vi } from 'vitest';

vi.mock('./supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}));

import { checkAccentDensity, checkCtaDestinationIntegrity, checkMarkdownTableIntegrity } from './blog-quality-gate';

describe('checkAccentDensity', () => {
  it('fails when rendered or stored content contains mark tags', async () => {
    const gate = await checkAccentDensity('<p>weather <mark>25C</mark></p>');

    expect(gate.passed).toBe(false);
    expect(gate.reason).toContain('highlight_marker');
  });

  it('fails when legacy double-equals highlight markers remain', async () => {
    const gate = await checkAccentDensity('This is ==highlighted== text.');

    expect(gate.passed).toBe(false);
    expect(gate.evidence?.legacyMarkerCount).toBe(1);
  });

  it('fails when numeric accent count exceeds the render cap', async () => {
    const html = Array.from({ length: 36 }, (_, index) => `<strong class="num">${index + 1} days</strong>`).join(' ');
    const gate = await checkAccentDensity(`<p>${html}</p>`);

    expect(gate.passed).toBe(false);
    expect(gate.reason).toContain('numeric_accent_density');
    expect(gate.evidence?.strongNumCount).toBe(36);
  });

  it('fails when h2 or h3 heading counts are excessive', async () => {
    const tooManyH2 = Array.from({ length: 13 }, (_, index) => `## Section ${index + 1}\nBody`).join('\n\n');
    const tooManyH3 = Array.from({ length: 21 }, (_, index) => `### Detail ${index + 1}\nBody`).join('\n\n');

    const h2Gate = await checkAccentDensity(tooManyH2);
    const h3Gate = await checkAccentDensity(tooManyH3);

    expect(h2Gate.passed).toBe(false);
    expect(h2Gate.reason).toContain('h2_density');
    expect(h3Gate.passed).toBe(false);
    expect(h3Gate.reason).toContain('h3_density');
  });

  it('fails when a paragraph is longer than 480 characters', async () => {
    const gate = await checkAccentDensity(`<p>${'a'.repeat(481)}</p>`);

    expect(gate.passed).toBe(false);
    expect(gate.reason).toContain('long_paragraph');
    expect(gate.evidence?.longestParagraph).toBe(481);
  });

  it('passes restrained article markup', async () => {
    const gate = await checkAccentDensity(`
## Weather overview

A short answer first, followed by practical reasons.

### What to pack

- Light layers
- Rain jacket
`);

    expect(gate.passed).toBe(true);
  });

  it('fails package CTA links with empty or mismatched destinations', () => {
    const gate = checkCtaDestinationIntegrity({
      blog_html: '[packages](https://www.yeosonam.com/packages?destination=&utm_source=naver_blog)\n[wrong](/packages?destination=%EB%82%98%ED%8A%B8%EB%9E%99)',
      slug: 'nhatrang-weather',
      destination: '나트랑',
    });

    expect(gate.passed).toBe(false);
    expect(gate.reason).toContain('package CTA destination mismatch');
    expect(gate.evidence?.issues).toHaveLength(2);
  });

  it('passes package CTA links without destination when queue destination is missing', () => {
    const gate = checkCtaDestinationIntegrity({
      blog_html: '[packages](https://www.yeosonam.com/packages?utm_source=naver_blog)',
      slug: 'travel-guide-q35bf6ed0',
      destination: null,
    });

    expect(gate.passed).toBe(true);
  });

  it('fails malformed markdown tables before publish', () => {
    const gate = checkMarkdownTableIntegrity(`
| Month | Weather |
| June | Rainy |
`);

    expect(gate.passed).toBe(false);
    expect(gate.reason).toContain('missing_header_separator');
  });

  it('passes a stable markdown table with a header separator and data rows', () => {
    const gate = checkMarkdownTableIntegrity(`
| Month | Weather |
| --- | --- |
| June | Rainy |
| July | Hot |
`);

    expect(gate.passed).toBe(true);
  });
});
