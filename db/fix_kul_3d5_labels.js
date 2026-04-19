/**
 * 3박5일 쿠알라 optional_tours의 "2층버스", "스카이 파크"에 "(싱가포르)" 라벨 보정.
 * 이미 "리버보트 (싱가포르)"는 라벨 있음 — 데이터 불일치 보정.
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

const FIX_MAP = {
  '2층버스': '2층버스 (싱가포르)',
  '스카이 파크': '스카이 파크 (싱가포르)',
};

(async () => {
  const { data: pkgs } = await sb
    .from('travel_packages')
    .select('id, title, duration, optional_tours')
    .ilike('destination', '%쿠알라%')
    .eq('duration', 5);
  if (!pkgs?.length) { console.log('3박5일 상품 없음'); return; }

  for (const pkg of pkgs) {
    console.log(`\n──── ${pkg.title} ────`);
    let mutated = false;
    const next = (pkg.optional_tours || []).map((t) => {
      if (t.name in FIX_MAP) {
        console.log(`  ✂️  "${t.name}" → "${FIX_MAP[t.name]}" + region: "싱가포르"`);
        mutated = true;
        return { ...t, name: FIX_MAP[t.name], region: '싱가포르' };
      }
      return t;
    });
    if (!mutated) { console.log('  변경 없음'); continue; }
    if (!APPLY) { console.log('  [DRY-RUN]'); continue; }
    const { error } = await sb.from('travel_packages').update({ optional_tours: next }).eq('id', pkg.id);
    if (error) console.error('  ❌', error.message);
    else console.log('  ✅ UPDATE 완료');
  }
})().catch(e => { console.error(e); process.exit(1); });
