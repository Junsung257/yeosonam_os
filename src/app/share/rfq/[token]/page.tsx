import { getSharedRfq, getRfqReactions } from '@/lib/db/rfq-share';
import { notFound } from 'next/navigation';
import { RfqShareClient } from './RfqShareClient';
import type { Metadata } from 'next';

interface Props {
  params: Promise<{ token: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params;
  const data = await getSharedRfq(token);
  if (!data) return { title: '견적 공유 - 여소남' };

  return {
    title: `${data.customer_name}님의 단독맞춤여행 견적`,
    description: `${data.destination} · ${data.adult_count + data.child_count}명 · ${data.duration_nights ?? '문의'}박`,
    openGraph: {
      title: `${data.customer_name}님의 여행 견적`,
      description: `함께 떠날 ${data.destination} 여행 견적을 확인해보세요!`,
    },
  };
}

export default async function RfqSharePage({ params }: Props) {
  const { token } = await params;
  const data = await getSharedRfq(token);
  if (!data) notFound();

  const reactions = await getRfqReactions(data.id);

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
      shareToken={token}
    />
  );
}
