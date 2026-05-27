/**
 * 기존 travel_packages의 date_range → departure_dates 일괄 정규화
 * 사용법: node db/normalize_date_ranges.js [--dry-run]
 *
 * 로직은 src/lib/expand-date-range.ts의 미러
 */
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

const envFile = fs.readFileSync('.env.local', 'utf-8');
const env = {};
envFile.split('\n').forEach(l => { const [k, ...v] = l.split('='); if (k) env[k.trim()] = v.join('=').trim(); });
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const dryRun = process.argv.includes('--dry-run');

// ─── expand-date-range.ts 미러 로직 ───

const DAY_MAP = { '일': 0, '월': 1, '화': 2, '수': 3, '목': 4, '금': 5, '토': 6 };

function parseDayIndices(dayStr, fallbackDays) {
  const src = (dayStr || fallbackDays || '');
  if (/매일/.test(src)) return [0, 1, 2, 3, 4, 5, 6];
  const cleaned = src.replace(/매주|요일/g, '');
  const indices = [];
  for (const [k, v] of Object.entries(DAY_MAP)) {
    if (cleaned.includes(k)) indices.push(v);
  }
  return indices;
}

function parseExcludedFromLabel(label) {
  const s = new Set();
  const m = label.match(/\(([^)]*제외)\)/);
  if (!m) return s;
  const parts = m[1].replace(/\s*제외/, '').split(',');
  let lastMonth = '';
  for (const p of parts) {
    const mp = p.trim().match(/^(\d{1,2})\/(\d{1,2})$/);
    if (mp) { lastMonth = mp[1]; s.add(`${mp[1]}/${mp[2]}`); }
    else { const dp = p.trim().match(/^(\d{1,2})$/); if (dp && lastMonth) s.add(`${lastMonth}/${dp[1]}`); }
  }
  return s;
}

const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

function formatDateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// departure_dates → 정확한 요일 역산: ["2026-05-03","2026-05-04"] → "일,월"
function deriveDayOfWeek(dates) {
  const daySet = new Set();
  for (const d of dates) {
    const dt = new Date(d);
    if (!isNaN(dt.getTime())) daySet.add(dt.getDay());
  }
  if (daySet.size === 0) return undefined;
  return [...daySet].sort((a, b) => a - b).map(i => DAY_NAMES[i]).join(',');
}

function expandDateRangeToArray({ dateRange, departureDayOfWeek, departureDays, periodLabel }) {
  if (!dateRange?.start || !dateRange?.end) return [];
  const start = new Date(dateRange.start);
  const end = new Date(dateRange.end);
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) return [];

  const dayIndices = parseDayIndices(departureDayOfWeek, departureDays);
  if (dayIndices.length === 0) return [];

  const excluded = periodLabel ? parseExcludedFromLabel(periodLabel) : new Set();
  const dates = [];

  for (const cur = new Date(start); cur <= end; cur.setDate(cur.getDate() + 1)) {
    if (!dayIndices.includes(cur.getDay())) continue;
    const mm = cur.getMonth() + 1;
    const dd = cur.getDate();
    if (excluded.has(`${mm}/${dd}`)) continue;
    dates.push(formatDateKey(cur));
  }
  return dates;
}

// 상품 출발요일과 불일치하는 tier 필터
function filterTiersByDepartureDays(tiers, departureDays) {
  if (!departureDays) return tiers;
  const pkgIndices = parseDayIndices(departureDays);
  if (pkgIndices.length === 0) return tiers;
  return tiers.filter(tier => {
    if (!tier.departure_day_of_week) return true;
    const tierIndices = parseDayIndices(tier.departure_day_of_week);
    if (tierIndices.length === 0) return true;
    return tierIndices.some(d => pkgIndices.includes(d));
  });
}

// ─── 메인 ───

