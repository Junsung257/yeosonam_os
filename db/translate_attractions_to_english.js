#!/usr/bin/env node
/**
 * @file db/translate_attractions_to_english.js
 * @description 모든 attractions.name 을 Gemini 2.5 Flash 로 영어명 번역 → aliases[0] 에 저장.
 *
 * 배경: ERR-pexels-korean-search@2026-04-21 — 한글 쿼리는 Pexels 에서 generic travel 사진만 반환.
 *   영어 공식명을 aliases 에 넣으면 ① Pexels 매칭 품질 상승 ② attraction-matcher 의 aliases 룩업도 혜택.
 *
 * 로직:
 *   1. aliases 에 이미 영어명 있는 (첫 요소가 ASCII 80%+) 관광지는 skip
 *   2. 배치 30건씩 Gemini 에 JSON array 형식으로 요청
 *   3. 응답을 aliases 맨 앞에 push (기존 aliases 는 유지)
 *   4. 체크포인트 JSON 파일에 진행상황 기록 (재시작 가능)
 *
 * 사용:
 *   node db/translate_attractions_to_english.js              # dry-run (Gemini 호출만, DB UPDATE 안 함)
 *   node db/translate_attractions_to_english.js --insert     # 실제 aliases 업데이트
 *   node db/translate_attractions_to_english.js --limit=50   # 테스트 50건만
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

const BATCH_SIZE = 30;
const INTER_BATCH_DELAY_MS = 4000; // Gemini rate limit 안전 마진

const CHECKPOINT = path.resolve(__dirname, '..', 'scratch', 'translate_attractions_checkpoint.json');
function loadCheckpoint() {
  try { return JSON.parse(fs.readFileSync(CHECKPOINT, 'utf8')); } catch { return { processed: {} }; }
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

async function callGeminiBatch(batch, apiKey) {
  const prompt = `You are a translator for a Korean travel platform's attraction database.
For each attraction below, provide the official English name that would be used on Wikipedia, TripAdvisor, or Google Maps. This English name is used for Pexels image search — so prioritize names that will return accurate photos of that specific place or region.

Rules:
- Use the globally recognized English name when one exists (e.g., "왕소군묘" → "Wang Zhaojun Tomb", "춘쿤산" → "Chunkun Mountain").
- If no established English name exists, use romanization + region/country for disambiguation (e.g., "노산" → "Mount Lao Qingdao", "빈그랜드월드" → "Vinpearl Phu Quoc").
- For hotels/restaurants: use the brand's English name (e.g., "하이량프라자호텔" → "Hailiang Plaza Hotel Hohhot").
- For generic terms (e.g., "시내" "이동") return "SKIP".
- Include the country/region ONLY when it adds clarity for photo search.
- Output ONE line per input, same order, only the English name (no numbering, no explanation).

Input (format: name | region/country):
${batch.map((a, i) => `${i + 1}. ${a.name} | ${a.region || ''} ${a.country || ''}`.trim()).join('\n')}

Output (${batch.length} lines of English names):`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 2000 },
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini ${res.status}: ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  // 앞의 번호(1., 2.) 제거 + 결과 수가 다르면 맞춰 패딩
  const parsed = lines.map(l => l.replace(/^\d+\.\s*/, '').trim());
  while (parsed.length < batch.length) parsed.push('');
  return parsed.slice(0, batch.length);
}

async function main() {
  const args = process.argv.slice(2);
  const insert = args.includes('--insert');
  const limitArg = args.find(a => a.startsWith('--limit='));
  const limit = limitArg ? Number(limitArg.slice(8)) : null;
  const force = args.includes('--force'); // aliases 에 영어 있어도 다시 번역

  const env = loadEnv();
  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  if (!env.GEMINI_API_KEY) { console.error('❌ GEMINI_API_KEY 미설정'); process.exit(1); }

  // 전수 조회 (페이지네이션)
  let all = [];
  for (let from = 0; from < 10000; from += 1000) {
    const { data } = await sb.from('attractions').select('id, name, aliases, region, country').range(from, from + 999);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < 1000) break;
  }
  console.log(`\n📚 전체 attractions: ${all.length}건`);

  const cp = loadCheckpoint();
  const todo = all
    .filter(a => {
      if (cp.processed[a.id]) return false; // 체크포인트 건너뜀
      if (!force) {
        // 이미 영어명이 aliases 에 있으면 skip
        const aliases = Array.isArray(a.aliases) ? a.aliases : [];
        if (aliases.some(al => isLikelyEnglish(al))) return false;
      }
      return !!a.name && a.name.length >= 2;
    });
  console.log(`🎯 번역 대상: ${todo.length}건 (체크포인트 skip: ${Object.keys(cp.processed).length}건)`);

  const target = limit ? todo.slice(0, limit) : todo;
  console.log(`📦 이번 실행: ${target.length}건 (배치 ${BATCH_SIZE}건씩)\n`);

  let translated = 0;
  let updated = 0;
  let skipped = 0;
  const START = Date.now();

  for (let i = 0; i < target.length; i += BATCH_SIZE) {
    const batch = target.slice(i, i + BATCH_SIZE);
    const batchNo = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(target.length / BATCH_SIZE);
    const elapsed = Math.round((Date.now() - START) / 1000);
    process.stdout.write(`  [배치 ${batchNo}/${totalBatches}] ${batch.length}건 번역 중... (경과 ${elapsed}s) `);

    let names;
    try {
      names = await callGeminiBatch(batch, env.GEMINI_API_KEY);
      translated += batch.length;
      console.log('✅');
    } catch (err) {
      console.log(`❌ ${err.message.slice(0, 100)}`);
      // 실패 시 다음 배치로 skip (체크포인트에 기록 안 하면 다음 실행 시 재시도)
      await new Promise(r => setTimeout(r, INTER_BATCH_DELAY_MS * 2));
      continue;
    }

    // aliases 업데이트
    for (let j = 0; j < batch.length; j++) {
      const attr = batch[j];
      const newEn = names[j] && names[j] !== 'SKIP' ? names[j].trim() : null;
      if (!newEn) { skipped++; cp.processed[attr.id] = 'skip'; continue; }

      const existing = Array.isArray(attr.aliases) ? attr.aliases : [];
      // 이미 있는 영어 alias 제거 후 맨 앞에 새 영어명 배치
      const filtered = existing.filter(al => !isLikelyEnglish(al));
      const newAliases = [newEn, ...filtered];

      if (insert) {
        const { error } = await sb.from('attractions').update({ aliases: newAliases }).eq('id', attr.id);
        if (error) { console.log(`    ❌ ${attr.name}: ${error.message}`); continue; }
      }
      cp.processed[attr.id] = newEn;
      updated++;
      if (updated <= 20 || updated % 50 === 0) {
        console.log(`    ✓ "${attr.name}" → "${newEn}"`);
      }
    }
    saveCheckpoint(cp);

    if (i + BATCH_SIZE < target.length) await new Promise(r => setTimeout(r, INTER_BATCH_DELAY_MS));
  }

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`✅ 번역 완료: ${translated}건 / ${insert ? 'UPDATE' : 'DRY-RUN'} ${updated}건 / SKIP ${skipped}건`);
  console.log(`📁 체크포인트: ${CHECKPOINT}`);
  console.log(`⏱️  소요: ${Math.round((Date.now() - START) / 1000)}초\n`);
}

main().catch(err => { console.error('💥', err); process.exit(1); });
