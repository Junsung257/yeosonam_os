import { revalidatePath } from 'next/cache';
import { type NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return apiResponse({ error: 'DB 미설정' }, { status: 503 });
  }

  try {
    const body = await request.json();
    const { creative_id, action } = body;

    if (!creative_id) {
      return apiResponse({ error: 'creative_id 필요' }, { status: 400 });
    }

    const status =
      action === 'archive' ? 'archived' :
      action === 'manually_published' ? 'manually_published' :
      'published';
    const updateData: Record<string, unknown> = { status };
    if (status === 'published' || status === 'manually_published') {
      updateData.published_at = new Date().toISOString();
    }

    const { error } = await supabaseAdmin
      .from('content_creatives')
      .update(updateData)
      .eq('id', creative_id);

    if (error) throw error;

    if (status === 'published' || status === 'manually_published') {
      revalidatePath('/blog');

      const { data: creative } = await supabaseAdmin
        .from('content_creatives')
        .select('slug, product_id, travel_packages(destination)')
        .eq('id', creative_id)
        .limit(1);
      const row = creative?.[0] as Record<string, unknown>;
      if (row?.slug) revalidatePath(`/blog/${row.slug}`);
      if ((row?.travel_packages as { destination?: string } | undefined)?.destination) {
        revalidatePath(`/blog/destination/${encodeURIComponent((row?.travel_packages as { destination?: string } | undefined)?.destination ?? '')}`);
      }

      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://yeosonam.com';
      if (row?.slug) {
        const { notifyIndexing } = await import('@/lib/indexing');
        notifyIndexing(`${baseUrl}/blog/${row.slug}`, baseUrl)
          .then(r => console.log(`[content-hub/publish] indexing notified: google=${r.google}, indexnow=${r.indexnow}`))
          .catch(() => {});
      }
    }

    return apiResponse({ ok: true, status });
  } catch (err) {
    console.error('[content-hub/publish] failed:', sanitizeDbError(err));
    return apiResponse({ error: sanitizeDbError(err, '발행 실패') }, { status: 500 });
  }
}
