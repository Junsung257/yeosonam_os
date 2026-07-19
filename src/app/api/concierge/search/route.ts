/**
 * AI 컨시어지 검색 API
 * Gemini 자연어 쿼리 → 인텐트 추출 → 실제 입점 상품 검색 → 결과 반환
 *
 * 출시 안전 원칙:
 * 공개 고객 화면에는 승인되지 않은 mock 공급사 재고/가격을 노출하지 않는다.
 */
import { NextRequest, NextResponse } from 'next/server';
import { searchTenantProducts, isSupabaseConfigured, CrossSearchResult } from '@/lib/supabase';
import { getSecret } from '@/lib/secret-registry';
import { getPrompt } from '@/lib/prompt-loader';
import { rateLimitAI } from '@/lib/rate-limiter';
import { logAndSanitize } from '@/lib/error-sanitizer';
import { sanitizeConciergeItemsForPublic } from '@/lib/concierge-public-payload';

interface ConciergeSearchResult {
  product_id: string;
  product_name: string;
  api_name: 'tenant_product';
  product_type: 'HOTEL' | 'ACTIVITY' | 'CRUISE';
  product_category: 'FIXED';
  cost: number;
  price: number;
  description: string;
  attrs?: Record<string, unknown>;
}

function tenantToConciergeResult(r: CrossSearchResult): ConciergeSearchResult {
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

function conciergeBackendUnavailable() {
  return NextResponse.json(
    {
      error: '현재 실제 입점 상품 검색 백엔드가 준비되지 않아 추천을 제공할 수 없습니다. 카톡 상담으로 문의해 주세요.',
      results: [],
    },
    {
      status: 503,
      headers: { 'Cache-Control': 'private, no-store' },
    }
  );
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
];

async function callGemini(
  apiKey: string,
  query: string
): Promise<ConciergeSearchResult[]> {
  const today = new Date().toISOString().slice(0, 10);
  const CONCIERGE_SYSTEM_FALLBACK = `당신은 여행 플랫폼 AI 컨시어지입니다. 사용자의 자연어 여행 요청을 분석해서 적절한 검색 도구를 호출하세요.
오늘 날짜: {{today}}
- 패키지/투어/종합여행 요청 → search_tenant_products (마진 높은 입점 상품 우선)
- 호텔/숙박/투어/액티비티/체험/크루즈 요청도 승인된 입점 상품만 검색하기 위해 search_tenant_products를 사용
- 복합 요청 → search_tenant_products를 사용
- 날짜/인원이 명시되지 않으면 적절한 기본값 사용 (날짜: 오늘+7일, 인원: 2명)`;
  const systemPrompt = (await getPrompt('concierge-search-system', CONCIERGE_SYSTEM_FALLBACK))
    .replace('{{today}}', today);

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
  const contents = [{ role: 'user', parts: [{ text: query }] }];
  const allResults: ConciergeSearchResult[] = [];
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
      let results: ConciergeSearchResult[] = [];
      try {
        if (name === 'search_tenant_products') {
          const tenantResults = await searchTenantProducts({
            destination: args.destination as string | undefined,
            category:    args.category    as string | undefined,
            date:        args.date        as string | undefined,
            persons:     args.persons     as number | undefined,
          });
          results = tenantResults.map(tenantToConciergeResult);
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
  const limited = await rateLimitAI(request);
  if (limited) return limited;

  try {
    const { query } = await request.json();
    if (!query?.trim()) {
      return NextResponse.json({ error: '검색어가 필요합니다.' }, { status: 400 });
    }

    if (!isSupabaseConfigured) {
      return conciergeBackendUnavailable();
    }

    const apiKey = getSecret('GOOGLE_AI_API_KEY');
    if (!apiKey) {
      const tenantRes = await searchTenantProducts({ destination: query }).catch(() => []);
      const tenantMapped = tenantRes.map(tenantToConciergeResult);
      return NextResponse.json({ results: sanitizeConciergeItemsForPublic(tenantMapped) });
    }

    const results = await callGemini(apiKey, query);
    return NextResponse.json({ results: sanitizeConciergeItemsForPublic(results) });
  } catch (error) {
    return NextResponse.json(
      { error: logAndSanitize('concierge-search', error, '검색 처리 실패') },
      { status: 500 }
    );
  }
}
