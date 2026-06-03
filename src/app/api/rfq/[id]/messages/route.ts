import { type NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import {
  isSupabaseConfigured,
  getGroupRfq,
  getRfqMessages,
  createRfqMessage,
  type RfqMessage,
} from '@/lib/supabase';
import { processCustomerMessage, processTenantMessage } from '@/lib/rfq-ai';

type MessageSender = 'customer' | 'tenant';

function isMessageSender(value: unknown): value is MessageSender {
  return value === 'customer' || value === 'tenant';
}

export async function GET(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const { id: rfqId } = params;

  if (!isSupabaseConfigured) {
    const mockMessages: RfqMessage[] = [
      {
        id: 'mock-msg-001',
        rfq_id: rfqId,
        sender_type: 'customer',
        raw_content: '숙박 업그레이드가 가능한가요?',
        processed_content: '[업무 지원] 고객이 숙박 등급 업그레이드 가능 여부를 문의했습니다.',
        pii_detected: false,
        pii_blocked: false,
        recipient_type: 'tenant',
        is_visible_to_customer: true,
        is_visible_to_tenant: true,
        created_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
      },
    ];
    return apiResponse({ messages: mockMessages, mock: true });
  }

  try {
    const { searchParams } = new URL(request.url);
    const viewAs = (searchParams.get('viewAs') ?? 'admin') as 'customer' | 'tenant' | 'admin';
    const proposalId = searchParams.get('proposal_id') ?? undefined;

    const messages = await getRfqMessages(rfqId, viewAs, proposalId);
    return apiResponse({ messages, count: messages.length });
  } catch (error) {
    console.error('[rfq/messages] list failed:', sanitizeDbError(error));
    return apiResponse(
      { error: sanitizeDbError(error, '메시지 조회에 실패했습니다.') },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const { id: rfqId } = params;

  if (!isSupabaseConfigured) {
    const body = await request.json();
    const senderType = isMessageSender(body.sender_type) ? body.sender_type : 'customer';
    const rawContent = typeof body.raw_content === 'string' ? body.raw_content : '';
    const processedContent = `[처리됨] ${rawContent}`;
    return apiResponse({
      message: {
        id: `mock-msg-${Date.now()}`,
        rfq_id: rfqId,
        sender_type: senderType,
        raw_content: rawContent,
        processed_content: processedContent,
        pii_detected: false,
        pii_blocked: false,
        recipient_type: senderType === 'customer' ? 'tenant' : 'customer',
        is_visible_to_customer: true,
        is_visible_to_tenant: true,
        created_at: new Date().toISOString(),
      },
      processed_content: processedContent,
      pii_blocked: false,
      mock: true,
    });
  }

  try {
    const body = await request.json();
    const senderType = body.sender_type;
    const rawContent = body.raw_content;

    if (!isMessageSender(senderType) || typeof rawContent !== 'string' || !rawContent.trim()) {
      return apiResponse(
        { error: 'sender_type과 raw_content는 필수입니다.' },
        { status: 400 },
      );
    }

    const rfq = await getGroupRfq(rfqId);
    if (!rfq) {
      return apiResponse({ error: 'RFQ를 찾을 수 없습니다.' }, { status: 404 });
    }

    const proposalId = typeof body.proposal_id === 'string' ? body.proposal_id : undefined;
    const senderId = typeof body.sender_id === 'string' ? body.sender_id : undefined;
    let isVisibleToCustomer: boolean;
    let isVisibleToTenant: boolean;
    let recipientType: 'customer' | 'tenant' | 'admin';

    const processResult = senderType === 'customer'
      ? await processCustomerMessage(rawContent, rfq)
      : await processTenantMessage(rawContent, rfq);

    if (senderType === 'customer') {
      isVisibleToCustomer = true;
      isVisibleToTenant = !processResult.pii_detected;
      recipientType = 'tenant';
    } else {
      isVisibleToCustomer = true;
      isVisibleToTenant = true;
      recipientType = 'customer';
    }

    const piiBlocked = processResult.pii_detected;

    const message = await createRfqMessage({
      rfq_id: rfqId,
      proposal_id: proposalId,
      sender_type: senderType,
      sender_id: senderId,
      raw_content: rawContent,
      processed_content: processResult.processed,
      pii_detected: processResult.pii_detected,
      pii_blocked: piiBlocked,
      recipient_type: recipientType,
      is_visible_to_customer: isVisibleToCustomer,
      is_visible_to_tenant: isVisibleToTenant,
    });

    if (processResult.processed !== rawContent) {
      const translationNote = piiBlocked
        ? `개인정보(${processResult.pii_details ?? ''})가 감지되어 메시지가 차단되었습니다.`
        : `[AI 번역 완료] ${senderType === 'customer' ? '고객' : '랜드사'} 메시지가 업무 언어로 변환되었습니다.`;

      await createRfqMessage({
        rfq_id: rfqId,
        proposal_id: proposalId,
        sender_type: 'ai',
        raw_content: translationNote,
        processed_content: translationNote,
        pii_detected: false,
        pii_blocked: false,
        recipient_type: 'admin',
        is_visible_to_customer: false,
        is_visible_to_tenant: false,
      });
    }

    return apiResponse({
      message,
      processed_content: processResult.processed,
      pii_blocked: piiBlocked,
    }, { status: 201 });
  } catch (error) {
    console.error('[rfq/messages] send failed:', sanitizeDbError(error));
    return apiResponse(
      { error: sanitizeDbError(error, '메시지 전송에 실패했습니다.') },
      { status: 500 },
    );
  }
}
