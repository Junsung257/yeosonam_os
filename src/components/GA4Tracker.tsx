import Script from 'next/script';

/**
 * Google Analytics 4 — gtag.js 표준 구현
 *
 * NEXT_PUBLIC_GA4_ID 환경변수 (예: G-XXXXXXXXXX) 가 있을 때만 활성.
 * 미설정 시 silent null 반환 (개발 환경·자동 색인 시 부하 없음).
 *
 * 적용 위치: `src/app/layout.tsx` <body> 안 마지막 직전 (Vercel SpeedInsights 와 같은 라인).
 * Strategy: 'afterInteractive' — INP/LCP 영향 최소화 (Google 권장).
 *
 * 사장님이 할 일:
 *   1. analytics.google.com → 속성 만들기 → 데이터 스트림 (웹) → 측정 ID 복사 (G-로 시작)
 *   2. Vercel 환경변수 `NEXT_PUBLIC_GA4_ID` 추가 (production·preview·development 모두)
 *   3. Vercel 재배포 → 24시간 내 Realtime 보고서에 트래픽 노출
 *
 * (왜 TrackerBootstrap 만으로는 부족한가: TrackerBootstrap 은 내부 funnel/conversion 용 자체 이벤트.
 *  Google Search Console·검색 순위 분석·랜딩 페이지 성과 측정은 GA4 가 SSOT.)
 */
export default function GA4Tracker() {
  const id = process.env.NEXT_PUBLIC_GA4_ID;
  if (!id) return null;
  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${id}`}
        strategy="afterInteractive"
      />
      <Script id="ga4-init" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', '${id}', {
            send_page_view: true,
            anonymize_ip: true,
          });
        `}
      </Script>
    </>
  );
}
