/**
 * @file cleanup_unmatched_queue.js
 *
 * 미매칭 큐 (unmatched_activities) 자동 정리 스크립트.
 * 사장님 명시 위임 (2026-05-16) 으로 일괄 자동 처리.
 *
 * STRICT SSOT 정책 준수:
 *   - 자동 INSERT 는 (a) DB 매칭 score ≥ 90 alias 추가 또는 (b) Wikidata 정확 매칭
 *   - 명확히 attraction 아닌 것 (이동/수속/하선/일반어) → ignored 처리
 *   - 모호한 것 → pending 유지 (사장님 어드민 직접 검토)
 *
 * 단계:
 *   1. SQL pattern → 명확한 ignored (transit/lodging/garbage)
 *   2. 각 pending 항목 → /api/unmatched/suggest 호출
 *   3. DB 매칭 score ≥ 90 → /api/unmatched PATCH link_alias
 *   4. Wikidata QID 매칭 + 짧은 이름 → /api/unmatched PATCH register_from_wikidata
 *   5. 나머지 → pending 유지
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const API_BASE = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌ env 누락: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

// ─── Step 1: SQL pattern → 명확한 ignored ─────────────────────────────────
// 이동/도착/수속/하선/승선/집결/터미널 + 짧은 라인만 (긴 라인은 attraction 포함 가능)
const IGNORE_PATTERNS = [
  // 교통/이동
  /^[^\s]{2,6}\s*이동(\s|$)/,
  /^[^\s]{2,6}\s*도착(\s|$)/,
  /^[^\s]{2,8}\s*하선/,
  /^[^\s]{2,8}\s*승선/,
  /(?:출국|입국)\s*수속/,
  /국제여객터미널/,
  /국제공항/,
  /항\s*이동$/,
  /항\s*하선$/,
  /부두\s*도착/,
  /^[^\s]{2,8}\s*집결/,
  /훼리\s*승선/,
  /기내식/,
  /(?:으로|로)\s*이동\s*(?:\(.*\))?\s*$/,
  // 호텔/숙박/휴식
  /호텔로?\s*이동/,
  /^호텔\s*투숙/,
  /^호텔\s*휴식/,
  /^호텔\s*도착/,
  /^호텔\s*조식/,
  /휴식$/,
  // 특전/팁/쇼핑 N회
  /^\s*\[\s*특전\s*\]/,
  /^\s*특전\s*[\]\)]?/,
  /팁\s*별도/,
  /팁\s*포함/,
  /매너\s*팁/,
  /^쇼핑\s*\d+회/,
  // 시간/거리 단독
  /^\d+시간\d*분?\s*소요?$/,
  /^약?\s*\d+시간/,
  /^약?\s*\d+분/,
  /^전\s*일$/,
  // 인코딩 깨짐 (한글/영문 비율 < 30%)
];

function shouldIgnore(activity) {
  if (!activity) return true;
  const text = activity.replace(/^[▶•☆\-\s]+/, '').trim();
  if (text.length < 2) return true;
  // 인코딩 깨짐 검출
  const valid = (text.match(/[가-힣A-Za-z0-9]/g) ?? []).length;
  if (valid / text.length < 0.3) return true;
  // 패턴 매칭
  return IGNORE_PATTERNS.some(re => re.test(text));
}

async function step1_ignoreObvious() {
  console.log('\n=== Step 1: 명확한 ignored 처리 ===');
  const { data: pending } = await supabase
    .from('unmatched_activities')
    .select('id, activity')
    .eq('status', 'pending');
  if (!pending) return { ignored: 0, remaining: 0 };

  const toIgnore = pending.filter(p => shouldIgnore(p.activity));
  console.log(`  대상: ${toIgnore.length}/${pending.length}`);
  if (toIgnore.length === 0) return { ignored: 0, remaining: pending.length };

  // 100건씩 batch UPDATE
  const BATCH = 100;
  let done = 0;
  for (let i = 0; i < toIgnore.length; i += BATCH) {
    const ids = toIgnore.slice(i, i + BATCH).map(p => p.id);
    const { error } = await supabase
      .from('unmatched_activities')
      .update({
        status: 'ignored',
        resolved_at: new Date().toISOString(),
        resolved_kind: 'auto_pattern_ignore',
        resolved_by: 'cleanup_script',
      })
      .in('id', ids);
    if (error) console.warn('  batch UPDATE 실패:', error.message);
    else done += ids.length;
  }
  console.log(`  처리: ${done}건 ignored`);
  return { ignored: done, remaining: pending.length - done };
}

// ─── Step 2: /api/unmatched/suggest 호출 ─────────────────────────────────
async function callSuggest(unmatchedId) {
  const res = await fetch(`${API_BASE}/api/unmatched/suggest?id=${unmatchedId}`);
  if (!res.ok) return null;
  return res.json();
}

async function step2_autoResolve() {
  console.log('\n=== Step 2: 매칭 자동 해결 (score ≥ 90 alias / Wikidata) ===');
  const { data: pending } = await supabase
    .from('unmatched_activities')
    .select('id, activity, region, country')
    .eq('status', 'pending')
    .order('occurrence_count', { ascending: false, nullsLast: true });
  if (!pending) return { aliased: 0, registered: 0, untouched: 0 };

  let aliased = 0;
  let registered = 0;
  let untouched = 0;

  for (let i = 0; i < pending.length; i++) {
    const item = pending[i];
    if (i % 20 === 0) console.log(`  진행: ${i}/${pending.length}`);
    try {
      const sg = await callSuggest(item.id);
      if (!sg) { untouched++; continue; }

      const top = sg.suggestions?.[0];

      // 고신뢰 DB 매칭 (score ≥ 90) → alias 자동 추가
      if (top && top.score >= 90) {
        const r = await fetch(`${API_BASE}/api/unmatched`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: item.id, action: 'link_alias', attractionId: top.id }),
        });
        if (r.ok) {
          aliased++;
          continue;
        }
      }

      // Wikidata 정확 매칭 + 짧은 이름 (공백 ≤ 1개) → 신규 등록
      const wd = sg.wikidata;
      if (wd && wd.qid) {
        const koLabel = wd.labels?.ko ?? wd.labels?.en ?? '';
        const isShortClean = koLabel.length >= 2
          && koLabel.length <= 18
          && (koLabel.match(/\s/g) ?? []).length <= 2
          && /[가-힣]/.test(koLabel);
        if (isShortClean) {
          const r = await fetch(`${API_BASE}/api/unmatched`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: item.id, action: 'register_from_wikidata', wikidata: wd }),
          });
          if (r.ok) {
            registered++;
            continue;
          }
        }
      }

      untouched++;
    } catch (e) {
      console.warn(`  ${item.activity.slice(0, 30)}... 실패:`, e.message);
      untouched++;
    }
    // Rate limit 안전 (Wikidata 200ms / Pexels 200ms)
    await new Promise(r => setTimeout(r, 250));
  }

  console.log(`  alias 추가: ${aliased}건 / Wikidata 신규: ${registered}건 / 모호 (사장님 검토): ${untouched}건`);
  return { aliased, registered, untouched };
}

async function main() {
  const before = await supabase
    .from('unmatched_activities')
    .select('status', { count: 'exact', head: true })
    .eq('status', 'pending');
  console.log(`시작 시 pending: ${before.count}건`);

  const s1 = await step1_ignoreObvious();
  const s2 = await step2_autoResolve();

  const after = await supabase
    .from('unmatched_activities')
    .select('status', { count: 'exact', head: true })
    .eq('status', 'pending');

  console.log('\n=== 종합 ===');
  console.log(`  Step 1 ignored:        ${s1.ignored}건`);
  console.log(`  Step 2 alias 추가:     ${s2.aliased}건`);
  console.log(`  Step 2 Wikidata 신규:  ${s2.registered}건`);
  console.log(`  남은 pending (사장님): ${after.count}건`);
  console.log(`\n어드민 검토: ${API_BASE}/admin/attractions/unmatched`);
}

main().catch(e => {
  console.error('❌ 스크립트 실패:', e);
  process.exit(1);
});
