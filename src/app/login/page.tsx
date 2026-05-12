// Windows 로컬만 force-dynamic 유지 (webpack chunk race 회피),
// 운영(Linux)은 auto로 두어 Next 정적/캐시 최적화를 활용한다.
export const dynamic = process.platform === 'win32' ? 'force-dynamic' : 'auto';

import LoginForm from './LoginForm';

export default function LoginPage() {
  return <LoginForm />;
}
