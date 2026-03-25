import { NextRequest, NextResponse } from 'next/server';
import { runInterviewTurn, InterviewState } from '@/lib/rfq-ai';

export async function POST(request: NextRequest) {
  try {
    const { message, state } = await request.json() as { message: string; state: InterviewState };

    if (!message) {
      return NextResponse.json({ error: '메시지가 필요합니다.' }, { status: 400 });
    }

    const initialState: InterviewState = state ?? {
      messages: [],
      extracted: {},
      isComplete: false,
      stepsDone: [],
    };

    const result = await runInterviewTurn(message, initialState);
    return NextResponse.json(result);
  } catch (error) {
    console.error('인터뷰 API 오류:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '인터뷰 처리에 실패했습니다.' },
      { status: 500 }
    );
  }
}
