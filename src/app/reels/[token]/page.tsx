import { notFound } from 'next/navigation';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import ReelsShareClient from './ReelsShareClient';
import type { Metadata } from 'next';

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
  params: Promise<{ token?: string | string[] }>;
}

function siteBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || 'https://www.yeosonam.com')
    .replace(/\/+$/, '');
}

function reelsCanonical(token: string): string {
  const baseUrl = siteBaseUrl();
  return token ? `${baseUrl}/reels/${encodeURIComponent(token)}` : `${baseUrl}/reels`;
}

function socialImageUrl(): string {
  return `${siteBaseUrl()}/og-image.png`;
}

function getRouteParam(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value ?? '').trim();
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { token: rawToken } = await params;
  const token = getRouteParam(rawToken);
  const url = reelsCanonical(token);
  const imageUrl = socialImageUrl();
  return {
    title: '여행 추억 릴스',
    description: `여소남과 함께한 여행 추억을 공유하세요`,
    alternates: { canonical: url },
    robots: { index: false, follow: false },
    openGraph: {
      title: '여행 추억 릴스',
      description: '여소남과 함께한 특별한 여행 순간들',
      url,
      images: [{ url: imageUrl, width: 1200, height: 630 }],
    },
    twitter: {
      card: 'summary_large_image',
      title: 'Travel memory reels',
      description: 'Share your travel memories with Yeosonam.',
      images: [imageUrl],
    },
  };
}

export default async function ReelsTokenPage({ params }: PageProps) {
  const { token: rawToken } = await params;
  const token = getRouteParam(rawToken);
  if (!token) notFound();

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
