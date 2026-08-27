import { describe, expect, it } from 'vitest';
import {
  getInformationalReviewBlockReason,
  isHighRiskAutoDiscardTopic,
  isHighRiskInformationalTopic,
} from './blog-publication-review-policy';

describe('informational publication review policy', () => {
  it.each([
    '일본 입국 신고와 비자 조건',
    '미국 ESTA 신청 방법',
    '해외여행 보험 보장과 면책',
    '면세 한도와 세관 신고',
    '해외여행 약',
    '처방약 해외 반입과 영문 처방전',
  ])('classifies high-risk informational topics: %s', (title) => {
    expect(isHighRiskInformationalTopic({ title })).toBe(true);
  });

  it.each([
    '괌 항공권 가격과 잔여석 확인',
    '하와이 호텔 운영시간과 예약 가능 여부',
  ])('classifies V4 unattended topics for automatic discard: %s', (title) => {
    expect(isHighRiskAutoDiscardTopic({ title })).toBe(true);
    expect(isHighRiskInformationalTopic({ title })).toBe(false);
  });

  it('does not confuse reservation terms with medication queries', () => {
    expect(isHighRiskInformationalTopic({ title: '여행 예약 약관 안내' })).toBe(false);
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

  it('allows approved high-risk information and blocks review-state products too', () => {
    expect(getInformationalReviewBlockReason({
      title: '일본 입국 비자 안내',
      reviewStatus: 'approved',
    })).toBeNull();
    expect(getInformationalReviewBlockReason({
      productId: 'product-1',
      title: '비자 포함 상품',
      reviewStatus: 'pending_review',
    })).toBe('review_not_approved');
  });
});
