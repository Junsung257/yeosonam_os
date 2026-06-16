import { supabaseAdmin, isSupabaseAdminConfigured } from '@/lib/supabase';
import BlogQueueClient from './BlogQueueClient';

export const dynamic = 'force-dynamic';

export default async function BlogQueuePage() {
  if (!isSupabaseAdminConfigured) {
    return <BlogQueueClient />;
  }

  const [itemsResult, statsResult] = await Promise.all([
    supabaseAdmin
      .from('blog_topic_queue')
      .select('*')
      .order('target_publish_at', { ascending: true, nullsFirst: false })
      .order('priority', { ascending: false })
      .limit(200),
    supabaseAdmin
      .from('blog_topic_queue')
      .select('status'),
  ]);

  const counts: Record<string, number> = {};
  ((statsResult.data ?? []) as { status: string }[]).forEach(r => {
    counts[r.status] = (counts[r.status] || 0) + 1;
  });

  return (
    <BlogQueueClient
      initialItems={(itemsResult.data ?? []) as unknown as Array<{ id: string; topic: string; source: string; priority: number; destination: string | null; angle_type: string | null; category: string | null; target_publish_at: string | null; status: string; attempts: number; last_error: string | null; content_creative_id: string | null; created_at: string; primary_keyword: string | null; keyword_tier: 'head' | 'mid' | 'longtail' | null; monthly_search_volume: number | null; competition_level: 'low' | 'medium' | 'high' | null; trend_score: number | null; meta?: { search_intent?: string } | null; }>}
      initialCounts={counts}
    />
  );
}
