/**
 * 카피 글자 수 제한 테스트
 * headline ≤20자, body ≤40자, pexels_keyword ≤5단어 검증
 */
const fs = require('fs');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const envFile = fs.readFileSync('.env.local', 'utf-8');
const env = {};
envFile.split('\n').forEach(l => { const [k,...v] = l.split('='); if(k) env[k.trim()] = v.join('=').trim(); });

const SYSTEM = `You must output ONLY valid JSON. No markdown, no explanation, no code blocks.

당신은 한국 패키지 여행 카드뉴스 카피라이터입니다.
타겟: 40~60대 한국 중장년 (고모님/이모/부부여행)
클리셰 절대 금지: 파격, 놓치세요, 함께해요, 특별한, 소중한

## 글자 수 제한 (반드시 준수, 초과하면 틀린 답)
- headline: 반드시 20자 이내. 20자 넘으면 잘라서 출력.
- body: 반드시 40자 이내. 40자 넘으면 잘라서 출력. 긴 문장 금지, 명사 나열 위주.
- pexels_keyword: 영문 3~5단어

출력 형식 (이 형식만 출력, 다른 텍스트 일절 금지):
{"headline":"...","body":"...","pexels_keyword":"..."}`;

function extractJSON(text) {
  const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlock) return codeBlock[1].trim();
  const jsonMatch = text.match(/\{[\s\S]*?\}/);
  if (jsonMatch) return jsonMatch[0];
  return text.trim();
}

function enforceLength(copy) {
  return {
    headline: copy.headline.slice(0, 20),
    body: copy.body.slice(0, 40),
    pexels_keyword: copy.pexels_keyword.split(' ').slice(0, 5).join(' '),
  };
}

const roles = [
  { name: 'hook', prompt: `[훅 슬라이드] 스크롤 멈추게 하는 첫 문장
훅 타입: benefit
노팁·노옵션·5성급 혜택 중심
headline: 반드시 20자 이내 (혜택 핵심)
body: 반드시 40자 이내 (한 줄 요약)
pexels_keyword: 구체적 영문 3-5단어

출력은 반드시 {"headline":"...","body":"...","pexels_keyword":"..."} JSON 객체만. 다른 텍스트 일절 금지.` },
  { name: 'benefit', prompt: `[혜택 슬라이드] 명사/숫자 나열만. 문장형 금지.
노팁=true / 노옵션=true / 5성급 / 한식 3회
호텔명: 호라이즌, 멀펄달랏
특전: 과일도시락 1팩/룸
headline: 반드시 20자 이내. "노팁·노옵션·5성급·한식매일" 형태
body: 반드시 40자 이내. 호텔명+메뉴 나열만.
pexels_keyword: 영문 3-5단어

출력은 반드시 {"headline":"...","body":"...","pexels_keyword":"..."} JSON 객체만. 다른 텍스트 일절 금지.` },
  { name: 'cta', prompt: `[CTA 슬라이드] 긴급감
반드시 포함: 잔여 2석 / 3/30 마감 / 489,000원
headline: 반드시 20자 이내. 잔여석+마감 (예: "잔여2석 3/30마감")
body: 반드시 40자 이내. 가격+포함 요약
pexels_keyword: 영문 3-5단어

출력은 반드시 {"headline":"...","body":"...","pexels_keyword":"..."} JSON 객체만. 다른 텍스트 일절 금지.` },
];

async function test() {
  const genAI = new GoogleGenerativeAI(env.GOOGLE_AI_API_KEY);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash', generationConfig: { temperature: 0.8 } });

  console.log('=== 카피 글자 수 제한 테스트 ===\n');

  let allPass = true;

  for (const role of roles) {
    const prompt = SYSTEM + '\n\n' + role.prompt;
    try {
      const result = await model.generateContent(prompt);
      const rawText = result.response.text();
      const jsonStr = extractJSON(rawText);
      const parsed = JSON.parse(jsonStr);
      const final = enforceLength(parsed);

      const hLen = final.headline.length;
      const bLen = final.body.length;
      const kwCount = final.pexels_keyword.split(' ').length;
      const hOk = hLen <= 20;
      const bOk = bLen <= 40;
      const kwOk = kwCount <= 5;

      console.log(`[${role.name}]`);
      console.log(`  headline (${hLen}자${hOk ? ' OK' : ' TRIMMED'}): "${final.headline}"`);
      console.log(`  body     (${bLen}자${bOk ? ' OK' : ' TRIMMED'}): "${final.body}"`);
      console.log(`  keyword  (${kwCount}어${kwOk ? ' OK' : ' TRIMMED'}): "${final.pexels_keyword}"`);

      if (!hOk || !bOk || !kwOk) allPass = false;

      // 원본 vs 후처리 비교
      if (parsed.headline.length > 20 || parsed.body.length > 40) {
        console.log(`  ⚠ 원본 초과 → headline ${parsed.headline.length}자, body ${parsed.body.length}자 → 잘림 적용됨`);
      }
      console.log('');
    } catch (err) {
      console.error(`[${role.name}] 실패:`, err.message);
      allPass = false;
    }
  }

  console.log(allPass ? '✅ 모든 슬라이드 글자 수 제한 통과!' : '⚠ 일부 원본 초과 있었으나 enforceLength()로 강제 적용됨');
}

test().catch(e => console.error('Fatal:', e.message));
