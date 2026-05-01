import { describe, it, expect } from 'vitest';
import { parseCommandInput } from './payment-command-parser';

describe('parseCommandInput — 표준 메모 포맷', () => {
  it('260505_남영선_베스트아시아 → 세 토큰 모두 추출', () => {
    const r = parseCommandInput('260505_남영선_베스트아시아');
    expect(r.date).toBe('2026-05-05');
    expect(r.customerName).toBe('남영선');
    expect(r.operatorAlias).toBe('베스트아시아');
    expect(r.hasAnyToken).toBe(true);
    expect(r.warnings).toHaveLength(0);
  });

  it('공백 구분도 동일하게 처리', () => {
    const r = parseCommandInput('260505 남영선 베스트아시아');
    expect(r.date).toBe('2026-05-05');
    expect(r.customerName).toBe('남영선');
    expect(r.operatorAlias).toBe('베스트아시아');
  });

  it('슬래시 구분', () => {
    const r = parseCommandInput('260505/남영선/베스트');
    expect(r.date).toBe('2026-05-05');
    expect(r.customerName).toBe('남영선');
    expect(r.operatorAlias).toBe('베스트');
  });
});

describe('parseCommandInput — 부분 입력', () => {
  it('고객명만', () => {
    const r = parseCommandInput('남영선');
    expect(r.customerName).toBe('남영선');
    expect(r.date).toBeUndefined();
    expect(r.operatorAlias).toBeUndefined();
    expect(r.hasAnyToken).toBe(true);
  });

  it('날짜만 (YYMMDD)', () => {
    const r = parseCommandInput('260505');
    expect(r.date).toBe('2026-05-05');
    expect(r.customerName).toBeUndefined();
  });

  it('고객명 + 랜드사 (날짜 없음)', () => {
    const r = parseCommandInput('남영선 베스트투어');
    expect(r.customerName).toBe('남영선');
    expect(r.operatorAlias).toBe('베스트투어');
    expect(r.date).toBeUndefined();
  });

  it('단일 5자+ 한글 → 랜드사로 추정', () => {
    const r = parseCommandInput('베스트아시아');
    expect(r.operatorAlias).toBe('베스트아시아');
    expect(r.customerName).toBeUndefined();
  });

  it('단일 2~4자 한글 → 고객명으로 추정', () => {
    expect(parseCommandInput('홍길동').customerName).toBe('홍길동');
    expect(parseCommandInput('이순신').customerName).toBe('이순신');
    expect(parseCommandInput('김민수아').customerName).toBe('김민수아');
  });
});

describe('parseCommandInput — Booking ID 직타', () => {
  it('BK-0042', () => {
    expect(parseCommandInput('BK-0042').bookingId).toBe('BK-0042');
  });

  it('소문자 bk-0042', () => {
    expect(parseCommandInput('bk-0042').bookingId).toBe('BK-0042');
  });

  it('하이픈 없는 BK0042', () => {
    expect(parseCommandInput('BK0042').bookingId).toBe('BK-0042');
  });

  it('BK + 추가 컨텍스트', () => {
    const r = parseCommandInput('BK-0042 남영선');
    expect(r.bookingId).toBe('BK-0042');
    expect(r.customerName).toBe('남영선');
  });
});

describe('parseCommandInput — 다양한 날짜 포맷', () => {
  it('YYYY-MM-DD', () => {
    expect(parseCommandInput('2026-05-05_남영선').date).toBe('2026-05-05');
  });

  it('YY-MM-DD', () => {
    expect(parseCommandInput('26-05-05_남영선').date).toBe('2026-05-05');
  });

  it('YYYYMMDD (8자리)', () => {
    expect(parseCommandInput('20260505_남영선').date).toBe('2026-05-05');
  });

  it('YYYY/MM/DD', () => {
    expect(parseCommandInput('2026/05/05_남영선').date).toBe('2026-05-05');
  });

  it('한국어 날짜 5월5일 → ambiguous', () => {
    const r = parseCommandInput('5월5일 남영선');
    expect(r.date).toMatch(/^\d{4}-05-05$/);
    expect(r.dateAmbiguous).toBe(true);
    expect(r.customerName).toBe('남영선');
  });

  it('M/D → ambiguous', () => {
    const r = parseCommandInput('5/5 남영선');
    expect(r.dateAmbiguous).toBe(true);
    expect(r.customerName).toBe('남영선');
  });
});

