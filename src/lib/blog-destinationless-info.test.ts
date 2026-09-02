import { describe, expect, it } from 'vitest';
import {
  buildBlogDestinationlessInfoWorkReport,
  buildDestinationlessInfoGenericGenerationMeta,
  buildDestinationlessInfoGenericMeta,
  classifyDestinationlessInfoCandidate,
  destinationlessInfoBlocksPublishability,
  resolveBlogInformationResearchDestination,
} from './blog-destinationless-info';

describe('blog destinationless info candidates', () => {
  it('separates unmarked generic info seeds from broken missing-destination seeds', () => {
    expect(classifyDestinationlessInfoCandidate({
      topic: '여름 휴가철 해외여행 전화/데이터 로밍 vs 유심 비교',
      category: 'travel_tips',
      meta: { writer_type: 'info_writer' },
    })).toBe('generic_unmarked');

    expect(classifyDestinationlessInfoCandidate({
      topic: '이번 주말 현지 맛집 동선',
      category: 'food',
      meta: { writer_type: 'info_writer' },
    })).toBe('missing_destination');
  });

  it('does not block publishability after the generic intent is durable', () => {
    const row = {
      topic: '광복절 연휴 해외여행 비자 필요 국가 리스트',
      category: 'visa_info',
      meta: { writer_type: 'info_writer', intentionally_generic: true },
    };

    expect(classifyDestinationlessInfoCandidate(row)).toBe('intentionally_generic');
    expect(destinationlessInfoBlocksPublishability(row)).toBe(false);
    expect(resolveBlogInformationResearchDestination(row)).toBe('해외여행 공통');
  });

  it('keeps real destinations and refuses to invent a scope for unmarked generic rows', () => {
    expect(resolveBlogInformationResearchDestination({
      topic: '세부 가족여행 준비',
      destination: '세부',
      meta: { writer_type: 'info_writer' },
    })).toBe('세부');
    expect(resolveBlogInformationResearchDestination({
      topic: '해외여행 보험 비교',
      category: 'travel_tips',
      meta: { writer_type: 'info_writer' },
    })).toBeNull();
  });

  it('uses slug intent when a public API title is too generic', () => {
    expect(classifyDestinationlessInfoCandidate({
      slug: 'summer-travel-insurance-coverage-guide-2026',
      seo_title: '여름 여행 가이드 2026 | 일정, 비용, 준비물 체크',
      destination: null,
      category: 'travel_tips',
      meta: { writer_type: 'info_writer' },
    })).toBe('generic_unmarked');
  });

  it('blocks fake destinations that are reader segments or months, not places', () => {
    const row = {
      topic: '가족 7월 날씨 여행 가이드 2026',
      destination: '가족',
      category: 'travel_tips',
      meta: { writer_type: 'info_writer' },
    };

    expect(classifyDestinationlessInfoCandidate(row)).toBe('invalid_destination');
    expect(destinationlessInfoBlocksPublishability(row)).toBe(true);
  });

  it('blocks generic audience, season, and broad travel labels as destinations', () => {
    for (const destination of ['대학생', '여름', '해외여행']) {
      expect(classifyDestinationlessInfoCandidate({
        topic: `${destination} 여행 준비 가이드`,
        destination,
        category: 'travel_tips',
        meta: { writer_type: 'info_writer' },
      })).toBe('invalid_destination');
    }
  });

  it('builds durable metadata for approved generic info rows', () => {
    const meta = buildDestinationlessInfoGenericMeta({
      checkedAt: '2026-07-03T00:00:00.000Z',
      row: {
        topic: '여름 휴가철 해외여행 보험 꼭 필요한가요?',
        meta: { writer_type: 'info_writer' },
      },
    });

    expect(meta).toMatchObject({
      writer_type: 'info_writer',
      intentionally_generic: true,
      generic_info_candidate: true,
      generic_info_marked_at: '2026-07-03T00:00:00.000Z',
      generic_info_marked_by: 'blog-destinationless-info-recheck',
    });
  });

  it('builds durable generation metadata for already published generic info rows', () => {
    const generationMeta = buildDestinationlessInfoGenericGenerationMeta({
      checkedAt: '2026-07-03T00:00:00.000Z',
      row: {
        seo_title: '대학생 여름방학 여행 — 추천',
        generation_meta: { writer: 'info_writer' },
      },
    });

    expect(generationMeta).toMatchObject({
      writer: 'info_writer',
      intentionally_generic: true,
      generic_info_candidate: true,
      generic_info_marked_at: '2026-07-03T00:00:00.000Z',
      generic_info_marked_by: 'blog-published-info-destination-recheck',
    });
  });

  it('reports only destinationless rows that need action', () => {
    const report = buildBlogDestinationlessInfoWorkReport({
      rows: [
        {
          id: 'q1',
          topic: '여름 휴가철 해외여행 보험 꼭 필요한가요?',
          category: 'travel_tips',
          meta: { writer_type: 'info_writer' },
        },
        {
          id: 'q2',
          topic: '해외여행 보험',
          category: 'travel_tips',
          meta: { writer_type: 'info_writer', intentionally_generic: true },
        },
        {
          id: 'q3',
          topic: '이번 주말 현지 맛집 동선',
          category: 'food',
          meta: { writer_type: 'info_writer' },
        },
        {
          id: 'q4',
          topic: '가족 7월 날씨 여행 가이드',
          destination: '가족',
          category: 'travel_tips',
          meta: { writer_type: 'info_writer' },
        },
      ],
    });

    expect(report.total).toBe(3);
    expect(report.issue_counts).toEqual({
      generic_unmarked: 1,
      missing_destination: 1,
      invalid_destination: 1,
    });
    expect(report.next_actions).toEqual(['mark_intentionally_generic', 'add_destination_or_skip', 'archive_or_rewrite']);
  });
});
