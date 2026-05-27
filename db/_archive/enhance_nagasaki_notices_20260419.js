/**
 * @file enhance_nagasaki_notices_20260419.js
 * @description AI cross-check(E5)가 지적한 누락 항목을 notices_parsed에 반영.
 *   - 송영요금 추가 발생 가능 경고
 *   - 일본 연휴 항공 제외일 명시
 *   - 현금영수증 행사완료 5일 이내 기한
 *   - 파이널 완납 조건
 *   - [정통] 클럽식 조건부 포함 (사세보국제CC만)
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env.local');
for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const [k, ...rest] = line.split('=');
  if (k && rest.length) process.env[k.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '');
}
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const IDS = {
  jeongtong: '2227e9c4-a8ba-464e-b89e-4b901625fa8e',
  pumgyeok:  'e4a2ae42-d00e-484a-ad78-3785c955448b',
};

const DRY = process.argv.includes('--dry');

// 공통 추가 블록
const COMMON_ADDITIONS = [
  {
    type: 'POLICY',
    title: '현지 변경 가능성',
    text: `• 골프장 예약 상황에 따라 대체될 수 있으며, 송영요금이 추가로 발생할 수 있습니다
• 호텔 예약상황에 따라 동급으로 대체될 수 있습니다
• 일본 연휴 기간(3/18~20, 4/27~5/4 오봉)은 항공 제외일이며 요금 별도 확인 필요`,
  },
  {
    type: 'PAYMENT',
    title: '결제 및 현금영수증 안내',
    text: `• 예약금 입금 확인 후 확정 진행
• 출발 1주일 전 완납 기준 (특가 상품은 2주 전 완납)
• 파이널 확정 후 금액은 파이널 확인 날짜까지 100% 입금 필요, 파이널 후 취소 불가
• 현금영수증은 행사 완료 후 5일 이내에만 발급 가능`,
  },
];

// 정통만 추가: 클럽식 조건부 포함
const JEONGTONG_ADDITION = {
  type: 'INFO',
  title: '중식(클럽식) 조건부 포함 안내',
  text: `• 사세보국제CC 이용 시 클럽식(중식) 포함
• 타케오우레시노CC, 오무라만CC 등 타 골프장 변경 시 클럽식 불포함`,
};

function mergeNoticesPreservingExisting(existing, additions) {
  // 이미 같은 title이 있으면 text를 덮어쓰지 않고 skip (idempotent)
  const titles = new Set((existing || []).map(n => n?.title));
  const toAdd = additions.filter(a => !titles.has(a.title));
  return [...(existing || []), ...toAdd];
}

(async () => {
  console.log(`🔧 나가사키 notices_parsed 보강 ${DRY ? '(DRY-RUN)' : '(실행)'}\n`);

  const { data: rows } = await sb.from('travel_packages')
    .select('id, short_code, title, notices_parsed')
    .in('id', Object.values(IDS));

  for (const r of rows) {
    const isJeongtong = r.id === IDS.jeongtong;
    const additions = [...COMMON_ADDITIONS];
    if (isJeongtong) additions.push(JEONGTONG_ADDITION);

    const merged = mergeNoticesPreservingExisting(r.notices_parsed, additions);
    const addedCount = merged.length - (r.notices_parsed?.length || 0);

    console.log(`── ${r.short_code} | ${r.title}`);
    console.log(`   before: ${(r.notices_parsed || []).length}개 블록`);
    console.log(`   after : ${merged.length}개 블록 (${addedCount}개 추가)`);
    if (addedCount > 0) {
      merged.slice(-addedCount).forEach(n => console.log(`     + ${n.title}`));
    }

    if (!DRY && addedCount > 0) {
      const { error } = await sb.from('travel_packages')
        .update({ notices_parsed: merged })
        .eq('id', r.id);
      if (error) { console.error(`   ❌ UPDATE 실패:`, error); process.exit(1); }
      console.log(`   ✅ UPDATE 완료`);
    } else if (!DRY) {
      console.log(`   ⏭️  변경 없음 (이미 반영됨)`);
    }
    console.log('');
  }

  if (DRY) console.log('DRY-RUN 완료 — --dry 없이 재실행하면 반영.');
  else console.log('✅ 보강 완료.');
})().catch(e => { console.error(e); process.exit(1); });
