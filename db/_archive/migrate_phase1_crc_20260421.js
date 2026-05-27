/**
 * Phase 1 CRC 완전 이관 — 레거시 상품 전수 마이그레이션
 *
 * 대상: status IN ('active','pending','approved','published','available') 전체
 *
 * 3가지 정규화:
 *   1) inclusions 배열 — 최상위 콤마(괄호 밖)로 분리. 괄호/숫자콤마는 보호.
 *      예) "항공료, 택스, 유류세" → ["항공료","택스","유류세"]
 *
 *   2) 각 day.schedule — 연속된 2 flight activity (출발→도착 분리) 를 단일
 *      "A 출발 → B 도착 HH:MM" 으로 병합. "→" 가 이미 있으면 그대로 유지.
 *
 *   3) schedule activity 텍스트 정규화
 *      "호텔 체크인 및 휴식" → "호텔 투숙 및 휴식" (렌더러 컨벤션 통일)
 *
 * itinerary_data.highlights.inclusions 도 동일 정규화.
 *
 * 환경변수:
 *   DRY_RUN=true  — DB UPDATE 미수행. 변경 대상만 집계.
 *   LIMIT=N       — 상위 N개만 처리 (테스트용).
 */

const { initSupabase } = require('./templates/insert-template');

function splitTopLevelComma(s) {
  if (typeof s !== 'string') return [s];
  // 최상위 콤마만 분리 (괄호 안·숫자 콤마 보호)
  const parts = [];
  let depth = 0;
  let buf = '';
  const chars = [...s];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      const prev = buf.slice(-1);
      const next3 = chars.slice(i + 1, i + 4).join('');
      const isNumberComma = /\d/.test(prev) && /^\d{3}/.test(next3);
      if (isNumberComma) { buf += ch; continue; }
      const t = buf.trim();
      if (t) parts.push(t);
      buf = '';
    } else {
      buf += ch;
    }
  }
  const t = buf.trim();
  if (t) parts.push(t);
  return parts.length > 0 ? parts : [s];
}

function normalizeInclusions(arr) {
  if (!Array.isArray(arr)) return { result: arr, changed: false };
  const result = [];
  let changed = false;
  for (const item of arr) {
    const parts = splitTopLevelComma(item);
    if (parts.length > 1) changed = true;
    result.push(...parts);
  }
  return { result, changed };
}

function mergeFlightPair(schedule) {
  if (!Array.isArray(schedule) || schedule.length < 2) return { result: schedule, changed: false };
  const out = [];
  let changed = false;
  for (let i = 0; i < schedule.length; i++) {
    const cur = schedule[i];
    const nxt = schedule[i + 1];
    const isPair =
      cur?.type === 'flight' &&
      nxt?.type === 'flight' &&
      typeof cur.activity === 'string' &&
      typeof nxt.activity === 'string' &&
      /출발/.test(cur.activity) &&
      /도착/.test(nxt.activity) &&
      !/→|↦|⇒/.test(cur.activity);
    if (isPair) {
      const depCity = (cur.activity.match(/^(.+?)(?:국제)?공항?\s*출발/) || [])[1]?.trim() || '출발지';
      const arrCity = (nxt.activity.match(/^(.+?)(?:국제)?공항?\s*도착/) || [])[1]?.trim() || '도착지';
      const label = `${depCity} 출발 → ${arrCity} 도착 ${nxt.time || ''}`.trim();
      out.push({
        time: cur.time || null,
        activity: label,
        type: 'flight',
        transport: cur.transport || nxt.transport || null,
        note: null,
      });
      i++; // 두 번째 소비
      changed = true;
      continue;
    }
    out.push(cur);
  }
  return { result: out, changed };
}

function normalizeCheckinText(schedule) {
  if (!Array.isArray(schedule)) return { result: schedule, changed: false };
  let changed = false;
  const result = schedule.map((s) => {
    if (s?.type === 'normal' && typeof s?.activity === 'string') {
      if (s.activity === '호텔 체크인 및 휴식') {
        changed = true;
        return { ...s, activity: '호텔 투숙 및 휴식' };
      }
    }
    return s;
  });
  return { result, changed };
}

