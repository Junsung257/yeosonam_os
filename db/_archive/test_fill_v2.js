require('dotenv').config({ path: '.env.local' });
const key = process.env.DEEPSEEK_API_KEY;

const SYS = `당신은 여소남 OS 의 한국 패키지 여행 attraction 카피 작성자입니다.

사장님 톤: 친근, 구체, 소통, 재미있게. 슬래시 나열 금지. 마케팅 과장 금지.

형식:
{
  "short_desc": "1-2줄 30-60자. 정보성 + 호기심 자극. 슬로건이 아니라 '왜 가야 하는지' 한 마디. 마침표 1개.",
  "long_desc": "2-3문장 100-200자, 친근 한국어, 사실만"
}

short_desc 좋은 예시:
- "당현종과 양귀비의 로맨스가 꽃핀, 2200년 황실 온천 정원."
- "1974년 농부가 우물 파다 발견한 세계 8대 불가사의."
- "유네스코가 인정한 카르스트 절경, 동양화 같은 강 위 1시간."

short_desc 나쁜 예시 (너무 짧고 정보 없음):
- "계림의 명동, 동서항 거리"  ← 단순 라벨
- "호수 위 야경 명소"  ← 무엇이 특별한지 안 보임

attraction 의 정식 name 그대로 사용 (다른 표기로 변형 금지). 예: '이강유람선' 은 '리강' 같은 다른 표기로 쓰지 말 것.

환각 금지: 외부 그라운딩 fact 가 있으면 그것만 활용. 없으면 일반적/보수적 안내.`;

const TARGETS = [
  { name: '동서항', region: '계림', country: 'CN', ground: '맛집·카페·옷가게가 즐비한 계림의 명동 옛거리.' },
  { name: '금탑은탑', region: '계림', country: 'CN', ground: '호수 위 황금빛과 은빛으로 빛나는 야경 명소 (도보 관광).' },
  { name: '이강유람선', region: '양삭', country: 'CN', ground: "Li River is a 102 mi river in Guangxi, China. Part of the Pearl River basin, flowing from Xing'an County to Pingle County. Known for breathtaking karst landscapes." },
  { name: '서가재래시장', region: '양삭', country: 'CN', ground: '동양과 서양 문화가 어우러진 양삭의 재래시장.' },
  { name: '신호산', region: '청도', country: 'CN', ground: 'Xinhao Hill (Signal Hill) is a small hill in Shinan District, Qingdao, China. Used historically for signal flag communication.' },
];

async function callDeepSeek(target) {
  const userPrompt = `attraction: "${target.name}" (지역: ${target.region} / 국가: ${target.country} / 카테고리: tour)
${target.ground ? `Wikipedia 그라운딩 fact:\n${target.ground}\n` : '(외부 그라운딩 없음)'}

JSON 객체만 응답. attraction 이름은 "${target.name}" 정확히 그대로 사용:`;

  const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [{ role: 'system', content: SYS }, { role: 'user', content: userPrompt }],
      response_format: { type: 'json_object' },
      max_tokens: 600,
      temperature: 0.5,
    }),
  });
  if (!res.ok) return { error: `HTTP ${res.status}` };
  const json = await res.json();
  try { return { ok: true, parsed: JSON.parse(json.choices[0].message.content), tokens: json.usage }; }
  catch { return { error: 'parse fail', raw: json.choices[0].message.content }; }
}

async function main() {
  console.log('=== short_desc 톤 강화 v2 ===\n');
  for (const t of TARGETS) {
    process.stdout.write(`[${t.name}] ... `);
    const r = await callDeepSeek(t);
    if (r.error) { console.log('FAIL'); continue; }
    console.log('OK');
    console.log('  short:', r.parsed.short_desc, `(${r.parsed.short_desc?.length || 0}자)`);
    console.log('  long :', r.parsed.long_desc);
    console.log('');
  }
}

main().catch(e => console.error(e.message));
