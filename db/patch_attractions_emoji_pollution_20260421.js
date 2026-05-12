#!/usr/bin/env node
/**
 * @file db/patch_attractions_emoji_pollution_20260421.js
 * @description ERR-attractions-emoji-label-merged@2026-04-21 즉시 조치.
 *   CSV 업로드 시 emoji 컬럼에 "📍 관광" / "💎 선택관광" / "🛍️ 쇼핑" / "⛳ 골프" 같은
 *   이모지+label 복합값이 그대로 저장됨 (142건). UI 가 `{emoji} {name}` 렌더라서
 *   "📍 관광 노산" 처럼 name 앞에 badge label 이 자연스럽게 붙어 보였음.
 *
 * 사용:
 *   node db/patch_attractions_emoji_pollution_20260421.js           # dry-run
 *   node db/patch_attractions_emoji_pollution_20260421.js --insert  # 실제 UPDATE
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

function loadEnv() {
  const envFile = fs.readFileSync(path.resolve(__dirname, '..', '.env.local'), 'utf-8');
  const env = {};
  envFile.split('\n').forEach(l => { const [k, ...v] = l.split('='); if (k) env[k.trim()] = v.join('=').trim(); });
  return env;
}

function sanitizeEmoji(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s) return null;
  // 공백을 만나면 그 앞까지만 (이모지 앞부분)
  const idx = s.search(/\s/);
  if (idx === -1) return s;
  return s.slice(0, idx);
}

async function main() {
  const insert = process.argv.includes('--insert');
  const env = loadEnv();
  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  // 전수 조회 (페이지네이션 1000건 단위)
  let all = [];
  for (let from = 0; from < 10000; from += 1000) {
    const { data } = await sb.from('attractions').select('id, name, emoji, badge_type').range(from, from + 999);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < 1000) break;
  }

  // 오염된 것만 추출 (emoji 에 공백 포함 + sanitize 결과가 원본과 다름)
  const polluted = [];
  for (const a of all) {
    if (typeof a.emoji !== 'string' || !/\s/.test(a.emoji)) continue;
    const clean = sanitizeEmoji(a.emoji);
    if (clean !== a.emoji) polluted.push({ id: a.id, name: a.name, oldEmoji: a.emoji, newEmoji: clean, badge_type: a.badge_type });
  }

  console.log(`\n📊 오염 감지: ${polluted.length}건 / 전체 ${all.length}건`);

  // 패턴별 집계
  const byOld = {};
  polluted.forEach(p => { byOld[p.oldEmoji] = (byOld[p.oldEmoji] || 0) + 1; });
  console.log('\n🔖 패턴별 count:');
  Object.entries(byOld).sort((a,b)=>b[1]-a[1]).forEach(([k, c]) => console.log(`  "${k}" → "${sanitizeEmoji(k)}" : ${c}건`));

  if (!insert) {
    console.log('\n💡 dry-run 종료. 실제 UPDATE 는 --insert 플래그 필요.');
    return;
  }

  // 실제 UPDATE (배치로 50건씩)
  let updated = 0;
  for (const p of polluted) {
    const { error } = await sb
      .from('attractions')
      .update({ emoji: p.newEmoji })
      .eq('id', p.id);
    if (error) console.log(`  ❌ ${p.name}: ${error.message}`);
    else updated++;
  }
  console.log(`\n✅ UPDATE 완료: ${updated} / ${polluted.length}`);
}

main().catch(err => { console.error('💥', err); process.exit(1); });
