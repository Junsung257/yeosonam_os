/**
 * unmatched_activities 재매칭 sweep
 *
 * 배경: ERR-unmatched-stale-after-alias@2026-04-29
 *   사장님이 attractions.aliases 적립 또는 신규 attraction 추가해도,
 *   그 이전에 unmatched_activities 에 적재된 항목은 stale 상태로 남음.
 *   /admin/attractions/unmatched 페이지에 처리 대기로 계속 노출되어 사장님 부담.
 *
 * 동작:
 *   1) resolved_at IS NULL 인 unmatched_activities 모두 fetch
 *   2) Step 7-F 와 동일한 매칭 로직 (cleanText + name+aliases substring)
 *   3) 매칭 성공 → resolved_at=now, resolved_kind='auto_resweep', resolved_attraction_id 갱신
 *   4) 미매칭은 그대로 유지 (사장님 수동 처리 대기)
 *
 * 안전성:
 *   - 신규 attraction 시드 안 함 (ERR-20260418-33 정책 준수)
 *   - 기존 attractions/aliases 매칭만 활용
 *   - DRY_RUN=1 로 미리 확인 가능
 *
 * 실행:
 *   node db/resweep_unmatched_activities.js              # 실제 갱신
 *   DRY_RUN=1 node db/resweep_unmatched_activities.js    # 미리보기
 */

const fs = require('fs');
const path = require('path');
const envFile = fs.readFileSync(path.resolve(__dirname, '..', '.env.local'), 'utf-8');
const env = {};
envFile.split('\n').forEach(l => { const [k, ...v] = l.split('='); if (k) env[k.trim()] = v.join('=').trim(); });
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const DRY_RUN = process.env.DRY_RUN === '1';

const cleanText = (t) => String(t || '')
  .replace(/^[▶☆※♣*]+\s*/, '')
  .replace(/[(\[].*?[)\]]/g, ' ')
  .replace(/\s+/g, ' ')
  .toLowerCase()
  .trim();

function matchAttr(act, candidates) {
  const clean = cleanText(act);
  if (!clean) return null;
  for (const a of candidates) {
    const terms = [a.name, ...(a.aliases || [])].filter(Boolean);
    for (const t of terms) {
      const tc = String(t).toLowerCase().trim();
      if (tc.length < 2) continue;
      if (clean.includes(tc) || tc.includes(clean)) return { attr: a, via: t };
    }
  }
  return null;
}

