import { describe, expect, it } from 'vitest';
import {
  buildBlogInformationalCtaEvent,
  buildBlogInformationalCtaSettings,
  readBlogInformationalOfficialSourceUrl,
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
      dealRoomUrl: 'https://open.kakao.com/o/travel-deals',
      naverCafeUrl: 'https://cafe.naver.com/example',
    });
    const result = selection({ settings });
    expect(result.map((cta) => [cta.key, cta.role])).toEqual([
      ['DEAL_ROOM', 'primary'],
      ['RELATED_ARTICLES', 'secondary'],
    ]);
    expect(result.filter((cta) => cta.external)).toHaveLength(1);
  });

  it('puts a pinned official source first and omits sales CTAs for high-risk intents', () => {
    const settings = buildBlogInformationalCtaSettings({
      relatedArticlesHref: '/blog/entry-checklist',
      consultationUrl: 'https://pf.kakao.com/_verified/chat',
      officialSourceUrl: 'https://www.mofa.go.jp/entry/rules',
      officialSourceRegistryHostname: 'www.mofa.go.jp',
    });
    const result = selection({ intent: 'entry_requirements', riskLevel: 'HIGH', settings });
    expect(result.map((cta) => cta.key)).toEqual(['OFFICIAL_SOURCE', 'RELATED_ARTICLES']);
    expect(result.some((cta) => cta.key === 'CONSULTATION')).toBe(false);
  });

  it('does not trust caller-controlled official URLs in generation metadata', () => {
    expect(readBlogInformationalOfficialSourceUrl({
      evidence_items: [{ kind: 'official_source', url: 'https://www.mofa.go.jp/entry' }],
    })).toBeNull();
    expect(readBlogInformationalOfficialSourceUrl({
      evidence_items: [{ kind: 'internal_insight', url: 'https://www.mofa.go.jp/entry' }],
    })).toBeNull();
  });

  it('disables invalid, unlisted, or ambiguous URLs instead of guessing', () => {
    const settings = buildBlogInformationalCtaSettings({
      relatedArticlesHref: '/packages',
      naverCafeUrl: 'http://cafe.naver.com/not-secure',
      dealRoomUrl: 'https://evil.example/deals',
      consultationUrl: 'javascript:alert(1)',
      kakaoChannelId: 'ambiguous',
    });
    expect(settings.every((cta) => cta.enabled === false)).toBe(true);
  });

  it('uses only an internal related CTA for non-Korean locales', () => {
    const settings = buildBlogInformationalCtaSettings({
      relatedArticlesHref: '/blog/sapporo-weather',
      dealRoomUrl: 'https://open.kakao.com/o/deals',
    });
    expect(selection({ locale: 'en-US', settings }).map((cta) => cta.key))
      .toEqual(['RELATED_ARTICLES']);
  });

  it('limits a mid-article placement to one CTA', () => {
    const settings = buildBlogInformationalCtaSettings({
      relatedArticlesHref: '/blog/sapporo-weather',
      dealRoomUrl: 'https://open.kakao.com/o/deals',
    });
    expect(selection({ placement: 'mid', settings })).toHaveLength(1);
  });

  it('builds a minimal idempotent event without PII or arbitrary metadata', () => {
    const event = buildBlogInformationalCtaEvent('click', {
      articleId: 'article-1',
      ctaKey: 'RELATED_ARTICLES',
      placement: 'bottom',
    });
    expect(event).toMatchObject({
      article_id: 'article-1',
      event_type: 'click',
      cta_key: 'RELATED_ARTICLES',
      placement: 'bottom',
    });
    expect(event.event_key).toMatch(/^[0-9a-f-]{36}:click:RELATED_ARTICLES:bottom$/);
    expect(JSON.stringify(event)).not.toMatch(/email|phone|name|user_id|session|href|metadata|utm/i);
  });

  it('removes generated sales links from markdown and rendered HTML', () => {
    const cleaned = stripBlogInformationalBodyCtas([
      '## 여행 준비',
      '[관련 글](/blog/sapporo-weather)',
      '[상품 보기](/packages?destination=sapporo)',
      '[상담](https://pf.kakao.com/_legacy/chat)',
      '<a data-blog-cta="true" href="/packages/legacy">legacy product CTA</a>',
    ].join('\n\n'));
    expect(cleaned).toContain('[관련 글](/blog/sapporo-weather)');
    expect(cleaned).not.toMatch(/\/packages|pf\.kakao\.com/);
    expect(cleaned).toContain('상품 보기');
    expect(cleaned).toContain('legacy product CTA');
  });
});
