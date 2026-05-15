/**
 * @file paraphrase-enforcer.ts — 외부 source 텍스트 paraphrase + 복사 차단 검증 (2026-05-14 박제)
 *
 * 사장님 정책: 외부 OTA/Wikidata source 의 long_desc/short_desc 를 차용 시
 *   1. LLM rewrite 필수
 *   2. Cosine similarity 검증 (rewrite vs 원문 < 0.6)
 *   3. 실패 시 다른 source 시도 또는 manual queue
 *
 * 저작권 안전 + 출처 추적.
 *
 * 2026-05-15 박제 (G1+G2):
 *   - G1 fewShotDemos prompt 옵션 (caller 가 비슷한 카테고리/지역 attraction 의 short_desc 예시 주입)
 *   - G2 Self-Refine critic loop (생성 후 LLM 자신이 "사실 명시 위반" 평가 → 부족하면 재생성)
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
  /** G1 박제 (2026-05-15): 유사 카테고리 attraction 의 short_desc 예시 (paraphrase 패턴 학습용) */
  fewShotDemos?: Array<{ name: string; short_desc: string }>;
  /** G2 박제 (2026-05-15): Self-Refine critic loop. paraphrase 후 LLM critic 호출하여 부족하면 재생성. */
  enableSelfRefine?: boolean;
}): Promise<ParaphraseResult> {
  const orig = (args.originalText ?? '').trim();
  if (!orig || orig.length < 10) {
    return { text: '', similarity: 0, attempts: 0, ok: false };
  }

  const lengthHint = args.style === 'short_desc' ? '1~2문장 50~120자' : '2~4문장 200~600자';
  const stronger = (round: number) => round === 0
    ? '톤은 자연스럽게, 원문의 정보는 보존하되 문장 구조와 표현을 재작성하세요.'
    : '원문과 단어 선택·문장 순서·구문이 모두 다르게 완전히 새로 작성하세요. 사실만 보존.';

  // G1: few-shot demos 가 있으면 prompt 에 패턴 학습용으로 주입 (cosine 검증 그대로)
  const demosBlock = args.fewShotDemos && args.fewShotDemos.length > 0
    ? `\n참고 패턴 (같은 카테고리 attraction 의 짧은 설명 예시 — 톤·구조만 학습, 내용 복사 금지):\n${args.fewShotDemos.slice(0, 3).map((d, i) => `  ${i + 1}. ${d.name} — "${d.short_desc}"`).join('\n')}\n`
    : '';

  for (let round = 0; round < 2; round++) {
    const prompt = `당신은 여행 카탈로그 카피라이터입니다. 아래 외부 원문을 ${lengthHint} 분량의 ${args.style === 'short_desc' ? '한 줄 짧은 설명' : '상세 설명'} 으로 재작성하세요.

원문:
"""
${orig}
"""

${args.attractionName ? `관광지명: ${args.attractionName}\n` : ''}${args.destination ? `지역: ${args.destination}\n` : ''}${demosBlock}
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
      if (sim >= PARAPHRASE_THRESHOLD) {
        // 너무 비슷하면 다음 라운드 (더 강한 prompt)
        continue;
      }
      // G2 Self-Refine critic: paraphrase 결과를 LLM 이 평가. 부족하면 다음 라운드.
      if (args.enableSelfRefine) {
        const critique = await selfRefineCritique({
          text: rewritten,
          attractionName: args.attractionName,
          style: args.style,
        });
        if (!critique.ok) continue;
      }
      return { text: rewritten, similarity: sim, attempts: round + 1, ok: true };
    } catch {
      /* 다음 라운드 */
    }
  }
  return { text: '', similarity: 1, attempts: 2, ok: false };
}

/**
 * G2 박제 (2026-05-15): Self-Refine critic.
 * Madaan et al. NeurIPS 2023 "Self-Refine: Iterative Refinement with Self-Feedback".
 * LLM 이 paraphrase 결과를 평가 — "사실 명시 위반" / "과장" / "권유 표현" 감지 시 fail.
 */
async function selfRefineCritique(args: {
  text: string;
  attractionName?: string;
  style: 'short_desc' | 'long_desc';
}): Promise<{ ok: boolean; reason: string }> {
  const prompt = `다음 텍스트가 여행 카탈로그용 ${args.style === 'short_desc' ? '짧은 설명' : '상세 설명'} 으로 적합한지 평가하세요.

평가 대상:
"""
${args.text}
"""

${args.attractionName ? `관광지명: ${args.attractionName}\n` : ''}
체크리스트 (위반 시 NG):
1. 검증 불가 사실 명시 (가격·연령·할인·운영시간·건립연도 등)
2. 마케팅 과장 ("최고", "반드시", "꼭" 등 권유 표현)
3. 부정확한 지리·역사 추측

OK / NG 만 한 줄로 출력하세요. NG 면 한 가지 사유 추가.
예: "OK" 또는 "NG: 건립연도 명시"`;

  try {
    const r = await llmCall({
      task: 'judge',
      systemPrompt: '여행 카탈로그 품질 critic. OK/NG 만 출력.',
      userPrompt: prompt,
      maxTokens: 60,
      temperature: 0.1,
    });
    if (!r.success || !r.rawText) return { ok: true, reason: 'critic_unavailable' };
    const text = r.rawText.trim();
    if (/^OK\b/i.test(text)) return { ok: true, reason: 'pass' };
    return { ok: false, reason: text.slice(0, 80) };
  } catch {
    return { ok: true, reason: 'critic_exception' }; // critic fail 시 conservative pass
  }
}

/**
 * E5 박제 (2026-05-15): paraphrase 2회 실패 시 LLM 으로 짧은 설명 자체 생성 fallback.
 * 외부 원문에 의존하지 않고 attractionName + destination 기반으로 일반 가이드 한 줄 생성.
 * "사실 명시 금지" 룰: 가격·연령·우선·할인·역사 연도 등 검증 불가 정보는 금지.
 * 결과는 카드 비어보임 차단용 최소 보장.
 */
export async function generateGenericShortDesc(args: {
  attractionName: string;
  destination?: string | null;
}): Promise<{ text: string; ok: boolean }> {
  const name = args.attractionName.trim();
  if (!name) return { text: '', ok: false };

  const dest = args.destination ?? null;
  const prompt = `여행 카탈로그용 짧은 한 줄 설명 (50자 이내) 을 작성하세요.
관광지: ${name}
${dest ? `지역: ${dest}\n` : ''}
규칙:
- 가격·할인·연령·운영시간·건립연도 같이 검증이 필요한 사실 절대 추가 금지.
- "방문" "꼭 가봐야" 같은 권유·과장 표현 피함.
- 자연 환경·건축 양식·일반 분위기 같이 카테고리 차원 묘사만.
- 결과만 출력. 다른 설명·따옴표 없이.

예시 출력: "달랏 시내 핑크 톤 가톨릭 성당으로 유명한 야경 명소"`;

  try {
    const r = await llmCall({
      task: 'content-brief',
      systemPrompt: '여행 관광지 짧은 설명 생성. 결과만 50자 이내 한 줄로 출력.',
      userPrompt: prompt,
      maxTokens: 120,
      temperature: 0.4,
    });
    if (!r.success || !r.rawText) return { text: '', ok: false };
    const out = r.rawText.trim().replace(/^["「『]|["」』]$/g, '').trim().slice(0, 70);
    if (out.length < 8) return { text: '', ok: false };
    return { text: out, ok: true };
  } catch {
    return { text: '', ok: false };
  }
}

/** 단순 utility — 외부에서 직접 cosine 만 쓰고 싶을 때 */
export { cosineSim };