(async () => {
  console.log(`🔍 unmatched_activities 재매칭 sweep ${DRY_RUN ? '[DRY-RUN]' : ''}\n`);

  // 1) 미해결 unmatched 전체 fetch
  const { data: unmatched, error: e1 } = await sb.from('unmatched_activities')
    .select('id, activity, region, country, package_id, package_title, occurrence_count')
    .is('resolved_at', null);
  if (e1) throw e1;
  console.log(`📥 미해결 unmatched: ${unmatched.length}건`);
  if (unmatched.length === 0) { console.log('✅ 정리 대상 없음'); return; }

  // 2) 모든 attractions fetch (range 로 전수 — Supabase 기본 limit 1000 우회)
  const attractions = [];
  let offset = 0;
  const PAGE = 1000;
  while (true) {
    const { data: page, error } = await sb.from('attractions')
      .select('id, name, aliases, region, country')
      .order('id')
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    if (!page || page.length === 0) break;
    attractions.push(...page);
    if (page.length < PAGE) break;
    offset += PAGE;
  }
  console.log(`📚 attractions 후보: ${attractions.length}개 (전수, range fetch)\n`);

  // 3) destination/country 별 후보 좁히기 (false-positive 방어)
  //    unmatched.country 가 destination 형식 (예: "후쿠오카", "쿠알라룸푸르/싱가포르")
  //    → attractions.region/country/name 과 partial 매칭으로 후보 좁힘. 미매칭 시 전체 fallback.
  const candidatesByLocation = new Map();
  function getCandidates(u) {
    const loc = (u.region || u.country || '').toLowerCase();
    if (!loc) return attractions; // location 없으면 전체
    if (candidatesByLocation.has(loc)) return candidatesByLocation.get(loc);
    const filtered = (attractions || []).filter(a => {
      const arN = (a.region || '').toLowerCase();
      const acN = (a.country || '').toLowerCase();
      // unmatched.location 이 attractions.region/country 를 substring 으로 포함 또는 반대
      return (arN && (loc.includes(arN) || arN.includes(loc))) ||
             (acN && (loc.includes(acN) || acN.includes(loc)));
    });
    // 후보 부족 (< 5개) 면 전체 사용 — region 정보가 명확하지 않을 때 매칭 누락 방지
    const result = filtered.length >= 5 ? filtered : attractions;
    candidatesByLocation.set(loc, result);
    return result;
  }

  // 4) 재매칭
  const resolved = [];
  const stillUnmatched = [];
  for (const u of unmatched) {
    const cands = getCandidates(u);
    const m = matchAttr(u.activity, cands);
    if (m) {
      resolved.push({ u, attr: m.attr, via: m.via });
    } else {
      stillUnmatched.push(u);
    }
  }

  console.log(`✅ 매칭 성공: ${resolved.length}건`);
  console.log(`⏸️  미매칭 유지: ${stillUnmatched.length}건 (사장님 수동 처리 대기)\n`);

  if (resolved.length > 0) {
    console.log('━ 매칭 성공 항목 ━');
    resolved.slice(0, 30).forEach(({ u, attr, via }) => {
      console.log(`  [${u.region || u.country || '?'}] "${u.activity.slice(0, 60)}" → ${attr.name} (via "${via}")`);
    });
    if (resolved.length > 30) console.log(`  ... 외 ${resolved.length - 30}건`);
  }

  // 4) DB UPDATE (DRY_RUN 모드 아닐 때만)
  if (!DRY_RUN && resolved.length > 0) {
    console.log('\n💾 DB UPDATE 진행...');
    const now = new Date().toISOString();
    let updateCount = 0;
    // status 는 그대로 두고 resolved_* 필드만 set (status check constraint 호환)
    // 어드민 페이지는 resolved_at IS NULL 로 필터링하므로 처리 큐에서 자동 제외됨
    for (const { u, attr } of resolved) {
      const { error } = await sb.from('unmatched_activities').update({
        resolved_at: now,
        resolved_kind: 'auto_resweep',
        resolved_attraction_id: attr.id,
        resolved_by: 'resweep_script',
      }).eq('id', u.id);
      if (!error) updateCount++;
      else console.log(`  ⚠️  ${u.id} 갱신 실패:`, error.message);
    }
    console.log(`✅ ${updateCount}/${resolved.length}건 갱신 완료`);
  } else if (DRY_RUN) {
    console.log('\nℹ️  DRY_RUN 모드 — 실제 UPDATE 안 함. 실제 정리하려면 DRY_RUN 없이 재실행');
  }

  if (stillUnmatched.length > 0) {
    console.log('\n━ 미매칭 유지 (사장님 수동 처리 후보 — 빈도순) ━');
    const byActivity = new Map();
    for (const u of stillUnmatched) {
      const key = u.activity;
      if (!byActivity.has(key)) byActivity.set(key, { count: 0, regions: new Set() });
      byActivity.get(key).count += (u.occurrence_count || 1);
      if (u.region) byActivity.get(key).regions.add(u.region);
    }
    [...byActivity.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 20)
      .forEach(([act, info]) => {
        console.log(`  [${info.count}회] (${[...info.regions].join('·')}) ${act.slice(0, 70)}`);
      });
    console.log('\n  → /admin/attractions/unmatched 에서 1클릭 alias 적립 또는 신규 attraction 등록');
  }
})().catch(err => { console.error('❌', err); process.exit(1); });
