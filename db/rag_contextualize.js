/**
 * 여소남 OS — Contextual Retrieval chunk 전처리 (Phase 4 §B.3.3)
 *
 * 역할: chunk 앞에 "이 문서 안에서 이 청크의 역할" 한 문장을 Gemini Flash 로 생성.
 * Anthropic 가이드 — 이 한 줄 prepend 로 retrieval 실패율 49~67% 감소.
 *
 * 비용 최적화:
 * - 같은 문서 내 여러 청크를 처리할 때 문서 요약을 system instruction 에 넣고 cachedContents 로 캐시
 * - Gemini 2.5 Flash 사용 (Haiku 대비 ~10× 저렴)
 */

const fetch = globalThis.fetch
const FLASH_MODEL = 'gemini-2.5-flash'

const PROMPT = `문서 내에서 아래 청크가 어떤 맥락·역할을 하는지 한국어 한 문장으로 설명.
검색 최적화 관점 — 고객이 질문했을 때 이 청크가 매칭되려면 어떤 문맥 정보가 필요한지 명시.
50~100토큰. 설명·접두사 없이 문장만.`

/**
 * @param {{ docTitle: string, docSummary: string, chunk: string, apiKey: string }} p
 * @returns {Promise<string>} contextual_text = "<문맥 문장>\n\n<chunk>"
 */
async function contextualizeChunk({ docTitle, docSummary, chunk, apiKey }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${FLASH_MODEL}:generateContent?key=${apiKey}`
  const body = {
    systemInstruction: {
      parts: [{ text: `${PROMPT}\n\n문서 제목: ${docTitle}\n문서 요약: ${docSummary}` }],
    },
    contents: [{ parts: [{ text: `청크:\n${chunk}` }] }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 150 },
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      console.warn(`[rag-ctx] HTTP ${res.status} — 원본 청크 사용`)
      return chunk
    }
    const json = await res.json()
    const ctx = json.candidates?.[0]?.content?.parts?.[0]?.text?.trim()
    if (!ctx) return chunk
    return `${ctx}\n\n${chunk}`
  } catch (err) {
    console.warn('[rag-ctx] 실패 — 원본 청크 사용:', err.message)
    return chunk
  }
}

/**
 * 텍스트를 고정 크기 청크로 분할 (문단 경계 존중).
 * @param {string} text
 * @param {number} maxChars default 1200 (~300 tokens)
 * @returns {string[]}
 */
function chunkText(text, maxChars = 1200) {
  if (!text) return []
  const paragraphs = text.split(/\n\n+/)
  const chunks = []
  let current = ''

  for (const p of paragraphs) {
    if (current.length + p.length + 2 > maxChars && current.length > 0) {
      chunks.push(current.trim())
      current = p
    } else {
      current = current ? `${current}\n\n${p}` : p
    }
  }
  if (current.trim().length > 0) chunks.push(current.trim())

  // 극단 긴 문단은 강제 분할
  return chunks.flatMap(c => {
    if (c.length <= maxChars * 1.5) return [c]
    const out = []
    for (let i = 0; i < c.length; i += maxChars) out.push(c.slice(i, i + maxChars))
    return out
  })
}

/**
 * 쿼리 텍스트 임베딩 호출 (RETRIEVAL_DOCUMENT task).
 * @returns {Promise<number[]|null>}
 */
async function embedDocument(text, apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${apiKey}`
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: { parts: [{ text }] },
        taskType: 'RETRIEVAL_DOCUMENT',
        outputDimensionality: 1536,  // v4 fix: DB schema 와 일치 (default 3072)
      }),
    })
    if (!res.ok) return null
    const json = await res.json()
    return json.embedding?.values ?? null
  } catch {
    return null
  }
}

/** FNV-1a content hash — dedupe 용 */
function hashContent(text) {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(36)
}

module.exports = { contextualizeChunk, chunkText, embedDocument, hashContent }