describe('parseCommandInput — 무효 입력 / 엣지 케이스', () => {
  it('빈 입력', () => {
    const r = parseCommandInput('');
    expect(r.hasAnyToken).toBe(false);
  });

  it('공백만', () => {
    const r = parseCommandInput('   ');
    expect(r.hasAnyToken).toBe(false);
  });

  it('Feb 29 비윤년 → 날짜 무효', () => {
    const r = parseCommandInput('260229_남영선');
    expect(r.date).toBeUndefined();
    expect(r.customerName).toBe('남영선');
  });

  it('윤년 Feb 29 → 통과', () => {
    expect(parseCommandInput('240229_남영선').date).toBe('2024-02-29');
  });

  it('월 13 → 무효', () => {
    expect(parseCommandInput('261305_남영선').date).toBeUndefined();
  });

  it('reserved words (환불/취소 등)는 고객명에서 제외', () => {
    const r = parseCommandInput('BK-0042 환불');
    expect(r.bookingId).toBe('BK-0042');
    expect(r.customerName).toBeUndefined();
  });

  it('reserved words + 실제 이름 공존', () => {
    const r = parseCommandInput('260505 남영선 환불');
    expect(r.date).toBe('2026-05-05');
    expect(r.customerName).toBe('남영선');
    expect(r.operatorAlias).toBeUndefined();
  });

  it('한글 토큰 3개 → warning 발생', () => {
    const r = parseCommandInput('남영선 김민수 베스트투어');
    expect(r.warnings.length).toBeGreaterThan(0);
    expect(r.customerName).toBe('남영선');
    expect(r.operatorAlias).toBe('베스트투어');
  });

  it('단일 영문 토큰 — 짧으면 customer, 길면 operator', () => {
    const r = parseCommandInput('260505 BEST');
    expect(r.date).toBe('2026-05-05');
    // BEST = 4자 영문 → 길이 6 이하 = customer
    expect(r.customerName).toBe('BEST');
    expect(r.operatorAlias).toBeUndefined();
  });

  it('rawInput 보존', () => {
    const input = '260505_남영선_베스트아시아';
    expect(parseCommandInput(input).rawInput).toBe(input);
  });

  it('NFKC 정규화 — full-width 숫자/문자 입력', () => {
    // ２６０５０５_남영선 (full-width digits) → 정규화 후 정상 파싱
    const r = parseCommandInput('２６０５０５_남영선');
    expect(r.date).toBe('2026-05-05');
    expect(r.customerName).toBe('남영선');
  });

  it('영문 토큰 지원 — 외국인 이름 + 영문 약칭', () => {
    const r = parseCommandInput('260505_LEE_TOURBI');
    expect(r.date).toBe('2026-05-05');
    expect(r.customerName).toBe('LEE');
    expect(r.operatorAlias).toBe('TOURBI');
  });

  it('영문 reserved (REFUND/FEE) 는 토큰에서 제외', () => {
    const r = parseCommandInput('260505 LEE REFUND');
    expect(r.date).toBe('2026-05-05');
    expect(r.customerName).toBe('LEE');
    expect(r.operatorAlias).toBeUndefined();
  });

  it('한영 혼용 — 한글 고객 + 영문 랜드사', () => {
    const r = parseCommandInput('260505_남영선_BEST');
    expect(r.customerName).toBe('남영선');
    expect(r.operatorAlias).toBe('BEST');
  });
});