async function main() {
  console.log(dryRun ? '=== DRY-RUN 모드 ===\n' : '=== 실행 모드 ===\n');

  const { data: pkgs, error } = await sb.from('travel_packages')
    .select('id, title, price_tiers, departure_days')
    .not('price_tiers', 'is', null);

  if (error) { console.error('조회 오류:', error.message); return; }
  console.log('전체 상품:', pkgs.length, '개\n');

  let affectedPkgs = 0;
  let expandedTiers = 0;
  let fixedDowTiers = 0;
  let filteredTiers = 0;

  for (const pkg of pkgs) {
    const tiers = pkg.price_tiers || [];
    let changed = false;

    for (const tier of tiers) {
      // 1) date_range만 있고 departure_dates 없으면 전개
      if ((!tier.departure_dates || tier.departure_dates.length === 0) && tier.date_range) {
        const dates = expandDateRangeToArray({
          dateRange: tier.date_range,
          departureDayOfWeek: tier.departure_day_of_week,
          departureDays: pkg.departure_days,
          periodLabel: tier.period_label,
        });

        if (dates.length > 0) {
          tier.departure_dates = dates;
          tier.departure_day_of_week = deriveDayOfWeek(dates);
          changed = true;
          expandedTiers++;
          console.log(`  ✓ ${pkg.title.slice(0, 40)} | ${tier.period_label} → ${dates.length}일 (${tier.departure_day_of_week})`);
        } else {
          console.log(`  ⚠ ${pkg.title.slice(0, 40)} | ${tier.period_label} → 요일 정보 없음 (스킵)`);
        }
      }
      // 2) departure_dates가 있으면 요일 역산 보정
      else if (tier.departure_dates && tier.departure_dates.length > 0) {
        const correctDow = deriveDayOfWeek(tier.departure_dates);
        if (correctDow && correctDow !== tier.departure_day_of_week) {
          const oldDow = tier.departure_day_of_week || '(없음)';
          tier.departure_day_of_week = correctDow;
          changed = true;
          fixedDowTiers++;
          console.log(`  🔧 ${pkg.title.slice(0, 40)} | ${tier.period_label} | 요일 보정: ${oldDow} → ${correctDow}`);
        }
      }
    }

    // 3) 상품 출발요일과 불일치하는 tier 제거
    const beforeFilter = tiers.length;
    const filtered = filterTiersByDepartureDays(tiers, pkg.departure_days);
    const removedCount = beforeFilter - filtered.length;
    if (removedCount > 0) {
      changed = true;
      filteredTiers += removedCount;
      console.log(`  ❌ ${pkg.title.slice(0, 40)} | ${removedCount}개 tier 요일 불일치 제거 (${pkg.departure_days})`);
    }

    if (changed) {
      affectedPkgs++;
      if (!dryRun) {
        const { error: updateErr } = await sb.from('travel_packages')
          .update({ price_tiers: filtered })
          .eq('id', pkg.id);
        if (updateErr) console.error(`  ❌ 업데이트 실패: ${updateErr.message}`);
      }
    }
  }

  console.log(`\n=== 결과 ===`);
  console.log(`정규화 대상: ${affectedPkgs}개 상품, ${expandedTiers}개 tier 전개, ${fixedDowTiers}개 요일 보정, ${filteredTiers}개 불일치 제거`);
  if (dryRun) console.log('\n실행: node db/normalize_date_ranges.js');

  // 검증
  if (!dryRun) {
    const { data: verify } = await sb.from('travel_packages')
      .select('id, title, price_tiers')
      .not('price_tiers', 'is', null)
      .limit(500);

    let remaining = 0;
    for (const pkg of (verify || [])) {
      for (const tier of (pkg.price_tiers || [])) {
        if (tier.date_range && (!tier.departure_dates || tier.departure_dates.length === 0)) {
          remaining++;
        }
      }
    }
    console.log(`\n검증: date_range만 있는 tier ${remaining}개 남음 ${remaining === 0 ? '✅' : '⚠️'}`);
  }
}

main().catch(e => console.error(e.message));
