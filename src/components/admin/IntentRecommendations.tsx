'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { Sparkles, ArrowRight } from 'lucide-react';

interface IntentRecommendation {
  label: string;
  href: string;
  reason: string;
}

/**
 * 페이지 컨텍스트 기반 인텐트 추천.
 * 현재 경로에 따라 "이 페이지에서 자주 하는 다음 작업"을 제안.
 */
export function useIntentRecommendations(
  pathname: string,
  usageCounts: Record<string, number>,
): IntentRecommendation[] {
  return useMemo(() => {
    const recs: IntentRecommendation[] = [];

    // 페이지별 컨텍스트 추천
    const intentMap: Record<string, IntentRecommendation[]> = {
      // 대시보드
      '': [
        { label: '새 상품 등록', href: '/admin/upload', reason: '새 상품을 등록해보세요' },
        { label: '예약 현황', href: '/admin/bookings', reason: '최근 예약을 확인하세요' },
        { label: '자비스 AI에게 물어보기', href: '/admin/jarvis', reason: 'AI 분석이 필요하세요?' },
      ],
      // 상품
      'packages': [
        { label: '새 상품 업로드', href: '/admin/upload', reason: '상품을 추가로 등록하세요' },
        { label: '랜드사 관리', href: '/admin/land-operators', reason: '공급사를 확인하세요' },
        { label: '여행지 관리', href: '/admin/attractions', reason: '관광지 데이터를 업데이트하세요' },
      ],
      'upload': [
        { label: '상품 관리', href: '/admin/packages', reason: '업로드한 상품을 확인하세요' },
        { label: '자유여행 상품 조립', href: '/admin/products/assemble-free-travel', reason: '조립이 필요한 상품이 있나요?' },
      ],
      // 마케팅
      'marketing': [
        { label: '검색광고', href: '/admin/search-ads', reason: '키워드 광고 성과를 확인하세요' },
        { label: '콘텐츠 허브', href: '/admin/content-hub', reason: '마케팅 콘텐츠를 관리하세요' },
        { label: '카드뉴스', href: '/admin/marketing/card-news', reason: '새 카드뉴스를 발행하세요' },
      ],
      'search-ads': [
        { label: '키워드 성과', href: '/admin/keyword-stats', reason: '키워드별 성과를 분석하세요' },
        { label: '최적화 로그', href: '/admin/keyword-optimization', reason: '자동 최적화 내역을 확인하세요' },
      ],
      // 콘텐츠
      'blog': [
        { label: '자동 발행 큐', href: '/admin/blog/queue', reason: '발행 대기 중인 글을 확인하세요' },
        { label: '카드뉴스', href: '/admin/marketing/card-news', reason: '시각 콘텐츠도 함께 발행하세요' },
      ],
      'content-hub': [
        { label: '콘텐츠 큐', href: '/admin/content-queue', reason: '발행 일정을 관리하세요' },
        { label: '콘텐츠 분석', href: '/admin/content-analytics', reason: '콘텐츠 성과를 측정하세요' },
      ],
      // 제휴
      'affiliates': [
        { label: '제휴 분석', href: '/admin/affiliate-analytics', reason: '제휴 채널 성과를 분석하세요' },
        { label: '프로모코드 성과', href: '/admin/affiliate-promo-report', reason: '프로모션 코드 효과를 확인하세요' },
      ],
      // 영업
      'bookings': [
        { label: '입금/정산', href: '/admin/payments', reason: '결제 상태를 확인하세요' },
        { label: '컨시어지', href: '/admin/concierge', reason: '고객 문의를 처리하세요' },
      ],
      // 재무
      'settlements': [
        { label: '통합 장부', href: '/admin/ledger', reason: '전체 장부를 조회하세요' },
        { label: '세무 관리', href: '/admin/tax', reason: '세무 데이터를 확인하세요' },
      ],
      // 시스템
      'control-tower': [
        { label: '크론·작업', href: '/admin/ops', reason: '예약된 작업을 확인하세요' },
        { label: '운영 알림', href: '/admin/alerts', reason: '최신 알림을 확인하세요' },
      ],
      // 자비스
      'jarvis': [
        { label: 'RAG 검색', href: '/admin/jarvis/rag', reason: '문서를 검색하세요' },
        { label: 'AI 생성', href: '/admin/generate', reason: 'AI로 콘텐츠를 생성하세요' },
      ],
    };

    // 부분 경로 매칭
    for (const [prefix, suggestions] of Object.entries(intentMap)) {
      if (!prefix) continue; // 빈 문자열(대시보드)은 아래에서 처리
      if (pathname.includes(prefix)) {
        recs.push(...suggestions);
      }
    }

    // 대시보드 — prefix가 빈 문자열이므로 별도 처리
    if (pathname === '/admin' || pathname === '/admin/') {
      recs.push(...(intentMap[''] ?? []));
    }

    // 이미 방문한 페이지는 추천에서 제외 (재방문 유도 방지)
    return recs.filter((r) => (usageCounts[r.href] ?? 0) < 5).slice(0, 4);
  }, [pathname, usageCounts]);
}

/**
 * 인텐트 기반 추천 UI — 페이지 상단에 작은 추천 바를 표시.
 */
export function IntentRecommendationsBar({
  pathname,
  usageCounts,
  onNavClick,
}: {
  pathname: string;
  usageCounts: Record<string, number>;
  onNavClick?: (href: string) => void;
}) {
  const recs = useIntentRecommendations(pathname, usageCounts);

  if (recs.length === 0) return null;

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 mb-2 bg-brand-light/30 rounded-admin-md border border-brand-light/50 text-admin-xs text-admin-text-2">
      <Sparkles size={12} className="shrink-0 text-brand" />
      <span className="text-admin-2xs font-medium text-brand mr-0.5">추천:</span>
      {recs.map((rec, i) => (
        <span key={rec.href} className="flex items-center gap-1">
          {i > 0 && <ArrowRight size={10} className="text-admin-muted-2" />}
          <Link
            href={rec.href}
            onClick={() => onNavClick?.(rec.href)}
            className="hover:text-brand hover:underline transition-colors whitespace-nowrap"
            title={rec.reason}
          >
            {rec.label}
          </Link>
        </span>
      ))}
    </div>
  );
}
