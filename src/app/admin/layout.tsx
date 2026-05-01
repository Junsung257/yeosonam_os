import AdminLayout from '@/components/AdminLayout';

// Windows dev: chunk race 방지 (ERR-windows-prerender-chunk@2026-04-26)
// Vercel(Linux): 'auto' → 레이아웃 셸 캐싱 허용, 실제 데이터는 클라이언트 useEffect로 로드
export const dynamic = process.platform === 'win32' ? 'force-dynamic' : 'auto';

export default function Layout({ children }: { children: React.ReactNode }) {
  return <AdminLayout>{children}</AdminLayout>;
}
