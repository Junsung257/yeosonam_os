/**
 * @file activity-normalizer.ts — 비정형 일정 활동 정규화 LLM mini task (2026-05-14 박제)
 *
 * 사장님 비전 V5: "▶후쿠오카 인공해변 모모치 해변&후쿠오카타워(외관관광) 관광" 같은
 * 비정형 텍스트를 정형 component 로 분할.
 *
 * Strategy:
 *   1. 결정적 분할 우선 (&, +, /, 콤마)
 *   2. 각 component 정제 (▶ 접두사 / 괄호 안 부가설명 분리 / 동사 분리)
 *   3. LLM mini (Gemini Flash, 200 토큰) — 결정적이 못 처리한 복잡 케이스만
 */

import { llmCall } from '@/lib/llm-gateway';

const BULLET_PREFIX = /^[▶●•·◆◇■□★☆+\-○•▪●◦]+\s*/;
const ACTIVITY_VERB_SUFFIX = /\s*(관광|체험|방문|등정|등반|시음|쇼핑|이동|투어|관람|구경|탐방|마사지|식사|입장)\s*$/;

export interface NormalizedActivity {
  /** 정제된 활동명 (배지 단위로 분리됨) */
  components: string[];
  /** 괄호 부가설명 추출 (예: "(외관관광)", "(자유식 불포함)") */
  notes: string[];
  /** 활동 분류 (관광/체험/식사/이동/쇼핑 등) */
  verb: string | null;
}

/**
 * 결정적 정규화 — LLM 없이 빠르게.
 */
export function normalizeActivityDeterministic(raw: string): NormalizedActivity {
  if (!raw) return { components: [], notes: [], verb: null };

  let text = raw.trim();

  // 1) 불릿 접두사 제거
  text = text.replace(BULLET_PREFIX, '').trim();

  // 2) 괄호 부가설명 추출
  const notes: string[] = [];
  text = text.replace(/[（(]([^()（）]+)[)）]/g, (_m, content) => {
    const clean = String(content).trim();
    if (clean.length > 0) notes.push(clean);
    return ' ';
  }).replace(/\s+/g, ' ').trim();

  // 3) 활동 동사 추출 + 제거
  let verb: string | null = null;
  const verbMatch = text.match(ACTIVITY_VERB_SUFFIX);
  if (verbMatch) {
    verb = verbMatch[1];
    text = text.replace(ACTIVITY_VERB_SUFFIX, '').trim();
  }

  // 4) 분할 (& + / 콤마)
  const parts = text
    .split(/\s*[&＆\+／/]\s*|\s*[,，]\s*/)
    .map(s => s.trim())
    .filter(s => s.length >= 2);

  // 5) 정제 (앞뒤 공백, 끝의 ", " 제거)
  const components = parts
    .map(s => s.replace(/^[、,，]+|[、,，]+$/g, '').trim())
    .filter(Boolean);

  return { components, notes, verb };
}

/**
 * LLM-aware 정규화 — 결정적이 component 1개로 끝났는데 원문이 길 때 (>30자) 호출.
 * Gemini Flash 200 토큰. 실패 시 결정적 결과 그대로.
 */
export async function normalizeActivitySmart(raw: string): Promise<NormalizedActivity> {
  const det = normalizeActivityDeterministic(raw);
  if (det.components.length >= 2 || raw.length <= 30) return det;

  try {
    const r = await llmCall({
      task: 'classify',
      systemPrompt: '여행 일정 활동 정규화. 결과는 JSON 만.',
      userPrompt: `원문: "${raw}"
이 활동을 component 배열로 분할하세요. 괄호 안 부가설명은 notes 로 분리. 동사(관광/체험/방문 등) 는 verb 필드.

JSON 형식:
{
  "components": ["관광지A", "관광지B"],
  "notes": ["외관관광"],
  "verb": "관광"
}

규칙:
- 원문에 명시되지 않은 정보 추가 금지
- component 는 명사구 (동사 제거)
- 1개 component 면 그대로

JSON 만 반환.`,
      maxTokens: 300,
      temperature: 0.1,
    });
    if (r.success && r.rawText) {
      const cleaned = r.rawText.trim().replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
      const parsed = JSON.parse(cleaned);
      if (parsed && Array.isArray(parsed.components) && parsed.components.length > 0) {
        return {
          components: parsed.components.map((s: unknown) => String(s).trim()).filter(Boolean),
          notes: Array.isArray(parsed.notes) ? parsed.notes.map((s: unknown) => String(s).trim()).filter(Boolean) : det.notes,
          verb: typeof parsed.verb === 'string' ? parsed.verb : det.verb,
        };
      }
    }
  } catch {
    /* swallow — 결정적 결과 사용 */
  }
  return det;
}
