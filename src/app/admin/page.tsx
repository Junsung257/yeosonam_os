import { supabaseAdmin } from '@/lib/supabase';
import AdminPageClient from './AdminPageClient';

// Windows 로컬: force-dynamic (chunk race 회피)
// Vercel(Linux): auto → 패키지 목록 server pre-fetch 후 클라이언트에 전달
export const dynamic = process.platform === 'win32' ? 'force-dynamic' : 'auto';

export default async function AdminPage() {
  // 대시보드에서 가장 먼저 보이는 데이터: 승인대기 + 전체 패키지 목록
  // Promise.all로 병렬 조회 — 클라이언트 useEffect waterfall 제거
  const [pendingResult, approvedResult] = await Promise.all([
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

  return (
    <AdminPageClient
      initialPendingPackages={(pendingResult.data ?? []) as any}
      initialPackages={(approvedResult.data ?? []) as any}
    />
  );
}
