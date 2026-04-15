/**
 * 여소남 OS — Gemini 기반 벡터 임베딩 (1536 dim)
 *
 * 모델: gemini-embedding-001 (outputDimensionality=1536)
 * products.embedding 컬럼과 동일 벡터 공간 → 마이그레이션 불필요
 *
 * 사용처:
 * - products 검색 (RETRIEVAL_DOCUMENT/QUERY 비대칭)
 * - customer_facts 시맨틱 회수
 * - 블로그/카드뉴스 중복 탐지
 */

const EMBED_MODEL = 'gemini-embedding-001';
export const EMBED_DIM = 1536;

export type EmbedTaskType =
  | 'RETRIEVAL_DOCUMENT'   // 저장용 (긴 문서)
  | 'RETRIEVAL_QUERY'      // 검색 쿼리용
  | 'SEMANTIC_SIMILARITY'  // 대칭 유사도
  | 'CLASSIFICATION'
  | 'CLUSTERING';

const MAX_TEXT_CHARS = 8000;

export async function embedText(
  text: string,
  apiKey: string,
  taskType: EmbedTaskType = 'SEMANTIC_SIMILARITY',
): Promise<number[] | null> {
  if (!apiKey || !text?.trim()) return null;
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:embedContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: `models/${EMBED_MODEL}`,
          content: { parts: [{ text: text.slice(0, MAX_TEXT_CHARS) }] },
          taskType,
          outputDimensionality: EMBED_DIM,
        }),
      },
    );
    if (!res.ok) {
      console.warn('[embedText] HTTP', res.status);
      return null;
    }
    const json = await res.json();
    const values = json?.embedding?.values;
    return Array.isArray(values) && values.length === EMBED_DIM ? values : null;
  } catch (e) {
    console.warn('[embedText] 실패:', e);
    return null;
  }
}

export async function embedBatch(
  texts: string[],
  apiKey: string,
  taskType: EmbedTaskType = 'RETRIEVAL_DOCUMENT',
): Promise<Array<number[] | null>> {
  if (!apiKey || texts.length === 0) return texts.map(() => null);
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:batchEmbedContents?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: texts.map((t) => ({
            model: `models/${EMBED_MODEL}`,
            content: { parts: [{ text: (t ?? '').slice(0, MAX_TEXT_CHARS) }] },
            taskType,
            outputDimensionality: EMBED_DIM,
          })),
        }),
      },
    );
    if (!res.ok) {
      console.warn('[embedBatch] HTTP', res.status);
      return texts.map(() => null);
    }
    const json = await res.json();
    const arr = Array.isArray(json?.embeddings) ? json.embeddings : [];
    return texts.map((_, i) => {
      const v = arr[i]?.values;
      return Array.isArray(v) && v.length === EMBED_DIM ? v : null;
    });
  } catch (e) {
    console.warn('[embedBatch] 실패:', e);
    return texts.map(() => null);
  }
}

/** 코사인 유사도 — DB 외부에서 필요한 경우 (예: in-memory 재정렬) */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, ma = 0, mb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    ma += a[i] * a[i];
    mb += b[i] * b[i];
  }
  const denom = Math.sqrt(ma) * Math.sqrt(mb);
  return denom === 0 ? 0 : dot / denom;
}
