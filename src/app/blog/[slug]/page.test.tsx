import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  notFound: () => {
    const err = new Error('NEXT_HTTP_ERROR_FALLBACK;404') as Error & { digest: string };
    err.digest = 'NEXT_HTTP_ERROR_FALLBACK;404';
    throw err;
  },
  redirect: (url: string) => {
    const err = new Error(`NEXT_REDIRECT;${url}`) as Error & { digest: string };
    err.digest = `NEXT_REDIRECT;${url}`;
    throw err;
  },
}));

vi.mock('@/lib/supabase', () => {
  const post = {
    id: 'blog-smoke-post',
    slug: 'manila-weather',
    seo_title: '마닐라 월별 날씨와 옷차림 가이드',
    seo_description: '마닐라 월별 날씨와 옷차림 가이드',
    og_image_url: null,
    blog_html: [
      '# 마닐라 월별 날씨와 옷차림 가이드',
      '',
      '## 건기와 우기',
      '',
      '마닐라는 건기와 우기가 뚜렷해 일정별 옷차림을 나눠 준비하는 편이 좋습니다.',
      '',
      '## 월별 옷차림',
      '',
      '1월부터 5월은 가벼운 여름 옷과 자외선 차단 준비가 핵심입니다.',
      '',
      '## 여행 준비물',
      '',
      '우산, 얇은 겉옷, 방수 파우치를 챙기면 갑작스러운 소나기에 대응하기 좋습니다.',
      '',
      '## 자주 묻는 질문',
      '',
      '**Q: 마닐라 여행에 우산이 필요한가요?**',
      '',
      'A: 우기에는 접이식 우산이나 우비를 챙기는 편이 안전합니다.',
    ].join('\n'),
    angle_type: 'value',
    channel: 'naver_blog',
    published_at: '2026-06-01T05:05:12.905+00:00',
    created_at: '2026-06-01T05:05:13.061364+00:00',
    updated_at: '2026-06-01T05:05:13.061364+00:00',
    product_id: null,
    tracking_id: 'blog-smoke-tracking',
    destination: '마닐라',
    landing_enabled: false,
    landing_headline: null,
    landing_subtitle: null,
    travel_packages: null,
  };

  function queryResult(table: string, selected: string | undefined) {
    if (table === 'content_creatives' && selected?.includes('blog_html')) {
      return { data: [post], error: null };
    }
    if (table === 'content_creatives') {
      return { data: [], error: null };
    }
    if (table === 'ab_experiments') {
      return { data: [], error: null };
    }
    if (table === 'travel_packages') {
      return { data: [], error: null };
    }
    return { data: [], error: null };
  }

  function makeQuery(table: string, selected?: string) {
    const query = {
      select: vi.fn((nextSelected?: string) => makeQuery(table, nextSelected)),
      eq: vi.fn(() => query),
      in: vi.fn(() => query),
      not: vi.fn(() => query),
      neq: vi.fn(() => query),
      lt: vi.fn(() => query),
      gt: vi.fn(() => query),
      order: vi.fn(() => query),
      limit: vi.fn(() => query),
      abortSignal: vi.fn(() => Promise.resolve(queryResult(table, selected))),
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve(queryResult(table, selected)).then(resolve, reject),
    };
    return query;
  }

  return {
    isSupabaseConfigured: true,
    isSupabaseAdminConfigured: true,
    supabaseAdmin: {
      from: vi.fn((table: string) => makeQuery(table)),
    },
  };
});

vi.mock('@/lib/sentry-logger', () => ({
  logError: vi.fn(),
}));

describe('/blog/[slug] page smoke', () => {
  it('does not split table-bearing blog HTML outside the article shell', () => {
    const source = readFileSync(join(process.cwd(), 'src/app/blog/[slug]/page.tsx'), 'utf8');

    expect(source).toContain('if (/<table\\b/i.test(html)) return null;');
  });

  it('renders a published blog detail without falling through to the global 404', async () => {
    const mod = await import('./page');
    const Page = (mod.default as unknown as { default?: typeof mod.default }).default ?? mod.default;

    const element = await Page({
      params: Promise.resolve({ slug: 'manila-weather' }),
      searchParams: Promise.resolve({}),
    });

    expect(element).toBeTruthy();
  }, 20_000);
});
