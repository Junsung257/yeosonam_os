/** tier → price_dates 변환 실패 원인 샘플 */
import { config } from 'dotenv';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';
import { tiersToDatePrices } from '../src/lib/price-dates';

config({ path: resolve(process.cwd(), '.env.local') });

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function main() {
  const { data } = await sb
    .from('travel_packages')
    .select('id, title, price_tiers, price_dates')
    .or('price_dates.is.null,price_dates.eq.[]')
    .limit(20);

  for (const row of data ?? []) {
    const tiers = Array.isArray(row.price_tiers) ? row.price_tiers : [];
    if (tiers.length === 0) continue;
    const expanded = tiersToDatePrices(tiers as never);
    if (expanded.length === 0) {
      console.log('--- FAIL', row.id, (row.title as string)?.slice(0, 50));
      console.log(JSON.stringify(tiers[0], null, 2));
    } else {
      console.log('OK', row.id, expanded.length, 'dates');
    }
  }
}

main();
