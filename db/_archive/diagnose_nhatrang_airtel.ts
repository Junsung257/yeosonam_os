import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const PKG = 'b68b08fe-594f-41bf-8417-637f4a66678a';

(async () => {
  const { createClient } = await import('@supabase/supabase-js');
  const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const { data: pkg } = await supa.from('travel_packages').select('*').eq('id', PKG).single();
  if (!pkg) { console.log('패키지 없음'); return; }

  console.log('═══ 패키지 메타 ═══');
  console.log(`title: ${(pkg as { title?: string }).title}`);
  console.log(`display_title: ${(pkg as { display_title?: string | null }).display_title}`);
  console.log(`product_summary: ${(pkg as { product_summary?: string | null }).product_summary}`);
  console.log(`hero_tagline: ${(pkg as { hero_tagline?: string | null }).hero_tagline}`);
  console.log(`destination: ${(pkg as { destination?: string }).destination}`);
  console.log(`status: ${(pkg as { status?: string }).status}`);
  console.log(`audit_status: ${(pkg as { audit_status?: string }).audit_status}`);
  console.log(`raw_text length: ${(pkg as { raw_text?: string }).raw_text?.length ?? 0}`);
  console.log(`created_at: ${(pkg as { created_at?: string }).created_at}`);
  console.log(`updated_at: ${(pkg as { updated_at?: string }).updated_at}`);

  console.log('\n═══ price_dates ═══');
  const { data: prices } = await supa.from('price_dates').select('*').eq('package_id', PKG).order('start_date');
  console.log(`총 ${prices?.length ?? 0}건`);
  for (const p of prices?.slice(0, 5) ?? []) console.log(`  ${(p as { start_date: string; end_date: string; lowest_price?: number }).start_date} ~ ${(p as { start_date: string; end_date: string }).end_date} | ${(p as { lowest_price?: number }).lowest_price ?? '?'}`);

  console.log('\n═══ audit_report ═══');
  const audit = (pkg as { audit_report?: { confidence?: number; checks?: Array<{ id: string; status: string; detail?: string }> } }).audit_report;
  if (audit?.checks) {
    console.log(`confidence: ${(audit.confidence ?? 0) * 100}%`);
    for (const c of audit.checks) console.log(`  [${c.id} ${c.status}] ${c.detail?.slice(0, 80) ?? ''}`);
  }

  console.log('\n═══ itinerary_data ═══');
  const days = (pkg as { itinerary_data?: { days?: Array<{ day: number; schedule?: Array<{ activity: string; type?: string; attraction_ids?: string[] }> }> } }).itinerary_data?.days ?? [];
  console.log(`총 ${days.length} days`);
  for (const d of days) {
    console.log(`\nDAY ${d.day} (schedule ${d.schedule?.length ?? 0} 라인):`);
    for (const s of d.schedule ?? []) {
      console.log(`  [${s.type ?? ''}|${(s.attraction_ids ?? []).length}] ${s.activity.slice(0, 90)}`);
    }
  }

  console.log('\n═══ raw_text (앞 800자) ═══');
  console.log((pkg as { raw_text?: string }).raw_text?.slice(0, 800));
})().catch(e => { console.error(e); process.exit(1); });
