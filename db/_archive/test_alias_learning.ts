/**
 * alias 학습 확대 효과 측정 (before vs after).
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

(async () => {
  const { createClient } = await import('@supabase/supabase-js');
  const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  // before
  const { count: before } = await supa.from('attractions_aliases').select('*', { count: 'exact', head: true });
  console.log(`Before: alias 행 ${before ?? 0}건`);

  // 8 패키지 backfill 재실행
  const { data: pkgs } = await supa
    .from('travel_packages')
    .select('id, title')
    .in('status', ['approved', 'pending_review'])
    .limit(10);

  const { backfillPackageAttractionsL3 } = await import('../src/lib/itinerary-llm-extractor');
  for (const p of pkgs ?? []) {
    const r = await backfillPackageAttractionsL3(p.id as string, { useLLMFallback: true });
    console.log(`  ${(p.title as string).slice(0, 50)} | llmCalls=${r.llmCalls} before=${((r.before ?? 0)*100).toFixed(0)}% after=${((r.after ?? 0)*100).toFixed(0)}%`);
    await new Promise(r => setTimeout(r, 500));
  }

  // 적재 대기 (fire-and-forget recordAlias)
  await new Promise(r => setTimeout(r, 3000));

  // after
  const { count: after } = await supa.from('attractions_aliases').select('*', { count: 'exact', head: true });
  console.log(`\nAfter:  alias 행 ${after ?? 0}건 (증가 ${(after ?? 0) - (before ?? 0)})`);

  // source별 분포
  const { data: bySrc } = await supa.from('attractions_aliases').select('source');
  const dist: Record<string, number> = {};
  for (const r of bySrc ?? []) dist[r.source as string] = (dist[r.source as string] ?? 0) + 1;
  console.log('source 분포:', dist);
})().catch(e => { console.error(e); process.exit(1); });
