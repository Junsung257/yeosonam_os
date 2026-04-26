import AdminLayout from '@/components/AdminLayout';

// Windows webpack chunk race + admin 페이지 인증 필요 → 자식 페이지 prerender 비활성.
// ERR-windows-prerender-chunk@2026-04-26 (Next.js 14.0.4 client component chunk loading bug on Windows + Korean path)
export const dynamic = 'force-dynamic';

export default function Layout({ children }: { children: React.ReactNode }) {
  return <AdminLayout>{children}</AdminLayout>;
}
