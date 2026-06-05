import type { SupabaseClient } from '@supabase/supabase-js';

import { computeNormalizedContentHash } from '@/lib/parser/upload-text-hash';

type DocumentHashRow = {
  file_hash: string;
  product_id: string | null;
  file_name: string;
  normalized_hash?: string | null;
};

export type UploadDuplicateResponsePayload = {
  success: true;
  duplicate: true;
  duplicateReason?: 'normalized_content';
  fileHash: string;
  normalizedContentHash?: string;
  internal_code: string | null;
  message: string;
  hint?: string;
};

export type UploadDuplicateCheckResult = {
  duplicate: false;
} | {
  duplicate: true;
  kind: 'file_hash' | 'normalized_content';
  hashPreview: string;
  payload: UploadDuplicateResponsePayload;
};

const INACTIVE_PRODUCT_STATUSES = ['archived', 'inactive', 'INACTIVE', 'deleted', 'expired', 'cancelled'];

async function findAliveDocumentHashMatch(
  supabase: SupabaseClient,
  rows: DocumentHashRow[],
): Promise<DocumentHashRow | null> {
  const productIds = rows
    .map(row => row.product_id)
    .filter((productId): productId is string => Boolean(productId));
  if (productIds.length === 0) return null;

  const { data: aliveProducts } = await supabase
    .from('products')
    .select('internal_code, status')
    .in('internal_code', productIds)
    .not('status', 'in', `("${INACTIVE_PRODUCT_STATUSES.join('","')}")`);
  const aliveSet = new Set((aliveProducts ?? []).map((row: { internal_code: string }) => row.internal_code));
  return rows.find(row => row.product_id && aliveSet.has(row.product_id)) ?? null;
}

export async function checkInitialUploadDuplicate(input: {
  supabase: SupabaseClient;
  isSupabaseConfigured: boolean;
  forceReprocess: boolean;
  fileHash: string;
  directRawText: string | null;
}): Promise<UploadDuplicateCheckResult> {
  if (!input.isSupabaseConfigured || input.forceReprocess) return { duplicate: false };

  const { data: existingHashes } = await input.supabase
    .from('document_hashes')
    .select('file_hash, product_id, file_name')
    .eq('file_hash', input.fileHash);
  const blocked = await findAliveDocumentHashMatch(input.supabase, (existingHashes ?? []) as DocumentHashRow[]);

  if (blocked) {
    return {
      duplicate: true,
      kind: 'file_hash',
      hashPreview: input.fileHash.slice(0, 12),
      payload: {
        success: true,
        duplicate: true,
        fileHash: input.fileHash,
        internal_code: blocked.product_id,
        message: `이미 처리된 파일입니다. 원본: ${blocked.file_name}. 재처리하려면 force=1.`,
        hint: 'archived 상태의 기존 상품은 자동으로 재처리를 허용합니다.',
      },
    };
  }

  if (!input.directRawText) return { duplicate: false };

  const normalizedContentHash = computeNormalizedContentHash(input.directRawText);
  const { data: existingNormRows } = await input.supabase
    .from('document_hashes')
    .select('file_hash, product_id, file_name, normalized_hash')
    .eq('normalized_hash', normalizedContentHash);
  const blockedNorm = await findAliveDocumentHashMatch(input.supabase, (existingNormRows ?? []) as DocumentHashRow[]);

  if (!blockedNorm) return { duplicate: false };
  return {
    duplicate: true,
    kind: 'normalized_content',
    hashPreview: normalizedContentHash.slice(0, 12),
    payload: {
      success: true,
      duplicate: true,
      duplicateReason: 'normalized_content',
      fileHash: input.fileHash,
      normalizedContentHash: `${normalizedContentHash.slice(0, 16)}...`,
      internal_code: blockedNorm.product_id,
      message: `이미 처리된 카탈로그입니다. 본문 정규화 기준. 원본: ${blockedNorm.file_name}. 재처리하려면 force=1.`,
    },
  };
}

export async function checkParsedDocumentNormalizedDuplicate(input: {
  supabase: SupabaseClient;
  isSupabaseConfigured: boolean;
  directRawText: string | null;
  parsedRawText: string;
  normalizedCatalogHash: string;
  fileHash: string;
}): Promise<UploadDuplicateCheckResult> {
  if (!input.isSupabaseConfigured || input.directRawText || input.parsedRawText.trim().length < 50) {
    return { duplicate: false };
  }

  const { data: existingNormRows } = await input.supabase
    .from('document_hashes')
    .select('file_hash, product_id, file_name, normalized_hash')
    .eq('normalized_hash', input.normalizedCatalogHash);
  const blockedNorm = await findAliveDocumentHashMatch(input.supabase, (existingNormRows ?? []) as DocumentHashRow[]);

  if (!blockedNorm) return { duplicate: false };
  return {
    duplicate: true,
    kind: 'normalized_content',
    hashPreview: input.normalizedCatalogHash.slice(0, 12),
    payload: {
      success: true,
      duplicate: true,
      duplicateReason: 'normalized_content',
      fileHash: input.fileHash,
      normalizedContentHash: `${input.normalizedCatalogHash.slice(0, 16)}...`,
      internal_code: blockedNorm.product_id,
      message: `이미 처리된 카탈로그입니다. 추출 본문 정규화 기준. 원본: ${blockedNorm.file_name}`,
    },
  };
}

export async function recordUploadDocumentHash(input: {
  supabase: SupabaseClient;
  isSupabaseConfigured: boolean;
  fileHash: string;
  fileName: string;
  productId: string | null;
  normalizedHash: string | null;
}): Promise<{ ok: boolean; message?: string }> {
  if (!input.isSupabaseConfigured) return { ok: true };

  const { error } = await input.supabase
    .from('document_hashes')
    .insert({
      file_hash: input.fileHash,
      file_name: input.fileName,
      product_id: input.productId,
      normalized_hash: input.normalizedHash,
    });

  if (error) return { ok: false, message: error.message };
  return { ok: true };
}
