import { ImageResponse } from 'next/og';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

export const runtime = 'nodejs';
export const alt = '여소남 여행 블로그';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const ANGLE_LABELS: Record<string, string> = {
  value: '가성비',
  emotional: '감성',
  filial: '효도',
  luxury: '럭셔리',
  urgency: '긴급특가',
  activity: '액티비티',
  food: '미식',
};

export default async function OgImage({ params }: { params: { slug: string } }) {
  let title = '여소남 여행 블로그';
  let destination = '';
  let angleLabel = '';

  if (isSupabaseConfigured) {
    const { data } = await supabaseAdmin
      .from('content_creatives')
      .select('seo_title, angle_type, og_image_url, travel_packages(destination)')
      .eq('slug', params.slug)
      .eq('status', 'published')
      .limit(1);

    const post = data?.[0] as
      | { seo_title?: string | null; angle_type?: string | null; og_image_url?: string | null; travel_packages?: { destination?: string } | null }
      | undefined;

    // DB에 og_image_url이 있으면 그쪽으로 리다이렉트하지 말고, 동적 카드는 폴백 전용
    // (메타 태그에서 ogImage 우선순위 처리는 page.tsx의 generateMetadata 담당)
    if (post?.seo_title) title = post.seo_title;
    if (post?.travel_packages?.destination) destination = post.travel_packages.destination;
    if (post?.angle_type && ANGLE_LABELS[post.angle_type]) angleLabel = ANGLE_LABELS[post.angle_type];
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          background: 'linear-gradient(135deg, #340897 0%, #6b21a8 50%, #7c3aed 100%)',
          padding: '80px 90px',
          color: 'white',
        }}
      >
        {/* 상단: 브랜드 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', fontSize: 36, fontWeight: 900, letterSpacing: '-1px' }}>
          <span style={{ fontSize: 44 }}>✈</span>
          <span>여소남</span>
          <span style={{ fontSize: 22, fontWeight: 500, opacity: 0.7, marginLeft: 12 }}>가치있는 여행을 소개합니다</span>
        </div>

        {/* 가운데: 제목 */}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
          <div
            style={{
              fontSize: 68,
              fontWeight: 900,
              lineHeight: 1.2,
              letterSpacing: '-2px',
              maxWidth: 1000,
            }}
          >
            {title}
          </div>
        </div>

        {/* 하단: 태그 */}
        <div style={{ display: 'flex', gap: '14px', alignItems: 'center', fontSize: 26 }}>
          {destination && (
            <span
              style={{
                background: 'rgba(255,255,255,0.18)',
                padding: '10px 22px',
                borderRadius: '999px',
                fontWeight: 600,
              }}
            >
              📍 {destination}
            </span>
          )}
          {angleLabel && (
            <span
              style={{
                background: 'rgba(255,200,50,0.95)',
                color: '#3b1c00',
                padding: '10px 22px',
                borderRadius: '999px',
                fontWeight: 700,
              }}
            >
              {angleLabel}
            </span>
          )}
          <span style={{ marginLeft: 'auto', fontSize: 22, opacity: 0.7 }}>yeosonam.com</span>
        </div>
      </div>
    ),
    { ...size },
  );
}
