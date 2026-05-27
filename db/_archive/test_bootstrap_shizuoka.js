/**
 * 시즈오카 21건 미매칭 → bootstrapNewRegionAsync 수동 호출 테스트.
 * production 매칭 API 안 쓰고 inline DeepSeek + supabase 로 동작 검증.
 */
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DS_KEY = process.env.DEEPSEEK_API_KEY;
if (!SB_URL || !SB_KEY || !DS_KEY) { console.error('env 누락'); process.exit(1); }
const sb = createClient(SB_URL, SB_KEY);

const SYS = `당신은 여소남 OS 의 한국 패키지 여행 attraction 카드 분해 도우미입니다.

미매칭 큐의 활동 라인 배열을 받으면, 진짜 관광지(POI)만 골라 카드로 분해합니다.

규칙:
1. 진짜 관광지만 추출. 호텔/식당/투어상품/공항픽업/wifi/eSIM/쇼핑센터/식사/이동/도착/면세점 제외.
2. verbatim 서술 라인이면 그 안의 캐노니컬 명사만 추출.
3. short_desc: 30-60자 정보성+호기심+친근 톤. 슬래시 나열 금지. 마침표 1개.
4. long_desc: 2-3문장 100-200자. 친근 한국어. 사실만.
5. badge_type: tour | special | shopping | meal | optional | hotel | restaurant | golf | activity | onsen
6. emoji: 1글자 (📍🏛️⛩️🌊🗼🍜⛲🌸 등)
7. aliases: 한국어/영어/일본어/중국어 다른 표기

응답: JSON 배열만 (객체 안 { "cards": [...] } 형태도 OK).
attraction 아닌 활동은 카드 응답에서 제외.`;

async function main() {
  // 시즈오카 region (또는 country) pending 미매칭 fetch
  const { data: pending } = await sb
    .from('unmatched_activities')
    .select('id, activity, region, country')
    .eq('status', 'pending')
    .or('country.ilike.%시즈오카%,country.ilike.%shizuoka%,region.ilike.%시즈오카%')
    .order('created_at', { ascending: false });

  console.log(`시즈오카 pending: ${pending?.length ?? 0}건`);
  if (!pending || pending.length === 0) return;

  const acts = pending.map(p => p.activity);
  console.log('활동 라인:');
  acts.forEach((a, i) => console.log(`  ${i+1}. ${a}`));

  const userPrompt = `지역: 시즈오카 (JP)\n\n미매칭 활동 라인 배열:\n${JSON.stringify(acts, null, 2)}\n\n위 라인들에서 진짜 attraction 카드만 추출. JSON 배열만:`;

  console.log('\n[DeepSeek 호출 중...]');
  const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${DS_KEY}` },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [{ role: 'system', content: SYS }, { role: 'user', content: userPrompt }],
      response_format: { type: 'json_object' },
      max_tokens: 4000,
      temperature: 0.4,
    }),
  });
  if (!res.ok) { console.error('LLM 실패:', res.status); return; }
  const json = await res.json();
  const content = json.choices[0].message.content;
  let cards;
  try {
    const parsed = JSON.parse(content);
    cards = Array.isArray(parsed) ? parsed : (parsed.cards ?? parsed.attractions ?? parsed.result ?? []);
  } catch (e) { console.error('parse 실패:', e.message); return; }

  console.log(`\n=== 분해 결과: ${cards.length}건 ===`);
  for (const c of cards) {
    console.log(`\n📌 ${c.emoji ?? '📍'} ${c.name}`);
    console.log(`   short: ${c.short_desc}`);
    console.log(`   long : ${c.long_desc}`);
    console.log(`   alias: ${(c.aliases ?? []).join(', ')}`);
    console.log(`   원본 : ${c.original_activity}`);
  }
  console.log(`\n=== 토큰: ${json.usage.prompt_tokens} / ${json.usage.completion_tokens} ===`);
  console.log(`=== 비용 ≈ $${((json.usage.prompt_tokens * 0.14 + json.usage.completion_tokens * 0.28) / 1_000_000).toFixed(6)} ===`);

  // suggested_card 적재 — original_activity 없으면 name 으로 fuzzy 매칭
  console.log('\n[suggested_card 적재 중...]');
  let saved = 0;
  for (const c of cards) {
    if (!c.name) continue;
    const sanitized = {
      name: c.name.trim(),
      short_desc: (c.short_desc ?? '').trim() || null,
      long_desc: (c.long_desc ?? '').trim() || null,
      badge_type: c.badge_type ?? 'tour',
      emoji: c.emoji ?? '📍',
      aliases: Array.isArray(c.aliases) ? c.aliases.filter(a => typeof a === 'string' && a.length >= 2) : [],
    };
    // 1) original_activity 있으면 우선 그걸로 매칭
    // 2) 없으면 카드 name 부분이 들어간 pending activity 찾아 매칭 (substring)
    const searchKey = c.original_activity ?? c.name;
    const { error, count } = await sb
      .from('unmatched_activities')
      .update({ suggested_card: sanitized, suggested_at: new Date().toISOString() }, { count: 'exact' })
      .eq('status', 'pending')
      .ilike('activity', `%${searchKey.slice(0, 20)}%`);
    if (!error && (count ?? 0) > 0) {
      saved += count;
      console.log(`  ✅ ${c.name} → ${count}건 매칭`);
    } else {
      console.log(`  ⚠️ ${c.name} → 매칭 0건 (searchKey="${searchKey.slice(0, 20)}")`);
    }
  }
  console.log(`✅ suggested_card 적재: ${saved}건`);
  console.log(`\n사장님: /admin/attractions/unmatched 에서 🤖 AI 자동 추천 배너 확인 → ☑ 일괄 등록`);
}

main().catch(e => console.error(e.message));
