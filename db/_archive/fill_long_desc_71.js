/**
 * 71건 long_desc 누락 attraction 일괄 채움.
 * DeepSeek + Wikipedia 그라운딩 (있을 때만) + 사장님 톤 v2.
 */
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DS_KEY = process.env.DEEPSEEK_API_KEY;
if (!SB_URL || !SB_KEY || !DS_KEY) { console.error('env 누락'); process.exit(1); }
const sb = createClient(SB_URL, SB_KEY);

const SYS = `당신은 여소남 OS 의 한국 패키지 여행 attraction 카피 작성자입니다.

사장님 톤: 친근, 구체, 소통, 재미있게. 슬래시 나열 금지. 마케팅 과장 금지.

형식:
{
  "short_desc": "1-2줄 30-60자. 정보성 + 호기심 자극. '왜 가야 하는지' 한 마디. 마침표 1개.",
  "long_desc": "2-3문장 100-200자, 친근 한국어, 사실만"
}

attraction 의 정식 name 그대로 사용 (다른 표기로 변형 금지).
환각 금지: 외부 그라운딩 fact 가 있으면 그것만 활용. 없으면 일반적/보수적 안내.`;

async function fetchKoWiki(title) {
  try {
    const url = `https://ko.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}?redirect=true`;
    const r = await fetch(url, { headers: { 'User-Agent': 'YeosonamOS/1.0 admin@yeosonam.com' } });
    if (!r.ok) return null;
    const j = await r.json();
    if (j.type === 'disambiguation' || !j.extract) return null;
    return j.extract.slice(0, 500);
  } catch { return null; }
}

async function fetchEnWiki(title) {
  try {
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
    const r = await fetch(url, { headers: { 'User-Agent': 'YeosonamOS/1.0 admin@yeosonam.com' } });
    if (!r.ok) return null;
    const j = await r.json();
    if (j.type === 'disambiguation' || !j.extract) return null;
    return j.extract.slice(0, 500);
  } catch { return null; }
}

async function callDeepSeek(target, ground) {
  const userPrompt = `attraction: "${target.name}" (지역: ${target.region ?? ''} / 국가: ${target.country ?? ''} / 카테고리: ${target.badge_type ?? 'tour'})
${ground ? `Wikipedia 그라운딩 fact:\n${ground}\n` : '(외부 그라운딩 없음 — 보수적 안내)'}

JSON 객체만 응답. attraction 이름은 "${target.name}" 정확히 그대로 사용:`;

  const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${DS_KEY}` },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [{ role: 'system', content: SYS }, { role: 'user', content: userPrompt }],
      response_format: { type: 'json_object' },
      max_tokens: 600,
      temperature: 0.5,
    }),
  });
  if (!res.ok) return null;
  const json = await res.json();
  try { return JSON.parse(json.choices[0].message.content); } catch { return null; }
}

async function main() {
  const { data: targets } = await sb
    .from('attractions')
    .select('id, name, region, country, badge_type, short_desc, long_desc, is_manual_override')
    .eq('is_active', true)
    .not('category', 'eq', 'accommodation')
    .is('mrt_gid', null)
    .or('long_desc.is.null,long_desc.eq.')
    .eq('is_manual_override', false);

  if (!targets) { console.error('fetch 실패'); return; }
  console.log(`대상: ${targets.length}건`);

  let filled = 0, skipped = 0, failed = 0;
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    process.stdout.write(`[${i+1}/${targets.length}] ${t.name.slice(0,20)} ... `);

    // 한국어 alias 우선 (단순화: name 그대로)
    const ko = await fetchKoWiki(t.name);
    let en = null;
    if (!ko) en = await fetchEnWiki(t.name);
    const ground = ko ?? en;

    const result = await callDeepSeek(t, ground);
    if (!result) { console.log('LLM FAIL'); failed++; continue; }

    const newShort = (!t.short_desc || t.short_desc.trim() === '') && result.short_desc ? result.short_desc.trim() : t.short_desc;
    const newLong = result.long_desc?.trim() ?? null;
    if (!newLong) { console.log('no long_desc'); failed++; continue; }

    const { error } = await sb
      .from('attractions')
      .update({
        short_desc: newShort,
        long_desc: newLong,
        source: ground ? 'wikipedia+llm' : 'llm',
        confidence_score: ground ? 0.75 : 0.55,
        updated_at: new Date().toISOString(),
      })
      .eq('id', t.id)
      .eq('is_manual_override', false);  // race condition 가드
    if (error) { console.log('UPDATE FAIL:', error.message); failed++; continue; }
    filled++;
    console.log(`OK (${ground ? 'Wikipedia 그라운딩' : 'LLM 단독'})`);
    await new Promise(r => setTimeout(r, 250));
  }

  console.log(`\n=== 종합 ===`);
  console.log(`  채움: ${filled}건 / 스킵: ${skipped}건 / 실패: ${failed}건`);
}

main().catch(e => console.error(e.message));
