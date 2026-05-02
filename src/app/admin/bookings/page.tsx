import { getBookings } from '@/lib/supabase';
import BookingsPageClient from './BookingsPageClient';

// Windows 로컬: force-dynamic (chunk race 회피)
// Vercel(Linux): auto → 서버 pre-fetch 후 클라이언트에 전달
export const dynamic = process.platform === 'win32' ? 'force-dynamic' : 'auto';

export default async function BookingsPage() {
  const initialBookings = await getBookings();
  return <BookingsPageClient initialBookings={initialBookings as any} />;
}
