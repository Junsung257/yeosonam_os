import { NextRequest, NextResponse } from 'next/server';
import {
  isSupabaseConfigured,
  getGroupRfq,
  getRfqMessages,
  createRfqMessage,
  RfqMessage,
} from '@/lib/supabase';
import { processCustomerMessage, processTenantMessage } from '@/lib/rfq-ai';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: rfqId } = await params;

  if (!isSupabaseConfigured) {
    const mockMessages: RfqMessage[] = [
      {
        id: 'mock-msg-001',
        rfq_id: rfqId,
        sender_type: 'customer',
        raw_content: '숙박 업그레이드가 가능한가요?',
        processed_content: '[업무 지시] 고객이 숙박 등급 업그레이드 가능 여부를 문의합니다.',
        pii_detected: false,
        pii_blocked: false,
        recipient_type: 'tenant',
        is_visible_to_customer: true,
        is_visible_to_tenant: true,
        created_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
      },
    ];
    return NextResponse.json({ messages: mockMessages, mock: true });
  }

  try {
    const { searchParams } = new URL(request.url);
    const viewAs = (searchParams.get('viewAs') ?? 'admin') as 'customer' | 'tenant' | 'admin';
    const proposalId = searchParams.get('proposal_id') ?? undefined;

    const messages = await getRfqMessages(rfqId, viewAs, proposalId);
    return NextResponse.json({ messages, count: messages.length });
  } catch (error) {
    console.error('메시지 조회 오류:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '메시지 조회에 실패했습니다.' },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: rfqId } = await params;

  if (!isSupabaseConfigured) {
    const body = await request.json();
    return NextResponse.json({
      message: {
        id: `mock-msg-${Date.now()}`,
        rfq_id: rfqId,
        sender_type: body.sender_type ?? 'customer',
        raw_content: body.raw_content ?? '',
        processed_content: `[처리됨] ${body.raw_content ?? ''}`,
        pii_detected: false,
        pii_blocked: false,
        recipient_type: body.sender_type === 'customer' ? 'tenant' : 'customer',
        is_visible_to_customer: true,
        is_visible_to_tenant: true,
        created_at: new Date().toISOString(),
      },
      processed_content: `[처리됨] ${body.raw_content ?? ''}`,
      pii_blocked: false,
      mock: true,
    });
  }

  try {
    const body = await request.json();
    const {
      sender_type,
      sender_id,
      raw_content,
      proposal_id,
    }: {
      sender_type: 'customer' | 'tenant';
      sender_id?: string;
      raw_content: string;
      proposal_id?: string;
    } = body;

    if (!sender_type || !raw_content) {
      return NextResponse.json(
        { error: 'sender_type과 raw_content는 필수입니다.' },
        { status: 400 }
      );
    }

    // RFQ 조회
    const rfq = await getGroupRfq(rfqId);
    if (!rfq) {
      return NextResponse.json({ error: 'RFQ를 찾을 수 없습니다.' }, { status: 404 });
    }

    let processResult: { processed: string; pii_detected: boolean; pii_details?: string };
    let isVisibleToCustomer: boolean;
    let isVisibleToTenant: boolean;
    let recipientType: 'customer' | 'tenant' | 'admin';

    if (sender_type === 'customer') {
      processResult = await processCustomerMessage(raw_content, rfq);
      isVisibleToCustomer = true;
      isVisibleToTenant = !processResult.pii_detected; // PII 차단 시 테넌트 비노출
      recipientType = 'tenant';
    } else {
      processResult = await processTenantMessage(raw_content, rfq);
      isVisibleToCustomer = true;
      isVisibleToTenant = true;
      recipientType = 'customer';
    }

    const piiBlocked = processResult.pii_detected;

    // 원본 메시지 저장
    const message = await createRfqMessage({
      rfq_id: rfqId,
      proposal_id,
      sender_type,
      sender_id,
      raw_content,
      processed_content: processResult.processed,
      pii_detected: processResult.pii_detected,
      pii_blocked: piiBlocked,
      recipient_type: recipientType,
      is_visible_to_customer: isVisibleToCustomer,
      is_visible_to_tenant: isVisibleToTenant,
    });

    // AI 번역 노트 시스템 메시지 생성
    if (processResult.processed !== raw_content) {
      const translationNote = piiBlocked
        ? `⚠️ 개인정보(${processResult.pii_details ?? ''})가 감지되어 메시지가 차단되었습니다.`
        : `[AI 번역 완료] ${sender_type === 'customer' ? '고객' : '랜드사'} 메시지가 업무 언어로 변환되었습니다.`;

      await createRfqMessage({
        rfq_id: rfqId,
        proposal_id,
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

    return NextResponse.json({
      message,
      processed_content: processResult.processed,
      pii_blocked: piiBlocked,
    }, { status: 201 });
  } catch (error) {
    console.error('메시지 전송 오류:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '메시지 전송에 실패했습니다.' },
      { status: 500 }
    );
  }
}
