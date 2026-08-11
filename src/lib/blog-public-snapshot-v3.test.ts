import { describe, expect, it } from 'vitest';
import {
  selectBundledBlogPublicDetailSnapshotV3,
  type BlogPublicDetailSnapshotV3,
} from './blog-public-snapshot-v3';

const snapshot: BlogPublicDetailSnapshotV3 = {
  creative_id: '10000000-0000-4000-8000-000000000001',
  slug: 'critical-route-guide',
  title: 'Critical route guide',
  description: null,
  content_document: null,
  legacy_markdown: '본문 '.repeat(120),
  generation_meta: {},
  quality_gate: {},
  product_id: null,
  tracking_id: null,
  content_type: 'informational',
  target_audience: null,
  landing_enabled: false,
  landing_headline: null,
  landing_subtitle: null,
  hero_image: null,
  author: null,
  review: null,
  destination: null,
  angle_type: 'route_walkthrough',
  published_at: '2026-08-11T00:00:00.000Z',
  content_modified_at: null,
  fact_checked_at: null,
};

describe('blog public full-body snapshot bundle', () => {
  it('serves an explicitly bundled full body during the freshness window', () => {
    expect(selectBundledBlogPublicDetailSnapshotV3({
      generated_at: '2026-08-11T00:00:00.000Z',
      posts: [snapshot],
    }, snapshot.slug, new Date('2026-08-12T00:00:00.000Z'))).toEqual(snapshot);
  });

  it('fails closed for stale, missing, or bodyless bundle entries', () => {
    expect(selectBundledBlogPublicDetailSnapshotV3({
      generated_at: '2026-08-01T00:00:00.000Z',
      posts: [snapshot],
    }, snapshot.slug, new Date('2026-08-12T00:00:00.000Z'))).toBeNull();
    expect(selectBundledBlogPublicDetailSnapshotV3({
      generated_at: '2026-08-11T00:00:00.000Z',
      posts: [{ ...snapshot, legacy_markdown: 'short' }],
    }, snapshot.slug, new Date('2026-08-12T00:00:00.000Z'))).toBeNull();
    expect(selectBundledBlogPublicDetailSnapshotV3({
      generated_at: '2026-08-11T00:00:00.000Z',
      posts: [snapshot],
    }, 'does-not-exist', new Date('2026-08-12T00:00:00.000Z'))).toBeNull();
  });

  it('caps high-risk fallback freshness at 24 hours', () => {
    const highRisk = {
      ...snapshot,
      generation_meta: { content_brief: { risk_level: 'HIGH' } },
    };
    expect(selectBundledBlogPublicDetailSnapshotV3({
      generated_at: '2026-08-10T23:00:00.000Z',
      posts: [highRisk],
    }, highRisk.slug, new Date('2026-08-12T00:00:00.000Z'))).toBeNull();
  });
});
