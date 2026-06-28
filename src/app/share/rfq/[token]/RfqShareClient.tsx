'use client';

import { useState, useEffect, useCallback } from 'react';
import { safeOpenNewWindow } from '@/lib/safe-window-open';
import type { SharedRfqData } from '@/lib/db/rfq-share';

declare global {
  interface Window {
    Kakao?: {
      isInitialized: () => boolean;
      Share: {
        sendDefault: (config: Record<string, unknown>) => void;
      };
    };
  }
}

function fmt(n: number) {
  return n.toLocaleString('ko-KR');
}

function scoreBar(score: number): string {
  if (score >= 90) return '🟢';
  if (score >= 70) return '🟡';
  return '🔴';
}

function getVisitorToken(): string {
  if (typeof window === 'undefined') return '';
  let token = sessionStorage.getItem('rfq_visitor_token');
  if (!token) {
    token = `vis_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    sessionStorage.setItem('rfq_visitor_token', token);
  }
  return token;
}

interface ReactionCounts {
  like: number;
  curious: number;
  vote_a: number;
  vote_b: number;
  vote_c: number;
}

interface Props {
  rfq: SharedRfqData;
  reactionCounts: ReactionCounts;
  shareToken: string;
}

const PROPOSAL_LABELS: Record<string, string> = {
  proposal_a: 'A안',
  proposal_b: 'B안',
  proposal_c: 'C안',
};

const HOTEL_LABELS: Record<string, string> = {
  '3': '⭐ 3성급',
  '4': '⭐⭐ 4성급',
  '5': '⭐⭐⭐ 5성급',
  '특급': '⭐⭐⭐ 특급호텔',
};

export function RfqShareClient({ rfq, reactionCounts: initialCounts, shareToken }: Props) {
  const [counts, setCounts] = useState(initialCounts);
  const [myReactions, setMyReactions] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);
  const [commentMap, setCommentMap] = useState<Record<string, string>>({});
  const visitorToken = getVisitorToken();

  // 현재 페이지 URL
  const shareUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/share/rfq/${shareToken}`
    : '';

  const proposals = [
    rfq.proposal_a && { key: 'proposal_a', ...rfq.proposal_a },
    rfq.proposal_b && { key: 'proposal_b', ...rfq.proposal_b },
    rfq.proposal_c && { key: 'proposal_c', ...rfq.proposal_c },
  ].filter(Boolean) as Array<{ key: string; title: string; summary: string; price: number; ai_score?: number; tenant_name?: string }>;

  const hasProposals = proposals.length > 0;

  /** 반응 추가 */
  const addReaction = useCallback(async (type: string) => {
    if (myReactions.has(type)) return;
    setMyReactions(prev => new Set(prev).add(type));
    setCounts(prev => ({ ...prev, [type]: prev[type as keyof ReactionCounts] + 1 }));

    const comment = type.startsWith('vote_') ? commentMap[type] : undefined;

    await fetch('/api/rfq/share/reaction', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rfqId: rfq.id,
        visitorToken,
        reactionType: type,
        comment,
      }),
    });
  }, [myReactions, rfq.id, visitorToken, commentMap]);

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
      const input = document.createElement('input');
      input.value = shareUrl;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleShareKakao = () => {
    if (typeof window === 'undefined') return;
    const text = `${rfq.customer_name}님의 ${rfq.destination} 여행 견적을 확인해보세요!`;

    // Kakao SDK가 로드되어 있으면 SDK 공유, 아니면 kakao.link API 활용
    if (typeof window.Kakao !== 'undefined' && window.Kakao.isInitialized()) {
      window.Kakao.Share.sendDefault({
        objectType: 'feed',
        content: {
          title: `✈️ ${rfq.customer_name}님의 ${rfq.destination} 단독맞춤여행 견적`,
          description: `${rfq.adult_count + rfq.child_count}명 · ${rfq.duration_nights ?? '?'}박`,
          imageUrl: `${window.location.origin}/og-private-tour.png`,
          link: { mobileWebUrl: shareUrl, webUrl: shareUrl },
        },
        buttons: [{
          title: '견적 확인하기',
          link: { mobileWebUrl: shareUrl, webUrl: shareUrl },
        }],
      });
    } else {
      // fallback: 카카오톡 앱 스킴 (모바일)
      const kakaoScheme = `kakaotalk://sendurl?url=${encodeURIComponent(shareUrl)}&appname=여소남`;
      safeOpenNewWindow(kakaoScheme);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white">
      <div className="max-w-2xl mx-auto px-4 py-6 space-y-5">

        {/* ── 헤더 ── */}
        <div className="bg-white rounded-2xl border shadow-sm p-6 text-center">
          <div className="inline-flex items-center gap-1 bg-blue-100 text-blue-700 text-xs px-3 py-1 rounded-full font-semibold mb-3">
            ✈️ 단독맞춤여행
          </div>
          <h1 className="text-xl font-bold text-gray-900">
            {rfq.customer_name}님의 여행 견적
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {rfq.destination} · {rfq.adult_count + rfq.child_count}명
            {rfq.duration_nights ? ` · ${rfq.duration_nights}박` : ''}
          </p>
        </div>

        {/* ── 견적 요약 ── */}
        <div className="bg-white rounded-xl border shadow-sm p-5">
          <h2 className="font-semibold text-gray-900 text-sm mb-3">📋 견적 요약</h2>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-gray-400 text-xs">목적지</span>
              <p className="font-medium text-gray-900">{rfq.destination}</p>
            </div>
            <div>
              <span className="text-gray-400 text-xs">인원</span>
              <p className="font-medium text-gray-900">
                성인 {rfq.adult_count}명{rfq.child_count > 0 ? ` · 아동 ${rfq.child_count}명` : ''}
              </p>
            </div>
            {rfq.duration_nights && (
              <div>
                <span className="text-gray-400 text-xs">일정</span>
                <p className="font-medium text-gray-900">{rfq.duration_nights}박</p>
              </div>
            )}
            {rfq.hotel_grade && (
              <div>
                <span className="text-gray-400 text-xs">호텔 등급</span>
                <p className="font-medium text-gray-900">{HOTEL_LABELS[rfq.hotel_grade] || rfq.hotel_grade}</p>
              </div>
            )}
            {rfq.custom_requirements?.group_type && (
              <div className="col-span-2">
                <span className="text-gray-400 text-xs">여행 유형</span>
                <p className="font-medium text-gray-900">{rfq.custom_requirements.group_type}</p>
              </div>
            )}
          </div>
          {rfq.custom_requirements?.special_notes && (
            <div className="mt-3 pt-3 border-t">
              <span className="text-gray-400 text-xs">특이사항</span>
              <p className="text-sm text-gray-700 mt-0.5">{rfq.custom_requirements.special_notes}</p>
            </div>
          )}
        </div>

        {/* ── 제안서 (있을 때만) — 리뉴얼된 UI ── */}
        {hasProposals && (
          <div className="space-y-3">
            <h2 className="font-semibold text-gray-900 text-sm px-1">🏆 제안 비교</h2>
            {proposals.map((p) => {
              const isSelected = rfq.selected_proposal_id && p.key.endsWith(rfq.selected_proposal_id.slice(0, 8));
              const aiScore = p.ai_score ?? null;
              return (
                <div
                  key={p.key}
                  className={`bg-white rounded-xl border p-5 shadow-sm transition ${
                    isSelected ? 'border-blue-400 ring-2 ring-blue-100' : ''
                  }`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
                      {PROPOSAL_LABELS[p.key] || p.key}
                    </span>
                    {aiScore !== null && (
                      <span className="text-xs font-semibold text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                        {scoreBar(aiScore)} AI {aiScore}점
                      </span>
                    )}
                    {isSelected && (
                      <span className="text-xs font-semibold text-green-600 bg-green-50 px-2 py-0.5 rounded-full">
                        ✅ 선정됨
                      </span>
                    )}
                  </div>
                  <h3 className="font-bold text-gray-900">{p.title}</h3>
                  {p.tenant_name && (
                    <p className="text-xs text-gray-400 mt-0.5">제안: {p.tenant_name}</p>
                  )}
                  <p className="text-sm text-gray-600 mt-1 line-clamp-2">{p.summary}</p>
                  <div className="flex items-center justify-between mt-3 pt-3 border-t border-dashed">
                    <p className="text-lg font-bold text-brand">₩{fmt(p.price)}</p>
                    {aiScore !== null && (
                      <div className="flex items-center gap-1">
                        <div className="w-16 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${
                              aiScore >= 90 ? 'bg-green-500' : aiScore >= 70 ? 'bg-yellow-500' : 'bg-red-500'
                            }`}
                            style={{ width: `${aiScore}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── 반응 (좋아요/궁금해요) ── */}
        <div className="bg-white rounded-xl border shadow-sm p-5">
          <h2 className="font-semibold text-gray-900 text-sm mb-3">💬 이 견적 어떤가요?</h2>
          <div className="flex gap-2 mb-3">
            <button
              onClick={() => addReaction('like')}
              disabled={myReactions.has('like')}
              className="flex-1 flex items-center justify-center gap-1 py-2 rounded-lg border text-sm font-medium transition disabled:opacity-50 disabled:cursor-default enabled:hover:bg-blue-50 enabled:hover:border-blue-300"
            >
              👍 좋아요 <span className="text-gray-400 text-xs">{counts.like}</span>
            </button>
            <button
              onClick={() => addReaction('curious')}
              disabled={myReactions.has('curious')}
              className="flex-1 flex items-center justify-center gap-1 py-2 rounded-lg border text-sm font-medium transition disabled:opacity-50 disabled:cursor-default enabled:hover:bg-purple-50 enabled:hover:border-purple-300"
            >
              🤔 궁금해요 <span className="text-gray-400 text-xs">{counts.curious}</span>
            </button>
          </div>

          {/* 제안 투표 (여러 제안이 있을 때) */}
          {proposals.length >= 2 && (
            <div className="border-t pt-3 mt-3">
              <p className="text-xs text-gray-500 mb-2">어느 제안이 마음에 드시나요?</p>
              <div className="flex gap-2">
                {proposals.map((p) => {
                  const voteKey = p.key === 'proposal_a' ? 'vote_a' : p.key === 'proposal_b' ? 'vote_b' : 'vote_c';
                  return (
                    <button
                      key={voteKey}
                      onClick={() => addReaction(voteKey)}
                      disabled={myReactions.has(voteKey)}
                      className="flex-1 text-center py-2 rounded-lg border text-sm transition disabled:opacity-50 disabled:cursor-default enabled:hover:bg-orange-50 enabled:hover:border-orange-300"
                    >
                      <span className="font-semibold">{PROPOSAL_LABELS[p.key]}</span>
                      <span className="text-gray-400 text-xs ml-1">{counts[voteKey as keyof ReactionCounts]}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* ── 일행 공유 버튼 ── */}
        <div className="bg-white rounded-xl border shadow-sm p-5">
          <h2 className="font-semibold text-gray-900 text-sm mb-3">📤 일행에게 공유하기</h2>
          <div className="flex gap-2">
            <button
              onClick={handleCopyLink}
              className="flex-1 bg-gray-100 text-gray-800 py-2.5 rounded-lg text-sm font-semibold hover:bg-gray-200 transition"
            >
              {copied ? '✅ 링크 복사됨!' : '🔗 링크 복사'}
            </button>
            <button
              onClick={handleShareKakao}
              className="flex-1 bg-[#FEE500] text-[#191919] py-2.5 rounded-lg text-sm font-semibold hover:bg-[#FDD800] transition"
            >
              💬 카카오톡 공유
            </button>
          </div>
          {copied && (
            <p className="text-xs text-green-600 mt-2 text-center">클립보드에 복사되었습니다!</p>
          )}
        </div>

        {/* ── 푸터 + "나도 견적 받기" CTA ── */}
        <div className="bg-gradient-to-r from-blue-600 to-indigo-600 rounded-2xl shadow-lg p-6 text-center">
          <h3 className="text-white text-lg font-bold mb-1">
            나도 단독맞춤여행 견적 받기
          </h3>
          <p className="text-blue-100 text-sm mb-4">
            나만을 위한 프라이빗 여행, 지금 바로 견적 요청하세요
          </p>
          <a
            href="/private-tour"
            className="inline-block bg-white text-blue-700 font-bold px-8 py-3 rounded-xl shadow-sm hover:bg-blue-50 transition"
          >
            ✈️ 무료 견적 요청하기
          </a>
        </div>

        <div className="text-center pb-8">
          <a href="/private-tour" className="text-sm text-gray-400 hover:text-brand transition">
            여소남 단독맞춤여행
          </a>
        </div>

      </div>
    </div>
  );
}
