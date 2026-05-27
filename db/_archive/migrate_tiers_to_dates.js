/**
 * price_tiers → price_dates 일괄 변환
 *
 * 목적: 3중 포맷(tiers/list/dates) 중 price_dates를 단일 진실 소스로 확정
 *
 * 사용법:
 *   node db/migrate_tiers_to_dates.js --dry-run          (기본, UPDATE 없이 리포트)
 *   node db/migrate_tiers_to_dates.js --apply           (실제 UPDATE)
 *   node db/migrate_tiers_to_dates.js --verify          (모든 행 price_dates 존재 확인)
 *   node db/migrate_tiers_to_dates.js --apply --force-refresh  (기존 price_dates도 재계산)
 *
 * 처리 대상:
 *   price_dates IS NULL OR price_dates = '[]'
 *   AND price_tiers IS NOT NULL AND array_length(price_tiers) > 0
 *
 * tiersToDatePrices() 로직을 JS로 포팅 (src/lib/price-dates.ts 참고)
 */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const VERIFY = args.includes('--verify');
const FORCE_REFRESH = args.includes('--force-refresh');
const DRY_RUN = !APPLY && !VERIFY;

function initSupabase() {
  const { createClient } = require('@supabase/supabase-js');
  const envFile = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf-8');
  const env = {};
  envFile.split('\n').forEach((l) => {
    const [k, ...v] = l.split('=');
    if (k) env[k.trim()] = v.join('=').trim();
  });
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
}

// ── DOW 매핑 (price-dates.ts와 동일) ──
const DOW_KO = { '일': 0, '월': 1, '화': 2, '수': 3, '목': 4, '금': 5, '토': 6 };

function tiersToDatePrices(tiers) {
  if (!Array.isArray(tiers) || tiers.length === 0) return [];
  const result = [];
  const seen = new Set();

  for (const tier of tiers) {
    if (!tier.adult_price) continue;
    const confirmed = tier.status === 'confirmed' || tier.status === 'departure_confirmed'
      || !!(tier.note && /출확|출발확정/.test(tier.note));

    // 1) departure_dates 배열 우선
    if (Array.isArray(tier.departure_dates) && tier.departure_dates.length > 0) {
      for (const d of tier.departure_dates) {
        if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
        if (seen.has(d)) continue;
        seen.add(d);
        result.push({
          date: d,
          price: tier.adult_price,
          child_price: tier.child_price ?? undefined,
          confirmed,
        });
      }
      continue;
    }

    // 2) date_range + departure_day_of_week
    if (tier.date_range && tier.date_range.start && tier.date_range.end) {
      const start = new Date(tier.date_range.start);
      const end = new Date(tier.date_range.end);
      if (isNaN(start.getTime()) || isNaN(end.getTime())) continue;
      const dowFilter = tier.departure_day_of_week
        ? String(tier.departure_day_of_week).split(/[,\/\s]+/).map(x => DOW_KO[x.trim()]).filter(x => typeof x === 'number')
        : null;

      for (let t = start.getTime(); t <= end.getTime(); t += 86400000) {
        const dt = new Date(t);
        if (dowFilter && !dowFilter.includes(dt.getDay())) continue;
        const iso = dt.toISOString().slice(0, 10);
        if (seen.has(iso)) continue;
        seen.add(iso);
        result.push({
          date: iso,
          price: tier.adult_price,
          child_price: tier.child_price ?? undefined,
          confirmed,
        });
      }
    }
  }

  result.sort((a, b) => a.date.localeCompare(b.date));
  return result;
}

async function main() {
  const sb = initSupabase();
  console.log(`[Migrate] 모드: ${VERIFY ? 'VERIFY' : DRY_RUN ? 'DRY RUN' : 'APPLY'}`);

  const { data, error } = await sb
    .from('travel_packages')
    .select('id, title, price_tiers, price_dates')
    .limit(10000);

  if (error) {
    console.error('[Migrate] 조회 실패:', error);
    process.exit(1);
  }

  if (VERIFY) {
    let ok = 0, missing = 0;
    for (const pkg of data ?? []) {
      const has = Array.isArray(pkg.price_dates) && pkg.price_dates.length > 0;
      const hasTiers = Array.isArray(pkg.price_tiers) && pkg.price_tiers.length > 0;
      if (has) ok++;
      else if (hasTiers) {
        missing++;
        console.log(`[MISSING] ${pkg.id} / ${pkg.title} — price_dates 없음, price_tiers ${pkg.price_tiers.length}개`);
      }
    }
    console.log(`\n[Verify] price_dates 보유: ${ok}건, 변환 필요: ${missing}건`);
    return;
  }

  let total = 0, changed = 0, skipped = 0, failed = 0;

  for (const pkg of data ?? []) {
    total++;
    const hasDates = Array.isArray(pkg.price_dates) && pkg.price_dates.length > 0;
    if (hasDates && !FORCE_REFRESH) { skipped++; continue; }

    const tiers = Array.isArray(pkg.price_tiers) ? pkg.price_tiers : [];
    if (tiers.length === 0) { skipped++; continue; }

    const converted = tiersToDatePrices(tiers);
    if (converted.length === 0) {
      failed++;
      console.log(`[FAIL] ${pkg.id} / ${pkg.title} — 변환 불가 (tiers ${tiers.length}개 → dates 0개)`);
      continue;
    }

    changed++;
    if (DRY_RUN) {
      console.log(`\n[DRY] ${pkg.id} / ${pkg.title}`);
      console.log(`  tiers ${tiers.length}개 → dates ${converted.length}개`);
      console.log(`  sample: ${JSON.stringify(converted.slice(0, 3))}`);
    } else {
      const { error: upErr } = await sb
        .from('travel_packages')
        .update({ price_dates: converted })
        .eq('id', pkg.id);
      if (upErr) {
        console.error(`[Migrate] UPDATE 실패 ${pkg.id}:`, upErr.message);
        failed++;
      }
    }
  }

  console.log(`\n[Migrate] 총 ${total}건 / 변환 ${changed} / 스킵 ${skipped} / 실패 ${failed}`);
  console.log(DRY_RUN ? '[Migrate] --apply 플래그로 실제 UPDATE 실행' : '[Migrate] 완료');
}

main().catch((e) => {
  console.error('[Migrate] 예외:', e);
  process.exit(1);
});
