import { describe, expect, it } from 'vitest';

import { evaluateBlogGeneratedQualityCanaryReport } from './blog-canary-generated-quality';
import { buildProductGeneratedCanaryRows } from './blog-product-generated-canary';

describe('buildProductGeneratedCanaryRows', () => {
  it('builds dry-run product writer samples from queued product rows and registered package data', async () => {
    const rows = buildProductGeneratedCanaryRows({
      queueRows: [{
        id: 'queue-1',
        product_id: 'pkg_100',
        destination: '나트랑',
        angle_type: 'value',
        topic: '부산출발 나트랑 패키지',
      }],
      products: [{
        id: 'pkg_100',
        title: '부산출발 나트랑 3박5일 패키지',
        destination: '나트랑',
        duration: 5,
        price_dates: [{ date: '2026-07-18', price: 599000 }],
        departure_airport: '부산/김해',
        airline: '7C',
        inclusions: ['왕복항공', '호텔', '현지 차량'],
        excludes: ['개인경비', '선택관광'],
        itinerary: ['부산 출발', '나트랑 도착', '자유시간', '시내 이동', '부산 도착'],
      }],
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      content_type: 'package_intro',
      product_id: 'pkg_100',
      destination: '나트랑',
    });
    expect(rows[0].generation_meta?.generated_canary).toMatchObject({
      mode: 'dry_run',
      queue_id: 'queue-1',
    });
    expect(rows[0].blog_html).toContain('등록된 상품 정보 기준');
    expect(rows[0].blog_html).toContain('## 포함/불포함');

    const report = await evaluateBlogGeneratedQualityCanaryReport({
      posts: rows,
      requested: 1,
    });

    expect(report.status).toBe('pass');
    expect(report.samples[0]).toMatchObject({
      writer_type: 'product_consultant_writer',
      status: 'pass',
      score: 100,
    });
  });
});
