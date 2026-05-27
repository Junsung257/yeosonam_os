import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

(async () => {
  const { createClient } = await import('@supabase/supabase-js');
  const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const PKG = '31c2a38b-8481-4674-a055-b11c96a7f948';

  const { data: pkg } = await supa.from('travel_packages').select('raw_text, unmatched_attractions').eq('id', PKG).single();
  const raw = (pkg as { raw_text?: string | null })?.raw_text ?? '';
  const unmatched = (pkg as { unmatched_attractions?: string[] | null })?.unmatched_attractions ?? null;
  console.log(`raw_text length: ${raw.length}`);
  console.log(`unmatched_attractions: ${JSON.stringify(unmatched)}`);

  console.log('\n=== raw_text에서 범정산/동인대협곡/봉황고성 발견 ===');
  for (const kw of ['범정산','동인대협곡','봉황고성','선녀헌화','후화원','마고석','노금정','홍운금정']) {
    const idx = raw.indexOf(kw);
    if (idx >= 0) {
      console.log(`  ✓ ${kw} (pos ${idx}): "${raw.slice(idx, idx + 80).replace(/\n/g, ' / ')}"`);
    } else {
      console.log(`  ❌ ${kw}: raw_text 없음`);
    }
  }

  // unmatched_activities 큐 (사장님 처리 대기) 확인
  const { data: q } = await supa
    .from('unmatched_activities')
    .select('id, activity, destination, status, created_at')
    .eq('package_id', PKG)
    .order('created_at', { ascending: false });
  console.log(`\n=== unmatched_activities 큐 (package=${PKG.slice(0,8)}) ===`);
  console.log(`총 ${q?.length ?? 0}건`);
  for (const item of (q ?? []).slice(0, 20)) {
    console.log(`  [${item.status}] ${item.activity.slice(0, 80)}`);
  }
})().catch(e => { console.error(e); process.exit(1); });
