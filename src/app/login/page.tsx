// 서버 컴포넌트 wrapper — Windows webpack chunk race 회피용 prerender 비활성.
// ERR-windows-prerender-chunk@2026-04-26 (Next.js 14.0.4 client component 'export const dynamic' 무시 버그 회피)
export const dynamic = 'force-dynamic';

import LoginForm from './LoginForm';

export default function LoginPage() {
  return <LoginForm />;
}
