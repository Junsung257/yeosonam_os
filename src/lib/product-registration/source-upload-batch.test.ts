import { describe, expect, it } from 'vitest';

import { parseProductSourceUploadBatch, PRODUCT_SOURCE_UPLOAD_BATCH_MAX_SIZE } from './source-upload-batch';

describe('parseProductSourceUploadBatch', () => {
  const id = '5e1ee884-4b4d-4dc9-972e-c2c9794d7842';

  it('allows a request without batch provenance', () => {
    expect(parseProductSourceUploadBatch({})).toEqual({ ok: true, value: null });
  });

  it('accepts a complete zero-based batch position', () => {
    expect(parseProductSourceUploadBatch({ id, index: '1', size: '3' })).toEqual({
      ok: true,
      value: { id, index: 1, size: 3 },
    });
  });

  it.each([
    [{ id: 'not-a-uuid', index: 0, size: 1 }, 'SOURCE_BATCH_ID_INVALID'],
    [{ id, index: 0, size: PRODUCT_SOURCE_UPLOAD_BATCH_MAX_SIZE + 1 }, 'SOURCE_BATCH_SIZE_INVALID'],
    [{ id, index: 2, size: 2 }, 'SOURCE_BATCH_INDEX_INVALID'],
    [{ id, index: 0 }, 'SOURCE_BATCH_SIZE_INVALID'],
  ] as const)('rejects incomplete or invalid provenance %#', (input, code) => {
    expect(parseProductSourceUploadBatch(input)).toMatchObject({ ok: false, code });
  });
});
