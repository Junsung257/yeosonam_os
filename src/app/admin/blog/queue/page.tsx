import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import BlogQueueClient from './BlogQueueClient';

export const dynamic = process.platform === 'win32' ? 'force-dynamic' : 'auto';

export default async function BlogQueuePage() {
  if (!isSupabaseConfigured) {
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
      initialItems={(itemsResult.data ?? []) as any}
      initialCounts={counts}
    />
  );
}
