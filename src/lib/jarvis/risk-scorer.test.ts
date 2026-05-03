import { describe, expect, it } from 'vitest';
import { requiresApproval, scoreRiskLevel } from '@/lib/jarvis/risk-scorer';

describe('risk-scorer', () => {
  it('일반 문의는 low', () => {
    expect(scoreRiskLevel({ message: '다낭 일정 추천해줘' })).toBe('low');
  });

  it('가격/정산 관련은 high', () => {
    expect(scoreRiskLevel({ message: '가격 변경하고 정산 반영해줘' })).toBe('high');
  });

  it('환불/결제취소는 critical', () => {
    expect(scoreRiskLevel({ message: '환불 처리해줘' })).toBe('critical');
    expect(scoreRiskLevel({ message: '결제 취소 진행해줘' })).toBe('critical');
  });

  it('승인 필요 기준은 high 이상', () => {
    expect(requiresApproval('low')).toBe(false);
    expect(requiresApproval('medium')).toBe(false);
    expect(requiresApproval('high')).toBe(true);
    expect(requiresApproval('critical')).toBe(true);
  });
});

