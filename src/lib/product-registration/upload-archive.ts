import type { SupabaseClient } from '@supabase/supabase-js';

import {
  resolveLandOperatorId,
  resolveSupplierCode,
  type UploadFilenameRule,
  type UploadLandOperatorRow,
} from '@/lib/product-registration/upload-supplier-context';

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
  const supplierCode = resolveSupplierCode(input.filenameRule.supplierRaw);
  const landOperatorId = resolveLandOperatorId(input.filenameRule.supplierRaw, input.landOperators);

  if (input.isSupabaseConfigured) {
    await input.supabase.from('products').upsert({
      internal_code: sku,
      display_name: input.filenameRule.cleanName ?? input.fileName,
      status,
      source_filename: input.fileName,
      raw_extracted_text: rawText,
      departure_date: departureDate,
      supplier_code: supplierCode,
      land_operator_id: landOperatorId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'internal_code', ignoreDuplicates: true });
  }

  return {
    sku,
    status,
    expired,
    departureDate,
  };
}
