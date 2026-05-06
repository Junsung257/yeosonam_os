/**
 * AI 컨시어지 검색 API
 * Gemini 자연어 쿼리 → 인텐트 추출 → Mock API 호출 → 마진 적용 → 결과 반환
 */
import { NextRequest, NextResponse } from 'next/server';
import { searchHotels, searchActivities, searchCruises, MockSearchResult } from '@/lib/mock-apis';
import { searchTenantProducts, isSupabaseConfigured, CrossSearchResult } from '@/lib/supabase';
import { getSecret } from '@/lib/secret-registry';

function tenantToMock(r: CrossSearchResult): MockSearchResult {
  return {
    product_id:       r.product_id,
    product_name:     r.product_name,
    api_name:         'tenant_product',
    product_type:     (r.category === 'cruise' ? 'CRUISE'
                     : r.category === 'hotel'  ? 'HOTEL'
                     : 'ACTIVITY') as 'HOTEL' | 'ACTIVITY' | 'CRUISE',
    product_category: 'FIXED',
    cost:             r.cost_price,
    price:            r.effective_price,
    description:      `${r.destination ?? ''} · ${r.tenant_name} · 잔여 ${r.available_seats}석`,
    attrs: {
      tenant_id:       r.tenant_id,
      date:            r.date,
      available_seats: r.available_seats,
      margin:          r.margin,
    },
  };
}

const TOOL_DECLARATIONS = [
  {
    name: 'search_tenant_products',
    description: '실제 입점 랜드사(테넌트) 상품 검색. 재고 있는 상품만 반환. 마진 높은 순 정렬. 패키지/투어/크루즈 등 종합 상품에 활용.',
    parameters: {
      type: 'OBJECT',
      properties: {
        destination: { type: 'STRING', description: '목적지 (예: 발리, 방콕, 도쿄)' },
        category:    { type: 'STRING', description: '카테고리 (package, hotel, cruise, activity, golf, theme)' },
        date:        { type: 'STRING', description: '여행 날짜 YYYY-MM-DD' },
        persons:     { type: 'NUMBER', description: '인원 수' },
      },
      required: [],
    },
  },
  {
    name: 'search_hotels',
    description: '호텔 검색. 도시/국가 여행에서 숙박이 필요할 때 사용.',
    parameters: {
      type: 'OBJECT',
      properties: {
        destination: { type: 'STRING', description: '목적지 도시/국가 (예: 방콕, 도쿄, 발리)' },
        check_in:    { type: 'STRING', description: '체크인 날짜 YYYY-MM-DD' },
        check_out:   { type: 'STRING', description: '체크아웃 날짜 YYYY-MM-DD' },
        guests:      { type: 'NUMBER', description: '숙박 인원 수' },
      },
      required: ['destination'],
    },
  },
  {
    name: 'search_activities',
    description: '액티비티/투어 검색. 체험, 관광, 투어, 레저 활동에 사용.',
    parameters: {
      type: 'OBJECT',
      properties: {
        destination: { type: 'STRING', description: '목적지 (예: 방콕, 파타야, 오사카)' },
        date:        { type: 'STRING', description: '이용 날짜 YYYY-MM-DD' },
        persons:     { type: 'NUMBER', description: '참여 인원 수' },
      },
      required: ['destination'],
    },
  },
  {
    name: 'search_cruises',
    description: '크루즈 검색. 크루즈 여행, 선박 여행에 사용.',
    parameters: {
      type: 'OBJECT',
      properties: {
        destination:    { type: 'STRING', description: '크루즈 목적지/항로 (예: 지중해, 동남아, 알래스카)' },
        departure_date: { type: 'STRING', description: '출발 날짜 YYYY-MM-DD' },
        nights:         { type: 'NUMBER', description: '숙박 박 수' },
        persons:        { type: 'NUMBER', description: '인원 수' },
      },
      required: ['destination'],
    },
  },
];

