/**
 * Zod 검증 실패 시 DeepSeek로 필드만 최소 수정 (1회, 저비용).
 * UPLOAD_ZOD_REPAIR=0 이면 호출하지 않음.
 */

import type { ExtractedData } from '@/lib/parser';
import { getSecret } from '@/lib/secret-registry';
import { llmCall } from '@/lib/llm-gateway';

const PRODUCT_REGISTRATION_DEEPSEEK_MODEL =
  process.env.PRODUCT_REGISTRATION_CRITICAL_FACT_DEEPSEEK_MODEL || 'deepseek-v4-pro';

const REPAIR_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: ['string', 'null'] },
    destination: { type: ['string', 'null'] },
    duration: { type: ['integer', 'null'] },
    net_price: { type: ['integer', 'null'] },
    flight_depart: { type: ['string', 'null'] },
    flight_arrive: { type: ['string', 'null'] },
    flight_return_depart: { type: ['string', 'null'] },
    flight_return_arrive: { type: ['string', 'null'] },
  },
};

export function mergeGeminiRepairIntoExtractedData(ed: ExtractedData, patch: Record<string, unknown>): void {
  if (typeof patch.title === 'string' && patch.title.trim()) ed.title = patch.title.trim().slice(0, 200);
  if (typeof patch.destination === 'string' && patch.destination.trim()) {
    ed.destination = patch.destination.trim().slice(0, 100);
  }
  if (typeof patch.duration === 'number' && Number.isFinite(patch.duration)) {
    const n = Math.round(patch.duration);
    if (n >= 1 && n <= 60) ed.duration = n;
  }
  if (typeof patch.net_price === 'number' && Number.isFinite(patch.net_price) && patch.net_price >= 0) {
    ed.price = Math.min(patch.net_price, 50_000_000);
  }
  const fi = { ...(ed.flight_info ?? {}) };
  let touched = false;
  const setTime = (key: string, val: unknown) => {
    if (typeof val !== 'string') return;
    const m = val.trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return;
    fi[key] = `${m[1].padStart(2, '0')}:${m[2]}`;
    touched = true;
  };
  setTime('depart', patch.flight_depart);
  setTime('arrive', patch.flight_arrive);
  setTime('return_depart', patch.flight_return_depart);
  setTime('return_arrive', patch.flight_return_arrive);
  if (touched) ed.flight_info = fi;
}

/**
 * 검증 오류 메시지 + 원문 발췌로 누락/형식 오류만 보정. 실패 시 null.
 */
export async function repairExtractedDataWithGemini(
  ed: ExtractedData,
  zodErrors: string[],
  rawExcerpt: string,
): Promise<boolean> {
  if (process.env.UPLOAD_ZOD_REPAIR === '0') return false;
  const apiKey = getSecret('DEEPSEEK_API_KEY');
  if (!apiKey || zodErrors.length === 0) return false;

  const current = {
    title: ed.title ?? '',
    destination: ed.destination ?? '',
    duration: ed.duration ?? null,
    net_price: ed.price ?? 0,
    flight: ed.flight_info ?? {},
  };

  const prompt = `여행상품 파싱 결과가 Zod 검증에 실패했다. 아래 "오류"에 나온 필드만 원문과 현재값을 참고해 고쳐라.
고칠 필요 없는 키는 JSON에서 생략하거나 null. 항공 시각은 반드시 HH:MM(24h, 시 2자리) 형식.
오류:
${zodErrors.map(e => `- ${e}`).join('\n')}

현재 추출값(JSON):
${JSON.stringify(current)}

원문 발췌:
---
${rawExcerpt.slice(0, 8000)}
---`;

  try {
    const res = await llmCall<Record<string, unknown>>({
      task: 'classify',
      systemPrompt: '여행상품 추출 결과의 형식 오류만 원문 근거로 보정한다. JSON만 반환한다.',
      userPrompt: prompt,
      jsonSchema: REPAIR_SCHEMA,
      temperature: 0,
      maxTokens: 512,
      maxRetries: 1,
      autoEscalate: false,
      pinnedProvider: 'deepseek',
      pinnedModel: PRODUCT_REGISTRATION_DEEPSEEK_MODEL,
    });
    if (!res.success || !res.data) return false;
    const patch = res.data;
    mergeGeminiRepairIntoExtractedData(ed, patch);
    return true;
  } catch (e) {
    console.warn('[extracted-field-repair] DeepSeek 보정 실패:', e instanceof Error ? e.message : e);
    return false;
  }
}
