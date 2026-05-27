import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const PKG = '31c2a38b-8481-4674-a055-b11c96a7f948';

(async () => {
  const { backfillPackageAttractionsL3 } = await import('../src/lib/itinerary-llm-extractor');
  const r = await backfillPackageAttractionsL3(PKG, { useLLMFallback: true, cleanWrongMatches: true });
  console.log(`before=${((r.before ?? 0)*100).toFixed(0)}% after=${((r.after ?? 0)*100).toFixed(0)}% llmCalls=${r.llmCalls} cleaned=${r.cleaned}`);

  // 검증
  const { createClient } = await import('@supabase/supabase-js');
  const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: pkg } = await supa.from('travel_packages').select('itinerary_data').eq('id', PKG).single();
  const days = (pkg as { itinerary_data?: { days?: Array<{ day: number; schedule?: Array<{ activity: string; attraction_ids?: string[] }> }> } })?.itinerary_data?.days ?? [];

  console.log('\n=== 재실행 후 매칭 상태 ===');
  for (const d of days) {
    console.log(`\n━━ DAY ${d.day} ━━`);
    for (const item of d.schedule ?? []) {
      const ids = item.attraction_ids ?? [];
      const tag = ids.length === 0 ? '[ ]' : `[${ids.length}]`;
      const names: string[] = [];
      for (const id of ids) {
        const { data: a } = await supa.from('attractions').select('name').eq('id', id).maybeSingle();
        names.push(a?.name ? (a.name as string).slice(0, 30) : `❌${id.slice(0,8)}`);
      }
      console.log(`  ${tag} ${item.activity.slice(0, 60)}${names.length ? ' → ' + names.join(' | ') : ''}`);
    }
  }
})().catch(e => { console.error(e); process.exit(1); });
