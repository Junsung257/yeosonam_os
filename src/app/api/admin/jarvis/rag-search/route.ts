/**
 * GET /api/admin/jarvis/rag-search?q=&source=
 *
 * /admin/jarvis/rag 페이지가 호출. retriever lib 그대로 활용.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured } from '@/lib/supabase';
import { retrieve, type SourceType } from '@/lib/jarvis/rag/retriever';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ hits: [] });
  const sp = req.nextUrl.searchParams;
  const q = sp.get('q')?.trim();
  if (!q) return NextResponse.json({ hits: [], error: 'q 필수' }, { status: 400 });

  const source = sp.get('source');
  const sourceTypes = source && ['package', 'blog', 'attraction', 'policy'].includes(source)
    ? [source as SourceType]
    : undefined;

  try {
    const hits = await retrieve({
      query: q,
      tenantId: undefined,        // admin 검색은 본사 (NULL) 만
      sourceTypes,
      limit: 10,
      rerank: false,              // 원본 RRF 순서 유지 (검증용)
    });
    return NextResponse.json({
      hits: hits.map(h => ({
        source_type: h.sourceType,
        source_id: h.sourceId,
        source_title: h.sourceTitle,
        source_url: h.sourceUrl,
        chunk_text: h.chunkText,
        contextual_text: h.contextualText,
        rrf_score: h.score,
        vector_score: h.vectorScore,
        bm25_score: h.bm25Score,
      })),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'failed', hits: [] },
      { status: 500 },
    );
  }
}
