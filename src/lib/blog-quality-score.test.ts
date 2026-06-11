import { describe, expect, it } from 'vitest';
import { aggregateBlogQualityFleet, calculateBlogQualityScore } from './blog-quality-score';
import type { BlogIntentQualityReport } from './blog-content-intent';
import type { QualityGateReport } from './blog-quality-gate';
import type { ReadabilityResult } from './blog-readability';
import type { SeoScoreResult } from './blog-seo-scorer';

const passedQualityGate: QualityGateReport = {
  passed: true,
  gates: [],
  summary: 'quality passed',
  checkedAt: '2026-06-11T00:00:00.000Z',
};

const passedSeo: SeoScoreResult = {
  passed: true,
  score: 96,
  maxScore: 100,
  details: [
    {
      name: 'title',
      score: 12,
      maxScore: 12,
      status: 'pass',
      message: 'title ok',
    },
  ],
  summary: 'seo passed',
  checkedAt: '2026-06-11T00:00:00.000Z',
};

const passedReadability: ReadabilityResult = {
  score: 88,
  sentence_count: 12,
  avg_sentence_len: 42,
  long_sentence_count: 0,
  double_negative_count: 0,
  duplicate_phrases: [],
  issues: [],
};

const passedEditorial: BlogIntentQualityReport = {
  passed: true,
  score: 100,
  intent: {
    mode: 'info',
    infoSubtype: 'general',
    productSubtype: null,
    readerIntent: 'learn',
    confidence: 90,
    evidence: ['test'],
  },
  issues: [],
};

describe('blog quality score', () => {
  it('returns score_100 only when every component has zero issues', () => {
    const report = calculateBlogQualityScore({
      qualityGate: passedQualityGate,
      seoScore: passedSeo,
      readability: passedReadability,
      editorial: passedEditorial,
    });

    expect(report.status).toBe('score_100');
    expect(report.passed).toBe(true);
    expect(report.score).toBe(100);
    expect(report.issues).toEqual([]);
  });

  it('blocks 100 when editorial has a warning', () => {
    const report = calculateBlogQualityScore({
      editorial: {
        ...passedEditorial,
        score: 94,
        issues: [
          {
            code: 'weak_reading_design',
            severity: 'warning',
            message: 'Needs stronger reading design.',
          },
        ],
      },
    });

    expect(report.status).toBe('fail');
    expect(report.passed).toBe(false);
    expect(report.score).toBe(95);
    expect(report.issues).toMatchObject([
      { code: 'editorial.weak_reading_design', severity: 'minor' },
    ]);
  });

  it('applies critical, major, and minor diagnostic penalties', () => {
    const report = calculateBlogQualityScore({
      qualityGate: {
        passed: false,
        checkedAt: '2026-06-11T00:00:00.000Z',
        summary: 'failed',
        gates: [
          { gate: 'render_integrity', passed: false, reason: 'render failed' },
          { gate: 'length', passed: false, reason: 'too short' },
        ],
      },
      seoScore: {
        ...passedSeo,
        details: [
          {
            name: 'semantic_longtail_coverage',
            score: 4,
            maxScore: 8,
            status: 'warn',
            message: 'weak semantic coverage',
          },
        ],
      },
    });

    expect(report.score).toBe(55);
    expect(report.issues.map((issue) => issue.severity)).toEqual(['critical', 'major', 'minor']);
  });

  it('computes fleet score from the share of 100-point posts', () => {
    const perfect = calculateBlogQualityScore({ editorial: passedEditorial });
    const failed = calculateBlogQualityScore({
      editorial: {
        ...passedEditorial,
        issues: [
          {
            code: 'weak_source_backing',
            severity: 'critical',
            message: 'Needs an official source.',
          },
        ],
      },
    });

    expect(aggregateBlogQualityFleet([perfect, failed])).toMatchObject({
      ok: false,
      fleetScore: 50,
      total: 2,
      score100Count: 1,
      failedCount: 1,
      issueCounts: { 'editorial.weak_source_backing': 1 },
    });
  });
});
