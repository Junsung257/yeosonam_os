import { permanentRedirect } from 'next/navigation';

function getRouteParam(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? '';
}

// /tour/[id] → /packages/[id] 로 통일됨 (308)
// next.config.js의 redirects()가 우선 처리하지만, 직접 import/raw 접근에 대비한 명시적 fallback.
export default async function TourRedirect({
  params,
}: {
  params: Promise<{ id?: string | string[] }>;
}) {
  const { id: rawId } = await params;
  const id = getRouteParam(rawId);
  permanentRedirect(id ? `/packages/${encodeURIComponent(id)}` : '/packages');
}
