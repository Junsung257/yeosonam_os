/**
 * 일회성 백필: '세부-6월-날씨와-옷차림-완벽-가이드' 블로그 글에
 * Pexels 자동 cover image 첨부 + ISR revalidate.
 *
 * 사유:
 *   /api/blog/generate (정보성 분기) 가 Pexels hook 을 가지고 있지 않던 시절에
 *   이 글이 발행됨 → og_image_url=null → SNS/모바일/구글 검색 미리보기 깨짐.
 *   파이프라인은 PR 에서 픽스했고, 본 글만 1회 백필.
 *
 * 실행: node db/backfill_blog_cover_cebu_june.js
 */

require('dotenv').config({ path: 'C:/Users/admin/Desktop/여소남OS/.env.local' });
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PEXELS_KEY = process.env.PEXELS_API_KEY;
const REVALIDATE_SECRET = process.env.REVALIDATE_SECRET;
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';

const SLUG = '세부-6월-날씨와-옷차림-완벽-가이드';
const PEXELS_QUERY = 'Cebu Philippines beach';

async function fetchPexelsCover(query) {
  if (!PEXELS_KEY) throw new Error('PEXELS_API_KEY 미설정');
  const url = new URL('https://api.pexels.com/v1/search');
  url.searchParams.set('query', query);
  url.searchParams.set('per_page', '15');
  url.searchParams.set('orientation', 'landscape');
  const res = await fetch(url, { headers: { Authorization: PEXELS_KEY } });
  if (!res.ok) throw new Error(`Pexels HTTP ${res.status}`);
  const data = await res.json();
  if (!data.photos?.length) throw new Error('Pexels 결과 0건');
  // 다양성 위해 결과 중 랜덤
  const photo = data.photos[Math.floor(Math.random() * data.photos.length)];
  return {
    src: photo.src.large2x || photo.src.large,
    photographer: photo.photographer,
    pexelsUrl: photo.url,
  };
}

async function main() {
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  // 1) 현재 상태 확인
  const { data: pre } = await sb
    .from('content_creatives')
    .select('id, slug, og_image_url')
    .eq('slug', SLUG)
    .maybeSingle();
  if (!pre) { console.error('[backfill] 글 없음'); process.exit(1); }
  console.log('[backfill] BEFORE og_image_url:', pre.og_image_url);

  // 2) Pexels 호출
  const photo = await fetchPexelsCover(PEXELS_QUERY);
  console.log('[backfill] Pexels:', photo);

  // 3) DB UPDATE
  const { error } = await sb
    .from('content_creatives')
    .update({ og_image_url: photo.src, updated_at: new Date().toISOString() })
    .eq('id', pre.id);
  if (error) { console.error('[backfill] UPDATE 실패:', error); process.exit(1); }

  // 4) ISR revalidate
  const path = `/blog/${SLUG}`;
  const revRes = await fetch(`${BASE_URL}/api/revalidate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paths: [path, '/blog'], secret: REVALIDATE_SECRET }),
  });
  const revBody = await revRes.json().catch(() => ({}));
  console.log(`[backfill] revalidate ${revRes.status}:`, revBody);

  // 5) 검증
  const { data: post } = await sb
    .from('content_creatives')
    .select('og_image_url, updated_at')
    .eq('id', pre.id)
    .maybeSingle();
  console.log('[backfill] AFTER og_image_url:', post?.og_image_url);
  console.log('[backfill] AFTER updated_at:', post?.updated_at);
}

main().catch(err => { console.error('[backfill] FATAL', err); process.exit(1); });
