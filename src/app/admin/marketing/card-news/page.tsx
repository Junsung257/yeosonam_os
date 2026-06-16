import { supabaseAdmin, isSupabaseAdminConfigured, getCardNewsList } from '@/lib/supabase';
import type { CardNews } from '@/lib/supabase';
import CardNewsListPageClient from './CardNewsListPageClient';

export const dynamic = 'force-dynamic';

export default async function CardNewsPage() {
  if (!isSupabaseAdminConfigured) {
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
      initialList={list as unknown as CardNews[]}
      initialPackages={(packagesResult.data ?? []) as unknown as Array<{ id: string; title: string; destination: string; status: string; }>}
      initialCategories={(categoriesResult.data ?? []) as unknown as Array<{ id: string; key: string; label: string; scope: string; }>}
    />
  );
}
