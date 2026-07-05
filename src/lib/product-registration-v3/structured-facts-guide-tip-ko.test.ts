import { describe, expect, it } from 'vitest';
import { createSourceLineIndex } from './source-line-index';
import { extractStructuredFactsFromSupplierText } from './structured-facts';

describe('product-registration-v3 Korean guide tip evidence', () => {
  it('treats included-cost guide tip lines as source-backed auto-clean evidence', () => {
    const rawText = '\uD56D\uACF5\uB8CC \uBC0F TAX, \uD638\uD154, \uCC28\uB7C9, \uC2DD\uC0AC, \uC785\uC7A5\uB8CC, \uAC00\uC774\uB4DC, \uAE30\uC0AC\uAC00\uC774\uB4DC \uD301';
    const result = extractStructuredFactsFromSupplierText({ rawText, lines: createSourceLineIndex(rawText) });
    const fact = result.structuredFacts.find(row => row.category === 'guide_tip');

    expect(fact?.values).toMatchObject({ included: true, amount: null });
    expect(fact?.review_status).toBe('auto_clean');
  });

  it('does not auto-clean guide tip lines that are explicitly excluded or locally paid', () => {
    const rawText = '\uBD88\uD3EC\uD568: \uAC1C\uC778\uACBD\uBE44, \uD604\uC9C0\uC9C0\uBD88 \uAE30\uC0AC\uAC00\uC774\uB4DC \uD301';
    const result = extractStructuredFactsFromSupplierText({ rawText, lines: createSourceLineIndex(rawText) });
    const fact = result.structuredFacts.find(row => row.category === 'guide_tip');

    expect(fact?.review_status).not.toBe('auto_clean');
  });
});
