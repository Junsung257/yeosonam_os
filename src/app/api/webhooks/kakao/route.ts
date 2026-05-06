import { NextRequest, NextResponse } from 'next/server'
import { getSecret } from '@/lib/secret-registry'
import { supabaseAdmin } from '@/lib/supabase'
import crypto from 'crypto'

function verifyKakaoSignature(body: string, signature: string): boolean {
  const secret = getSecret('KAKAO_CHANNEL_SECRET') || ''
  if (!secret) return true // 시크릿 미설정 시 검증 스킵
  const hash = crypto.createHmac('sha256', secret).update(body).digest('hex')
  return hash === signature
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  const signature = req.headers.get('x-kakao-signature') || ''

  // 서명 검증 (프로덕션에서만 활성화)
  if (process.env.NODE_ENV === 'production') {
    if (!verifyKakaoSignature(rawBody, signature)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }
  }

  try {
    const payload = JSON.parse(rawBody)

    const { userRequest } = payload
    const kakaoUserId = userRequest?.user?.id
    const messageText = userRequest?.utterance || ''

    if (!kakaoUserId || !messageText) {
      return NextResponse.json({ version: '2.0', template: { outputs: [] } })
    }

    // 고객 자동 매칭 (카카오 ID로 기존 고객 찾기)
    let customerId = null
    const { data: existingConv } = await supabaseAdmin
      .from('kakao_inbound')
      .select('customer_id')
      .eq('kakao_user_id', kakaoUserId)
      .not('customer_id', 'is', null)
      .order('received_at', { ascending: false })
      .limit(1)

    if (existingConv?.[0]?.customer_id) {
      customerId = existingConv[0].customer_id
    }

    // kakao_inbound 저장
    await supabaseAdmin.from('kakao_inbound').insert({
      kakao_user_id: kakaoUserId,
      customer_id: customerId,
      message: messageText,
      message_type: 'text',
      is_processed: false,
    })

    // conversations 테이블에도 저장 (고객 매칭된 경우)
    if (customerId) {
      const { data: convList } = await supabaseAdmin
        .from('conversations')
        .select('id, messages')
        .eq('customer_id', customerId)
        .order('created_at', { ascending: false })
        .limit(1)

      const conv = convList?.[0]
      if (conv) {
        const updatedMessages = [
          ...(conv.messages || []),
          { role: 'user', content: messageText, source: 'kakao', timestamp: new Date().toISOString() }
        ]
        await supabaseAdmin
          .from('conversations')
          .update({ messages: updatedMessages, updated_at: new Date().toISOString() })
          .eq('id', conv.id)
      } else {
        await supabaseAdmin.from('conversations').insert({
          customer_id: customerId,
          channel: 'kakao',
          messages: [{ role: 'user', content: messageText, source: 'kakao', timestamp: new Date().toISOString() }]
        })
      }
    }

    // 카카오 자동 응답
    return NextResponse.json({
      version: '2.0',
      template: {
        outputs: [{
          simpleText: {
            text: '안녕하세요! 여소남입니다. 메시지를 확인하고 곧 답변 드리겠습니다.'
          }
        }]
      }
    })
  } catch (error) {
    console.error('[카카오 웹훅] 오류:', error)
    return NextResponse.json({
      version: '2.0',
      template: { outputs: [{ simpleText: { text: '죄송합니다. 잠시 후 다시 시도해주세요.' } }] }
    })
  }
}
