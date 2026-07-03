import { describe, expect, it } from 'vitest';
import { buildBlogCanaryPreflight } from './blog-canary-preflight';

describe('buildBlogCanaryPreflight', () => {
  it('selects three unique low-risk canary candidates', () => {
    const result = buildBlogCanaryPreflight({
      requested: 3,
      recentPublished: [],
      activeQueue: [
        { id: 'q1', topic: '발리 가족여행 2026 실제 경비', destination: '발리', priority: 90, meta: { micro_angle: 'budget_family', writer_type: 'info_writer' } },
        { id: 'q2', topic: '다낭 7월 날씨와 옷차림 체크리스트', destination: '다낭', priority: 80, meta: { micro_angle: 'weather_packing', writer_type: 'info_writer' } },
        { id: 'q3', topic: '오사카 공항 도착 첫날 이동 동선', destination: '오사카', priority: 70, meta: { micro_angle: 'airport_arrival', writer_type: 'info_writer' } },
      ],
    });

    expect(result.status).toBe('warn');
    expect(result.candidates).toHaveLength(3);
    expect(result.writer_mix.info_writer).toBe(3);
    expect(result.rejected_counts.single_writer_type_canary).toBe(1);
  });

  it('prefers a mixed info/product writer canary set when both are available', () => {
    const result = buildBlogCanaryPreflight({
      requested: 3,
      recentPublished: [],
      activeQueue: [
        { id: 'p1', topic: '서안 패키지 4박6일 포함 불포함 체크', destination: '서안', product_id: 'pkg-1', priority: 100, meta: { product_dedup_key: 'pkg-1|2026-08-01|6d|ze' } },
        { id: 'p2', topic: '청도 골프 패키지 2박3일 가격 체크', destination: '청도', product_id: 'pkg-2', priority: 95, meta: { product_dedup_key: 'pkg-2|2026-08-01|3d|ze' } },
        { id: 'i1', topic: '발리 가족여행 2026 실제 경비', destination: '발리', priority: 70, meta: { micro_angle: 'budget_family', writer_type: 'info_writer' } },
        { id: 'i2', topic: '다낭 7월 날씨와 옷차림 체크리스트', destination: '다낭', priority: 60, meta: { micro_angle: 'weather_packing', writer_type: 'info_writer' } },
      ],
    });

    expect(result.status).toBe('pass');
    expect(result.candidates).toHaveLength(3);
    expect(result.writer_mix.info_writer).toBeGreaterThanOrEqual(1);
    expect(result.writer_mix.product_consultant_writer).toBeGreaterThanOrEqual(1);
    expect(new Set(result.candidates.map((candidate) => candidate.dedup_key)).size).toBe(3);
  });

  it('rejects recent duplicates and evidence-blocked candidates before canary selection', () => {
    const result = buildBlogCanaryPreflight({
      requested: 2,
      recentPublished: [
        { slug: 'bali-budget', destination: '발리', meta: { micro_angle: 'budget_family', writer_type: 'info_writer' } },
      ],
      activeQueue: [
        { id: 'dup', topic: '발리 가족여행 2026 실제 경비', destination: '발리', meta: { micro_angle: 'budget_family', writer_type: 'info_writer' } },
        { id: 'blocked', topic: '세부 가족여행 경비 체크', destination: '세부', meta: { micro_angle: 'budget_family', evidence_insufficient: true } },
        { id: 'ok', topic: '다낭 7월 날씨와 옷차림 체크리스트', destination: '다낭', meta: { micro_angle: 'weather_packing', writer_type: 'info_writer' } },
      ],
    });

    expect(result.status).toBe('warn');
    expect(result.ready_count).toBe(1);
    expect(result.rejected_counts.duplicate_candidate).toBe(1);
    expect(result.rejected_counts.evidence_or_product_blocked).toBe(1);
  });

  it('blocks when no topic-fit candidate is available', () => {
    const result = buildBlogCanaryPreflight({
      requested: 1,
      recentPublished: [],
      activeQueue: [
        { id: 'bad', topic: 'draft-post-a1b2c3', destination: '발리', meta: { expected_slug: 'draft-post-a1b2c3' } },
      ],
    });

    expect(result.status).toBe('block');
    expect(result.ready_count).toBe(0);
    expect(result.rejected_counts.topic_fit_failed).toBe(1);
  });

  it('rejects info canary candidates without a destination unless explicitly generic', () => {
    const result = buildBlogCanaryPreflight({
      requested: 1,
      recentPublished: [],
      activeQueue: [
        { id: 'generic', topic: '가족 7월 날씨 여행 가이드 2026', meta: { micro_angle: 'weather_packing', writer_type: 'info_writer' } },
      ],
    });

    expect(result.status).toBe('block');
    expect(result.rejected_counts.info_missing_destination).toBe(1);
  });
});
