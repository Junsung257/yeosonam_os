import { describe, expect, it } from 'vitest';
import {
  buildBlogInformationalCtaEvent,
  buildBlogInformationalCtaSettings,
  selectBlogInformationalCtas,
  stripBlogInformationalBodyCtas,
} from './blog-informational-cta';

function selection(overrides: Partial<Parameters<typeof selectBlogInformationalCtas>[0]> = {}) {
  const settings = buildBlogInformationalCtaSettings({
    destination: '삿포로',
    relatedArticlesHref: '/blog/sapporo-weather',
  });
  return selectBlogInformationalCtas({
    intent: 'food_budget',
    destination: '삿포로',
    riskLevel: 'LOW',
    locale: 'ko-KR',
    settings,
    ...overrides,
  });
}

describe('blog informational CTA settings and selection', () => {
  it('falls back to related articles when external settings are missing', () => {
    expect(selection().map((cta) => cta.key)).toEqual(['RELATED_ARTICLES']);
  });

  it('selects one primary and at most one secondary CTA by intent', () => {
    const settings = buildBlogInformationalCtaSettings({
      destination: '삿포로',
      relatedArticlesHref: '/blog/sapporo-weather',
      dealRoomUrl: 'https://example.com/travel-deals',
      naverCafeUrl: 'https://cafe.naver.com/example',
    });
    const result = selection({ settings });

    expect(result.map((cta) => [cta.key, cta.role])).toEqual([
      ['DEAL_ROOM', 'primary'],
      ['RELATED_ARTICLES', 'secondary'],
    ]);
  });

  it('puts related information first and omits sales CTAs for high-risk intents', () => {
    const settings = buildBlogInformationalCtaSettings({
      relatedArticlesHref: '/blog/entry-checklist',
      consultationUrl: 'https://pf.kakao.com/_verified/chat',
    });
    const result = selection({
      intent: 'entry_requirements',
      riskLevel: 'HIGH',
      settings,
    });

    expect(result.map((cta) => cta.key)).toEqual(['RELATED_ARTICLES']);
  });

  it('disables invalid or ambiguous external URLs instead of guessing', () => {
    const settings = buildBlogInformationalCtaSettings({
      relatedArticlesHref: '/packages',
      naverCafeUrl: 'http://cafe.naver.com/not-secure',
      dealRoomUrl: 'javascript:alert(1)',
      kakaoChannelId: 'ambiguous',
    });

    expect(settings.every((cta) => cta.enabled === false)).toBe(true);
  });

  it('uses only an internal related CTA for non-Korean locales', () => {
    const settings = buildBlogInformationalCtaSettings({
      relatedArticlesHref: '/blog/sapporo-weather',
      dealRoomUrl: 'https://example.com/deals',
    });
    expect(selection({ locale: 'en-US', settings }).map((cta) => cta.key))
      .toEqual(['RELATED_ARTICLES']);
  });

  it('limits a mid-article placement to one CTA', () => {
    const settings = buildBlogInformationalCtaSettings({
      relatedArticlesHref: '/blog/sapporo-weather',
      dealRoomUrl: 'https://example.com/deals',
    });
    expect(selection({ placement: 'mid', settings })).toHaveLength(1);
  });

  it('builds dedicated anonymous event metadata without PII fields', () => {
    const event = buildBlogInformationalCtaEvent('blog_cta_click', {
      articleId: 'article-1',
      slug: 'sapporo-food',
      destinationId: 'sapporo',
      destination: '삿포로',
      intent: 'food_budget',
      ctaKey: 'RELATED_ARTICLES',
      placement: 'bottom',
      locale: 'ko-KR',
    });

    expect(event.event_type).toBe('blog_cta_click');
    expect(event.metadata).toEqual({
      article_id: 'article-1',
      slug: 'sapporo-food',
      destination_id: 'sapporo',
      intent: 'food_budget',
      cta_key: 'RELATED_ARTICLES',
      placement: 'bottom',
      locale: 'ko-KR',
    });
    expect(JSON.stringify(event)).not.toMatch(/email|phone|name|user_id/i);
  });

  it('removes generated sales URLs from informational body copy', () => {
    const cleaned = stripBlogInformationalBodyCtas([
      '## 여행 준비',
      '[관련 글](/blog/sapporo-weather)',
      '[상품 보기](/packages?destination=삿포로)',
      '[상담](https://pf.kakao.com/_legacy/chat)',
    ].join('\n\n'));

    expect(cleaned).toContain('[관련 글](/blog/sapporo-weather)');
    expect(cleaned).not.toMatch(/\/packages|pf\.kakao\.com/);
    expect(cleaned).toContain('상품 보기');
  });
});
