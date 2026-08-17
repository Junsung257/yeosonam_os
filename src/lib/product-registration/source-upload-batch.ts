export const PRODUCT_SOURCE_UPLOAD_BATCH_MAX_SIZE = 50;

export type ProductSourceUploadBatch = {
  id: string;
  index: number;
  size: number;
};

export type ProductSourceUploadBatchResult =
  | { ok: true; value: ProductSourceUploadBatch | null }
  | { ok: false; code: string; message: string };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function optionalInteger(value: unknown): number | null {
  if (value === null || typeof value === 'undefined' || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/**
 * A batch is only upload provenance: it says that files were selected in one
 * browser action. It is never sufficient evidence that two documents describe
 * the same product, supplier, price, or itinerary.
 */
export function parseProductSourceUploadBatch(input: {
  id?: unknown;
  index?: unknown;
  size?: unknown;
}): ProductSourceUploadBatchResult {
  const id = typeof input.id === 'string' ? input.id.trim().toLowerCase() : '';
  const hasAnyValue = Boolean(id)
    || (input.index !== null && typeof input.index !== 'undefined' && input.index !== '')
    || (input.size !== null && typeof input.size !== 'undefined' && input.size !== '');
  if (!hasAnyValue) return { ok: true, value: null };

  const index = optionalInteger(input.index);
  const size = optionalInteger(input.size);
  if (!UUID_PATTERN.test(id)) {
    return { ok: false, code: 'SOURCE_BATCH_ID_INVALID', message: '업로드 묶음 식별자가 올바르지 않습니다.' };
  }
  if (size === null || size < 1 || size > PRODUCT_SOURCE_UPLOAD_BATCH_MAX_SIZE) {
    return {
      ok: false,
      code: 'SOURCE_BATCH_SIZE_INVALID',
      message: `업로드 묶음 크기는 1~${PRODUCT_SOURCE_UPLOAD_BATCH_MAX_SIZE}개여야 합니다.`,
    };
  }
  if (index === null || index < 0 || index >= size) {
    return { ok: false, code: 'SOURCE_BATCH_INDEX_INVALID', message: '업로드 묶음 순서가 범위를 벗어났습니다.' };
  }
  return { ok: true, value: { id, index, size } };
}
