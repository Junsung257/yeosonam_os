// Windows webpack chunk race + Next.js 14.0.4 'use client' page export 무시 버그 회피.
// page.tsx 가 server wrapper 라도 layout 단계 dynamic 선언이 추가로 필요함 (검증: 2026-04-26).
// ERR-windows-prerender-chunk@2026-04-26
export const dynamic = 'force-dynamic';

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
