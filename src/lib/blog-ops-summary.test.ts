import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildBlogOpsSummary,
  classifyPublishedBlogQualityIssues,
  summarizePublishedBlogQuality,
} from './blog-ops-summary';

type TableRows = Record<string, Array<Record<string, unknown>>>;

class FakeQuery {
  private rows: Array<Record<string, unknown>>;

  constructor(rows: Array<Record<string, unknown>>) {
    this.rows = [...rows];
  }

  select() {
    return this;
  }

  order() {
    return this;
  }

  limit(count: number) {
    this.rows = this.rows.slice(0, count);
    return this;
  }

  eq(field: string, value: unknown) {
    this.rows = this.rows.filter((row) => row[field] === value);
    return this;
  }

  gte() {
    return this;
  }

  then<TResult1 = { data: Array<Record<string, unknown>>; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: Array<Record<string, unknown>>; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    return Promise.resolve({ data: this.rows, error: null }).then(onfulfilled, onrejected);
  }
}

function fakeSupabase(tables: TableRows) {
  return {
    from(name: string) {
      return new FakeQuery(tables[name] ?? []);
    },
  };
}

function goodPost(overrides: Record<string, unknown> = {}) {
  return {
    id: 'post-ok',
    slug: 'bali-family-budget',
    seo_title: 'Bali family budget guide',
    seo_description: 'A grounded travel guide.',
    og_image_url: 'https://example.com/image.jpg',
    blog_html: [
      'This guide gives enough body detail for the operational quality summary to treat the content as present.',
      'It includes practical trip context, decision points, and reader-facing evidence placeholders.',
      '',
      '![Bali beach](https://example.com/image.jpg)',
    ].join('\n'),
    status: 'published',
    published_at: new Date().toISOString(),
    readability_score: 96,
    seo_score: { score: 96 },
    quality_gate: { passed: true, gates: [] },
    generation_meta: { content_brief: { reader_task: 'compare budget' } },
    destination: 'Bali',
    product_id: null,
    angle_type: 'value',
    category: 'travel_tips',
    content_type: 'guide',
    primary_keyword: 'Bali family budget',
    ...overrides,
  };
}

describe('blog ops quality summary', () => {
  it('requires durable publish evidence beyond quality_gate.passed', () => {
    const issues = classifyPublishedBlogQualityIssues(goodPost({
      id: 'missing-evidence',
      generation_meta: {},
      seo_score: null,
      readability_score: null,
      og_image_url: null,
      blog_html: 'Plain body without image evidence but enough words to avoid body missing.',
    }));

    expect(issues).toContain('content_brief_missing');
    expect(issues).toContain('seo_score_missing');
    expect(issues).toContain('readability_score_missing');
    expect(issues).toContain('image_missing');
  });

  it('separates slug-only cleanup from non-slug quality failures', () => {
    const summary = summarizePublishedBlogQuality([
      goodPost({
        id: 'slug-only',
        quality_gate: { passed: false, gates: [{ gate: 'slug', passed: false }] },
      }),
      goodPost({
        id: 'structure-fail',
        quality_gate: { passed: false, gates: [{ gate: 'structure_integrity', passed: false }] },
      }),
    ]);

    expect(summary.slug_only_failure_count).toBe(1);
    expect(summary.non_slug_failure_count).toBe(1);
    expect(summary.buckets.quality_gate_slug).toBe(1);
    expect(summary.buckets.quality_gate_structure_integrity).toBe(1);
  });

  it('returns operator-facing health sections and failure buckets', async () => {
    const summary = await buildBlogOpsSummary(fakeSupabase({
      blog_topic_queue: [
        {
          id: 'q1',
          topic: 'duplicate slug',
          status: 'failed',
          target_publish_at: new Date(Date.now() - 60_000).toISOString(),
          created_at: new Date().toISOString(),
          last_error: 'slug already exists',
          meta: {},
        },
        {
          id: 'q2',
          topic: 'stuck generation',
          status: 'generating',
          created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
          meta: {},
        },
      ],
      content_creatives: [
        goodPost({
          id: 'bad-recent',
          slug: 'bad-recent',
          generation_meta: {},
          quality_gate: { passed: true, gates: [] },
        }),
      ],
      blog_indexing_jobs: [],
      indexing_reports: [],
      cron_health: [],
      publishing_policies: [{ scope: 'global', posts_per_day: 4, enabled: true }],
      programmatic_seo_topics: [],
      blog_categories: [],
      ad_landing_mappings: [],
      rank_history: [],
    }) as any);

    expect(summary.health_sections.quality.failed).toBe(true);
    expect(summary.quality.failure_buckets.content_brief_missing).toBe(1);
    expect(summary.queue.failure_groups.slug_failures).toBe(1);
    expect(summary.queue.failure_groups.stuck_queue_rows).toBeGreaterThan(0);
    expect(summary.indexing.failure_buckets.outbox_missing).toBe(1);
    expect(summary.contract.failed_checks).toContain('recent_quality_gate');
    expect(summary.contract.failed_checks).toContain('indexing_outbox_missing');
  });

  it('shows the fail-closed runtime mode instead of the larger DB policy target', async () => {
    const previousMode = process.env.BLOG_AUTOPUBLISH_MODE;
    const previousCap = process.env.BLOG_DAILY_PUBLISH_CAP;
    delete process.env.BLOG_AUTOPUBLISH_MODE;
    delete process.env.BLOG_DAILY_PUBLISH_CAP;

    try {
      const summary = await buildBlogOpsSummary(fakeSupabase({
        blog_topic_queue: [],
        content_creatives: [],
        blog_indexing_jobs: [],
        indexing_reports: [],
        cron_health: [],
        publishing_policies: [{ scope: 'global', posts_per_day: 5, enabled: true }],
        programmatic_seo_topics: [],
        blog_categories: [],
        ad_landing_mappings: [],
        rank_history: [],
      }) as any);

      expect(summary.publish).toMatchObject({
        configured_daily_target: 5,
        effective_daily_target: 5,
        daily_publish_cap: 5,
        autopublish_mode: 'draft_only',
        public_publication_enabled: false,
        daily_target: 0,
        remaining_today: 0,
      });
      expect(summary.contract.failed_checks).toContain('autopublish_mode_draft_only');
    } finally {
      if (previousMode === undefined) delete process.env.BLOG_AUTOPUBLISH_MODE;
      else process.env.BLOG_AUTOPUBLISH_MODE = previousMode;
      if (previousCap === undefined) delete process.env.BLOG_DAILY_PUBLISH_CAP;
      else process.env.BLOG_DAILY_PUBLISH_CAP = previousCap;
    }
  });

  it('exposes fleet phrase drift as a quality signal in the admin summary', () => {
    const source = readFileSync(join(process.cwd(), 'src/lib/blog-ops-summary.ts'), 'utf8');

    expect(source).toContain('inspectBlogFleetPhraseDrift');
    expect(source).toContain('fleet_phrase_drift: fleetPhraseDrift');
    expect(source).toContain("title: '최근 글 말투 반복");
    expect(source).toContain("['fleet_phrase_drift']");
  });
});
