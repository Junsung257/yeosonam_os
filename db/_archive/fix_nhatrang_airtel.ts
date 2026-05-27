import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const PKG = 'b68b08fe-594f-41bf-8417-637f4a66678a';

(async () => {
  console.log('===== backfillSectionsByPackageId 호출 =====');
  const { backfillSectionsByPackageId } = await import('../src/lib/parser/llm/section-extractors');
  const r = await backfillSectionsByPackageId(PKG, { force: true });
  console.log('hero:', JSON.stringify(r.hero));
  console.log('price:', JSON.stringify(r.price));
  console.log('notices:', JSON.stringify(r.notices));

  // 결과 검증
  const { createClient } = await import('@supabase/supabase-js');
  const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: pkg } = await supa.from('travel_packages').select('display_title, product_summary, hero_tagline, destination').eq('id', PKG).single();
  console.log('\n===== DB 갱신 결과 =====');
  console.log(JSON.stringify(pkg, null, 2));

  const { count } = await supa.from('price_dates').select('*', { count: 'exact', head: true }).eq('package_id', PKG);
  console.log(`price_dates 행: ${count}`);

  const { data: priceRows } = await supa.from('price_dates').select('start_date, end_date, lowest_price').eq('package_id', PKG).order('start_date').limit(20);
  for (const p of priceRows ?? []) console.log(`  ${(p as { start_date: string }).start_date} ~ ${(p as { end_date: string }).end_date} | ${(p as { lowest_price?: number }).lowest_price}`);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
