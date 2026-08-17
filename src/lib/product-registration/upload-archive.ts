import type { SupabaseClient } from '@supabase/supabase-js';

import type { UploadFilenameRule, UploadLandOperatorRow } from '@/lib/product-registration/upload-supplier-context';

export type ArchiveUploadRawProductResult = {
  sku: string;
  status: 'expired' | 'DRAFT';
  expired: boolean;
  departureDate: string | null;
};

export async function archiveUploadRawProduct(input: {
  supabase: SupabaseClient;
  isSupabaseConfigured: boolean;
  buffer: Buffer;
  fileName: string;
  filenameRule: UploadFilenameRule;
  landOperators: UploadLandOperatorRow[];
}): Promise<ArchiveUploadRawProductResult> {
  let rawText = '';
  try {
    rawText = input.buffer.toString('utf-8').slice(0, 50000);
  } catch {
    console.warn('[upload] archive rawText decode skipped');
  }

  const dateMatch = rawText.match(/(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})/);
  const departureDate = dateMatch
    ? `${dateMatch[1]}-${dateMatch[2].padStart(2, '0')}-${dateMatch[3].padStart(2, '0')}`
    : null;
  const expired = departureDate ? new Date(departureDate) < new Date() : false;
  const status = expired ? 'expired' : 'DRAFT';
  const sku = `ARCH-${input.filenameRule.cleanName.slice(0, 20).replace(/\s/g, '-')}-${Date.now()}`;
  // Source retention now belongs to the tenant-scoped V6 intake and
  // source_documents ledger. Never create a mutable product from raw bytes.
  void input.supabase;
  void input.isSupabaseConfigured;
  void input.landOperators;

  return {
    sku,
    status,
    expired,
    departureDate,
  };
}
