import { notFound } from 'next/navigation';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import ReelsShareClient from './ReelsShareClient';

export const dynamic = 'force-dynamic';

interface ReelPhoto {
  url: string;
  caption?: string;
}

interface ReelRecord {
  id: string;
  destination: string | null;
  template_id: string;
  photos: ReelPhoto[];
  created_at: string;
  share_token: string;
}

interface PageProps {
  params: Promise<{ token: string }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { token } = await params;
  return {
    title: '여행 추억 릴스 | 여소남',
    description: `여소남과 함께한 여행 추억을 공유하세요`,
    openGraph: {
      title: '여행 추억 릴스 | 여소남',
      description: '여소남과 함께한 특별한 여행 순간들',
      url: `https://yeosonam.com/reels/${token}`,
    },
  };
}

export default async function ReelsTokenPage({ params }: PageProps) {
  const { token } = await params;

  if (!isSupabaseConfigured) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-500">서비스 준비 중입니다.</p>
      </div>
    );
  }

  const { data: rows, error } = await supabaseAdmin
    .from('travel_reels')
    .select('id, destination, template_id, photos, created_at, share_token')
    .eq('share_token', token)
    .limit(1);

  if (error || !rows || rows.length === 0) {
    notFound();
  }

  const reel = rows[0] as ReelRecord;

  return <ReelsShareClient reel={reel} />;
}
