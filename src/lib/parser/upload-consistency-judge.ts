import { getSecret } from '@/lib/secret-registry';
import { llmCall } from '@/lib/llm-gateway';

const JUDGE_SCHEMA = {
  type: 'object',
  properties: {
    consistent: { type: 'boolean', description: '원문 일정표 헤더 수와 추출 상품 수가 같으면 true' },
  },
  required: ['consistent'],
};

const PRODUCT_REGISTRATION_DEEPSEEK_MODEL =
  process.env.PRODUCT_REGISTRATION_CRITICAL_FACT_DEEPSEEK_MODEL || 'deepseek-v4-pro';

/**
 * 카탈로그 갯수 정합 검증 (DeepSeek 전용).
 *
 * 2026-05-19 박제 (사장님 5 카탈로그 사고 종결):
 *   - 기본 ON 으로 변경 (기존: UPLOAD_CATALOG_JUDGE=1 명시해야만 동작 → 사실상 호출 0).
 *   - 명시적 OFF (UPLOAD_CATALOG_JUDGE=0) 만 비활성.
 *   - 프롬프트 확장 — "일정표" 키워드 외 "N박 M일" + 대괄호 코드 패턴도 인식.
 *
 * false여도 파이프는 중단하지 않음 (admin_alerts 적재만 — 어드민이 보고 정정).
 */
export async function judgeCatalogProductCountConsistency(
  rawTextSnippet: string,
  extractedProductCount: number,
): Promise<{ consistent: boolean; skipped: boolean; headerCount?: number; reason?: string }> {
  // 명시적 OFF 만 비활성. 그 외 자동 ON.
  if (process.env.UPLOAD_CATALOG_JUDGE === '0') {
    return { consistent: true, skipped: true, reason: 'env-disabled' };
  }
  const apiKey = getSecret('DEEPSEEK_API_KEY');
  if (!apiKey || extractedProductCount < 1) {
    return { consistent: true, skipped: true, reason: 'no-api-key-or-zero-products' };
  }

  const prompt = `한국 여행상품 카탈로그 원문에서 별개 상품 개수를 센다.

상품 시작점 패턴 (다양함, 랜드사마다 다름):
- [XX] / 【XX】 대괄호 + 코드 (영숫자 OR 한글) + "N박 M일" 또는 "무박N일"
  예: "[BX] 대만 단수이 3박 4일", "[VJ] 베트남 하노이 3박5일", "[부관훼리] 무박3일 PKG"
- 대괄호 없이 도시명 + "N박 M일" + 전각 요일【금】/【월】
  예: "울란바토르, 테를지초원 3박 5일【금】"
- "일정표" / "일정 표" 키워드가 있는 줄
- ■◆ 같은 글머리 + 상품명

같은 상품을 여러 카드(요금표 + 일정)로 나눠 적은 경우는 1개로 묶어.
판단 기준:
- 항공편이 다르면 별도 상품 (BX vs LJ vs VJ)
- 일정 차이가 Day 1개 이상이면 별도 상품
- 같은 일정인데 요금표만 따로면 같은 상품

이미 추출된 상품 개수: ${extractedProductCount}개
원문에서 별개 상품 개수와 일치하면 consistent:true, 다르면 false.

원문 발췌:
---
${rawTextSnippet.slice(0, 6000)}
---`;

  try {
    const result = await llmCall<{ consistent?: unknown }>({
      task: 'judge',
      systemPrompt: '여행상품 카탈로그 상품 개수 정합성 판정기. 원문에 근거해 JSON만 반환한다.',
      userPrompt: prompt,
      jsonSchema: JUDGE_SCHEMA,
      temperature: 0,
      maxTokens: 128,
      maxRetries: 1,
      autoEscalate: false,
      pinnedProvider: 'deepseek',
      pinnedModel: PRODUCT_REGISTRATION_DEEPSEEK_MODEL,
    });
    if (!result.success) {
      return { consistent: false, skipped: false, reason: 'deepseek-unavailable' };
    }
    const data = result.data && typeof result.data === 'object' ? result.data as { consistent?: unknown } : {};
    return { consistent: data.consistent === true, skipped: false };
  } catch {
    // 검증을 못 한 경우 true로 통과시키지 않는다. 기존 추출 결과는
    // 유지하되, caller가 admin alert/재처리 대상으로 볼 수 있게 한다.
    return { consistent: false, skipped: false, reason: 'deepseek-error' };
  }
}
