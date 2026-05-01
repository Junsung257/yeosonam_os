/**
 * POST /api/admin/jarvis/reindex
 * Body: { source: 'package'|'blog'|'attraction'|'policy', id: string }
 *
 * 사장님 수동 재인덱싱 — JarvisRagStatusCard 또는 RAG 검색 페이지 버튼에서 호출.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured } from '@/lib/supabase';
import { indexPackage, indexBlog, indexAttraction, indexPolicy } from '@/lib/jarvis/rag/indexer';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'supabase 미설정' }, { status: 503 });
  try {
    const body = await req.json() as { source: string; id: string };
    if (!body.source || !body.id) {
      return NextResponse.json({ error: 'source, id 필수' }, { status: 400 });
    }
    let result;
    switch (body.source) {
      case 'package': result = await indexPackage(body.id); break;
      case 'blog': result = await indexBlog(body.id); break;
      case 'attraction': result = await indexAttraction(body.id); break;
      case 'policy': result = await indexPolicy(body.id); break;
      default: return NextResponse.json({ error: 'invalid source' }, { status: 400 });
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'failed' },
      { status: 500 },
    );
  }
}
