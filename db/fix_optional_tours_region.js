/**
 * @file fix_optional_tours_region.js
 * @description 전체 travel_packages의 optional_tours에 region 필드 일괄 주입.
 *
 * 매핑 전략:
 *   1. 이름에 지역 키워드 있으면 해당 region 자동 설정
 *   2. "2층버스", "리버보트", "스카이파크" 같은 모호 이름은 같은 상품의
 *      다른 tour에 region 있으면 같은 region으로 추론 (맥락 일관성)
 *   3. 추론 실패 시 null 유지 (수동 검수 필요 플래그)
 *
 * 사용:
 *   node db/fix_optional_tours_region.js                 # dry-run + scratch/ JSON 덤프
 *   node db/fix_optional_tours_region.js --apply         # 실제 UPDATE
 */

const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const fs = require('fs');
const envPath = path.join(__dirname, '..', '.env.local');
for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const [k, ...rest] = line.split('=');
  if (k && rest.length) process.env[k.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '');
}
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const APPLY = process.argv.includes('--apply');

const REGION_KW = {
  '말레이시아': '말레이시아', '쿠알라': '말레이시아', '말라카': '말레이시아', '겐팅': '말레이시아',
  '싱가포르': '싱가포르',
  '태국': '태국', '방콕': '태국', '파타야': '태국', '푸켓': '태국',
  '베트남': '베트남', '다낭': '베트남', '하노이': '베트남', '나트랑': '베트남',
  '대만': '대만', '타이페이': '대만', '타이베이': '대만',
  '일본': '일본', '후쿠오카': '일본', '오사카': '일본', '홋카이도': '일본',
  '중국': '중국', '서안': '중국', '북경': '중국', '상해': '중국', '장가계': '중국', '칭다오': '중국',
  '라오스': '라오스', '몽골': '몽골', '필리핀': '필리핀', '보홀': '필리핀', '세부': '필리핀',
  '인도네시아': '인도네시아', '발리': '인도네시아',
};
const AMBIGUOUS = ['2층버스', '리버보트', '야시장투어', '크루즈', '마사지', '스카이파크', '스카이 파크'];

function inferByName(name) {
  if (!name) return null;
  // 괄호 내 키워드 우선
  const paren = name.match(/\(([^)]+)\)/);
  if (paren) {
    for (const [kw, region] of Object.entries(REGION_KW)) {
      if (paren[1].includes(kw)) return region;
    }
  }
  for (const [kw, region] of Object.entries(REGION_KW)) {
    if (name.includes(kw)) return region;
  }
  return null;
}

function inferByDestination(destination) {
  if (!destination) return null;
  for (const [kw, region] of Object.entries(REGION_KW)) {
    if (destination.includes(kw)) return region;
  }
  return null;
}

(async () => {
  const all = [];
  let offset = 0;
  while (true) {
    const { data } = await sb.from('travel_packages').select('id, title, destination, optional_tours').range(offset, offset + 999);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < 1000) break;
    offset += 1000;
  }
  console.log(`총 ${all.length}건 상품 스캔\n`);

  const diffs = [];
  for (const pkg of all) {
    if (!Array.isArray(pkg.optional_tours) || pkg.optional_tours.length === 0) continue;
    const destRegion = inferByDestination(pkg.destination);
    let mutated = false;
    const next = pkg.optional_tours.map(t => {
      if (!t.name || t.region) return t;
      const inferred = inferByName(t.name);
      if (inferred) {
        mutated = true;
        return { ...t, region: inferred };
      }
      // 모호 이름이면 destination region 사용
      if (AMBIGUOUS.some(kw => t.name.includes(kw)) && destRegion) {
        mutated = true;
        return { ...t, region: destRegion };
      }
      return t;
    });
    if (mutated) {
      diffs.push({ id: pkg.id, title: pkg.title, before: pkg.optional_tours, after: next });
    }
  }

  console.log(`변경 대상: ${diffs.length}건\n`);
  if (diffs.length === 0) { console.log('✅ 수정할 상품 없음'); return; }

  // dry-run diff JSON 덤프
  const dumpDir = path.join(__dirname, '..', 'scratch', 'migrations');
  fs.mkdirSync(dumpDir, { recursive: true });
  const dumpPath = path.join(dumpDir, `optional_tours_region_${Date.now()}.json`);
  fs.writeFileSync(dumpPath, JSON.stringify(diffs, null, 2));
  console.log(`변경 diff JSON 저장: ${dumpPath}\n`);

  // 샘플 출력
  console.log('샘플 3건:');
  for (const d of diffs.slice(0, 3)) {
    console.log(`  ${d.title}`);
    for (let i = 0; i < d.before.length; i++) {
      const b = d.before[i], a = d.after[i];
      if (JSON.stringify(b) !== JSON.stringify(a)) {
        console.log(`    - "${b.name}" : region ${JSON.stringify(b.region)} → ${JSON.stringify(a.region)}`);
      }
    }
  }

  if (!APPLY) {
    console.log('\n[DRY-RUN] --apply 로 실제 반영');
    return;
  }

  let ok = 0;
  for (const d of diffs) {
    const { error } = await sb.from('travel_packages').update({ optional_tours: d.after }).eq('id', d.id);
    if (error) console.error(`❌ ${d.title}:`, error.message);
    else ok++;
  }
  console.log(`\n✅ UPDATE ${ok}/${diffs.length}건 완료`);
})().catch(e => { console.error(e); process.exit(1); });
