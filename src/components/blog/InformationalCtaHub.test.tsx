import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { InformationalCtaHub } from './InformationalCtaHub';

describe('InformationalCtaHub', () => {
  it('renders a mobile-first accessible hub and secures new-window links', () => {
    const html = renderToStaticMarkup(
      <InformationalCtaHub
        articleId="article-1"
        ctas={[
          {
            key: 'DEAL_ROOM',
            label: '삿포로 여행 소식 확인',
            description: '공개 채널로 이동합니다.',
            href: 'https://open.kakao.com/o/deals',
            enabled: true,
            external: true,
            role: 'primary',
            placement: 'bottom',
          },
          {
            key: 'RELATED_ARTICLES',
            label: '관련 가이드 이어보기',
            description: '관련 글을 읽습니다.',
            href: '/blog/sapporo-weather',
            enabled: true,
            external: false,
            role: 'secondary',
            placement: 'bottom',
          },
        ]}
      />,
    );
    expect(html).toContain('aria-labelledby=');
    expect(html).toContain('grid-cols-1');
    expect(html).toContain('sm:grid-cols-2');
    expect(html).toContain('min-h-11');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('href="/blog/sapporo-weather"');
  });
});
