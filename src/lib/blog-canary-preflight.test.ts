import { describe, expect, it } from 'vitest';
import { buildBlogCanaryPreflight } from './blog-canary-preflight';

describe('buildBlogCanaryPreflight', () => {
  it('selects three unique low-risk canary candidates', () => {
    const result = buildBlogCanaryPreflight({
      requested: 3,
      recentPublished: [],
      activeQueue: [
        { id: 'q1', topic: '발리 가족여행 2026 실제 경비', destination: '발리', priority: 90, meta: { micro_angle: 'budget_family', writer_type: 'info_writer' } },
        { id: 'q2', topic: '오사카 7월 날씨와 옷차림 체크리스트', destination: '오사카', priority: 80, meta: { micro_angle: 'weather_packing', writer_type: 'info_writer' } },
        { id: 'q3', topic: '다낭 공항 입국 첫날 이동 동선', destination: '다낭', priority: 70, meta: { micro_angle: 'airport_arrival', writer_type: 'info_writer' } },
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
        { id: 'i2', topic: '오사카 7월 날씨와 옷차림 체크리스트', destination: '오사카', priority: 60, meta: { micro_angle: 'weather_packing', writer_type: 'info_writer' } },
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
        { id: 'blocked', topic: '홍콩 가족여행 경비 체크', destination: '홍콩', meta: { micro_angle: 'budget_family', evidence_insufficient: true } },
        { id: 'ok', topic: '오사카 7월 날씨와 옷차림 체크리스트', destination: '오사카', meta: { micro_angle: 'weather_packing', writer_type: 'info_writer' } },
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

  it('rejects destinationless info candidates until generic intent is durable', () => {
    const result = buildBlogCanaryPreflight({
      requested: 1,
      recentPublished: [],
      activeQueue: [
        { id: 'generic', topic: '여름 휴가철 해외여행 보험 꼭 필요한가요?', category: 'travel_tips', meta: { writer_type: 'info_writer' } },
        { id: 'missing', topic: '이번 주말 현지 맛집 동선', meta: { writer_type: 'info_writer' } },
      ],
    });

    expect(result.status).toBe('block');
    expect(result.rejected_counts.info_generic_unmarked).toBe(1);
    expect(result.rejected_counts.info_missing_destination).toBe(1);
  });

  it('allows destinationless info canaries only after they are marked intentionally generic', () => {
    const result = buildBlogCanaryPreflight({
      requested: 1,
      recentPublished: [],
      activeQueue: [
        {
          id: 'generic',
          topic: '여름 휴가철 해외여행 보험 꼭 필요한가요?',
          category: 'travel_tips',
          meta: { writer_type: 'info_writer', intentionally_generic: true },
        },
      ],
    });

    expect(result.ready_count).toBe(1);
    expect(result.candidates[0]).toMatchObject({
      destination: null,
      writer_type: 'info_writer',
    });
    expect(result.rejected_counts.info_generic_unmarked).toBeUndefined();
  });
});
