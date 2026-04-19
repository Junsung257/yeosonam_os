import Link from 'next/link';
import { MobileHeader } from '@/components/admin/mobile/MobileHeader';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { cookies } from 'next/headers';
import NotificationsClient from './_client';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export interface NotifRow {
  id: string;
  title: string;
  body: string | null;
  deep_link: string | null;
  kind: string | null;
  read_at: string | null;
  created_at: string;
}

function userIdFromCookie(): string | null {
  try {
    const token = cookies().get('sb-access-token')?.value;
    if (!token) return null;
    const payload = JSON.parse(
      Buffer.from(token.split('.')[1], 'base64').toString('utf-8'),
    );
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}

async function fetchNotifs(): Promise<NotifRow[]> {
  if (!isSupabaseConfigured) return [];
  const userId = userIdFromCookie();
  if (!userId) return [];
  const { data } = await supabaseAdmin
    .from('push_notifications')
    .select('id, title, body, deep_link, kind, read_at, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(100);
  return (data as NotifRow[] | null) ?? [];
}

export default async function MobileNotificationsPage() {
  const rows = await fetchNotifs();

  return (
    <>
      <MobileHeader
        title="알림"
        subtitle={`최근 ${rows.length}건`}
        rightSlot={
          <Link
            href="/m/admin/settings"
            className="text-xs text-slate-500 px-3 py-1.5"
          >
            설정
          </Link>
        }
      />
      <NotificationsClient rows={rows} />
    </>
  );
}
