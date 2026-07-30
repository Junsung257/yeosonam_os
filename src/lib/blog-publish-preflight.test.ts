import { describe, expect, it } from 'vitest';
import { evaluateBlogPublishPreflight } from './blog-publish-preflight';

const goodPost = (slug: string) => ({
  slug,
  quality_gate: { passed: true },
  generation_meta: { content_brief: { primary_keyword: '발리 가족여행' } },
  seo_score: { score: 96 },
  readability_score: 96,
});

describe('evaluateBlogPublishPreflight', () => {
  it('passes when inventory, queue, quality canary, and indexing outbox are healthy', () => {
    const result = evaluateBlogPublishPreflight({
      dailyTarget: 4,
      publishedToday: 1,
      publishableCandidateCount: 12,
      duplicateCandidateCount: 0,
      evidenceInsufficientCount: 0,
      candidateShortage: false,
      actionableFailedCount: 0,
      staleGeneratingCount: 0,
      indexingOutboxMissingCount: 0,
      indexingOutboxCoverageRate: 100,
      recentPosts: [goodPost('a'), goodPost('b'), goodPost('c')],
    });

    expect(result.status).toBe('pass');
    expect(result.canary_ready).toBe(true);
    expect(result.blockers).toHaveLength(0);
  });

  it('blocks publishing when recent posts are missing indexing outbox jobs', () => {
    const result = evaluateBlogPublishPreflight({
      dailyTarget: 4,
      publishedToday: 0,
      publishableCandidateCount: 12,
      duplicateCandidateCount: 0,
      evidenceInsufficientCount: 0,
      candidateShortage: false,
      actionableFailedCount: 0,
      staleGeneratingCount: 0,
      indexingOutboxMissingCount: 2,
      indexingOutboxCoverageRate: 80,
      recentPosts: [goodPost('a'), goodPost('b'), goodPost('c')],
    });

    expect(result.status).toBe('block');
    expect(result.blockers.map((check) => check.id)).toContain('indexing_outbox');
  });

  it('blocks when the recent canary quality sample fails current evidence requirements', () => {
    const result = evaluateBlogPublishPreflight({
      dailyTarget: 4,
      publishedToday: 0,
      publishableCandidateCount: 12,
      duplicateCandidateCount: 0,
      evidenceInsufficientCount: 0,
      candidateShortage: false,
      actionableFailedCount: 0,
      staleGeneratingCount: 0,
      indexingOutboxMissingCount: 0,
      recentPosts: [
        goodPost('a'),
        { ...goodPost('b'), generation_meta: {} },
        goodPost('c'),
      ],
    });

    expect(result.status).toBe('block');
    expect(result.blockers.map((check) => check.id)).toContain('canary_recent_quality_sample');
  });

  it('warns instead of blocking when only buffer inventory is low', () => {
    const result = evaluateBlogPublishPreflight({
      dailyTarget: 4,
      publishedToday: 2,
      publishableCandidateCount: 3,
      duplicateCandidateCount: 1,
      evidenceInsufficientCount: 0,
      candidateShortage: true,
      actionableFailedCount: 0,
      staleGeneratingCount: 0,
      indexingOutboxMissingCount: 0,
      recentPosts: [goodPost('a'), goodPost('b'), goodPost('c')],
    });

    expect(result.status).toBe('warn');
    expect(result.warnings.map((check) => check.id)).toContain('publishable_inventory');
    expect(result.warnings.map((check) => check.id)).toContain('duplicate_pressure');
    expect(result.score).toBe(90);
  });

  it('keeps one non-blocking manual-review warning at the 95-point operating floor', () => {
    const result = evaluateBlogPublishPreflight({
      dailyTarget: 5,
      publishedToday: 0,
      publishableCandidateCount: 20,
      duplicateCandidateCount: 0,
      evidenceInsufficientCount: 0,
      candidateShortage: false,
      actionableFailedCount: 0,
      staleGeneratingCount: 0,
      manualReviewCount: 4,
      indexingOutboxMissingCount: 0,
      indexingOutboxCoverageRate: 100,
      recentPosts: [goodPost('a'), goodPost('b'), goodPost('c')],
    });

    expect(result.status).toBe('warn');
    expect(result.score).toBe(95);
    expect(result.blockers).toHaveLength(0);
    expect(result.warnings.map((check) => check.id)).toEqual(['queue_health']);
  });

  it('does not block verified daily slots because a different candidate lacks evidence', () => {
    const result = evaluateBlogPublishPreflight({
      dailyTarget: 5,
      publishedToday: 3,
      publishableCandidateCount: 20,
      duplicateCandidateCount: 0,
      evidenceInsufficientCount: 1,
      candidateShortage: false,
      actionableFailedCount: 0,
      staleGeneratingCount: 0,
      indexingOutboxMissingCount: 0,
      indexingOutboxCoverageRate: 100,
      recentPosts: [goodPost('a'), goodPost('b'), goodPost('c')],
    });

    expect(result.status).toBe('warn');
    expect(result.canary_ready).toBe(true);
    expect(result.blockers).toHaveLength(0);
    expect(result.warnings.map((check) => check.id)).toEqual(['evidence_readiness']);
    expect(result.next_action).toContain('verified candidates');
  });

  it('does not warn for overdue queued rows when publishable inventory is sufficient', () => {
    const result = evaluateBlogPublishPreflight({
      dailyTarget: 4,
      publishedToday: 4,
      publishableCandidateCount: 87,
      duplicateCandidateCount: 0,
      evidenceInsufficientCount: 0,
      candidateShortage: false,
      actionableFailedCount: 0,
      staleGeneratingCount: 0,
      overdueQueuedCount: 6,
      indexingOutboxMissingCount: 0,
      recentPosts: [goodPost('a'), goodPost('b'), goodPost('c')],
    });

    expect(result.status).toBe('pass');
    expect(result.checks.find((check) => check.id === 'queue_health')?.status).toBe('pass');
  });

  it('does not downgrade publish preflight after the daily target is already met by safe candidates', () => {
    const result = evaluateBlogPublishPreflight({
      dailyTarget: 4,
      publishedToday: 4,
      publishableCandidateCount: 15,
      duplicateCandidateCount: 0,
      evidenceInsufficientCount: 0,
      candidateShortage: false,
      actionableFailedCount: 0,
      staleGeneratingCount: 0,
      manualReviewCount: 34,
      indexingOutboxMissingCount: 0,
      indexingOutboxCoverageRate: 100,
      recentPosts: [goodPost('a'), goodPost('b'), goodPost('c')],
    });

    expect(result.status).toBe('pass');
    expect(result.checks.find((check) => check.id === 'queue_health')?.status).toBe('pass');
    expect(result.checks.find((check) => check.id === 'queue_health')?.detail).toContain('quota is already met');
  });
});
