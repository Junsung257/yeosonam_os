import { GoogleGenerativeAI, SchemaType, type ResponseSchema } from '@google/generative-ai';
import { getSecret } from '@/lib/secret-registry';

const JUDGE_SCHEMA: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    consistent: { type: SchemaType.BOOLEAN, description: '원문 일정표 헤더 수와 추출 상품 수가 같으면 true' },
  },
  required: ['consistent'],
};

/**
 * UPLOAD_CATALOG_JUDGE=1 일 때만 호출. 저비용 Gemini Flash로 개수 정합만 확인.
 * false여도 파이프는 중단하지 않음(로그·향후 게이트 확장용).
 */
export async function judgeCatalogProductCountConsistency(
  rawTextSnippet: string,
  extractedProductCount: number,
): Promise<{ consistent: boolean; skipped: boolean }> {
  if (process.env.UPLOAD_CATALOG_JUDGE !== '1') {
    return { consistent: true, skipped: true };
  }
  const apiKey = getSecret('GOOGLE_AI_API_KEY');
  if (!apiKey || extractedProductCount < 1) {
    return { consistent: true, skipped: true };
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 128,
      responseMimeType: 'application/json',
      responseSchema: JUDGE_SCHEMA,
    },
  });

  const prompt = `원문에서 일정표 섹션 헤더가 몇 번 나오는지 센다.
헤더 패턴: 반각 [XX]·전각 【XX】 등 대괄호 안 2~4자 영숫자 코드 뒤에 같은 줄에 "일정표"가 오는 줄(앞에 1. 2. 번호가 붙을 수 있음).
이미 추출된 상품 개수가 ${extractedProductCount}개일 때, 헤더 개수와 같으면 consistent:true, 다르면 false만 반환.
원문 발췌:
---
${rawTextSnippet.slice(0, 6000)}
---`;

  try {
    const res = await model.generateContent(prompt);
    const txt = res.response.text();
    const parsed = JSON.parse(txt) as { consistent?: boolean };
    return { consistent: parsed.consistent !== false, skipped: false };
  } catch {
    return { consistent: true, skipped: false };
  }
}
