'use client';

import { useState } from 'react';
import { Link2, Check, Facebook, Twitter, MessageCircle } from 'lucide-react';

interface Props {
  url: string;
  title: string;
  compact?: boolean;
}

export default function ShareButtons({ url, title, compact = false }: Props) {
  const [copied, setCopied] = useState(false);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt('링크를 복사해 주세요', url);
    }
  };

  const openShare = (shareUrl: string) => {
    window.open(shareUrl, '_blank', 'width=540,height=640,noopener,noreferrer');
  };

  const kakaoStory = `https://story.kakao.com/share?url=${encodeURIComponent(url)}`;
  const facebook = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`;
  const twitter = `https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}&text=${encodeURIComponent(title)}`;

  const btnBase =
    'inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700';

  return (
    <div className={`flex flex-wrap items-center gap-2 ${compact ? '' : 'my-6'}`}>
      {!compact && (
        <span className="mr-1 text-xs font-semibold uppercase tracking-wider text-gray-400">
          공유하기
        </span>
      )}
      <button type="button" onClick={copyLink} className={btnBase} aria-label="링크 복사">
        {copied ? <Check size={14} /> : <Link2 size={14} />}
        {copied ? '복사됨' : '링크'}
      </button>
      <button
        type="button"
        onClick={() => openShare(kakaoStory)}
        className={btnBase}
        aria-label="카카오스토리로 공유"
      >
        <MessageCircle size={14} />
        카카오
      </button>
      <button
        type="button"
        onClick={() => openShare(facebook)}
        className={btnBase}
        aria-label="페이스북으로 공유"
      >
        <Facebook size={14} />
        페이스북
      </button>
      <button
        type="button"
        onClick={() => openShare(twitter)}
        className={btnBase}
        aria-label="X(트위터)로 공유"
      >
        <Twitter size={14} />X
      </button>
    </div>
  );
}
