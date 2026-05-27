/**
 * @file fix_kul_contamination.js
 * @description 쿠알라룸푸르 4박6일 상품의 DAY 교차 오염 수정
 *
 * 대상 버그:
 *   - ERR-KUL-02: 4박6일 DAY 4 "메르데카 광장" — 원문에 없는 랜드마크 제거
 *   - ERR-KUL-03: 4박6일 DAY 1 "추천선택관광: 쿠알라 야경투어" — 원문에 없는 항목 제거
 *
 * 사용법:
 *   node db/fix_kul_contamination.js              # dry-run (변경사항만 출력)
 *   node db/fix_kul_contamination.js --apply      # 실제 DB UPDATE
 */

const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const fs = require('fs');

// .env.local 로드
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const [k, ...rest] = line.split('=');
    if (k && rest.length) process.env[k.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '');
  }
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const APPLY = process.argv.includes('--apply');
const TARGET_CODE = 'TP-KUL-06-01'; // 4박6일 쿠알라

// 패턴: "DAY N — 삭제할 activity 패턴"
const CLEANUP_RULES = [
  {
    dayNumber: 4,
    activityPattern: /메르데카\s*광장/,
    reason: 'ERR-KUL-02: 원문 4박6일 4일차에는 메르데카 광장 없음 (3박5일에서 복사된 교차 오염)',
  },
  {
    dayNumber: 1,
    activityPattern: /추천선택관광.*야경투어|쿠알라\s*야경투어.*야시장/,
    reason: 'ERR-KUL-03: 원문 4박6일 1일차에는 추천 야경투어 없음 (3박5일에서 복사)',
  },
];

async function main() {
  console.log(`🔍 ${APPLY ? '[APPLY]' : '[DRY-RUN]'} ${TARGET_CODE} 교차 오염 수정\n`);

  // 4박6일 쿠알라 상품 조회 (title 기반 안전 매칭)
  const { data: pkgs, error: tpErr } = await supabase
    .from('travel_packages')
    .select('id, title, duration, destination, itinerary_data')
    .ilike('destination', '%쿠알라%')
    .eq('duration', 6);
  if (tpErr) { console.error('travel_packages 조회 실패:', tpErr); process.exit(1); }
  if (!pkgs?.length) { console.error(`4박6일 쿠알라 상품 미발견`); process.exit(1); }
  console.log(`대상 상품 ${pkgs.length}건 발견.`);

  for (const pkg of pkgs) {
    console.log(`\n──── ${pkg.title} (${pkg.id}) ────`);
    const raw = pkg.itinerary_data;
    const days = Array.isArray(raw) ? raw : (raw?.days || []);
    let mutated = false;

    for (const rule of CLEANUP_RULES) {
      const day = days.find(d => d.day === rule.dayNumber);
      if (!day || !Array.isArray(day.schedule)) continue;
      const before = day.schedule.length;
      day.schedule = day.schedule.filter(item => {
        if (rule.activityPattern.test(item.activity || '')) {
          console.log(`  ✂️  DAY ${rule.dayNumber} 제거: "${item.activity}"`);
          console.log(`     이유: ${rule.reason}`);
          mutated = true;
          return false;
        }
        return true;
      });
      if (day.schedule.length === before) {
        console.log(`  ✅ DAY ${rule.dayNumber}: ${rule.activityPattern} — 이미 없음 (정상)`);
      }
    }

    if (!mutated) {
      console.log('  변경사항 없음.');
      continue;
    }

    // 재조립: 원본이 배열이면 배열, 객체면 객체
    const updatedItinerary = Array.isArray(raw) ? days : { ...raw, days };

    if (APPLY) {
      const { error: uErr } = await supabase
        .from('travel_packages')
        .update({ itinerary_data: updatedItinerary })
        .eq('id', pkg.id);
      if (uErr) { console.error(`  ❌ UPDATE 실패:`, uErr); continue; }
      console.log('  ✅ DB UPDATE 완료');
    } else {
      console.log('  [DRY-RUN] --apply 플래그로 실제 반영.');
    }
  }

  console.log('\n완료.');
}

main().catch(err => { console.error(err); process.exit(1); });
