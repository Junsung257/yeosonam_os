import { type NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import {
  isSupabaseConfigured,
  getGroupRfq,
  getRfqMessages,
  getRfqProposals,
  createRfqMessage,
  type RfqMessage,
} from '@/lib/supabase';
import { processCustomerMessage, processTenantMessage } from '@/lib/rfq-ai';
import {
  hasValidRfqShareToken,
  presentedRfqShareToken,
  resolveRfqActor,
  rfqForbiddenResponse,
  rfqUnauthorizedResponse,
} from '@/lib/rfq-request-auth';

type MessageSender = 'customer' | 'tenant';

function isMessageSender(value: unknown): value is MessageSender {
  return value === 'customer' || value === 'tenant';
}

export async function GET(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id: rfqId } = await props.params;
  const proposalId = request.nextUrl.searchParams.get('proposal_id')?.trim() || undefined;
  const actor = await resolveRfqActor(request);
  if (!actor && !presentedRfqShareToken(request)) return rfqUnauthorizedResponse();

  let viewAs: 'customer' | 'tenant' | 'admin';
  if (actor?.kind === 'admin') {
    viewAs = 'admin';
  } else if (actor?.kind === 'tenant') {
    if (!proposalId) return rfqForbiddenResponse();
    const proposals = await getRfqProposals(rfqId);
    const ownsProposal = proposals.some(
      (proposal) => proposal.id === proposalId && proposal.tenant_id === actor.tenantId,
    );
    if (!ownsProposal) return rfqForbiddenResponse();
    viewAs = 'tenant';
  } else {
    const rfq = await getGroupRfq(rfqId);
    if (!rfq || !hasValidRfqShareToken(request, rfq.share_token)) {
      return rfqUnauthorizedResponse();
    }
    viewAs = 'customer';
  }

  if (!isSupabaseConfigured) {
    const mockMessages: RfqMessage[] = [{
      id: 'mock-msg-001',
      rfq_id: rfqId,
      sender_type: 'customer',
      raw_content: '숙박 업그레이드가 가능한가요?',
      processed_content: '[업무 지시] 고객이 숙박 등급 업그레이드 가능 여부를 문의했습니다.',
      pii_detected: false,
      pii_blocked: false,
      recipient_type: 'tenant',
      is_visible_to_customer: true,
      is_visible_to_tenant: true,
      created_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    }];
    return apiResponse(
      { messages: mockMessages, mock: true },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  }

  try {
    const messages = await getRfqMessages(rfqId, viewAs, proposalId);
    const visibleMessages = viewAs === 'customer'
      ? messages.map((message) => message.pii_blocked
        ? {
            ...message,
            raw_content: message.processed_content || '[개인정보가 차단된 메시지]',
          }
        : message)
      : messages;
    return apiResponse(
      { messages: visibleMessages, count: visibleMessages.length },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    console.error('[rfq/messages] list failed:', sanitizeDbError(error));
    return apiResponse(
      { error: sanitizeDbError(error, '메시지 조회에 실패했습니다.') },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id: rfqId } = await props.params;

  try {
    const body = await request.json() as Record<string, unknown>;
    const rawContent = typeof body.raw_content === 'string' ? body.raw_content.trim() : '';
    if (!rawContent) {
      return apiResponse({ error: 'raw_content는 필수입니다.' }, { status: 400 });
    }
    if (rawContent.length > 5000) {
      return apiResponse({ error: '메시지는 5,000자 이하여야 합니다.' }, { status: 413 });
    }

    const actor = await resolveRfqActor(request);
    if (!actor && !presentedRfqShareToken(request, body.share_token)) {
      return rfqUnauthorizedResponse();
    }

    const rfq = await getGroupRfq(rfqId);
    if (!rfq) {
      return apiResponse({ error: 'RFQ를 찾을 수 없습니다.' }, { status: 404 });
    }

    const shareAccess = !actor && hasValidRfqShareToken(request, rfq.share_token, body.share_token);
    if (!actor && !shareAccess) return rfqUnauthorizedResponse();

    const proposalId = typeof body.proposal_id === 'string' && body.proposal_id.trim()
      ? body.proposal_id.trim()
      : undefined;

    let senderType: MessageSender;
    let senderId: string | undefined;
    if (actor?.kind === 'tenant') {
      if (!proposalId) return rfqForbiddenResponse();
      const proposals = await getRfqProposals(rfqId);
      const ownsProposal = proposals.some(
        (proposal) => proposal.id === proposalId && proposal.tenant_id === actor.tenantId,
      );
      if (!ownsProposal) return rfqForbiddenResponse();
      senderType = 'tenant';
      senderId = actor.userId;
    } else if (actor?.kind === 'admin') {
      senderType = isMessageSender(body.sender_type) ? body.sender_type : 'customer';
      senderId = undefined;
    } else {
      senderType = 'customer';
      senderId = undefined;
      if (proposalId) {
        const proposals = await getRfqProposals(rfqId);
        if (!proposals.some((proposal) => proposal.id === proposalId)) {
          return rfqForbiddenResponse();
        }
      }
    }

    if (!isSupabaseConfigured) {
      const processedContent = `[처리됨] ${rawContent}`;
      return apiResponse({
        message: {
          id: `mock-msg-${Date.now()}`,
          rfq_id: rfqId,
          proposal_id: proposalId,
          sender_type: senderType,
          sender_id: senderId,
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
      }, { status: 201 });
    }

    const processResult = senderType === 'customer'
      ? await processCustomerMessage(rawContent, rfq)
      : await processTenantMessage(rawContent, rfq);

    const isVisibleToCustomer = true;
    const isVisibleToTenant = senderType === 'tenant' || !processResult.pii_detected;
    const recipientType = senderType === 'customer' ? 'tenant' : 'customer';
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
    }, { status: 201, headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('[rfq/messages] send failed:', sanitizeDbError(error));
    return apiResponse(
      { error: sanitizeDbError(error, '메시지 전송에 실패했습니다.') },
      { status: 500 },
    );
  }
}
