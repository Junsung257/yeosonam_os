/**
 * 보홀 슬림팩 2상품 — 공유 raw_text·display_title 오염 수리
 * 실행: node db/fix_bohol_slimpack_raw_sections.js
 */
const fs = require('fs');
const { createHash } = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const envFile = fs.readFileSync('.env.local', 'utf-8');
const env = {};
for (const line of envFile.split('\n')) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const eq = t.indexOf('=');
  if (eq < 0) continue;
  const k = t.slice(0, eq).trim();
  let v = t.slice(eq + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  }
  env[k] = v;
}
const sb = createClient(env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

function collectPkgBlockStarts(raw) {
  const text = raw.replace(/\r\n/g, '\n');
  const starts = [];
  const re = /(?:^|\n)(PKG\s*\n[^\n]{4,100}\d+박\s*\d+일[^\n]{0,40})/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const g1 = m[1];
    const offsetInFull = m[0].indexOf(g1[0]);
    starts.push(m.index + offsetInFull);
  }
  return [...new Set(starts)].sort((a, b) => a - b);
}

function extractProductRawTextSection(fullRaw, productTitle, productIndex, totalProducts) {
  if (!fullRaw || totalProducts <= 1) return fullRaw;
  const text = fullRaw.replace(/\r\n/g, '\n');
  const idx = Math.max(0, Math.min(productIndex, totalProducts - 1));

  const pkgStarts = collectPkgBlockStarts(text);
  if (pkgStarts.length >= totalProducts && pkgStarts.length >= 2) {
    const start = pkgStarts[idx] ?? pkgStarts[pkgStarts.length - 1];
    const end = idx + 1 < pkgStarts.length ? pkgStarts[idx + 1] : text.length;
    return text.slice(start, end).trim();
  }

  const title = (productTitle ?? '').trim();
  if (title.length >= 4) {
    const positions = [];
    let from = 0;
    while (from < text.length) {
      const pos = text.indexOf(title, from);
      if (pos < 0) break;
      positions.push(pos);
      from = pos + title.length;
    }
    if (positions.length >= totalProducts) {
      const start = positions[idx] ?? positions[positions.length - 1];
      const nextStart = idx + 1 < positions.length ? positions[idx + 1] : text.length;
      return text.slice(start, nextStart).trim();
    }
  }

  return fullRaw;
}

function rawDayMax(raw) {
  const nums = [...raw.matchAll(/제\s*(\d+)\s*일/g)].map(m => parseInt(m[1], 10));
  return nums.length ? Math.max(...nums) : 0;
}

(async () => {
  const codes = ['PUS-ETC-BOH-05-0001', 'PUS-ETC-BOH-06-0001'];
  const { data: pkgs, error } = await sb
    .from('travel_packages')
    .select('id, internal_code, title, raw_text, display_title, itinerary_data')
    .in('internal_code', codes);

  if (error) {
    console.error('조회 실패:', error.message);
    process.exit(1);
  }
  if (!pkgs || pkgs.length < 2) {
    console.error('대상 상품 2건 미발견:', pkgs?.length ?? 0);
    process.exit(1);
  }

  const sorted = [...pkgs].sort((a, b) => a.internal_code.localeCompare(b.internal_code));
  const fullRaw = sorted[0].raw_text || sorted[1].raw_text;
  if (!fullRaw || fullRaw.length < 100) {
    console.error('raw_text 없음');
    process.exit(1);
  }

  for (let i = 0; i < sorted.length; i++) {
    const pkg = sorted[i];
    const section = extractProductRawTextSection(fullRaw, pkg.title, i, sorted.length);
    const hash = createHash('sha256').update(section).digest('hex');
    const dbDays = Array.isArray(pkg.itinerary_data?.days) ? pkg.itinerary_data.days.length : 0;
    const displayTitle = (pkg.title || '').trim().slice(0, 40);

    console.log(`\n${pkg.internal_code} — ${pkg.title}`);
    console.log(`  raw: ${(pkg.raw_text || '').length} → ${section.length} chars`);
    console.log(`  C1: 원문 max ${rawDayMax(section)}일 vs DB ${dbDays}일`);
    console.log(`  display_title: "${pkg.display_title}" → "${displayTitle}"`);

    const { error: uErr } = await sb
      .from('travel_packages')
      .update({
        raw_text: section,
        raw_text_hash: hash,
        display_title: displayTitle,
      })
      .eq('id', pkg.id);

    if (uErr) {
      console.error('  ✗ 업데이트 실패:', uErr.message);
      process.exit(1);
    }
    console.log('  ✓ 업데이트 완료');
  }

  console.log('\n완료 — admin/packages 에서 원문 대조를 다시 확인하세요.');
})();
