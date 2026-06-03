import { type NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { runInterviewTurn, InterviewState } from '@/lib/rfq-ai';

export async function POST(request: NextRequest) {
  try {
    const { message, state } = await request.json() as { message: string; state: InterviewState };

    if (!message) {
      return apiResponse({ error: '메시지가 필요합니다.' }, { status: 400 });
    }

    const initialState: InterviewState = state ?? {
      messages: [],
      extracted: {},
      isComplete: false,
      stepsDone: [],
    };

    const result = await runInterviewTurn(message, initialState);
    return apiResponse(result);
  } catch (error) {
    console.error('[rfq/interview] failed:', sanitizeDbError(error));
    return apiResponse(
      { error: sanitizeDbError(error, '인터뷰 처리에 실패했습니다.') },
      { status: 500 },
    );
  }
}
