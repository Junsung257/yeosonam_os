import { describe, expect, it } from 'vitest';

import { createTextDocumentIR, getDocumentIRValidationErrors, validateDocumentIR } from './document-ir';

describe('product registration V4 DocumentIR contract', () => {
  it('accepts the deterministic text IR shape', () => {
    const ir = createTextDocumentIR({
      filename: 'sample.txt',
      sourceType: 'text',
      text: '상품명\n서울 3박 4일',
      parserEngine: 'text-utf8',
      parserVersion: '1',
    });
    expect(validateDocumentIR(ir)).toBe(true);
    expect(getDocumentIRValidationErrors(ir)).toEqual([]);
  });

  it('reports structural errors instead of persisting partial IR', () => {
    const errors = getDocumentIRValidationErrors({ version: 'v4', text: 'broken' });
    expect(errors).toEqual(expect.arrayContaining([
      'DOCUMENT_IR_FILENAME_INVALID',
      'DOCUMENT_IR_SOURCE_TYPE_INVALID',
      'DOCUMENT_IR_PAGES_INVALID',
      'DOCUMENT_IR_NODES_INVALID',
      'DOCUMENT_IR_TABLES_INVALID',
      'DOCUMENT_IR_ASSETS_INVALID',
      'DOCUMENT_IR_PARSER_INVALID',
    ]));
    expect(validateDocumentIR({ version: 'v4', text: 'broken' })).toBe(false);
  });
});
