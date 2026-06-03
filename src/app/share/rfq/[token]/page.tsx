import { getSharedRfq, getRfqReactions } from '@/lib/db/rfq-share';
import { notFound } from 'next/navigation';
import { RfqShareClient } from './RfqShareClient';
import type { Metadata } from 'next';

interface Props {
  params: Promise<{ token?: string | string[] }>;
}

const FALLBACK_METADATA: Metadata = {
  title: '견적 공유 - 여소남',
  description: '여소남 단체 맞춤여행 견적 공유 링크입니다.',
  robots: { index: false, follow: false },
};

function getRouteParam(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value ?? '').trim();
}

function siteBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || 'https://www.yeosonam.com')
    .replace(/\/+$/, '');
}

function socialImageUrl(): string {
  return `${siteBaseUrl()}/og-image.png`;
}

function rfqShareCanonical(token: string): string {
  const baseUrl = siteBaseUrl();
  return token ? `${baseUrl}/share/rfq/${encodeURIComponent(token)}` : `${baseUrl}/share/rfq`;
}

function withCanonical(metadata: Metadata, canonical: string): Metadata {
  return {
    ...metadata,
    alternates: { canonical },
  };
}

async function safeGetSharedRfq(token: string) {
  const normalizedToken = token.trim();
  if (!normalizedToken) return null;

  try {
    return await getSharedRfq(normalizedToken);
  } catch {
    return null;
  }
}

async function safeGetRfqReactions(rfqId: string) {
  try {
    return await getRfqReactions(rfqId);
  } catch {
    return [];
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token: rawToken } = await params;
  const token = getRouteParam(rawToken);
  const canonical = rfqShareCanonical(token);
  const data = await safeGetSharedRfq(token);
  if (!data) return withCanonical(FALLBACK_METADATA, canonical);

  const customerName = data.customer_name?.trim() || '고객';
  const destination = data.destination?.trim() || '여행지';
  const adultCount = Number.isFinite(Number(data.adult_count)) ? Number(data.adult_count) : 0;
  const childCount = Number.isFinite(Number(data.child_count)) ? Number(data.child_count) : 0;
  const travelerCount = adultCount + childCount;
  const nights = data.duration_nights ?? '문의';
  const imageUrl = socialImageUrl();

  return {
    title: `${customerName}님의 단독맞춤여행 견적`,
    description: `${destination} · ${travelerCount || '문의'}명 · ${nights}박`,
    robots: { index: false, follow: false },
    alternates: { canonical },
    openGraph: {
      url: canonical,
      title: `${customerName}님의 여행 견적`,
      description: `함께 떠날 ${destination} 여행 견적을 확인해보세요.`,
      images: [{ url: imageUrl, width: 1200, height: 630 }],
    },
    twitter: {
      card: 'summary_large_image',
      title: `${customerName}님의 여행 견적`,
      description: `함께 떠날 ${destination} 여행 견적을 확인해보세요.`,
      images: [imageUrl],
    },
  };
}

export default async function RfqSharePage({ params }: Props) {
  const { token: rawToken } = await params;
  const token = getRouteParam(rawToken);
  const data = await safeGetSharedRfq(token);
  if (!data) notFound();

  const reactions = await safeGetRfqReactions(data.id);

  const reactionCounts = {
    like: reactions.filter(r => r.reaction_type === 'like').length,
    curious: reactions.filter(r => r.reaction_type === 'curious').length,
    vote_a: reactions.filter(r => r.reaction_type === 'vote_a').length,
    vote_b: reactions.filter(r => r.reaction_type === 'vote_b').length,
    vote_c: reactions.filter(r => r.reaction_type === 'vote_c').length,
  };

  return (
    <RfqShareClient
      rfq={data}
      reactionCounts={reactionCounts}
      shareToken={token.trim()}
    />
  );
}
