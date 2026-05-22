/**
 * A1 잔여 건 원인 분류 (일회성 진단)
 *   npx tsx scripts/audit-a1-remaining.ts
 */
import { config } from 'dotenv';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';

config({ path: resolve(process.cwd(), '.env.local') });
config({ path: resolve(process.cwd(), '.env') });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('SUPABASE env missing');
  process.exit(1);
}

const sb = createClient(url, key);

type Row = {
  id: string;
  title: string | null;
  raw_text: string | null;
  price_tiers: unknown;
  price_dates: unknown;
  price: number | null;
};

async function main() {
  const { data, error } = await sb
    .from('travel_packages')
    .select('id, title, raw_text, price_tiers, price_dates, price')
    .or('price_dates.is.null,price_dates.eq.[]')
    .order('updated_at', { ascending: true })
    .limit(200);

  if (error) {
    console.error(error.message);
    process.exit(1);
  }

  const rows = (data ?? []) as Row[];
  const buckets: Record<string, typeof rows> = {
    has_tiers: [],
    has_raw_100: [],
    has_raw_short: [],
    no_source: [],
  };

  for (const r of rows) {
    const tiers = Array.isArray(r.price_tiers) ? r.price_tiers : [];
    const rawLen = (r.raw_text ?? '').trim().length;
    if (tiers.length > 0) buckets.has_tiers.push(r);
    else if (rawLen >= 100) buckets.has_raw_100.push(r);
    else if (rawLen > 0) buckets.has_raw_short.push(r);
    else buckets.no_source.push(r);
  }

  const { data: intakes } = await sb
    .from('normalized_intakes')
    .select('package_id, raw_text')
    .in('package_id', rows.map(r => r.id));

  const intakeMap = new Map<string, number>();
  for (const i of intakes ?? []) {
    const len = typeof i.raw_text === 'string' ? i.raw_text.trim().length : 0;
    if (len > 0) intakeMap.set(i.package_id as string, len);
  }

  console.log(JSON.stringify({
    total_a1: rows.length,
    has_tiers: buckets.has_tiers.length,
    has_raw_100: buckets.has_raw_100.length,
    has_raw_short: buckets.has_raw_short.length,
    no_source: buckets.no_source.length,
    with_intake_raw: [...intakeMap.keys()].length,
    samples: {
      has_tiers: buckets.has_tiers.slice(0, 3).map(r => ({ id: r.id, title: r.title?.slice(0, 40), tierCount: (r.price_tiers as unknown[]).length })),
      no_source: buckets.no_source.slice(0, 5).map(r => ({ id: r.id, title: r.title?.slice(0, 40), intakeLen: intakeMap.get(r.id) ?? 0 })),
      has_raw_100: buckets.has_raw_100.slice(0, 3).map(r => ({ id: r.id, title: r.title?.slice(0, 40) })),
    },
  }, null, 2));
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
