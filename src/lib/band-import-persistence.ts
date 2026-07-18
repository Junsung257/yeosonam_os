import { supabaseAdmin } from './supabase';

interface BandImportRpcClient {
  rpc(name: string, params: Record<string, unknown>): Promise<{
    data: unknown;
    error: { code?: string; message?: string } | null;
  }>;
}

export interface BandImportedProductInput {
  internalCode: string;
  displayName: string;
  departureRegion: string;
  supplierCode: string;
  departureDate?: string | null;
  netPrice: number;
  marginRate: number;
  aiTags: string[];
  sourceFilename: string;
  postUrl?: string | null;
  postTitle?: string | null;
  rawText?: string | null;
}

export async function persistBandImportedProduct(
  input: BandImportedProductInput,
  client: BandImportRpcClient = supabaseAdmin as unknown as BandImportRpcClient,
): Promise<string> {
  const { data, error } = await client.rpc('import_band_product_atomically', {
    p_product: {
      internal_code: input.internalCode,
      display_name: input.displayName,
      departure_region: input.departureRegion,
      supplier_code: input.supplierCode,
      departure_date: input.departureDate ?? null,
      net_price: input.netPrice,
      margin_rate: input.marginRate,
      ai_tags: input.aiTags,
      source_filename: input.sourceFilename,
    },
    p_log: {
      post_url: input.postUrl ?? null,
      post_title: input.postTitle ?? null,
      raw_text: input.rawText ?? null,
    },
  });
  if (error) throw error;
  if (typeof data !== 'string' || !data.trim()) {
    throw new Error('band_import_atomic_rpc_invalid_result');
  }
  return data;
}
