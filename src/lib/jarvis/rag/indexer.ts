/**
 * 자비스 V2 RAG 자동 인덱싱 (v5, 2026-04-30)
 *
 * 등록·발행 hook 에서 호출 → 자비스가 즉시 학습.
 * 일괄 batch 스크립트(`db/rag_reindex_all.js`)와 동일 알고리즘이지만 server-side TS 모듈.
 *
 * 사용처:
 *   - /api/packages/[id]/approve (상품 승인 시)
 *   - /api/cron/publish-scheduled (블로그 발행 시)
 *   - /api/admin/attractions PATCH (관광지 수정 시)
 *   - /api/cron/rag-incremental (매시간 누락 보호)
 */
import { supabaseAdmin } from '@/lib/supabase';

const FLASH_MODEL = 'gemini-2.5-flash';
const EMBED_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent';

const CTX_PROMPT = `문서 내에서 아래 청크가 어떤 맥락·역할을 하는지 한국어 한 문장으로 설명.
검색 최적화 관점 — 고객이 질문했을 때 이 청크가 매칭되려면 어떤 문맥 정보가 필요한지 명시.
50~100토큰. 설명·접두사 없이 문장만.`;

export interface IndexableDoc {
  tenantId: string | null;
  sourceType: 'package' | 'blog' | 'attraction' | 'policy';
  sourceId: string;
  sourceUrl: string | null;
  sourceTitle: string;
  docSummary: string;
  body: string;
}

export interface IndexResult {
  inserted: number;
  skipped: number;
  failed: number;
}

function chunkText(text: string, maxChars = 1200): string[] {
  if (!text) return [];
  const paragraphs = text.split(/\n\n+/);
  const chunks: string[] = [];
  let current = '';
  for (const p of paragraphs) {
    if (current.length + p.length + 2 > maxChars && current.length > 0) {
      chunks.push(current.trim());
      current = p;
    } else {
      current = current ? `${current}\n\n${p}` : p;
    }
  }
  if (current.trim().length > 0) chunks.push(current.trim());
  return chunks.flatMap(c => {
    if (c.length <= maxChars * 1.5) return [c];
    const out: string[] = [];
    for (let i = 0; i < c.length; i += maxChars) out.push(c.slice(i, i + maxChars));
    return out;
  });
}

function hashContent(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h) + s.charCodeAt(i);
    h |= 0;
  }
  return (h >>> 0).toString(36);
}

async function contextualize(docTitle: string, docSummary: string, chunk: string): Promise<string> {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) return chunk;
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${FLASH_MODEL}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: `${CTX_PROMPT}\n\n문서 제목: ${docTitle}\n문서 요약: ${docSummary}` }] },
          contents: [{ parts: [{ text: `청크:\n${chunk}` }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 150 },
        }),
      },
    );
    if (!res.ok) return chunk;
    const json = await res.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const ctx = json.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    return ctx ? `${ctx}\n\n${chunk}` : chunk;
  } catch {
    return chunk;
  }
}

async function embed(text: string): Promise<number[] | null> {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch(`${EMBED_ENDPOINT}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: { parts: [{ text }] },
        taskType: 'RETRIEVAL_DOCUMENT',
        outputDimensionality: 1536,
      }),
    });
    if (!res.ok) return null;
    const json = await res.json() as { embedding?: { values?: number[] } };
    return json.embedding?.values ?? null;
  } catch {
    return null;
  }
}

/**
 * 단일 source(상품/블로그/관광지)를 즉시 인덱싱.
 * 등록·발행 hook 에서 호출. 실패해도 throw X (caller 흐름 막지 않음).
 *
 * dedupe: 같은 (tenant_id, source_type, source_id, chunk_index, content_hash) 이미 있으면 스킵.
 */
export async function indexDoc(doc: IndexableDoc): Promise<IndexResult> {
  const chunks = chunkText(doc.body);
  const result: IndexResult = { inserted: 0, skipped: 0, failed: 0 };
  if (chunks.length === 0) return result;

  for (let idx = 0; idx < chunks.length; idx++) {
    const raw = chunks[idx];
    const hash = hashContent(raw);

    // dedupe
    const { data: existing } = await supabaseAdmin
      .from('jarvis_knowledge_chunks')
      .select('id, content_hash')
      .eq('source_type', doc.sourceType)
      .eq('source_id', doc.sourceId)
      .eq('chunk_index', idx)
      .maybeSingle();
    if (existing && (existing as { content_hash: string }).content_hash === hash) {
      result.skipped++;
      continue;
    }

    const ctxText = await contextualize(doc.sourceTitle, doc.docSummary, raw);
    const embedding = await embed(ctxText);
    if (!embedding) { result.failed++; continue; }

    const { error } = await supabaseAdmin
      .from('jarvis_knowledge_chunks')
      .upsert({
        tenant_id: doc.tenantId,
        source_type: doc.sourceType,
        source_id: doc.sourceId,
        source_url: doc.sourceUrl,
        source_title: doc.sourceTitle,
        chunk_index: idx,
        chunk_text: raw,
        contextual_text: ctxText,
        embedding,
        content_hash: hash,
        metadata: {},
        updated_at: new Date().toISOString(),
      }, { onConflict: 'tenant_id,source_type,source_id,chunk_index' });

    if (error) {
      console.error(`[rag-indexer] upsert 실패 ${doc.sourceType}/${doc.sourceId}#${idx}:`, error.message);
      result.failed++;
      continue;
    }
    result.inserted++;
  }
  return result;
}

