import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

(async () => {
  const { createClient } = await import('@supabase/supabase-js');
  const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data, error } = await supa.from('travel_packages')
    .select('id, title, destination, status')
    .in('status', ['approved', 'pending_review'])
    .not('raw_text', 'is', null);
  if (error) { console.error(error); process.exit(1); }
  console.log('대상:', data?.length, '건');
  const { backfillSectionsByPackageId } = await import('../src/lib/parser/llm/section-extractors');
  for (const p of (data || []) as Array<{ id: string; title: string; destination: string; status: string }>) {
    try {
      const r = await backfillSectionsByPackageId(p.id, { force: false });
      const hero = r.hero?.applied ? '✓' : (r.hero?.reason === 'already-filled' ? '⊘' : '✗');
      const price = r.price?.applied ? `✓${r.price.rowCount}` : (r.price?.reason === 'already-filled' ? '⊘' : '✗');
      const notices = r.notices?.applied ? '✓' : (r.notices?.reason === 'already-filled' ? '⊘' : '✗');
      console.log(`  ${p.id.slice(0,8)} [${p.status}] ${p.destination?.slice(0,20)} → hero ${hero} | price ${price} | notices ${notices}`);
    } catch (e) {
      console.log(`  ${p.id.slice(0,8)} FAIL: ${(e as Error).message}`);
    }
  }
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
