/**
 * Phase 1 — 이번 세션 박힌 코드 실측 검증.
 * 추측 없이 actual DB + LLM 호출.
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

(async () => {
  const { createClient } = await import('@supabase/supabase-js');
  const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  // ===== A. orphan attraction_ids 전수 측정 =====
  console.log('═══ A. orphan attraction_ids 전수 측정 ═══');
  const { data: pkgs } = await supa
    .from('travel_packages')
    .select('id, title, itinerary_data')
    .in('status', ['approved', 'pending_review'])
    .limit(50);

  // 전체 attraction_ids 수집
  const allIds = new Set<string>();
  const pkgAttrIds = new Map<string, string[]>();
  for (const p of pkgs ?? []) {
    const days = (p.itinerary_data as { days?: Array<{ schedule?: Array<{ attraction_ids?: string[] }> }> })?.days ?? [];
    const ids: string[] = [];
    for (const d of days) for (const s of d.schedule ?? []) for (const id of s.attraction_ids ?? []) {
      ids.push(id);
      allIds.add(id);
    }
    pkgAttrIds.set(p.id as string, ids);
  }
  console.log(`  패키지 ${pkgs?.length ?? 0}개, 고유 attraction_ids ${allIds.size}개`);

  // 실재 attractions 검증
  const idChunks: string[][] = [];
  const idsArr = [...allIds];
  for (let i = 0; i < idsArr.length; i += 100) idChunks.push(idsArr.slice(i, i + 100));
  const existingIds = new Set<string>();
  for (const chunk of idChunks) {
    const { data: existing } = await supa.from('attractions').select('id').in('id', chunk);
    for (const e of existing ?? []) existingIds.add(e.id as string);
  }
  const orphans = idsArr.filter(id => !existingIds.has(id));
  console.log(`  실재 IDs ${existingIds.size} / orphan ${orphans.length} (${(orphans.length / idsArr.length * 100).toFixed(0)}%)`);

  // orphan 보유 패키지 TOP 10
  const pkgOrphanCount: Array<{ id: string; title: string; orphans: number; total: number }> = [];
  for (const [pid, ids] of pkgAttrIds) {
    const orphanCount = ids.filter(id => !existingIds.has(id)).length;
    if (orphanCount > 0) {
      const p = pkgs?.find(x => x.id === pid);
      pkgOrphanCount.push({ id: pid, title: (p?.title as string) ?? '?', orphans: orphanCount, total: ids.length });
    }
  }
  pkgOrphanCount.sort((a, b) => b.orphans - a.orphans);
  console.log('  TOP 10 orphan 보유 패키지:');
  for (const p of pkgOrphanCount.slice(0, 10)) {
    console.log(`    [${p.orphans}/${p.total}] ${p.title.slice(0, 50)}`);
  }

  // ===== B. attractions_aliases 컬럼 + 데이터 측정 =====
  console.log('\n═══ B. attractions_aliases 컬럼 및 데이터 측정 ═══');
  const { data: aliasSample } = await supa.from('attractions_aliases').select('*').limit(3);
  console.log('  실제 컬럼:', aliasSample?.[0] ? Object.keys(aliasSample[0]).join(', ') : '비어있음');
  const { count: aliasCount } = await supa.from('attractions_aliases').select('*', { count: 'exact', head: true });
  console.log(`  총 alias 행 수: ${aliasCount ?? 0}`);
  // 최근 한 달 적재 추이
  const monthAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const { count: recent } = await supa.from('attractions_aliases').select('*', { count: 'exact', head: true }).gte('created_at', monthAgo);
  console.log(`  최근 30일 추가: ${recent ?? 0}건`);

  // ===== C. unmatched_activities 큐 측정 =====
  console.log('\n═══ C. unmatched_activities 큐 측정 ═══');
  const { count: pendingCount } = await supa.from('unmatched_activities').select('*', { count: 'exact', head: true }).eq('status', 'pending');
  const { count: addedCount } = await supa.from('unmatched_activities').select('*', { count: 'exact', head: true }).eq('status', 'added');
  const { count: ignoredCount } = await supa.from('unmatched_activities').select('*', { count: 'exact', head: true }).eq('status', 'ignored');
  console.log(`  pending=${pendingCount} added=${addedCount} ignored=${ignoredCount}`);
  // 최근 pending 10건
  const { data: recentPending } = await supa.from('unmatched_activities')
    .select('activity, region, day_number, package_id, created_at')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(10);
  console.log('  최근 pending 10건:');
  for (const u of recentPending ?? []) {
    console.log(`    [${u.region ?? '?'} D${u.day_number ?? '?'}] ${(u.activity as string).slice(0, 60)}`);
  }

  // ===== D. L1 / isLooseMatch / LONG_DESC_HEADER 동작 검증 =====
  console.log('\n═══ D. PR #116/#117 가드 동작 검증 (실제 함수 호출) ═══');
  const NON_ATTR = /(공항|출국|입국|수속|이동|체크인|체크아웃|투숙|휴식|미팅|조식|중식|석식|온천\s*휴식|호텔\s*안내|면세점|마사지|쇼핑|샤워|드랍|픽업|샌딩|^도착|^출발|도착\s*\/|출발\s*\/|호텔\s*조식\s*후|호텔\s*투숙)/;
  const LONG_DESC = /^(?:총\s*)?(?:길이|넓이|높이|면적|폭|해발|약\s*\d|평\s*\d)\s*[\d,]/;

  const testLines = [
    '장가계 도착 / 가이드 미팅 후 중식',           // L1 skip 기대
    '동인으로 이동(4시간)',                         // L1 skip 기대
    '호텔 조식 후',                                  // L1 skip 기대
    '여행의 피로를 풀어주는 발+전신마사지(90분)',    // L1 skip 기대 (마사지)
    '총길이 430M, 넓이 6M, 계곡에서의 높이 300M', // LONG_DESC skip 기대
    '약 2KM의 협곡',                                 // LONG_DESC skip 기대 (약 N)
    '범정산 관광 (셔틀버스-케이블카-...)',         // skip 안 됨, 정상 매칭 대상
    '봉황고성으로 이동(1시간)',                    // L1 skip (이동)
    '중국 최고의 협곡 장가계대협곡',                // skip 안 됨, 매칭 대상
  ];
  for (const line of testLines) {
    const l1 = NON_ATTR.test(line);
    const ld = LONG_DESC.test(line);
    const skip = l1 || ld;
    console.log(`  ${skip ? 'SKIP' : 'PASS'} ${l1 ? 'L1' : '  '}${ld ? 'LD' : '  '}  ${line.slice(0, 50)}`);
  }
})().catch(e => { console.error(e); process.exit(1); });
