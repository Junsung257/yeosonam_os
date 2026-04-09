'use client';

import { useEffect } from 'react';
import { trackContentView } from '@/lib/tracker';

/**
 * 블로그 글 조회 시 First-touch 콘텐츠 어트리뷰션 데이터를 수집하는 경량 컴포넌트.
 * 서버 컴포넌트인 blog/[slug]/page.tsx에서 사용.
 */
export default function BlogTracker({ contentCreativeId }: { contentCreativeId: string }) {
  useEffect(() => {
    trackContentView(contentCreativeId);
  }, [contentCreativeId]);

  return null;
}
