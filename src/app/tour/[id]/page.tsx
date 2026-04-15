import { permanentRedirect } from 'next/navigation';

// /tour/[id] → /packages/[id] 로 통일됨 (308)
// next.config.js의 redirects()가 우선 처리하지만, 직접 import/raw 접근에 대비한 명시적 fallback.
export default async function TourRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  permanentRedirect(`/packages/${id}`);
}
