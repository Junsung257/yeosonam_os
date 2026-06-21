import { describe, expect, it, vi } from 'vitest';

vi.mock('./supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}));

import { checkAccentDensity } from './blog-quality-gate';

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
    const tooManyH2 = Array.from({ length: 11 }, (_, index) => `## Section ${index + 1}\nBody`).join('\n\n');
    const tooManyH3 = Array.from({ length: 21 }, (_, index) => `### Detail ${index + 1}\nBody`).join('\n\n');

    const h2Gate = await checkAccentDensity(tooManyH2);
    const h3Gate = await checkAccentDensity(tooManyH3);

    expect(h2Gate.passed).toBe(false);
    expect(h2Gate.reason).toContain('h2_density');
    expect(h3Gate.passed).toBe(false);
    expect(h3Gate.reason).toContain('h3_density');
  });

  it('fails when a paragraph is longer than 450 characters', async () => {
    const gate = await checkAccentDensity(`<p>${'a'.repeat(451)}</p>`);

    expect(gate.passed).toBe(false);
    expect(gate.reason).toContain('long_paragraph');
    expect(gate.evidence?.longestParagraph).toBe(451);
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
});
