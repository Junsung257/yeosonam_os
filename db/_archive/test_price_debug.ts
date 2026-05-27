import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

(async () => {
  const { createClient } = await import('@supabase/supabase-js');
  const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data } = await supa.from('travel_packages').select('raw_text').eq('id', '1e82f388-5cca-4d9a-8f53-10f4b0bb17b1').single();
  const raw = (data as { raw_text: string }).raw_text;

  const priceHints = ['상품가', '출 발 일', '출발일', '요금표'];
  let startIdx = 0;
  for (const h of priceHints) {
    const i = raw.indexOf(h);
    if (i >= 0 && (startIdx === 0 || i < startIdx)) startIdx = Math.max(0, i - 100);
  }
  const itinHints = ['제1일', 'DAY 1', 'Day 1', '제 1 일'];
  let endIdx = raw.length;
  for (const h of itinHints) {
    const i = raw.indexOf(h, startIdx + 100);
    if (i >= 0 && i < endIdx) endIdx = i;
  }
  const full = raw.slice(startIdx, Math.min(endIdx, startIdx + 6000));
  console.log('startIdx:', startIdx, 'endIdx:', endIdx, 'full length:', full.length);
  console.log('=== full segment (first 500) ===');
  console.log(full.slice(0, 500));
  console.log('=== full segment (last 500) ===');
  console.log(full.slice(-500));

  // 직접 LLM 호출
  const { llmCall } = await import('../src/lib/llm-gateway');
  const year = 2026;
  const chunk = full.slice(0, 1500);
  const prompt = `다음 여행상품 요금 구간에서 모든 출발일+가격을 추출:
${chunk}

규칙:
- date 는 "${year}-MM-DD". "5/7" → "${year}-05-07"
- 요일 라벨 ("일~화") 은 범위 [날짜~날짜] 의 모든 해당 요일을 각각 row 로
- 콤마 천 단위 → 정수. "779,000원" → 779000

JSON: {"rows":[{"date":"${year}-05-07","adult_price":779000,"note":"일~화"}]}`;

  console.log('\nCalling LLM...');
  const r = await llmCall<unknown>({
    task: 'parse_travel_doc',
    systemPrompt: '한국어 요금표 추출 전문가. raw JSON 만.',
    userPrompt: prompt,
    maxTokens: 2000,
    jsonSchema: {
      type: 'object',
      properties: {
        rows: { type: 'array', items: { type: 'object', properties: { date: { type: 'string' }, adult_price: { type: 'integer' }, note: { type: 'string' } }, required: ['date', 'adult_price'] } },
      },
      required: ['rows'],
    },
  });
  console.log('success:', r.success);
  console.log('rawText len:', (r.rawText ?? '').length);
  console.log('data:', JSON.stringify((r as { data?: unknown }).data, null, 2).slice(0, 1000));
  console.log('errors:', r.errors);
})().catch(e => { console.error('FAIL:', e); process.exit(1); });
