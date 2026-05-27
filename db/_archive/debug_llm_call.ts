import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

(async () => {
  const { createClient } = await import('@supabase/supabase-js');
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data } = await sb.from('travel_packages').select('raw_text').eq('id', '7f485215-370b-423d-9ce1-31838ce26db6').single();
  const rawText = (data as { raw_text?: string }).raw_text!;

  const { llmCall } = await import('../src/lib/llm-gateway');

  // 우리 실제 SYSTEM_PROMPT 형식 그대로
  const FEW_SHOT = `
[예시 1 — ▶<설명>\\n   <이름> 두 줄을 한 attraction 으로]
원본:
▶705년에 창건된 후지산의 수호신을 모시는 신사
   아라쿠라야마 센겐신사
출력:
[ { "activity": "아라쿠라야마 센겐신사", "type": "attraction", "note": "705년 창건" } ]
`.trim();

  const SYS_OURS = `당신은 한국어 여행 일정표 구조화 전문가. 랜드사 일정표를 schedule item 배열로 정확히 추출.

규칙:
1. ▶<설명>\\n   <이름>: 두 줄을 한 item 으로.
2. type: attraction/flight/hotel/meal/shopping/transit/other.

학습 예시:
${FEW_SHOT}

응답: { "days": [{ "day": <번호>, "schedule": [<item>...] }] } JSON 만.`;

  const USER = `[목적지] 시즈오카\n[원본]\n${rawText.slice(0, 3000)}\n\n위 일정표를 JSON 으로.`;

  console.log('Testing OUR system+user prompt...');
  const r1 = await llmCall<string>({
    task: 'parse_travel_doc',
    systemPrompt: SYS_OURS,
    userPrompt: USER,
  });
  console.log('  success:', r1.success, 'rawLen:', (r1.rawText ?? '').length);
  if ((r1.rawText ?? '').length > 0) console.log('  first 200:', (r1.rawText ?? '').slice(0, 200));

  // 같은 user prompt + 간단 system
  console.log('\nTesting SIMPLE system + same user...');
  const r2 = await llmCall<string>({
    task: 'parse_travel_doc',
    systemPrompt: '한국어 여행 일정표를 JSON 으로 추출. 응답은 raw JSON 만.',
    userPrompt: USER,
  });
  console.log('  success:', r2.success, 'rawLen:', (r2.rawText ?? '').length);
  if ((r2.rawText ?? '').length > 0) console.log('  first 200:', (r2.rawText ?? '').slice(0, 200));
})().catch(e => { console.error(e); process.exit(1); });
