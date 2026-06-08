import type { SupabaseClient } from '@supabase/supabase-js';

import type { ProductPriceRowInput } from '@/lib/upload-validator';

type ProductPriceReplacementRow = ProductPriceRowInput & {
  product_id?: string;
};

type ProductPriceReplacementRpc = SupabaseClient & {
  rpc(
    fn: 'replace_product_prices_for_product',
    args: { p_product_id: string; p_rows: ProductPriceReplacementRow[] },
  ): Promise<{ data: number | null; error: { message: string } | null }>;
};

export async function replaceProductPricesForProduct(input: {
  supabase: SupabaseClient;
  productId: string;
  rows: ProductPriceReplacementRow[];
}): Promise<number> {
  const rpcClient = input.supabase as unknown as ProductPriceReplacementRpc;
  const rows = input.rows.map(row => ({
    target_date: row.target_date ?? null,
    day_of_week: row.day_of_week ?? null,
    net_price: row.net_price,
    adult_selling_price: row.adult_selling_price ?? row.net_price,
    child_price: row.child_price ?? null,
    note: row.note ?? null,
  }));
  const { data, error } = await rpcClient.rpc('replace_product_prices_for_product', {
    p_product_id: input.productId,
    p_rows: rows,
  });

  if (error) {
    throw new Error(`product_prices save failed: ${error.message}`);
  }
  return Number(data ?? rows.length);
}
