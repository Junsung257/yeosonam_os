import { isSupabaseAdminConfigured, supabaseAdmin } from '@/lib/supabase';
import AdminPageClient, { type TravelPackage } from './AdminPageClient';

// Admin data depends on request-time Supabase credentials and must not prerender.
export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  if (!isSupabaseAdminConfigured) {
    return <AdminPageClient initialPendingPackages={[]} initialPendingPackageCount={0} />;
  }

  // 첫 화면에는 검수 대기 상품만 필요하다. 판매 상품 전체 목록은 사이드바의
  // 상품 관리에서 조회해 /admin 첫 응답의 DB·직렬화 비용을 줄인다.
  const pendingResult = await supabaseAdmin
    .from('travel_packages')
    .select('id, title, destination, price, status, created_at, filename, file_type, confidence', { count: 'exact' })
    .in('status', ['pending', 'pending_review', 'draft'])
    .order('created_at', { ascending: false })
    .limit(6);

  const pendingPackages = pendingResult.data ?? [];

  return (
    <AdminPageClient
      initialPendingPackages={pendingPackages as unknown as TravelPackage[]}
      initialPendingPackageCount={pendingResult.count ?? pendingPackages.length}
    />
  );
}
