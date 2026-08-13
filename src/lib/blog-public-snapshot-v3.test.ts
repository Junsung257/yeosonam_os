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
  review_status: 'none',
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

  it('serves low-risk last-known-good content for 30 days but fails closed after that', () => {
    expect(selectBundledBlogPublicDetailSnapshotV3({
      generated_at: '2026-08-01T00:00:00.000Z',
      posts: [snapshot],
    }, snapshot.slug, new Date('2026-08-12T00:00:00.000Z'))).toEqual(snapshot);
    expect(selectBundledBlogPublicDetailSnapshotV3({
      generated_at: '2026-07-01T00:00:00.000Z',
      posts: [snapshot],
    }, snapshot.slug, new Date('2026-08-12T00:00:00.000Z'))).toBeNull();
  });

  it('fails closed for missing or bodyless bundle entries', () => {
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

  it('recognizes high-risk titles even when legacy metadata omitted a risk level', () => {
    const highRiskByTitle = {
      ...snapshot,
      slug: 'etias-rule-change',
      title: 'ETIAS 입국 규정 변경',
      review_status: 'approved',
    };
    expect(selectBundledBlogPublicDetailSnapshotV3({
      generated_at: '2026-08-10T23:00:00.000Z',
      posts: [highRiskByTitle],
    }, highRiskByTitle.slug, new Date('2026-08-12T00:00:00.000Z'))).toBeNull();
  });

  it('never serves review-blocked or unapproved high-risk snapshots', () => {
    const blocked = { ...snapshot, review_status: 'changes_requested' };
    const highRisk = {
      ...snapshot,
      slug: 'travel-insurance-guide',
      title: '해외여행자 보험 보장과 면책 안내',
      generation_meta: { content_brief: { risk_level: 'HIGH', intent_type: 'travel_insurance' } },
    };
    const approvedHighRisk = {
      ...highRisk,
      slug: 'approved-travel-insurance-guide',
      review_status: 'approved',
      review: { review_status: 'approved', reviewed_at: '2026-08-11T00:00:00.000Z' },
    };
    const bundle = { generated_at: '2026-08-11T00:00:00.000Z', posts: [blocked, highRisk, approvedHighRisk] };

    expect(selectBundledBlogPublicDetailSnapshotV3(
      bundle,
      blocked.slug,
      new Date('2026-08-11T01:00:00.000Z'),
    )).toBeNull();
    expect(selectBundledBlogPublicDetailSnapshotV3(
      bundle,
      highRisk.slug,
      new Date('2026-08-11T01:00:00.000Z'),
    )).toBeNull();
    expect(selectBundledBlogPublicDetailSnapshotV3(
      bundle,
      approvedHighRisk.slug,
      new Date('2026-08-11T01:00:00.000Z'),
    )).toEqual(approvedHighRisk);
  });
});
