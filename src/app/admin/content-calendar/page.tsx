// ─────────────────────────────────────────────
// 콘텐츠 캘린더 메인 페이지 (Dynamic Wrapper)
// dnd-kit 번들링 충돌을 피하기 위해 next/dynamic + ssr:false 사용
// page.tsx는 Server Component이므로 'use client'를 추가하여 Client Component로 만듦
// ─────────────────────────────────────────────
'use client';

import dynamic from 'next/dynamic';

const ContentCalendarPage = dynamic(
  () => import('./CalendarPageContent').then((mod) => mod.ContentCalendarPage),
  { ssr: false },
);

export default function CalendarPage() {
  return <ContentCalendarPage />;
}
