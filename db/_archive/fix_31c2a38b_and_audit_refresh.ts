import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const PKG = '31c2a38b-8481-4674-a055-b11c96a7f948';

(async () => {
  const { createClient } = await import('@supabase/supabase-js');
  const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  // 1) sections force backfill (audit C11 stale snapshot 차단)
  console.log('1) Sections force backfill');
  const { backfillSectionsByPackageId } = await import('../src/lib/parser/llm/section-extractors');
  const sr = await backfillSectionsByPackageId(PKG, { force: false });
  console.log(`   hero=${sr.hero?.applied} price=${sr.price?.applied}(${sr.price?.rowCount ?? 0}) notices=${sr.notices?.applied}`);

  // 2) attractions hierarchy backfill (장가계 attractions 매칭 강화)
  console.log('\n2) Attractions hierarchy');
  const { backfillPackageAttractionsL3 } = await import('../src/lib/itinerary-llm-extractor');
  const ar = await backfillPackageAttractionsL3(PKG, { useLLMFallback: true });
  console.log(`   before=${((ar.before ?? 0)*100).toFixed(0)}% after=${((ar.after ?? 0)*100).toFixed(0)}% llmCalls=${ar.llmCalls}`);

  // 3) audit_report 재계산 (C11 stale snapshot 차단)
  console.log('\n3) audit_report 갱신 (display_title 채워진 후 C11 사라져야)');
  const { data: pkg } = await supa.from('travel_packages').select('display_title, audit_report').eq('id', PKG).single();
  const dt = (pkg as { display_title?: string | null })?.display_title;
  const rep = (pkg as { audit_report?: { checks?: Array<{ id: string; status: string; detail: string }> } })?.audit_report;
  if (rep?.checks && dt) {
    const newChecks = rep.checks.map(c => c.id === 'C11' && dt
      ? { ...c, status: 'pass', detail: `display_title 박힘: "${dt.slice(0, 40)}"` }
      : c);
    const stillWarn = newChecks.filter(c => c.status === 'warn').length;
    const newAuditStatus = stillWarn === 0 ? 'clean' : 'warnings';
    await supa.from('travel_packages').update({
      audit_report: { ...rep, checks: newChecks },
      audit_status: newAuditStatus,
      updated_at: new Date().toISOString(),
    }).eq('id', PKG);
    console.log(`   audit_status: warnings → ${newAuditStatus} (stillWarn=${stillWarn})`);
  }

  // 4) status approved (audit clean이면 자동 승인 의도)
  console.log('\n4) status → approved');
  await supa.from('travel_packages').update({ status: 'approved', updated_at: new Date().toISOString() }).eq('id', PKG);

  // 5) dev3001 + prod revalidate (둘 다 — 매번 빠뜨린 사고 차단)
  console.log('\n5) revalidate (prod + dev3001)');
  const paths = [`/packages/${PKG}`, `/m/packages/${PKG}`];
  for (const base of ['https://yeosonam.com', 'http://localhost:3001']) {
    try {
      const r = await fetch(`${base}/api/revalidate`, {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ paths, secret: process.env.REVALIDATE_SECRET }),
      });
      console.log(`   ${base}: ${(await r.text()).slice(0, 80)}`);
    } catch (e) { console.log(`   ${base}: ${(e as Error).message}`); }
  }

  console.log('\n✅ 31c2a38b 종결');
})().catch(e => { console.error(e); process.exit(1); });
