/**
 * audit_status='warnings' AND (display_title null OR price_dates 빈 배열) 인 패키지 전수 backfill.
 * register 시 silent fail 한 패키지 일괄 복구.
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

(async () => {
  const { createClient } = await import('@supabase/supabase-js');
  const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  // 진단: register 시 silent fail 의심 패키지
  const { data: pkgs } = await supa
    .from('travel_packages')
    .select('id, title, display_title, price_dates, audit_status')
    .or('audit_status.eq.warnings,display_title.is.null')
    .neq('status', 'archived')
    .limit(50);

  console.log(`총 ${pkgs?.length ?? 0} 패키지 의심.\n`);

  const failed: Array<{ id: string; title: string; reason: string }> = [];
  const fixed: Array<{ id: string; title: string; hero: boolean; price: number; notices: boolean }> = [];

  const { backfillSectionsByPackageId } = await import('../src/lib/parser/llm/section-extractors');
  const { revalidatePackagePaths } = await import('../src/lib/revalidate-helper');

  for (const p of pkgs ?? []) {
    const pid = p.id as string;
    const title = (p.title as string).slice(0, 50);
    const hasHero = (p.display_title as string | null) != null;
    const hasPrice = Array.isArray(p.price_dates) && (p.price_dates as unknown[]).length > 0;
    if (hasHero && hasPrice) {
      // C6/C11 외 다른 warning 일 수도 있음 — 스킵 후 audit refresh 만
      console.log(`⊘ skip (이미 hero+price 정상): ${title}`);
      continue;
    }
    console.log(`\n[${pid.slice(0,8)}] ${title}`);
    console.log(`  hero=${hasHero} price=${hasPrice ? (p.price_dates as unknown[]).length : 0}`);
    try {
      const r = await backfillSectionsByPackageId(pid, { force: false });
      const heroOk = r.hero?.applied === true;
      const priceCount = r.price?.rowCount ?? 0;
      const noticesOk = r.notices?.applied === true;
      console.log(`  → hero=${heroOk} price=${priceCount} notices=${noticesOk}`);
      fixed.push({ id: pid, title, hero: heroOk, price: priceCount, notices: noticesOk });
      // revalidate
      await revalidatePackagePaths(pid);
    } catch (e) {
      const msg = (e as Error).message;
      console.log(`  ✗ FAIL: ${msg.slice(0, 80)}`);
      failed.push({ id: pid, title, reason: msg.slice(0, 100) });
    }
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`\n═══ 결과 ═══`);
  console.log(`복구: ${fixed.length}건`);
  console.log(`실패: ${failed.length}건`);
  for (const f of failed) console.log(`  - ${f.title}: ${f.reason}`);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
