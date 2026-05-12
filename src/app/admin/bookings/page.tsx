import { getBookings } from '@/lib/supabase';
import BookingsPageClient from './BookingsPageClient';

// Windows 로컬: force-dynamic (chunk race 회피)
// Vercel(Linux): auto → 서버 pre-fetch 후 클라이언트에 전달
export const dynamic = process.platform === 'win32' ? 'force-dynamic' : 'auto';

export default async function BookingsPage() {
  // 감사(2026-05-11): lite=true — 110+ 컬럼 → 어드민 목록용 50개. 페이로드 50%+ 감소.
  const initialBookings = await getBookings(undefined, undefined, { lite: true });
  return <BookingsPageClient initialBookings={initialBookings as any} />;
}