async function callGemini(
  apiKey: string,
  query: string
): Promise<MockSearchResult[]> {
  const today = new Date().toISOString().slice(0, 10);
  const systemPrompt = `당신은 여행 플랫폼 AI 컨시어지입니다. 사용자의 자연어 여행 요청을 분석해서 적절한 검색 도구를 호출하세요.
오늘 날짜: ${today}
- 패키지/투어/종합여행 요청 → search_tenant_products (마진 높은 입점 상품 우선)
- 호텔/숙박 요청 → search_hotels
- 투어/액티비티/체험 요청 → search_activities
- 크루즈/유람선 요청 → search_cruises + search_tenant_products(category:cruise)
- 복합 요청 → 여러 도구 동시 호출 가능 (search_tenant_products는 항상 포함 권장)
- 날짜/인원이 명시되지 않으면 적절한 기본값 사용 (날짜: 오늘+7일, 인원: 2명)`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
  const contents = [{ role: 'user', parts: [{ text: query }] }];
  const allResults: MockSearchResult[] = [];
  let currentContents = [...contents];
  const MAX_ROUNDS = 3;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        tools: [{ function_declarations: TOOL_DECLARATIONS }],
        contents: currentContents,
        generationConfig: { temperature: 0.1 },
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Gemini API 오류 ${res.status}: ${err}`);
    }

    const json = await res.json();
    const candidate = json.candidates?.[0];
    const parts = candidate?.content?.parts ?? [];
    const funcCalls = parts.filter((p: { functionCall?: unknown }) => p.functionCall);

    if (funcCalls.length === 0) break;

    currentContents = [...currentContents, { role: 'model', parts }];

    const functionResponses = [];
    for (const part of funcCalls) {
      const { name, args } = part.functionCall as { name: string; args: Record<string, unknown> };
      let results: MockSearchResult[] = [];
      try {
        if (name === 'search_tenant_products' && isSupabaseConfigured) {
          const tenantResults = await searchTenantProducts({
            destination: args.destination as string | undefined,
            category:    args.category    as string | undefined,
            date:        args.date        as string | undefined,
            persons:     args.persons     as number | undefined,
          });
          results = tenantResults.map(tenantToMock);
        } else if (name === 'search_hotels') {
          results = await searchHotels(
            (args.destination as string) ?? '',
            (args.check_in as string) ?? '',
            (args.check_out as string) ?? '',
            (args.guests as number) ?? 2
          );
        } else if (name === 'search_activities') {
          results = await searchActivities(
            (args.destination as string) ?? '',
            (args.date as string) ?? '',
            (args.persons as number) ?? 2
          );
        } else if (name === 'search_cruises') {
          results = await searchCruises(
            (args.destination as string) ?? '',
            (args.departure_date as string) ?? '',
            (args.nights as number) ?? 7,
            (args.persons as number) ?? 2
          );
        }
        allResults.push(...results);
        functionResponses.push({
          functionResponse: {
            name,
            response: { result: { count: results.length, products: results.map(r => r.product_name) } },
          },
        });
      } catch (err) {
        functionResponses.push({
          functionResponse: {
            name,
            response: { result: { error: err instanceof Error ? err.message : '검색 실패' } },
          },
        });
      }
    }

    currentContents = [...currentContents, { role: 'user', parts: functionResponses } as unknown as { role: string; parts: { text: string }[] }];
  }

  return allResults;
}

export async function POST(request: NextRequest) {
  try {
    const { query } = await request.json();
    if (!query?.trim()) {
      return NextResponse.json({ error: '검색어가 필요합니다.' }, { status: 400 });
    }

    const apiKey = getSecret('GOOGLE_AI_API_KEY');
    if (!apiKey) {
      // API 키 없을 때 — 기본 검색 (목적지 키워드 추출 없이 전체 반환)
      const [tenantRes, hotelRes, actRes] = await Promise.all([
        isSupabaseConfigured
          ? searchTenantProducts({ destination: query }).catch(() => [])
          : Promise.resolve([]),
        searchHotels(query, '', '', 2).catch(() => [] as MockSearchResult[]),
        searchActivities(query, '', 2).catch(() => [] as MockSearchResult[]),
      ]);
      const tenantMapped: MockSearchResult[] = tenantRes.map(tenantToMock);
      return NextResponse.json({ results: [...tenantMapped, ...hotelRes, ...actRes] });
    }

    const results = await callGemini(apiKey, query);
    return NextResponse.json({ results });
  } catch (error) {
    console.error('[컨시어지 검색] 오류:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '검색 처리 실패' },
      { status: 500 }
    );
  }
}