async function main() {
  const dryRun = String(process.env.DRY_RUN || '').toLowerCase() === 'true';
  const limit = parseInt(process.env.LIMIT || '0', 10);
  const sb = initSupabase();

  console.log(`\n🔧 Phase 1 CRC 레거시 마이그레이션 시작 (DRY_RUN=${dryRun}${limit ? ` LIMIT=${limit}` : ''})\n`);

  let query = sb
    .from('travel_packages')
    .select('id, short_code, title, status, inclusions, itinerary_data')
    .in('status', ['active', 'pending', 'approved', 'published', 'available']);
  if (limit > 0) query = query.limit(limit);

  const { data: pkgs, error } = await query;
  if (error) { console.error('❌ 조회 실패:', error.message); process.exit(1); }

  let totalInc = 0, totalFlight = 0, totalCheckin = 0, touched = 0;

  for (const pkg of pkgs) {
    let changed = false;
    const updates = {};

    // 1) inclusions 콤마 분리
    const incRes = normalizeInclusions(pkg.inclusions);
    if (incRes.changed) {
      updates.inclusions = incRes.result;
      totalInc++;
      changed = true;
    }

    // 2)+3) itinerary_data.days[].schedule 정규화
    const itin = pkg.itinerary_data || {};
    const days = Array.isArray(itin.days) ? itin.days.slice() : [];
    let daysChanged = false;

    // itinerary_data.highlights.inclusions 도 동일 적용
    const hlInc = itin?.highlights?.inclusions;
    let newHighlights = itin?.highlights;
    if (Array.isArray(hlInc)) {
      const r = normalizeInclusions(hlInc);
      if (r.changed) {
        newHighlights = { ...(itin.highlights || {}), inclusions: r.result };
        daysChanged = true;
      }
    }

    for (let i = 0; i < days.length; i++) {
      const d = days[i];
      if (!d?.schedule) continue;
      let sched = d.schedule;
      const f = mergeFlightPair(sched);
      if (f.changed) { sched = f.result; totalFlight++; daysChanged = true; }
      const c = normalizeCheckinText(sched);
      if (c.changed) { sched = c.result; totalCheckin++; daysChanged = true; }
      if (sched !== d.schedule) {
        days[i] = { ...d, schedule: sched };
      }
    }

    if (daysChanged) {
      updates.itinerary_data = { ...itin, highlights: newHighlights, days };
      changed = true;
    }

    if (!changed) continue;

    touched++;
    console.log(`  • ${pkg.short_code} | ${(pkg.title || '').slice(0, 40)} — inc:${incRes.changed ? 'Y' : '.'} flight:${daysChanged ? 'Y' : '.'}`);

    if (!dryRun) {
      updates.updated_at = new Date().toISOString();
      const { error: uerr } = await sb.from('travel_packages').update(updates).eq('id', pkg.id);
      if (uerr) console.error(`    ❌ UPDATE 실패: ${uerr.message}`);
    }
  }

  console.log(`\n📊 마이그레이션 요약 (전체 ${pkgs.length}건 조회)`);
  console.log(`   - inclusions 콤마 분리 적용: ${totalInc}건`);
  console.log(`   - schedule flight 병합 적용: ${totalFlight}건 (day 단위)`);
  console.log(`   - "호텔 체크인 및 휴식" → "호텔 투숙 및 휴식": ${totalCheckin}건 (day 단위)`);
  console.log(`   - 변경된 상품 총합: ${touched}건`);
  console.log(dryRun ? '\n⚠️  DRY_RUN=true — 실제 DB 변경 없음. DRY_RUN 제거 후 재실행 필요.\n' : '\n✔ 실제 UPDATE 완료\n');
}

main().catch(e => { console.error('💥', e); process.exit(1); });