// ─── source 별 어댑터 (DB → IndexableDoc 변환) ─────────────────────

export async function indexPackage(packageId: string): Promise<IndexResult> {
  const { data: pkg, error } = await supabaseAdmin
    .from('travel_packages')
    .select('id, tenant_id, title, destination, product_summary, product_highlights, itinerary_data')
    .eq('id', packageId)
    .single();
  if (error || !pkg) return { inserted: 0, skipped: 0, failed: 1 };

  const itinFlat = flattenItinerary(pkg.itinerary_data);
  const highlightsText = Array.isArray(pkg.product_highlights) ? pkg.product_highlights.join('\n') : '';
  return indexDoc({
    tenantId: pkg.tenant_id ?? null,
    sourceType: 'package',
    sourceId: pkg.id,
    sourceUrl: `/packages/${pkg.id}`,
    sourceTitle: pkg.title,
    docSummary: `${pkg.destination ?? ''} · ${(pkg.product_summary ?? '').slice(0, 300)}`,
    body: [pkg.product_summary ?? '', highlightsText, itinFlat].filter(Boolean).join('\n\n'),
  });
}

export async function indexBlog(creativeId: string): Promise<IndexResult> {
  const { data: c, error } = await supabaseAdmin
    .from('content_creatives')
    .select('id, tenant_id, slug, seo_title, seo_description, blog_html, ad_copy')
    .eq('id', creativeId)
    .single();
  if (error || !c) return { inserted: 0, skipped: 0, failed: 1 };

  const stripped = (c.blog_html ?? c.ad_copy ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return indexDoc({
    tenantId: c.tenant_id ?? null,
    sourceType: 'blog',
    sourceId: c.id,
    sourceUrl: `/blog/${c.slug}`,
    sourceTitle: c.seo_title ?? '여행 가이드',
    docSummary: c.seo_description ?? c.seo_title ?? '',
    body: stripped,
  });
}

export async function indexPolicy(termId: string): Promise<IndexResult> {
  const { data: t, error } = await supabaseAdmin
    .from('terms_templates')
    .select('id, name, tier, scope, notices, version, is_active')
    .eq('id', termId)
    .single();
  if (error || !t) return { inserted: 0, skipped: 0, failed: 1 };
  if (!t.is_active) return { inserted: 0, skipped: 1, failed: 0 };

  // notices jsonb는 [{type, title, text}] 배열 형태 — 텍스트로 평탄화
  const noticesText = Array.isArray(t.notices)
    ? (t.notices as Array<{ type?: string; title?: string; text?: string }>)
        .map(n => `[${n.type ?? ''}] ${n.title ?? ''}\n${n.text ?? ''}`)
        .filter(s => s.trim().length > 5)
        .join('\n\n')
    : '';
  if (!noticesText) return { inserted: 0, skipped: 1, failed: 0 };

  return indexDoc({
    tenantId: null, // 약관은 공유
    sourceType: 'policy',
    sourceId: t.id,
    sourceUrl: null,
    sourceTitle: `${t.name} (${t.tier ?? ''} v${t.version ?? '?'})`,
    docSummary: `${t.tier ?? ''} 약관 — ${t.name}`,
    body: noticesText,
  });
}

export async function indexAttraction(attractionId: string): Promise<IndexResult> {
  const { data: a, error } = await supabaseAdmin
    .from('attractions')
    .select('id, name, country, region, long_desc, short_desc')
    .eq('id', attractionId)
    .single();
  if (error || !a) return { inserted: 0, skipped: 0, failed: 1 };
  if (!a.long_desc && !a.short_desc) return { inserted: 0, skipped: 1, failed: 0 };

  return indexDoc({
    tenantId: null,
    sourceType: 'attraction',
    sourceId: a.id,
    sourceUrl: null,
    sourceTitle: a.name,
    docSummary: `${[a.country, a.region].filter(Boolean).join(' · ')} · ${a.short_desc ?? ''}`.slice(0, 300),
    body: [a.long_desc, a.short_desc].filter(Boolean).join('\n\n'),
  });
}

function flattenItinerary(itin: unknown): string {
  if (!itin) return '';
  try {
    const days = Array.isArray(itin) ? itin : (itin as { days?: unknown }).days;
    if (!Array.isArray(days)) return '';
    return days.map((d: { items?: { activity?: string; name?: string }[]; schedule?: { activity?: string; name?: string }[] }, i: number) => {
      const items = (d.items ?? d.schedule ?? [])
        .map(it => it.activity ?? it.name ?? '')
        .filter(Boolean).join(', ');
      return `Day ${i + 1}: ${items}`;
    }).join('\n');
  } catch {
    return '';
  }
}
