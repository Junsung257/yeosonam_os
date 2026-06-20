'use client';

import { useEffect, useRef, useState } from 'react';
import { Link2, Check, Facebook, Twitter, MessageCircle } from 'lucide-react';
import { buildTrackedShareUrl } from '@/lib/share-url';

interface Props {
  url: string;
  title: string;
  compact?: boolean;
  /** utm_campaign (예: 블로그 slug) */
  utmCampaign?: string;
}

export default function ShareButtons({ url, title, compact = false, utmCampaign = 'blog' }: Props) {
  const [copied, setCopied] = useState(false);
  const [manualCopyUrl, setManualCopyUrl] = useState('');
  const [copyMessage, setCopyMessage] = useState('');
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const manualInputRef = useRef<HTMLInputElement | null>(null);

  const tracked = (channel: Parameters<typeof buildTrackedShareUrl>[1]['channel']) =>
    buildTrackedShareUrl(url, { channel, utmCampaign });

  useEffect(() => () => {
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
  }, []);

  const showCopyMessage = (message: string, autoHide = true) => {
    setCopyMessage(message);
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    if (autoHide) {
      statusTimerRef.current = setTimeout(() => {
        setCopied(false);
        setCopyMessage('');
      }, 1800);
    }
  };

  const copyLink = async () => {
    const toCopy = tracked('copy');
    try {
      await navigator.clipboard.writeText(toCopy);
      setCopied(true);
      setManualCopyUrl('');
      showCopyMessage('링크가 복사되었습니다.');
    } catch {
      setCopied(false);
      setManualCopyUrl(toCopy);
      showCopyMessage('자동 복사가 막혔습니다. 아래 링크를 길게 누르거나 선택해 복사해 주세요.', false);
      requestAnimationFrame(() => {
        manualInputRef.current?.focus();
        manualInputRef.current?.select();
      });
    }
  };

  const openShare = (shareUrl: string) => {
    window.open(shareUrl, '_blank', 'width=540,height=640,noopener,noreferrer');
  };

  const shareTarget = tracked('kakao');
  const kakaoStory = `https://story.kakao.com/share?url=${encodeURIComponent(shareTarget)}`;
  const facebook = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(tracked('facebook'))}`;
  const twitter = `https://twitter.com/intent/tweet?url=${encodeURIComponent(tracked('twitter'))}&text=${encodeURIComponent(title)}`;

  const btnBase =
    'inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-blue-200 hover:bg-brand-light hover:text-brand';

  return (
    <div className={compact ? '' : 'my-6'}>
      <div className="flex flex-wrap items-center gap-2">
        {!compact && (
          <span className="mr-1 text-xs font-semibold uppercase tracking-wider text-slate-400">
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
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {copyMessage}
      </p>
      {manualCopyUrl && (
        <div className="mt-2 flex max-w-xl flex-col gap-2 rounded-lg border border-blue-100 bg-brand-light/60 p-2 sm:flex-row sm:items-center">
          <label htmlFor="blog-share-copy-url" className="sr-only">직접 복사할 공유 링크</label>
          <input
            ref={manualInputRef}
            id="blog-share-copy-url"
            readOnly
            value={manualCopyUrl}
            onFocus={event => event.currentTarget.select()}
            className="min-w-0 flex-1 rounded-md border border-blue-100 bg-white px-2 py-1.5 text-xs text-slate-700 outline-none focus:border-brand focus:ring-2 focus:ring-blue-100"
          />
          <button
            type="button"
            onClick={() => manualInputRef.current?.select()}
            className="rounded-md border border-blue-100 bg-white px-3 py-1.5 text-xs font-medium text-brand transition hover:bg-blue-50"
          >
            전체 선택
          </button>
        </div>
      )}
    </div>
  );
}
