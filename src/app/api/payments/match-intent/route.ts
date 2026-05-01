import { NextRequest, NextResponse } from 'next/server';
import { parseCommandInput } from '@/lib/payment-command-parser';
import { resolvePaymentCommand } from '@/lib/payment-command-resolver';

/**
 * POST /api/payments/match-intent
 *
 * 어드민 ⌘K 채팅바에서 사장님이 입력한 한 줄 명령(`260505_남영선_베스트아시아`)을
 * 받아 booking / customer / land_operator 후보를 조회하고 분기 라벨(A/B/C/D)을 반환.
 *
 * Body: { input: string }
 * Response: ResolveResult (parsed, branch, bookings, operators, similarCustomers, warnings)
 *
 * 정책: 출금 자동매칭 절대 금지. 이 API 는 후보 제시까지만, 확정은 별도 엔드포인트.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const input = typeof body?.input === 'string' ? body.input : '';

    if (!input.trim()) {
      return NextResponse.json(
        { error: '입력이 비어있습니다' },
        { status: 400 },
      );
    }

    const parsed = parseCommandInput(input);
    const result = await resolvePaymentCommand(parsed);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '처리 실패' },
      { status: 500 },
    );
  }
}
