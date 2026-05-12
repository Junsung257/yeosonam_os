import { supabaseAdmin, isSupabaseConfigured, getCardNewsList } from '@/lib/supabase';
import CardNewsListPageClient from './CardNewsListPageClient';

export const dynamic = process.platform === 'win32' ? 'force-dynamic' : 'auto';

export default async function CardNewsPage() {
  if (!isSupabaseConfigured) {
    return <CardNewsListPageClient />;
  }

  const [list, packagesResult, categoriesResult] = await Promise.all([
    getCardNewsList({ limit: 100 }),
    supabaseAdmin
      .from('travel_packages')
      .select('id, title, destination, status')
      .in('status', ['approved', 'active', 'pending', 'pending_review', 'draft'])
      .order('created_at', { ascending: false })
      .limit(200),
    supabaseAdmin
      .from('blog_categories')
      .select('id, key, label, scope')
      .eq('scope', 'info'),
  ]);

  return (
    <CardNewsListPageClient
      initialList={list as any}
      initialPackages={(packagesResult.data ?? []) as any}
      initialCategories={(categoriesResult.data ?? []) as any}
    />
  );
}
