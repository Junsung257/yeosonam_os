'use client';

import Script from 'next/script';
import { useMarketingConsent } from '@/lib/consent';
import { thirdPartyScriptType } from '@/lib/third-party-script-type';

/**
 * 네이버 애널리틱스 / 전환추적 스크립트
 *
 * NEXT_PUBLIC_NAVER_ANALYTICS_ID 환경변수가 설정되어 있어야 동작.
 * PIPA: 마케팅 동의 후에만 스크립트 로드.
 *
 * 공식 스크립트: https://wcs.naver.net/wcslog.js
 * 네이버 애널리틱스 계정이 없다면 Ghost(공통) 계정 사용:
 *   - 네이버 애널리틱스 > 사이트 관리 > 사이트 등록 후 발급된 ID 사용
 */
const ACCOUNT_ID = process.env.NEXT_PUBLIC_NAVER_ANALYTICS_ID;

export default function NaverAnalyticsPixel() {
  const marketing = useMarketingConsent();

  if (!ACCOUNT_ID || !marketing) return null;

  // Common.js 스크립트 (네이버 제공 표준 코드)
  const commonScript = `
    if(!window.wcs) {
      window.wcs = {};
      window.wcs_cc = {};
    }
    window.wcs_cc["nv"] = "${ACCOUNT_ID}";
  `;

  return (
    <>
      <Script
        id="naver-analytics-common"
        type={thirdPartyScriptType()}
        strategy="lazyOnload"
        dangerouslySetInnerHTML={{ __html: commonScript }}
      />
      <Script
        id="naver-analytics-wcs"
        type={thirdPartyScriptType()}
        src="//wcs.naver.net/wcslog.js"
        strategy="lazyOnload"
      />
    </>
  );
}

/**
 * 네이버 전환추적 Purchase 이벤트
 * 마케팅 동의 없으면 noop.
 *
 * 사용 예: 체크아웃 완료 시
 *   trackNaverPurchase({ revenue: 500000, product_name: '다낭 3박 4일', booking_id: '...' });
 */
export function trackNaverPurchase(params: {
  revenue: number;
  product_name?: string;
  booking_id?: string;
}) {
  if (typeof window === 'undefined') return;
  if (!ACCOUNT_ID) return;

  try {
    // wcs 호출: 전환추적 픽셀 발송
    // wcs_conv 함수: ({wo: 계정ID, co: 전환액, rc: ROAS, gr: 구분})
    const wcs = (window as any).wcs;
    if (wcs?.conv) {
      wcs.conv({
        wo: ACCOUNT_ID,
        co: String(params.revenue),
        rc: '100',   // ROAS 100% 기준 (네이버 기본값)
        gr: 'booking',
        ...(params.product_name ? { pr: params.product_name } : {}),
      });
    }
  } catch {
    // noop — 전환추적 실패해도 서비스에 영향 없음
  }
}

/**
 * 네이버 서버사이드 전환추적 포스트백 URL 생성
 * 네이버 전환추적은 기본적으로 클라이언트 픽셀이지만,
 * 서버사이드에서도 전송 가능한 형식 제공
 */
export function buildNaverConversionPostbackUrl(params: {
  revenue: number;
  booking_id?: string;
}): string | null {
  if (!ACCOUNT_ID) return null;

  // 네이버 전환추적 픽셀 URL
  const baseUrl = 'https://wcs.naver.net/wcsc.con';
  const q = new URLSearchParams({
    wo: ACCOUNT_ID,
    co: String(params.revenue),
    rc: '100',
    gr: 'booking',
  });
  if (params.booking_id) q.set('bk', params.booking_id);
  return `${baseUrl}?${q.toString()}`;
}
