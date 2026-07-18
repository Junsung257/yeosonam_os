import { describe, expect, it } from 'vitest';
import {
  getInformationalReviewBlockReason,
  isHighRiskInformationalTopic,
} from './blog-publication-review-policy';

describe('informational publication review policy', () => {
  it.each([
    '일본 입국 신고와 비자 조건',
    '미국 ESTA 신청 방법',
    '해외여행 보험 보장과 면책',
    '면세 한도와 세관 신고',
  ])('classifies high-risk informational topics: %s', (title) => {
    expect(isHighRiskInformationalTopic({ title })).toBe(true);
  });

  it('requires explicit approval for high-risk information', () => {
    expect(getInformationalReviewBlockReason({
      title: '일본 입국 비자 안내',
      reviewStatus: 'none',
    })).toBe('high_risk_human_review_required');
  });

  it('blocks any informational draft still in the review lifecycle', () => {
    expect(getInformationalReviewBlockReason({
      title: '삿포로 식비',
      reviewStatus: 'pending_review',
    })).toBe('review_not_approved');
  });

  it('allows approved high-risk information and leaves product content unchanged', () => {
    expect(getInformationalReviewBlockReason({
      title: '일본 입국 비자 안내',
      reviewStatus: 'approved',
    })).toBeNull();
    expect(getInformationalReviewBlockReason({
      productId: 'product-1',
      title: '비자 포함 상품',
      reviewStatus: 'pending_review',
    })).toBeNull();
  });
});
