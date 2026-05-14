/**
 * @file paraphrase-enforcer.ts — 외부 source 텍스트 paraphrase + 복사 차단 검증 (2026-05-14 박제)
 *
 * 사장님 정책: 외부 OTA/Wikidata source 의 long_desc/short_desc 를 차용 시
 *   1. LLM rewrite 필수
 *   2. Cosine similarity 검증 (rewrite vs 원문 < 0.6)
 *   3. 실패 시 다른 source 시도 또는 manual queue
 *
 * 저작권 안전 + 출처 추적.
 */

import { llmCall } from '@/lib/llm-gateway';

const PARAPHRASE_THRESHOLD = 0.6; // similarity 가 이 값 이상이면 너무 비슷 → 재시도

/** 캐릭터 N-gram (3-gram) 빈도 벡터 → cosine similarity. 외부 lib 없이 빠르게. */
function ngramVector(s: string, n: number = 3): Map<string, number> {
  const cleaned = s.toLowerCase().replace(/\s+/g, ' ').trim();
  const v = new Map<string, number>();
  for (let i = 0; i <= cleaned.length - n; i++) {
    const g = cleaned.slice(i, i + n);
    v.set(g, (v.get(g) ?? 0) + 1);
  }
  return v;
}

function cosineSim(a: string, b: string): number {
  if (!a || !b) return 0;
  const va = ngramVector(a);
  const vb = ngramVector(b);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [g, ca] of va.entries()) {
    na += ca * ca;
    const cb = vb.get(g);
    if (cb) dot += ca * cb;
  }
  for (const cb of vb.values()) nb += cb * cb;
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export interface ParaphraseResult {
  text: string;
  similarity: number;
  attempts: number;
  ok: boolean;
}

/**
 * 외부 원문 → LLM rewrite + cosine 검증 + 재시도.
 * 임계값 위면 rewrite 강도 ↑ 로 1회 더 시도.
 *
 * style: 'short_desc' (1~2문장, 50자~120자) | 'long_desc' (2~4문장, 200자~600자)
 */
export async function paraphraseExternal(args: {
  originalText: string;
  style: 'short_desc' | 'long_desc';
  attractionName?: string;
  destination?: string | null;
}): Promise<ParaphraseResult> {
  const orig = (args.originalText ?? '').trim();
  if (!orig || orig.length < 10) {
    return { text: '', similarity: 0, attempts: 0, ok: false };
  }

  const lengthHint = args.style === 'short_desc' ? '1~2문장 50~120자' : '2~4문장 200~600자';
  const stronger = (round: number) => round === 0
    ? '톤은 자연스럽게, 원문의 정보는 보존하되 문장 구조와 표현을 재작성하세요.'
    : '원문과 단어 선택·문장 순서·구문이 모두 다르게 완전히 새로 작성하세요. 사실만 보존.';

  for (let round = 0; round < 2; round++) {
    const prompt = `당신은 여행 카탈로그 카피라이터입니다. 아래 외부 원문을 ${lengthHint} 분량의 ${args.style === 'short_desc' ? '한 줄 짧은 설명' : '상세 설명'} 으로 재작성하세요.

원문:
"""
${orig}
"""

${args.attractionName ? `관광지명: ${args.attractionName}\n` : ''}${args.destination ? `지역: ${args.destination}\n` : ''}
요구사항:
- ${stronger(round)}
- 마케팅 과장 금지. 사실만.
- 가격·할인·연령제한 같이 원문에 없는 사실 절대 추가 금지.
- "방문하시면 어떨까요" 같은 문장 끝 권유 표현 피함.
- 결과만 출력 (다른 설명·메타·따옴표 없이).`;

    try {
      const r = await llmCall({
        task: 'content-brief',
        systemPrompt: '여행 카탈로그 paraphrase. 결과만 출력.',
        userPrompt: prompt,
        maxTokens: args.style === 'short_desc' ? 200 : 800,
        temperature: 0.6,
      });
      if (!r.success || !r.rawText) continue;
      const rewritten = r.rawText.trim().replace(/^["「『]|["」』]$/g, '').trim();
      if (!rewritten) continue;
      const sim = cosineSim(orig, rewritten);
      if (sim < PARAPHRASE_THRESHOLD) {
        return { text: rewritten, similarity: sim, attempts: round + 1, ok: true };
      }
      // 너무 비슷하면 다음 라운드 (더 강한 prompt)
    } catch {
      /* 다음 라운드 */
    }
  }
  return { text: '', similarity: 1, attempts: 2, ok: false };
}

/** 단순 utility — 외부에서 직접 cosine 만 쓰고 싶을 때 */
export { cosineSim };
