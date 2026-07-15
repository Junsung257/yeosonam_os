import { describe, expect, it } from 'vitest';

import {
  buildAuditItem,
  GOLDEN_SET,
  goldenKey,
  goldenLookupFilter,
} from '../../scripts/audit-public-snapshot-generation-readiness';
import type { PublicSnapshotGenerationReport } from '../../src/lib/package-publication/public-snapshot-diagnostics';
import type { PublicPackageSnapshot } from '../../src/lib/package-publication/types';

describe('public snapshot generation audit golden set matching', () => {
  it('matches the required representative destinations by Korean aliases', () => {
    expect(goldenKey({ destination: '연길', title: '연길 백두산 노옵션 3박4일' })).toBe('yanji_baekdu');
    expect(goldenKey({ destination: '장가계', title: '장가계 노팁노옵션 3박4일' })).toBe('zhangjiajie');
    expect(goldenKey({ destination: '다낭/호이안', title: '다낭 호이안 3박5일' })).toBe('danang_hoian');
    expect(goldenKey({ destination: '나트랑/달랏', title: '나트랑 달랏 3박5일' })).toBe('nhatrang_dalat');
    expect(goldenKey({ destination: '푸꾸옥', title: '푸꾸옥 노옵션 3박5일' })).toBe('phuquoc');
    expect(goldenKey({ destination: '북해도', title: '삿포로 온천 3박4일' })).toBe('hokkaido');
    expect(goldenKey({ destination: '하노이/하롱베이', title: '하노이 하롱베이 옌뜨 3박5일' })).toBe('hanoi_halong');
    expect(goldenKey({ destination: '대마도', title: '쓰시마 당일 왕복' })).toBe('tsushima');
    expect(goldenKey({ destination: '세부', title: '세부 리조트 4박5일' })).toBe('cebu');
  });

  it('does not classify Nagasaki-only products as the Fukuoka golden sample', () => {
    expect(goldenKey({
      destination: '나가사키',
      title: 'BX나가사키 골프 패키지 3박4일',
      raw_text: '후쿠오카 공항 경유 안내가 포함된 원문',
    })).toBeNull();
    expect(goldenKey({ destination: '후쿠오카', title: '후쿠오카 북큐슈 온천 2박3일' })).toBe('fukuoka');
    expect(goldenKey({ destination: '규슈', title: '북큐슈 료칸팩 2박3일' })).toBe('fukuoka');
  });

  it('provides supplemental lookup filters for every required golden sample', () => {
    for (const item of GOLDEN_SET) {
      expect(goldenLookupFilter(item)).toContain('title.ilike');
    }

    const tsushima = GOLDEN_SET.find(item => item.key === 'tsushima');
    expect(tsushima).toBeDefined();
    expect(goldenLookupFilter(tsushima!)).toContain('대마도');
    expect(goldenLookupFilter(tsushima!)).toContain('쓰시마');
  });
});

describe('public snapshot generation audit item detail', () => {
  it('keeps source, extracted fields, public snapshot, and route text side by side', () => {
    const row = {
      id: 'pkg-yanji',
      title: '연길 백두산 노옵션 4박5일',
      display_title: '연길 백두산 핵심관광',
      destination: '연길',
      raw_text: [
        '선택관광: 노옵션',
        'DAY 1 부산 출발 후 연길 도착',
        'DAY 2 백두산 서파 관광',
        '7월 12일 출발 599,000원/인',
      ].join('\n'),
      hero_tagline: '백두산 핵심 일정',
      product_summary: '연길과 백두산을 함께 보는 일정입니다.',
      duration: 5,
      nights: 4,
      price: 599000,
      price_dates: [{ date: '2026-07-12', price: 599000 }],
      product_prices: [{ adult: 599000 }],
      inclusions: ['왕복항공료', '숙박료'],
      excludes: ['개인경비'],
      optional_tours: ['노옵션'],
      itinerary_data: { days: [{ day: 1 }, { day: 2 }] },
      products: [{ thumbnail_urls: ['https://cdn.example.com/yanji-1.jpg'] }],
    };
    const snapshot = {
      snapshot_version: 'public-package-snapshot-v1',
      package_id: 'pkg-yanji',
      package_revision: 7,
      public_title: '연길·백두산 노옵션 핵심관광 4박5일',
      public_subtitle: '노옵션 조건과 주요 일정을 상담 전 확인할 수 있어요.',
      duration: 5,
      destinations: ['연길', '백두산'],
      price_display: '599,000원~',
      option_policy: { status: 'none_explicit', badges: ['노옵션'] },
      canonical_view: null,
      package: { product_summary: '노옵션 조건과 주요 일정 중심으로 확인하세요.' },
      inclusions_public: ['왕복항공료', '숙박료'],
      exclusions_public: ['개인경비'],
      itinerary_public: { days: [{ day: 1 }, { day: 2 }] },
      public_notices: [],
      public_notice_source_paths: [],
      optional_tours_public: [],
      images_public: [{ url: 'https://cdn.example.com/yanji-1.jpg' }],
      cta_copy: {
        primary: '예약 가능 여부 확인',
        helper: '출발일과 객실 상황에 따라 요금이 달라질 수 있습니다.',
      },
      card_projection: {
        title: '연길·백두산 노옵션 핵심관광 4박5일',
        summary: '노옵션 조건과 주요 일정 확인',
      },
      lp_projection: {
        summary: '연길과 백두산 핵심 일정을 4박5일로 확인합니다.',
      },
      route_text_dump: [
        '연길·백두산 노옵션 핵심관광 4박5일',
        '599,000원~',
        '예약 가능 여부 확인',
      ],
    } as unknown as PublicPackageSnapshot;
    const report: PublicSnapshotGenerationReport = {
      package_id: 'pkg-yanji',
      overall_status: 'generated',
      diagnostics: [
        {
          field: 'title',
          status: 'generated',
          evidence: ['generated_title=연길·백두산 노옵션 핵심관광 4박5일'],
          repair_actions: [],
        },
        {
          field: 'optional_tours',
          status: 'generated',
          evidence: ['optional_tour_status=none_explicit'],
          repair_actions: [],
        },
      ],
      repair_actions: [],
    };

    const item = buildAuditItem(row, snapshot, report);

    expect(item.source.raw_title).toBe('연길 백두산 노옵션 4박5일');
    expect(item.source.raw_text_chars).toBeGreaterThan(50);
    expect(item.source.raw_excerpt).toContain('선택관광: 노옵션');
    expect(item.extracted_fields.duration).toBe(5);
    expect(item.extracted_fields.price_dates_count).toBe(1);
    expect(item.extracted_fields.optional_tours_count).toBe(1);
    expect(item.extracted_fields.itinerary_days_count).toBe(2);
    expect(item.public_snapshot.public_title).toBe('연길·백두산 노옵션 핵심관광 4박5일');
    expect(item.public_snapshot.option_policy.status).toBe('none_explicit');
    expect(item.public_snapshot.optional_tours_public_count).toBe(0);
    expect(item.public_snapshot.route_text_count).toBe(3);
    expect(item.mobile_landing_text.route_text_sample).toContain('예약 가능 여부 확인');
    expect(item.fields).toMatchObject({
      title: 'generated',
      optional_tours: 'generated',
    });
  });
});
