/**
 * 5건 attraction 에 대해 DeepSeek 으로 short_desc/long_desc 자동 생성 테스트.
 * production fill_from_llm 라우트 가 머지 전이라 inline 으로 동일 prompt 호출.
 */
require('dotenv').config({ path: '.env.local' });

const key = process.env.DEEPSEEK_API_KEY;
if (!key) { console.error('DEEPSEEK_API_KEY 미설정'); process.exit(1); }

const SYS = `당신은 여소남 OS 의 한국 패키지 여행 attraction 카피 작성자입니다.
사장님 톤: 친근, 구체, 소통. 슬래시 나열 금지. 마케팅 과장 금지.
형식: { "short_desc": "1줄 hook 15-40자", "long_desc": "2-3문장 100-200자, 친근 한국어, 사실만" }
환각 금지: 외부 그라운딩 fact 가 있으면 그것만 활용. 없으면 일반적/보수적 안내.`;

const TARGETS = [
  { name: '동서항', region: '계림', country: 'CN', ground: '맛집·카페·옷가게가 즐비한 계림의 명동 옛거리.' },
  { name: '금탑은탑', region: '계림', country: 'CN', ground: '호수 위 황금빛과 은빛으로 빛나는 야경 명소 (도보 관광).' },
  { name: '이강유람선', region: '양삭', country: 'CN', ground: "Li River is a 102 mi river in Guangxi, China. Part of the Pearl River basin, flowing from Xing'an County to Pingle County. Known for breathtaking karst landscapes." },
  { name: '서가재래시장', region: '양삭', country: 'CN', ground: '동양과 서양 문화가 어우러진 양삭의 재래시장.' },
  { name: '신호산', region: '청도', country: 'CN', ground: 'Xinhao Hill (Signal Hill) is a small hill in Shinan District, Qingdao, China. Used historically for signal flag communication.' },
];

async function callDeepSeek(target) {
  const userPrompt = `attraction: \"${target.name}\" (지역: ${target.region} / 국가: ${target.country} / 카테고리: tour)
${target.ground ? `Wikipedia 그라운딩 fact:\\n${target.ground}\\n` : '(외부 그라운딩 없음 — 보수적 안내)'}
JSON 객체만 응답:`;

  const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: SYS },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 600,
      temperature: 0.5,
    }),
  });
  if (!res.ok) {
    return { error: `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}` };
  }
  const json = await res.json();
  const content = json.choices?.[0]?.message?.content ?? '';
  try {
    return { ok: true, parsed: JSON.parse(content), tokens: json.usage };
  } catch {
    return { error: 'JSON parse 실패', raw: content.slice(0, 300) };
  }
}

async function main() {
  console.log('=== DeepSeek 자동 채움 5건 결과 ===\\n');
  for (const t of TARGETS) {
    process.stdout.write(`[${t.name}] (${t.region}) ground=${t.ground ? 'Y' : 'N'} ... `);
    const r = await callDeepSeek(t);
    if (r.error) { console.log('FAIL:', r.error); continue; }
    console.log('OK');
    console.log('  short_desc:', r.parsed.short_desc);
    console.log('  long_desc :', r.parsed.long_desc);
    console.log('  tokens    :', r.tokens?.prompt_tokens, '/', r.tokens?.completion_tokens);
    console.log('');
  }
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
