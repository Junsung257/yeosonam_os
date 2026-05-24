/**
 * 미매칭 290건 일괄 해결 스크립트 (v2 — 외부 POI 검색 통합)
 *
 * 2단계 매칭 (전부 무료):
 *   1) 내부 attractions 매칭 (score >= MIN_SCORE) → alias 적립 + resolved
 *   2) 내부 실패 → Wikidata API 검색 → note 저장 (해외 관광지)
 *
 * STRICT SSOT: 자동 INSERT 절대 금지. 외부 POI는 note에 JSON 로그만 저장.
 * 어드민 UI에서 note를 읽어 1-click 등록 지원.
 *
 * 실행:
 *   $env:DRY_RUN='1'; $env:MIN_SCORE='60'; node db/batch_resolve_unmatched.js
 *   $env:DRY_RUN='0'; $env:MIN_SCORE='60'; node db/batch_resolve_unmatched.js
 */
const fs = require('fs');
const path = require('path');
const envFile = fs.readFileSync(path.resolve(__dirname, '..', '.env.local'), 'utf-8');
const env = {};
envFile.split('\n').forEach(l => { const [k, ...v] = l.split('='); if (k) env[k.trim()] = v.join('=').trim(); });
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const DRY_RUN = process.env.DRY_RUN === '1';
const MIN_SCORE = parseFloat(process.env.MIN_SCORE || '60');
const EXTERNAL_POI_ENABLED = process.env.EXTERNAL_POI !== 'false';

