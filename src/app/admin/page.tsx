import { isSupabaseAdminConfigured, supabaseAdmin } from '@/lib/supabase';
import AdminPageClient, { type TravelPackage } from './AdminPageClient';

// Admin data depends on request-time Supabase credentials and must not prerender.
export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  if (!isSupabaseAdminConfigured) {
    return <AdminPageClient initialPendingPackages={[]} initialPackages={[]} />;
  }

  // 대시보드에서 가장 먼저 보이는 데이터: 승인대기 + 전체 패키지 목록
  // Promise.all로 병렬 조회 — 클라이언트 useEffect waterfall 제거
  // Server prefetch is only a speed hint. Keep the page renderable even if a
  // table/query drifts; the client has per-widget loading/error states.
  const [pendingResult, approvedResult] = await Promise.allSettled([
    supabaseAdmin
      .from('travel_packages')
      .select('id, title, destination, price, status, created_at, filename, file_type, confidence')
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(20),
    supabaseAdmin
      .from('travel_packages')
      .select('id, title, destination, price, status, created_at, filename, file_type, confidence')
      .in('status', ['active', 'approved'])
      .order('created_at', { ascending: false })
      .limit(50),
  ]);

  const pendingPackages =
    pendingResult.status === 'fulfilled' ? (pendingResult.value.data ?? []) : [];
  const approvedPackages =
    approvedResult.status === 'fulfilled' ? (approvedResult.value.data ?? []) : [];

  return (
    <AdminPageClient
      initialPendingPackages={pendingPackages as unknown as TravelPackage[]}
      initialPackages={approvedPackages as unknown as TravelPackage[]}
    />
  );
}
