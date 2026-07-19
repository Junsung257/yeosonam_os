import { type NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { isSupabaseConfigured, type RfqMessage } from '@/lib/supabase';
import { createRfqMessage, getGroupRfq, getRfqMessages, getRfqProposals, getRfqShareIdentity } from '@/lib/db/rfq-server';
import { processCustomerMessage, processTenantMessage } from '@/lib/rfq-ai';
import {
  hasValidRfqShareToken,
  presentedRfqShareToken,
  resolveRfqActor,
  rfqForbiddenResponse,
  rfqUnauthorizedResponse,
} from '@/lib/rfq-request-auth';
import { sensitiveBackendUnavailable } from '@/lib/sensitive-api-fail-closed';

type MessageSender = 'customer' | 'tenant';

function toCustomerMessage(message: RfqMessage) {
  return {
    id: message.id,
    rfq_id: message.rfq_id,
    proposal_id: message.proposal_id,
    sender_type: message.sender_type,
    processed_content: message.pii_blocked
      ? message.processed_content || '[개인정보가 차단된 메시지]'
      : message.processed_content || '',
    pii_blocked: message.pii_blocked,
    is_visible_to_customer: message.is_visible_to_customer,
    created_at: message.created_at,
  };
}

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
    const identity = await getRfqShareIdentity(rfqId);
    if (!identity || !hasValidRfqShareToken(request, identity.share_token)) {
      return rfqUnauthorizedResponse();
    }
    viewAs = 'customer';
  }

  if (!isSupabaseConfigured) {
    return sensitiveBackendUnavailable('rfq_messages');
  }

  try {
    const messages = await getRfqMessages(rfqId, viewAs, proposalId);
    const visibleMessages = viewAs === 'customer'
      ? messages.map(toCustomerMessage)
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

  if (!isSupabaseConfigured) {
    return sensitiveBackendUnavailable('rfq_messages');
  }

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
    if (!actor) return rfqUnauthorizedResponse();

    const rfq = await getGroupRfq(rfqId);
    if (!rfq) {
      return apiResponse({ error: 'RFQ를 찾을 수 없습니다.' }, { status: 404 });
    }

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
    if (!message) {
      return apiResponse({ error: 'Message persistence failed' }, { status: 500 });
    }

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