// ─── 내부 매칭 함수 ──────────────────────────────────────────────
function cleanActivity(text) {
  return text
    .replace(/^[▶☆※♣♠♥♦*]+\s*/, '')
    .replace(/[(\[].*?[)\]]/g, ' ')
    .replace(/[·,.\-+/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}
function tokenize(text) {
  return new Set(text.split(/\s+/).filter(t => t.length >= 2));
}
function commonPrefixLen(a, b) {
  let i = 0;
  const min = Math.min(a.length, b.length);
  while (i < min && a[i] === b[i]) i++;
  return i;
}
function scoreCandidate(activityClean, activityTokens, attr) {
  const candidates = [
    { term: attr.name, isAlias: false },
    ...((attr.aliases || []).map(a => ({ term: a, isAlias: true }))),
  ];
  let best = null;
  for (const { term, isAlias } of candidates) {
    if (!term || term.length < 2) continue;
    const termClean = term.toLowerCase().trim();
    const aliasBonus = isAlias ? 10 : 0;
    if (activityClean.includes(termClean) || termClean.includes(activityClean)) {
      const score = 100 + aliasBonus;
      if (!best || score > best.score) best = { score, matched_via: isAlias ? 'alias' : 'exact', matched_term: term };
      continue;
    }
    const termTokens = tokenize(termClean);
    if (activityTokens.size > 0 && termTokens.size > 0) {
      let intersect = 0;
      for (const t of activityTokens) if (termTokens.has(t)) intersect++;
      const union = activityTokens.size + termTokens.size - intersect;
      const jaccard = union > 0 ? intersect / union : 0;
      if (jaccard >= 0.4) {
        const score = jaccard * 70 + aliasBonus;
        if (!best || score > best.score) best = { score, matched_via: isAlias ? 'alias' : 'jaccard', matched_term: term };
      }
    }
    const lcs = commonPrefixLen(activityClean, termClean);
    if (lcs >= 2) {
      const ratio = lcs / Math.min(activityClean.length, termClean.length);
      if (ratio >= 0.5) {
        const score = ratio * 50 + aliasBonus;
        if (!best || score > best.score) best = { score, matched_via: isAlias ? 'alias' : 'lcs', matched_term: term };
      }
    }
  }
  return best;
}
function suggestAttractions(activity, candidates, minScore, limit = 3) {
  const activityClean = cleanActivity(activity);
  const activityTokens = tokenize(activityClean);
  const suggestions = [];
  for (const attr of candidates) {
    const sc = scoreCandidate(activityClean, activityTokens, attr);
    if (sc && sc.score >= minScore) suggestions.push({ ...attr, ...sc });
  }
  suggestions.sort((a, b) => b.score - a.score);
  return suggestions.slice(0, limit);
}

// ─── 외부 POI 검색 (Wikidata — 전 세계 커버리지) ───────────────────
const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';
const UA = 'YeosonamOS/1.0 (https://yeosonam.com; admin@yeosonam.com) batch-resolve';

async function searchWikidata(keyword) {
  if (!keyword || keyword.trim().length < 2) return null;
  // 한국어 우선 검색, 실패 시 영어
  const searchUrl = (lang) => `${WIKIDATA_API}?action=wbsearchentities&search=${encodeURIComponent(keyword)}&language=${lang}&format=json&limit=1&type=item`;

  let qid = null, labelKo = null, labelEn = null, description = null;
  try {
    const rKo = await fetch(searchUrl('ko'), { headers: { 'User-Agent': UA } });
    if (rKo.ok) {
      const j = await rKo.json();
      if (j.search?.[0]) { qid = j.search[0].id; labelKo = j.search[0].label; description = j.search[0].description || null; }
    }
    if (!qid) {
      const rEn = await fetch(searchUrl('en'), { headers: { 'User-Agent': UA } });
      if (rEn.ok) {
        const j = await rEn.json();
        if (j.search?.[0]) { qid = j.search[0].id; labelEn = j.search[0].label; description = j.search[0].description || null; }
      }
    }
    if (!qid) return null;

    // 이미지 조회 (선택)
    const rd = await fetch(`${WIKIDATA_API}?action=wbgetentities&ids=${qid}&props=claims&format=json`, { headers: { 'User-Agent': UA } });
    let imageThumbUrl = null;
    if (rd.ok) {
      const d = await rd.json();
      const fn = d.entities?.[qid]?.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
      if (fn) imageThumbUrl = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(fn)}?width=400`;
    }
    return { source: 'wikidata', qid, label_ko: labelKo, label_en: labelEn, description, image_thumb_url: imageThumbUrl };
  } catch { return null; }
}

function externalPOIToNote(result, searchedAt) {
  return JSON.stringify({
    searched_at: searchedAt, source: 'wikidata', confidence: 70,
    qid: result.qid, label_ko: result.label_ko, label_en: result.label_en,
    description: result.description, image_thumb_url: result.image_thumb_url,
  });
}

// ─── 배치 실행 ──────────────────────────────────────────────────
async function main() {
  console.log(`━━━ 미매칭 일괄 해결 v2 ━━━${DRY_RUN ? ' [DRY-RUN]' : ''}`);
  console.log(`minScore: ${MIN_SCORE}, 외부POI: ${EXTERNAL_POI_ENABLED}\n`);

  // 1) 미해결 unmatched fetch
  const { data: unmatched, error: e1 } = await sb.from('unmatched_activities')
    .select('id, activity, region, country, occurrence_count, note')
    .is('resolved_at', null)
    .order('occurrence_count', { ascending: false });
  if (e1) throw e1;
  console.log(`📥 미해결 unmatched: ${unmatched.length}건\n`);

  // 2) attractions 전수 fetch
  const attractions = [];
  let offset = 0;
  const PAGE = 1000;
  while (true) {
    const { data: page, error } = await sb.from('attractions')
      .select('id, name, aliases, region, country, category, emoji, short_desc')
      .eq('is_active', true)
      .order('id')
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    if (!page || page.length === 0) break;
    attractions.push(...page);
    if (page.length < PAGE) break;
    offset += PAGE;
  }
  console.log(`📚 attractions 후보: ${attractions.length}개\n`);

  // 3) location 기반 후보 좁힘
  const candidatesByLocation = new Map();
  function getCandidates(u) {
    const loc = (u.region || u.country || '').toLowerCase();
    if (!loc) return attractions;
    if (candidatesByLocation.has(loc)) return candidatesByLocation.get(loc);
    const filtered = attractions.filter(a => {
      const arN = (a.region || '').toLowerCase();
      const acN = (a.country || '').toLowerCase();
      return (arN && (loc.includes(arN) || arN.includes(loc))) ||
             (acN && (loc.includes(acN) || acN.includes(loc)));
    });
    const result = filtered.length >= 5 ? filtered : attractions;
    candidatesByLocation.set(loc, result);
    return result;
  }

  // 4) 2단계 매칭 실행
  const result = {
    matched: [],       // 내부 DB 매칭 성공
    wikidataFound: [], // Wikidata POI 발견 (note 저장)
    stillUnmatched: [],// 완전 미매칭
  };
  const now = new Date().toISOString();
  let progressInterval = 0;

  for (const [idx, u] of unmatched.entries()) {
    // Progress
    const pct = ((idx + 1) / unmatched.length * 100).toFixed(1);
    if (idx % 10 === 0) process.stdout.write(`\r   진행: ${idx + 1}/${unmatched.length} (${pct}%)   `);

    const cands = getCandidates(u);
    const suggestions = suggestAttractions(u.activity, cands, MIN_SCORE, 1);

    if (suggestions.length > 0) {
      // 1단계: 내부 매칭 성공
      result.matched.push({ u, top: suggestions[0] });
    } else if (EXTERNAL_POI_ENABLED) {
      const cleaned = cleanActivity(u.activity);
      if (cleaned && cleaned.length >= 3) {
        // 2단계: Wikidata API 검색 (해외 관광지 커버리지 우수)
        const wd = await searchWikidata(cleaned);
        if (wd && (wd.label_ko || wd.label_en)) {
          result.wikidataFound.push({ u, wd });
        } else {
          result.stillUnmatched.push(u);
        }
        // Wikidata rate limit 방어
        await new Promise(r => setTimeout(r, 60));
      } else {
        result.stillUnmatched.push(u);
      }
    } else {
      result.stillUnmatched.push(u);
    }
  }
  process.stdout.write(`\r   진행: ${unmatched.length}/${unmatched.length} (100%)   \n\n`);

  // 5) 결과 출력
  console.log(`✅ 내부 DB 매칭 성공: ${result.matched.length}건`);
  console.log(`🔍 Wikidata POI 발견: ${result.wikidataFound.length}건`);
  console.log(`⏸️  완전 미매칭: ${result.stillUnmatched.length}건\n`);

  if (result.matched.length > 0) {
    console.log('━ 내부 매칭 성공 ━');
    result.matched.slice(0, 40).forEach(({ u, top }) =>
      console.log(`  [${u.occurrence_count || 1}회] "${u.activity.slice(0, 50)}" → ${top.name} (score:${top.score})`));
    if (result.matched.length > 40) console.log(`  ... 외 ${result.matched.length - 40}건`);
  }
  if (result.wikidataFound.length > 0) {
    console.log('\n━ Wikidata POI (어드민 검토) ━');
    result.wikidataFound.slice(0, 20).forEach(({ u, wd }) =>
      console.log(`  [${u.occurrence_count || 1}회] "${u.activity.slice(0, 50)}" → WD: ${wd.label_ko} (${wd.qid})`));
    if (result.wikidataFound.length > 20) console.log(`  ... 외 ${result.wikidataFound.length - 20}건`);
  }

  // 6) DB UPDATE
  if (!DRY_RUN) {
    let updateCount = 0;
    let dismissCount = 0;

    // 6a) 내부 매칭 → alias 적립 + resolved
    for (const { u, top } of result.matched) {
      const { data: target } = await sb.from('attractions').select('id, aliases').eq('id', top.id).single();
      if (target) {
        const aliases = (target.aliases || []);
        if (!aliases.includes(u.activity)) {
          await sb.from('attractions').update({ aliases: [...aliases, u.activity] }).eq('id', top.id);
        }
      }
      const { error: updErr } = await sb.from('unmatched_activities').update({
        status: 'added', resolved_at: now, resolved_kind: 'auto_cron_high_confidence',
        resolved_attraction_id: top.id, resolved_by: 'batch_resolve_unmatched',
      }).eq('id', u.id);
      if (!updErr) updateCount++;
    }

    // 6b) Wikidata 후보 → note 저장
    for (const { u, wd } of result.wikidataFound) {
      const existingNote = u.note || '';
      const noteJson = externalPOIToNote(wd, now);
      const newNote = existingNote ? `${existingNote}\n[WIKIDATA] ${noteJson}` : `[WIKIDATA] ${noteJson}`;
      await sb.from('unmatched_activities').update({ note: newNote }).eq('id', u.id);
    }

    // 6c) 일반 활동 설명/관광지 아닌 항목 → dismissed 일괄 처리
    for (const u of result.stillUnmatched) {
      const { error: dismissErr } = await sb.from('unmatched_activities').update({
        status: 'dismissed',
        note: u.note ? `${u.note}\n[dismissed] 활동 설명/서비스 멘트 — 관광지 아님` : '[dismissed] 활동 설명/서비스 멘트 — 관광지 아님',
      }).eq('id', u.id);
      if (!dismissErr) dismissCount++;
    }

    console.log(`\n💾 DB 업데이트 완료: ${updateCount}건 매칭 해결`);
    console.log(`   Wikidata 후보 적립: ${result.wikidataFound.length}건`);
    console.log(`   ⏸️  dismissed (관광지 아님): ${dismissCount}건`);
  } else {
    console.log('\nℹ️  DRY_RUN — 실제 DB 변경 없음');
  }

  // 7) 요약
  console.log('\n━━━ 요약 ━━━');
  console.log(`처리 전: ${unmatched.length}건`);
  console.log(`✅ 자동 해결 (내부 DB): ${result.matched.length}건`);
  console.log(`🔍 Wikidata POI 발견 (어드민 검토 필요): ${result.wikidataFound.length}건`);
  console.log(`⏸️  dismissed (관광지 아님): ${result.stillUnmatched.length}건`);
}

main().catch(err => { console.error('\n❌', err); process.exit(1); });
