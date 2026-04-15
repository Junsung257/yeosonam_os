import { supabaseAdmin } from '@/lib/supabase';
import { TravelPackageInsertSchema } from '@/lib/validators/package-schema';
import { z } from 'zod';

/**
 * AI 에이전트가 직접 DB에 데이터를 넣는 것을 방지하고,
 * 엄격한 정합성(Schema Check)을 거쳐 결재함(agent_actions)에 기안서로 올리는 도구
 */
export async function submitPackageProposal(payload: any, summary: string, requestedBy: string = 'jarvis') {
  try {
    // 1. Zod 강제 검증: 규격에 어긋나는 키/타입이 있으면 ZodError 발생
    const validatedPayload = TravelPackageInsertSchema.parse(payload);

    // 2. 결재함(agent_actions)에 PENDING 상태로 기안서 제출
    const { data, error } = await supabaseAdmin.from('agent_actions').insert({
      agent_type: 'operations',
      action_type: 'create_package',
      summary: summary || `[자동등록요청] ${validatedPayload.title}`,
      payload: validatedPayload,
      status: 'pending',
      priority: 'high',
      requested_by: requestedBy
    }).select();

    if (error) {
      throw new Error(`DB Insert Error: ${error.message}`);
    }

    return {
      success: true,
      action_id: data?.[0]?.id,
      message: '성공적으로 결재함에 등록되었습니다. 관리자의 승인이 필요합니다.'
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      // AI가 쉽게 알아먹을 수 있도록 에러 파싱
      const issues = error.issues.map(i => `[${i.path.join('.')}] ${i.message}`).join(' \n');
      return {
        success: false,
        error: `제안된 데이터 규격이 시스템과 맞지 않습니다. 다음 항목을 수정하세요:\n${issues}`
      };
    }
    
    return {
      success: false,
      error: error instanceof Error ? error.message : '알 수 없는 서버 오류'
    };
  }
}
