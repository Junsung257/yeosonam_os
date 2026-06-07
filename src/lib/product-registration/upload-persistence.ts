import type { SupabaseClient } from '@supabase/supabase-js';

import type { UploadPersistenceRows } from './persistence-rows';

export type UploadPersistenceResult = {
  productInserted: boolean;
  productUpdated: boolean;
  packageRow: Record<string, unknown> | null;
  packageId: string | null;
  priceRowsSaved: number;
};

export async function persistUploadRegistrationRows(input: {
  supabase: SupabaseClient;
  isSupabaseConfigured: boolean;
  internalCode: string | null;
  rows: UploadPersistenceRows;
}): Promise<UploadPersistenceResult> {
  const result: UploadPersistenceResult = {
    productInserted: false,
    productUpdated: false,
    packageRow: null,
    packageId: null,
    priceRowsSaved: 0,
  };
  if (!input.isSupabaseConfigured) return result;

  let existingProductBeforeWrite: Record<string, unknown> | null = null;
  if (input.internalCode) {
    const { data: existingProductBeforeWriteRow } = await input.supabase
      .from('products')
      .select('*')
      .eq('internal_code', input.internalCode)
      .maybeSingle();
    existingProductBeforeWrite = existingProductBeforeWriteRow as Record<string, unknown> | null;
  }

  if (input.internalCode && input.rows.productRow) {
    const { error: productError } = await input.supabase
      .from('products')
      .upsert(input.rows.productRow, { onConflict: 'internal_code' });

    if (productError) {
      throw new Error(`products save failed: ${productError.message}`);
    }
    result.productInserted = !existingProductBeforeWrite;
    result.productUpdated = Boolean(existingProductBeforeWrite);
    console.log('[Upload API] products UPSERT complete:', input.internalCode);
  }

  if (input.internalCode && input.rows.productPriceRows.length > 0) {
    const { error: priceError } = await input.supabase
      .from('product_prices')
      .insert(input.rows.productPriceRows);

    if (priceError) {
      let rollbackErrorMessage: string | null = null;
      if (result.productInserted) {
        const { error: rollbackError } = await input.supabase
          .from('products')
          .delete()
          .eq('internal_code', input.internalCode);
        if (rollbackError) {
          rollbackErrorMessage = rollbackError.message;
        }
      } else if (result.productUpdated && existingProductBeforeWrite) {
        const { error: rollbackError } = await input.supabase
          .from('products')
          .upsert(existingProductBeforeWrite, { onConflict: 'internal_code' });
        if (rollbackError) {
          rollbackErrorMessage = rollbackError.message;
        }
      }
      if (rollbackErrorMessage) {
        throw new Error(`product_prices save failed: ${priceError.message}; product rollback failed: ${rollbackErrorMessage}`);
      }
      throw new Error(`product_prices save failed: ${priceError.message}`);
    }
    result.priceRowsSaved = input.rows.productPriceRows.length;
    console.log('[Upload API] product_prices INSERT complete:', input.rows.productPriceRows.length);
  }

  const { data: pkgRes, error: pkgError } = await input.supabase
    .from('travel_packages')
    .insert(input.rows.travelPackageRow)
    .select()
    .single();

  if (pkgError) {
    throw new Error(`travel_packages save failed: ${pkgError.message}`);
  }

  result.packageRow = (pkgRes ?? null) as Record<string, unknown> | null;
  result.packageId = typeof result.packageRow?.id === 'string' ? result.packageRow.id : null;
  console.log('[Upload API] travel_packages INSERT complete:', result.packageId, 'internal_code:', input.internalCode);
  return result;
}

export async function rollbackInsertedUploadProduct(input: {
  supabase: SupabaseClient;
  isSupabaseConfigured: boolean;
  internalCode: string | null;
  productInserted: boolean;
}): Promise<{ rolledBack: boolean; error?: string }> {
  if (!input.isSupabaseConfigured || !input.internalCode || !input.productInserted) {
    return { rolledBack: false };
  }

  const { error } = await input.supabase
    .from('products')
    .delete()
    .eq('internal_code', input.internalCode);
  if (error) return { rolledBack: false, error: error.message };
  return { rolledBack: true };
}
