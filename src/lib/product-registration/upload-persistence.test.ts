import { describe, expect, it, vi } from 'vitest';
import { persistUploadRegistrationRows } from './upload-persistence';

function createSupabaseMock(options: {
  productPricesInsertError?: Error | null;
  existingProduct?: Record<string, unknown> | null;
} = {}) {
  const maybeSingle = vi.fn(async () => ({ data: options.existingProduct ?? null }));
  const single = vi.fn(async () => ({ data: { id: 'pkg-1' }, error: null }));
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq, single }));
  const upsert = vi.fn(async () => ({ error: null }));
  const deleteEq = vi.fn(async () => ({ error: null }));
  const deleteProduct = vi.fn(() => ({ eq: deleteEq }));
  const insertProductPrices = vi.fn(async () => ({ error: options.productPricesInsertError ?? null }));
  const insertTravelPackage = vi.fn(() => ({ select }));
  const rpc = vi.fn(async (_fn: string, args: { p_rows?: unknown[] }) => ({
    data: args.p_rows?.length ?? 0,
    error: options.productPricesInsertError
      ? { message: options.productPricesInsertError.message }
      : null,
  }));
  const from = vi.fn((table: string) => {
    if (table === 'products') return { select, upsert, delete: deleteProduct };
    if (table === 'product_prices') return { insert: insertProductPrices };
    if (table === 'travel_packages') return { insert: insertTravelPackage };
    throw new Error(`Unexpected table ${table}`);
  });

  return {
    client: { from, rpc },
    calls: { from, upsert, deleteProduct, deleteEq, insertProductPrices, insertTravelPackage, rpc },
  };
}

describe('persistUploadRegistrationRows', () => {
  it('does not save the package when product price persistence fails', async () => {
    const supabase = createSupabaseMock({ productPricesInsertError: new Error('duplicate product price') });

    await expect(persistUploadRegistrationRows({
      supabase: supabase.client as never,
      isSupabaseConfigured: true,
      internalCode: 'PUS-ETC-CEB-05-0001',
      rows: {
        productRow: { internal_code: 'PUS-ETC-CEB-05-0001' },
        productPriceRows: [{
          product_id: 'PUS-ETC-CEB-05-0001',
          target_date: '2026-07-24',
          day_of_week: null,
          net_price: 859000,
          adult_selling_price: 859000,
          child_price: null,
          note: 'Solea',
        }],
        travelPackageRow: { title: 'Cebu hotel matrix' },
      },
    })).rejects.toThrow('product_prices save failed: duplicate product price');

    expect(supabase.calls.insertTravelPackage).not.toHaveBeenCalled();
    expect(supabase.calls.rpc).toHaveBeenCalledWith('replace_product_prices_for_product', expect.objectContaining({
      p_product_id: 'PUS-ETC-CEB-05-0001',
    }));
    expect(supabase.calls.deleteProduct).toHaveBeenCalledTimes(1);
    expect(supabase.calls.deleteEq).toHaveBeenCalledWith('internal_code', 'PUS-ETC-CEB-05-0001');
  });

  it('restores an existing product row when product price persistence fails after upsert', async () => {
    const existingProduct = {
      internal_code: 'PUS-ETC-CEB-05-0001',
      display_name: 'Previous Cebu package',
      net_price: 799000,
    };
    const supabase = createSupabaseMock({
      existingProduct,
      productPricesInsertError: new Error('duplicate product price'),
    });

    await expect(persistUploadRegistrationRows({
      supabase: supabase.client as never,
      isSupabaseConfigured: true,
      internalCode: 'PUS-ETC-CEB-05-0001',
      rows: {
        productRow: {
          internal_code: 'PUS-ETC-CEB-05-0001',
          display_name: 'New Cebu package',
          net_price: 859000,
        },
        productPriceRows: [{
          product_id: 'PUS-ETC-CEB-05-0001',
          target_date: '2026-07-24',
          day_of_week: null,
          net_price: 859000,
          adult_selling_price: 859000,
          child_price: null,
          note: 'Solea',
        }],
        travelPackageRow: { title: 'Cebu hotel matrix' },
      },
    })).rejects.toThrow('product_prices save failed: duplicate product price');

    expect(supabase.calls.insertTravelPackage).not.toHaveBeenCalled();
    expect(supabase.calls.rpc).toHaveBeenCalledWith('replace_product_prices_for_product', expect.objectContaining({
      p_product_id: 'PUS-ETC-CEB-05-0001',
    }));
    expect(supabase.calls.deleteProduct).not.toHaveBeenCalled();
    expect(supabase.calls.upsert).toHaveBeenNthCalledWith(1, expect.objectContaining({
      display_name: 'New Cebu package',
      net_price: 859000,
    }), { onConflict: 'internal_code' });
    expect(supabase.calls.upsert).toHaveBeenNthCalledWith(2, existingProduct, { onConflict: 'internal_code' });
  });
});
