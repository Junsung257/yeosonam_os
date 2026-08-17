import { describe, expect, it } from 'vitest';

import { createTextDocumentIR, validateDocumentIR } from './document-ir';
import { mergeSourceBundleDocumentIR } from './source-bundle-document-ir';

function member(role: 'price_sheet' | 'itinerary_sheet' | 'terms_sheet', suffix: string, text: string) {
  return {
    sourceDocumentId: `source-${suffix}`,
    extractionId: `extraction-${suffix}`,
    sourceHash: suffix.repeat(64).slice(0, 64),
    role,
    documentIr: createTextDocumentIR({
      filename: `${suffix}.hwp`,
      sourceType: 'hwp' as const,
      text,
      parserEngine: 'test',
      parserVersion: '1',
    }),
  };
}

describe('source bundle DocumentIR', () => {
  it('preserves member-level evidence lineage while producing one valid IR', () => {
    const ir = mergeSourceBundleDocumentIR({
      bundleHash: 'f'.repeat(64),
      members: [
        member('itinerary_sheet', 'b', 'DAY 1 BX321 \uBD80\uC0B0 \uCD9C\uBC1C'),
        member('price_sheet', 'a', '2026-10-01 599,000\uC6D0'),
      ],
    });

    expect(validateDocumentIR(ir)).toBe(true);
    expect(ir.text.indexOf('599,000')).toBeLessThan(ir.text.indexOf('DAY 1'));
    expect(ir.nodes.map(node => node.id).every(id => id.startsWith('bundle-'))).toBe(true);
    expect(new Set(ir.nodes.map(node => node.attributes?.sourceDocumentId))).toEqual(new Set(['source-a', 'source-b']));
    expect(ir.assets[0]?.metadata?.memberFilenames).toEqual(['a.hwp', 'b.hwp']);
    expect(ir.parser.engine).toBe('source-bundle-evidence-ir');
  });

  it('rejects a bundle that lacks one complementary role', () => {
    expect(() => mergeSourceBundleDocumentIR({
      bundleHash: 'f'.repeat(64),
      members: [
        member('price_sheet', 'a', '2026-10-01 599,000\uC6D0'),
        { ...member('price_sheet', 'b', '2026-10-02 699,000\uC6D0') },
      ],
    })).toThrow('SOURCE_BUNDLE_COMPLEMENTARY_ROLES_REQUIRED');
  });

  it('orders a shared terms sheet after the commercial and itinerary sources', () => {
    const ir = mergeSourceBundleDocumentIR({
      bundleHash: 'e'.repeat(64),
      members: [
        member('terms_sheet', 'c', '불포함사항 가이드비'),
        member('itinerary_sheet', 'b', 'DAY 1 BX321 부산 출발'),
        member('price_sheet', 'a', '2026-10-01 599,000원'),
      ],
    });
    expect(ir.text.indexOf('599,000')).toBeLessThan(ir.text.indexOf('DAY 1'));
    expect(ir.text.indexOf('DAY 1')).toBeLessThan(ir.text.indexOf('가이드비'));
  });
});
