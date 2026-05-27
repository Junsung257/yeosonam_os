/**
 * 기간형 요금표 → departure_dates 자동 생성
 * "5/1~6/30 토일월화" → 해당 기간의 모든 토/일/월/화 날짜 배열
 */
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const envFile = fs.readFileSync('.env.local', 'utf-8');
const env = {};
envFile.split('\n').forEach(l => { const [k, ...v] = l.split('='); if (k) env[k.trim()] = v.join('=').trim(); });
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const YEAR = 2026;
const DAY_MAP = { '일': 0, '월': 1, '화': 2, '수': 3, '목': 4, '금': 5, '토': 6 };

// "5/1~6/30" 또는 "7/1~14" (같은 월 축약) → { start: Date, end: Date }
function parseRange(rangeStr) {
  // 정규: "5/1~6/30"
  const m1 = rangeStr.match(/(\d{1,2})\/(\d{1,2})\s*~\s*(\d{1,2})\/(\d{1,2})/);
  if (m1) return { start: new Date(YEAR, parseInt(m1[1]) - 1, parseInt(m1[2])), end: new Date(YEAR, parseInt(m1[3]) - 1, parseInt(m1[4])) };

  // 축약: "7/1~14" (같은 월 내)
  const m2 = rangeStr.match(/(\d{1,2})\/(\d{1,2})\s*~\s*(\d{1,2})(?!\/)/)
  if (m2) return { start: new Date(YEAR, parseInt(m2[1]) - 1, parseInt(m2[2])), end: new Date(YEAR, parseInt(m2[1]) - 1, parseInt(m2[3])) };

  return null;
}

// "토일월화" → [6, 0, 1, 2]
function parseDays(dayStr) {
  const days = [];
  for (const [name, num] of Object.entries(DAY_MAP)) {
    if (dayStr.includes(name)) days.push(num);
  }
  return days;
}

// 기간 내 특정 요일의 모든 날짜 생성
function generateDates(start, end, dayNums) {
  const dates = [];
  const d = new Date(start);
  while (d <= end) {
    if (dayNums.includes(d.getDay())) {
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      dates.push(key);
    }
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

// period_label 파싱: "5/1~6/30,8/30~9/30 토일월화"
function expandPeriodLabel(label) {
  // 요일 추출
  const dayMatch = label.match(/([일월화수목금토]{2,7})\s*$/);
  if (!dayMatch) return null;
  const dayNums = parseDays(dayMatch[1]);
  if (dayNums.length === 0) return null;

  // 기간 추출 (콤마로 복수 기간)
  const periodPart = label.replace(dayMatch[0], '').trim();
  const ranges = periodPart.split(',').map(s => s.trim()).filter(Boolean);

  const allDates = [];
  for (const range of ranges) {
    const parsed = parseRange(range);
    if (parsed) {
      allDates.push(...generateDates(parsed.start, parsed.end, dayNums));
    }
  }

  return allDates.length > 0 ? allDates : null;
}

async function main() {
  const { data: pkgs } = await sb.from('travel_packages')
    .select('id, title, price_tiers')
    .not('price_tiers', 'is', null);

  console.log('대상 상품:', pkgs.length, '개\n');

  let updatedPkgs = 0;
  let expandedTiers = 0;

  for (const pkg of pkgs) {
    const tiers = pkg.price_tiers || [];
    let changed = false;

    for (const tier of tiers) {
      // 이미 dates가 있으면 스킵
      if (tier.departure_dates && tier.departure_dates.length > 0) continue;

      const dates = expandPeriodLabel(tier.period_label || '');
      if (dates) {
        tier.departure_dates = dates;
        changed = true;
        expandedTiers++;
        console.log('  ✓', pkg.title.slice(0, 35), '|', tier.period_label, '→', dates.length, '일');
      }
    }

    if (changed) {
      await sb.from('travel_packages').update({ price_tiers: tiers }).eq('id', pkg.id);
      updatedPkgs++;
    }
  }

  console.log('\n상품:', updatedPkgs, '개 업데이트');
  console.log('요금 구간:', expandedTiers, '개 날짜 확장');

  // 검증: 나트랑 노팁 확인
  const { data: verify } = await sb.from('travel_packages')
    .select('title, price_tiers')
    .ilike('title', '%나트랑%노팁%')
    .order('created_at', { ascending: false })
    .limit(1);

  if (verify?.[0]) {
    console.log('\n=== 검증:', verify[0].title.slice(0, 30), '===');
    verify[0].price_tiers?.forEach((t, i) => {
      console.log('  [' + i + ']', t.period_label, '→', (t.departure_dates || []).length, '일');
    });
  }
}

main().catch(e => console.error(e.message));
