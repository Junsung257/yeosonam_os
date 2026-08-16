import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  postQueryError: false,
  legacyProjectionSucceeds: false,
  snapshotTableReady: false,
  publicViewHasPost: true,
  highRiskUnapproved: false,
}));

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
    if (table === 'blog_public_snapshots') {
      return mockState.snapshotTableReady
        ? { data: [], error: null }
        : { data: null, error: { code: '42P01', message: 'relation blog_public_snapshots does not exist' } };
    }
    if (table === 'public_blog_content_creatives' && selected?.includes('blog_html')) {
      if (mockState.postQueryError) {
        if (mockState.legacyProjectionSucceeds && !selected.includes('content_modified_at')) {
          return { data: [post], error: null };
        }
        return { data: null, error: { code: '42703', message: 'column content_modified_at does not exist' } };
      }
      const selectedPost = mockState.highRiskUnapproved
        ? {
            ...post,
            seo_title: '여름 휴가 해외여행자 보험 안내',
            review_status: 'none',
            topic_source: 'travel_insurance',
          }
        : post;
      return { data: mockState.publicViewHasPost ? [selectedPost] : [], error: null };
    }
    if (table === 'public_blog_content_creatives') {
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
      ilike: vi.fn(() => query),
      gte: vi.fn(() => query),
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

  it('keeps database outages out of the Next cache rejection path', () => {
    const source = readFileSync(join(process.cwd(), 'src/app/blog/[slug]/page.tsx'), 'utf8');

    expect(source).toContain('type BlogPostCacheEnvelope');
    expect(source).toContain("return { state: 'unavailable', post: null }");
    expect(source).toContain("['blog-detail-v6-outage-envelope']");
    expect(source).not.toContain("if (snapshotResult.state === 'missing') return null");
    expect(source).toContain("if (snapshotResult.state === 'found')");
    expect(source.indexOf(".from(PUBLIC_BLOG_READ_SOURCE)"))
      .toBeLessThan(source.indexOf('loadBlogPublicFallbackOrThrow(dbSlug)'));
    expect(source).toContain("if (cached.state === 'unavailable') throw createBlogDatabaseUnavailableError()");
    expect(source).not.toContain('function shouldRefreshCachedBlogPost');
    expect(source).not.toContain('unstable_cache(\n  async (slug: string) => getPostFastUncached(slug)');
    expect(source).not.toContain('inspectBlogIntentQuality');
  });

  it('never converts a public detail query error into a false 404', () => {
    const source = readFileSync(join(process.cwd(), 'src/app/blog/[slug]/page.tsx'), 'utf8');
    const start = source.indexOf("logError('[blog/getPostFast] supabase error'");
    const end = source.indexOf('if (!data || data.length === 0)', start);
    const errorBranch = source.slice(start, end);

    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    expect(errorBranch).toContain('return loadBlogPublicFallbackOrThrow(dbSlug);');
    expect(errorBranch).not.toContain('return null;');
  });

  it('keeps metadata title synchronized with the stored article title', () => {
    const source = readFileSync(join(process.cwd(), 'src/app/blog/[slug]/page.tsx'), 'utf8');

    expect(source).not.toContain('function expandShortBlogSeoTitle');
    expect(source).not.toContain('공항 이동 체크리스트');
    expect(source).not.toContain('비용 체크 2026');
    expect(source).toContain('const metadataTitle = cleanedTitle;');
    expect(source).toContain('title: { absolute: metadataTitle },');
    expect(source).not.toContain('title: { absolute: `${metadataTitle} | 여소남` }');
  });

  it('shows only persisted package facts in the landing hero', () => {
    const source = readFileSync(join(process.cwd(), 'src/app/blog/[slug]/page.tsx'), 'utf8');

    expect(source).toContain('buildBlogProductFactLabels({');
    expect(source).not.toContain("trustBadges={['운영팀 검증'");
    expect(source).not.toContain("pkg?.airline || '직항'");
    expect(source).not.toContain("'노팁·노옵션'");
  });

  it('does not render a second DKI headline below the canonical H1', () => {
    const detailSource = readFileSync(join(process.cwd(), 'src/app/blog/[slug]/page.tsx'), 'utf8');
    const heroSource = readFileSync(join(process.cwd(), 'src/components/blog/LandingHero.tsx'), 'utf8');

    expect(detailSource).not.toContain('headline={dki.headline}');
    expect(detailSource).not.toContain('matched={dki.matched}');
    expect(heroSource).not.toContain('{headline}');
    expect(heroSource).not.toContain('맞춤 검색 결과');
    expect(heroSource).not.toContain('pf.kakao.com');
  });

  it('does not query or mutate visitor-level DKI state on public detail requests', () => {
    const detailSource = readFileSync(join(process.cwd(), 'src/app/blog/[slug]/page.tsx'), 'utf8');

    expect(detailSource).not.toContain("from '@/lib/dki-resolver'");
    expect(detailSource).not.toContain('resolveDki(');
    expect(detailSource).not.toContain('const utmTerm =');
    expect(detailSource).not.toContain('const utmCampaign =');
    expect(detailSource).not.toContain('const utmSource =');
    expect(detailSource).not.toContain('qp.utm_term');
    expect(detailSource).not.toContain('qp.utm_campaign');
    expect(detailSource).not.toContain('qp.utm_source');
  });

  it('keeps decorative author avatars out of extracted article text', () => {
    const detailSource = readFileSync(join(process.cwd(), 'src/app/blog/[slug]/page.tsx'), 'utf8');
    const authorSource = readFileSync(join(process.cwd(), 'src/components/blog/AuthorBox.tsx'), 'utf8');
    const seoAuditSource = readFileSync(join(process.cwd(), 'scripts/audit-blog-seo-quality.mjs'), 'utf8');

    expect(detailSource).not.toContain('>\n                여\n              </span>');
    expect(authorSource).not.toContain('>\n          여\n        </div>');
    expect(detailSource).toContain('data-blog-supporting="share"');
    expect(authorSource).toContain('data-blog-supporting="author"');
    expect(seoAuditSource).toContain("querySelectorAll('[data-blog-supporting]')");
    expect(seoAuditSource).toContain('surface_text_noise');
  });

  it('guards public blog articles against duplicate body h1 headings', () => {
    const source = readFileSync(join(process.cwd(), 'src/app/blog/[slug]/page.tsx'), 'utf8');
    const normalizer = readFileSync(join(process.cwd(), 'src/lib/blog-public-render-normalizer.ts'), 'utf8');

    expect(source).toContain('sanitizePublicBlogBodyHtml');
    expect(normalizer).toContain('<h2$1>');
    expect(normalizer).toContain('</h2>');
    expect(normalizer).toContain('<h1\\b[^>]*>\\s*(?:&nbsp;|\\u00a0|<br\\s*\\/?>|\\s)*<\\/h1>');
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

  it('renders the database-unavailable surface instead of a false 404 on query errors', async () => {
    mockState.postQueryError = true;
    try {
      const mod = await import('./page');
      const Page = (mod.default as unknown as { default?: typeof mod.default }).default ?? mod.default;
      const element = await Page({
        params: Promise.resolve({ slug: 'unbundled-db-error-fixture' }),
        searchParams: Promise.resolve({}),
      });

      expect(element).toBeTruthy();
      expect((element as unknown as { type?: { name?: string } }).type?.name)
        .toBe('BlogDatabaseUnavailableView');
    } finally {
      mockState.postQueryError = false;
      mockState.legacyProjectionSucceeds = false;
    }
  }, 20_000);

  it('uses the legacy public-view projection during a V3 rolling migration', async () => {
    mockState.postQueryError = true;
    mockState.legacyProjectionSucceeds = true;
    try {
      const mod = await import('./page');
      const Page = (mod.default as unknown as { default?: typeof mod.default }).default ?? mod.default;
      const element = await Page({
        params: Promise.resolve({ slug: 'manila-weather' }),
        searchParams: Promise.resolve({}),
      });

      expect(element).toBeTruthy();
      expect((element as unknown as { type?: { name?: string } }).type?.name)
        .not.toBe('BlogDatabaseUnavailableView');
    } finally {
      mockState.postQueryError = false;
      mockState.legacyProjectionSucceeds = false;
    }
  }, 20_000);

  it('falls through a missing durable snapshot to the authoritative public view', async () => {
    mockState.snapshotTableReady = true;
    try {
      const mod = await import('./page');
      const Page = (mod.default as unknown as { default?: typeof mod.default }).default ?? mod.default;
      const element = await Page({
        params: Promise.resolve({ slug: 'manila-weather' }),
        searchParams: Promise.resolve({}),
      });

      expect(element).toBeTruthy();
      expect((element as unknown as { type?: { name?: string } }).type?.name)
        .not.toBe('BlogDatabaseUnavailableView');
    } finally {
      mockState.snapshotTableReady = false;
    }
  }, 20_000);

  it('propagates a real 404 when both the current snapshot and public view exclude a slug', async () => {
    mockState.snapshotTableReady = true;
    mockState.publicViewHasPost = false;
    try {
      const mod = await import('./page');
      const Page = (mod.default as unknown as { default?: typeof mod.default }).default ?? mod.default;
      await expect(Page({
        params: Promise.resolve({ slug: 'changes-requested-fixture' }),
        searchParams: Promise.resolve({}),
      })).rejects.toMatchObject({ digest: 'NEXT_HTTP_ERROR_FALLBACK;404' });
    } finally {
      mockState.snapshotTableReady = false;
      mockState.publicViewHasPost = true;
    }
  }, 20_000);

  it('fails closed for an unapproved high-risk row from a rolling legacy view', async () => {
    mockState.snapshotTableReady = true;
    mockState.highRiskUnapproved = true;
    try {
      const mod = await import('./page');
      const Page = (mod.default as unknown as { default?: typeof mod.default }).default ?? mod.default;
      await expect(Page({
        params: Promise.resolve({ slug: 'summer-travel-insurance-coverage-guide-2026' }),
        searchParams: Promise.resolve({}),
      })).rejects.toMatchObject({ digest: 'NEXT_HTTP_ERROR_FALLBACK;404' });
    } finally {
      mockState.snapshotTableReady = false;
      mockState.highRiskUnapproved = false;
    }
  }, 20_000);
});
