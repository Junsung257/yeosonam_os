'use client';

import { useEffect } from 'react';
import { getSessionId } from '@/lib/tracker';

export interface BlogRecommendationExposure {
  package_id: string;
  recommended_rank?: number | null;
  policy_id?: string | null;
}

interface Props {
  contentCreativeId?: string | null;
  intent?: string | null;
  placement: string;
  products: BlogRecommendationExposure[];
}

export default function BlogProductRecommendationTracker({
  contentCreativeId,
  intent,
  placement,
  products,
}: Props) {
  useEffect(() => {
    if (!contentCreativeId || products.length === 0) return;
    const sessionId = getSessionId();
    const userId = (() => {
      try {
        return localStorage.getItem('ys_user_id');
      } catch {
        return null;
      }
    })();

    for (const product of products.slice(0, 6)) {
      if (!product.package_id) continue;
      fetch('/api/tracking/recommendation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          package_id: product.package_id,
          source: 'blog',
          recommended_rank: product.recommended_rank ?? null,
          policy_id: product.policy_id ?? null,
          intent: intent ?? 'blog',
          session_id: sessionId,
          user_id: userId,
          outcome: null,
          notes: JSON.stringify({
            content_creative_id: contentCreativeId,
            placement,
          }),
        }),
        keepalive: true,
      }).catch(() => {});
    }
  }, [contentCreativeId, intent, placement, products]);

  return null;
}
