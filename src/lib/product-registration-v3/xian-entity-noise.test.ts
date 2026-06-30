import { describe, expect, it } from 'vitest';
import { runProductRegistrationV3 } from '.';

const xianAttractions = [
  { id: 'dayanta', name: '\uB300\uC548\uD0D1', region: '\uC11C\uC548' },
  { id: 'huaqingji', name: '\uD654\uCCAD\uC9C0', region: '\uC11C\uC548' },
  { id: 'bingmayong', name: '\uBCD1\uB9C8\uC6A9', region: '\uC11C\uC548' },
];

describe('product-registration-v3 Xian entity noise', () => {
  it('keeps meal names, trekking waypoints, and description fragments out of unresolved attractions', async () => {
    const raw = [
      'Product: XIY spot special',
      '\uAC00\uACA9 799,000\uC6D0',
      '[LUXURY] \uB178\uD301+\uB178\uC635\uC158+\uB178\uC1FC\uD551',
      'DAY 1',
      '\uB300\uC548\uD0D1 \uAD00\uAD11',
      '(\uC11C\uC548\uBA74\uC694\uB9AC)',
      'DAY 2',
      '\uD654\uCCAD\uC9C0 \uAD00\uAD11',
      '\u25B6 \uC11C\uC548\uC758 \uC720\uBA85\uD55C \uC628\uCC9C\uC9C0\uC774\uBA70 \uC591\uADC0\uBE44\uACFC \uB2F9\uD604\uC885\uC758',
      '\uAD50\uC790\uC5F0',
      'DAY 3',
      '\uC790\uC720\uD2B8\uB808\uD0B9 : \uBD81\uBD09-\uCC9C\uC7AC-\uCC3D\uC6A9\uB839-\uAE08\uC0AC\uAD00 (1\uC2DC\uAC04\uC18C\uC694)',
      '\uBCD1\uB9C8\uC6A9 \uAD00\uAD11',
    ].join('\n');

    const result = await runProductRegistrationV3(raw, {
      destination: '\uC11C\uC548',
      attractions: xianAttractions,
    });

    const blockingRawTexts = result.match_summary.entity_summary.review_items
      .filter(item => item.blocks_publish)
      .map(item => item.raw_text.replace(/\s+/g, ''));

    expect(result.match_summary.entity_summary.attraction_unresolved_count).toBe(0);
    expect(blockingRawTexts).not.toContain('(\uC11C\uC548\uBA74\uC694\uB9AC)');
    expect(blockingRawTexts).not.toContain('\uAD50\uC790\uC5F0');
    expect(blockingRawTexts).not.toContain('\uAE08\uC0AC\uAD00');
    expect(blockingRawTexts).not.toContain('\uC11C\uC548\uC758\uC720\uBA85\uD55C\uC628\uCC9C\uC9C0\uC774\uBA70\uC591\uADC0\uBE44\uACFC\uB2F9\uD604\uC885\uC758');
  });
});
