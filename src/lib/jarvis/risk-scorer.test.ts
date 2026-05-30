import { describe, expect, it } from 'vitest';
import { requiresApproval, scoreRiskLevel } from '@/lib/jarvis/risk-scorer';

describe('risk-scorer', () => {
  it('general travel questions stay low risk', () => {
    expect(scoreRiskLevel({ message: '오사카 일정 추천해줘' })).toBe('low');
  });

  it('settlement and inventory mutations are high risk', () => {
    expect(scoreRiskLevel({ message: '가격 변경하고 정산 반영해줘' })).toBe('high');
    expect(scoreRiskLevel({ message: '좌석 확정하고 재고 차감해줘' })).toBe('high');
  });

  it('refunds and payment cancellation are critical', () => {
    expect(scoreRiskLevel({ message: '환불 처리해줘' })).toBe('critical');
    expect(scoreRiskLevel({ message: '결제 취소 진행해줘' })).toBe('critical');
    expect(scoreRiskLevel({ message: '카드 취소 바로 해줘' })).toBe('critical');
  });

  it('approval is required from high risk and above', () => {
    expect(requiresApproval('low')).toBe(false);
    expect(requiresApproval('medium')).toBe(false);
    expect(requiresApproval('high')).toBe(true);
    expect(requiresApproval('critical')).toBe(true);
  });
});
