#!/usr/bin/env node
/**
 * @file db/rematch_pexels_photos.js
 * @description 모든 attractions 의 사진을 영어 alias 우선으로 Pexels 재검색 → photos 덮어쓰기.
 *
 * 전제: db/translate_attractions_to_english.js 가 먼저 실행되어 aliases[0] 에 영어명이 있어야 최적.
 *   없으면 기존 한글 name fallback (품질 저하).
 *
 * Rate limit:
 *   Pexels Free = 200 req/hour = 18초/req. 1175건 ≈ 5.9시간.
 *   Tier 가 다르면 --delay=N (초) 로 조정 가능.
 *
 * 체크포인트로 중단·재개 가능. 재실행 시 이미 처리된 건 skip.
 *
 * 사용:
 *   node db/rematch_pexels_photos.js                    # dry-run (호출만, DB UPDATE 안 함)
 *   node db/rematch_pexels_photos.js --insert           # 실제 업데이트
 *   node db/rematch_pexels_photos.js --insert --limit=50 --delay=18
 *   node db/rematch_pexels_photos.js --insert --only-missing   # 사진 0건만 (미매칭)
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

const DEFAULT_DELAY_S = 18;   // 200/hour free tier
const PER_PAGE = 5;

const CHECKPOINT = path.resolve(__dirname, '..', 'scratch', 'rematch_pexels_checkpoint.json');
function loadCheckpoint() {
  try { return JSON.parse(fs.readFileSync(CHECKPOINT, 'utf8')); } catch { return { processed: {}, startedAt: null }; }
}
function saveCheckpoint(cp) {
  fs.mkdirSync(path.dirname(CHECKPOINT), { recursive: true });
  fs.writeFileSync(CHECKPOINT, JSON.stringify(cp, null, 2));
}

function isLikelyEnglish(s) {
  if (!s || typeof s !== 'string') return false;
  const ascii = s.replace(/[^\x20-\x7E]/g, '');
  return ascii.length / s.length > 0.8 && s.length >= 2;
}

function buildKeyword(attr) {
  const aliases = Array.isArray(attr.aliases) ? attr.aliases : [];
  const english = aliases.find(isLikelyEnglish);
  if (english) return english;
  // fallback — 한글명 + 지역 + travel (기존 동작)
  return `${attr.name} ${attr.region || attr.country || ''} travel`.trim();
}

async function searchPexels(keyword, apiKey) {
  const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(keyword)}&per_page=${PER_PAGE}&orientation=landscape`;
  const res = await fetch(url, { headers: { Authorization: apiKey } });
  if (res.status === 429) throw new Error('RATE_LIMIT');
  if (!res.ok) throw new Error(`Pexels ${res.status}`);
  const data = await res.json();
  return (data.photos || []).map(p => ({
    pexels_id: p.id,
    src_medium: p.src.medium,
    src_large: p.src.large2x,
    photographer: p.photographer,
    alt: p.alt,
  }));
}

async function main() {
  const args = process.argv.slice(2);
  const insert = args.includes('--insert');
  const onlyMissing = args.includes('--only-missing');
  const limitArg = args.find(a => a.startsWith('--limit='));
  const limit = limitArg ? Number(limitArg.slice(8)) : null;
  const delayArg = args.find(a => a.startsWith('--delay='));
  const delayMs = (delayArg ? Number(delayArg.slice(8)) : DEFAULT_DELAY_S) * 1000;

  const env = loadEnv();
  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  if (!env.PEXELS_API_KEY) { console.error('❌ PEXELS_API_KEY 미설정'); process.exit(1); }

  // 전수 조회 (페이지네이션)
  let all = [];
  for (let from = 0; from < 10000; from += 1000) {
    const { data } = await sb.from('attractions').select('id, name, aliases, region, country, photos').range(from, from + 999);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < 1000) break;
  }
  console.log(`\n📚 전체 attractions: ${all.length}건`);

  const cp = loadCheckpoint();
  if (!cp.startedAt) cp.startedAt = new Date().toISOString();

  let target = all.filter(a => !cp.processed[a.id]);
  if (onlyMissing) target = target.filter(a => !Array.isArray(a.photos) || a.photos.length === 0);
  if (limit) target = target.slice(0, limit);

  const withEng = target.filter(a => (a.aliases || []).some(isLikelyEnglish)).length;
  console.log(`🎯 재매칭 대상: ${target.length}건 (영어 alias 보유 ${withEng}건 · fallback ${target.length - withEng}건)`);
  console.log(`⏱️  딜레이 ${delayMs / 1000}초/건, 예상 소요 ${Math.round(target.length * delayMs / 60000)}분\n`);

  let updated = 0;
  let matched = 0;
  let errors = 0;
  const START = Date.now();

  for (let i = 0; i < target.length; i++) {
    const a = target[i];
    const keyword = buildKeyword(a);
    const no = i + 1;

    try {
      const photos = await searchPexels(keyword, env.PEXELS_API_KEY);
      matched += photos.length > 0 ? 1 : 0;

      if (insert && photos.length > 0) {
        const { error } = await sb.from('attractions').update({ photos: photos.slice(0, 5) }).eq('id', a.id);
        if (error) { console.log(`    ❌ ${a.name}: ${error.message}`); errors++; continue; }
      }
      cp.processed[a.id] = { keyword, count: photos.length, at: new Date().toISOString() };
      updated++;
      const elapsed = Math.round((Date.now() - START) / 1000);
      const remaining = Math.round((target.length - no) * delayMs / 1000);
      console.log(`  [${no}/${target.length}] "${a.name}" → "${keyword.slice(0, 40)}..." → ${photos.length}건 (elapsed ${elapsed}s, ETA ${remaining}s)`);
    } catch (err) {
      errors++;
      if (err.message === 'RATE_LIMIT') {
        console.log(`  ⚠️  [${no}] RATE LIMIT — 1시간 대기 후 재개`);
        saveCheckpoint(cp);
        await new Promise(r => setTimeout(r, 60 * 60 * 1000));
      } else {
        console.log(`  ❌ [${no}] "${a.name}": ${err.message}`);
      }
    }

    // 매 10건마다 체크포인트 저장
    if (no % 10 === 0) saveCheckpoint(cp);

    // Rate limit 준수
    if (i + 1 < target.length) await new Promise(r => setTimeout(r, delayMs));
  }

  saveCheckpoint(cp);
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`✅ 재매칭 완료: ${updated}건 / 매칭 성공 ${matched}건 / 에러 ${errors}건`);
  console.log(`📁 체크포인트: ${CHECKPOINT}`);
  console.log(`⏱️  소요: ${Math.round((Date.now() - START) / 60000)}분\n`);
}

main().catch(err => { console.error('💥', err); process.exit(1); });
