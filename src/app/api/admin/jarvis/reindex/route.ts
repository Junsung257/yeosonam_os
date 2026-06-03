/**
 * POST /api/admin/jarvis/reindex
 * Body: { source: 'package'|'blog'|'attraction'|'policy', id: string }
 *
 * 사장님 수동 재인덱싱 — JarvisRagStatusCard 또는 RAG 검색 페이지 버튼에서 호출.
 */
import { type NextRequest, type NextResponse } from 'next/server';
import { isSupabaseConfigured } from '@/lib/supabase';
import { indexPackage, indexBlog, indexAttraction, indexPolicy } from '@/lib/jarvis/rag/indexer';
import { withAdminGuard } from '@/lib/admin-guard';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';

export const runtime = 'nodejs';
export const maxDuration = 60;

const postHandler = async (req: NextRequest): Promise<NextResponse> => {
  if (!isSupabaseConfigured) return apiResponse({ error: 'supabase 미설정' }, { status: 503 });
  try {
    const body = await req.json() as { source: string; id: string };
    if (!body.source || !body.id) {
      return apiResponse({ error: 'source, id 필수' }, { status: 400 });
    }
    let result;
    switch (body.source) {
      case 'package': result = await indexPackage(body.id); break;
      case 'blog': result = await indexBlog(body.id); break;
      case 'attraction': result = await indexAttraction(body.id); break;
      case 'policy': result = await indexPolicy(body.id); break;
      default: return apiResponse({ error: 'invalid source' }, { status: 400 });
    }
    return apiResponse({ ok: true, ...result });
  } catch (e) {
    return apiResponse(
      { error: sanitizeDbError(e, 'failed') },
      { status: 500 },
    );
  }
}

export const POST = withAdminGuard(postHandler);
