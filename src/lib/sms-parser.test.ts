import { describe, expect, it } from 'vitest';
import { parseShinhanSMS } from './sms-parser';

describe('parseShinhanSMS', () => {
  it('신한은행 입금 문자를 파싱한다', () => {
    const parsed = parseShinhanSMS(
      '[Web발신][신한은행] 입금 홍길동 300,000원 잔액1,234,567원 03/09 10:30',
      new Date('2026-03-09T10:31:00+09:00'),
    );

    expect(parsed.transactionType).toBe('입금');
    expect(parsed.isDeposit).toBe(true);
    expect(parsed.isWithdrawal).toBe(false);
    expect(parsed.senderName).toBe('홍길동');
    expect(parsed.amount).toBe(300_000);
    expect(parsed.balance).toBe(1_234_567);
  });

  it('신한은행 출금/송금 문자를 파싱한다', () => {
    const parsed = parseShinhanSMS(
      '[신한은행] 출금 주식회사투어폰 1,000,500원 잔액2,000,000원 03/16 14:16',
      new Date('2026-03-16T14:17:00+09:00'),
    );

    expect(parsed.transactionType).toBe('출금');
    expect(parsed.isDeposit).toBe(false);
    expect(parsed.isWithdrawal).toBe(true);
    expect(parsed.senderName).toBe('주식회사투어폰');
    expect(parsed.amount).toBe(1_000_500);
  });

  it('신한은행 입출금 문자가 아니면 무시한다', () => {
    const parsed = parseShinhanSMS('인증번호 [123456] 입니다.');

    expect(parsed.transactionType).toBeNull();
    expect(parsed.amount).toBeNull();
    expect(parsed.senderName).toBeNull();
  });
});
