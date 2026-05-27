/**
 * @file normalize_departure_days.js
 * @description departure_days 필드의 JSON 배열 문자열을 평문으로 일괄 정규화
 *
 * 대상 버그: ERR-KUL-01 (A4 포스터에 `["금"]` JSON 누출)
 *
 * 사용법:
 *   node db/normalize_departure_days.js            # dry-run
 *   node db/normalize_departure_days.js --apply    # 실제 UPDATE
 */

const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const fs = require('fs');

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

function normalize(val) {
  if (val == null) return null;
  if (Array.isArray(val)) return val.map(v => String(v).trim()).filter(Boolean).join('/');
  const s = String(val).trim();
  if (!s) return null;
  if (s.startsWith('[') && s.endsWith(']')) {
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) return parsed.map(v => String(v).trim()).filter(Boolean).join('/');
    } catch {}
  }
  return s;
}

async function main() {
  console.log(`🔍 ${APPLY ? '[APPLY]' : '[DRY-RUN]'} departure_days 정규화\n`);

  const { data: pkgs, error } = await supabase
    .from('travel_packages')
    .select('id, title, departure_days')
    .not('departure_days', 'is', null);
  if (error) { console.error(error); process.exit(1); }

  const needsUpdate = [];
  for (const pkg of pkgs) {
    const normalized = normalize(pkg.departure_days);
    if (normalized !== pkg.departure_days) {
      needsUpdate.push({ ...pkg, normalized });
    }
  }

  if (!needsUpdate.length) {
    console.log('✅ 모든 상품이 이미 정규화됨.');
    return;
  }

  console.log(`대상 ${needsUpdate.length}건 발견:\n`);
  for (const pkg of needsUpdate) {
    console.log(`  ${pkg.title}`);
    console.log(`    before: ${JSON.stringify(pkg.departure_days)}`);
    console.log(`    after:  "${pkg.normalized}"`);
  }

  if (!APPLY) {
    console.log('\n[DRY-RUN] --apply 플래그로 실제 반영.');
    return;
  }

  let ok = 0;
  for (const pkg of needsUpdate) {
    const { error: uErr } = await supabase
      .from('travel_packages')
      .update({ departure_days: pkg.normalized })
      .eq('id', pkg.id);
    if (uErr) console.error(`  ❌ ${pkg.title}:`, uErr);
    else ok++;
  }
  console.log(`\n✅ UPDATE ${ok}/${needsUpdate.length}건 완료`);
}

main().catch(err => { console.error(err); process.exit(1); });
