/**
 * 여소남 OS — Voice Chat API (Phase 3-4, 장기)
 *
 * POST /api/v1/voice/chat
 *
 * Priceline Penny Voice 패턴:
 *   1. 받은 음성을 STT 로 텍스트 변환
 *   2. 텍스트로 QA 채팅 실행
 *   3. 응답을 TTS 로 음성 변환하여 반환
 *
 * 헤더:
 *   Authorization: Bearer <api_key> (스코프: voice:chat)
 *
 * 바디:
 *   {
 *     "audio": "base64...",     // base64 인코딩 오디오
 *     "mimeType": "audio/webm",  // MIME 타입
 *     "history": [...],          // 선택
 *     "sessionId": "..."         // 선택
 *   }
 *
 * 응답:
 *   {
 *     "ok": true,
 *     "data": {
 *       "audio": "base64...",    // TTS 결과 (MP3)
 *       "transcript": "...",     // STT 결과
 *       "text": "...",           // AI 응답 텍스트
 *       "sessionId": "..."
 *     }
 *   }
 */

import { NextRequest } from 'next/server'
import { withApiKey } from '@/lib/api-key-middleware'
import { transcribeSpeech, synthesizeSpeech, type VoiceChatRequest } from '@/lib/multimodal-sdk'
import { createV1QaChatStream } from '@/lib/qa-chat-engine'
import { redactKoreanPII } from '@/lib/pii-redactor'
import { apiResponse, ApiErrors } from '@/lib/api-response'

export const maxDuration = 60

export async function POST(request: NextRequest) {
  const auth = await withApiKey(request, { requiredScopes: ['voice:chat', 'qa:*'] })
  if (!auth.valid) return auth.response

  let body: VoiceChatRequest
  try {
    body = await request.json()
  } catch {
    return ApiErrors.badRequest('JSON 형식이 올바르지 않습니다')
  }

  if (!body.audio || !body.mimeType) {
    return ApiErrors.badRequest('audio 와 mimeType 은 필수입니다')
  }

  // 1. STT: 음성 → 텍스트
  const audioBuffer = Uint8Array.from(Buffer.from(body.audio, 'base64')).buffer
  const transcription = await transcribeSpeech(audioBuffer, body.mimeType)
  if (!transcription) {
    return ApiErrors.internalError('음성 인식에 실패했습니다')
  }

  // 2. QA 채팅: 텍스트 → AI 응답 (stream)
  const stream = await createV1QaChatStream({
    message: transcription.text,
    history: body.history ?? [],
    sessionId: body.sessionId ?? null,
    referrer: null,
    affiliateRef: null,
    affiliateId: auth.tenantId,
  })

  // Stream → 전체 텍스트 수집
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let fullText = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    const chunk = decoder.decode(value)
    // NDJSON 형식: {"type":"token","data":"..."}
    for (const line of chunk.split('\n').filter(Boolean)) {
      try {
        const parsed = JSON.parse(line)
        if (parsed.type === 'token' && parsed.data) {
          fullText += parsed.data
        }
      } catch {
        // skip
      }
    }
  }

  // 3. TTS: AI 응답 → 음성
  const audioResponse = await synthesizeSpeech(fullText)
  if (!audioResponse) {
    return ApiErrors.internalError('음성 합성에 실패했습니다')
  }

  const audioBase64 = Buffer.from(audioResponse).toString('base64')
  const safeTranscript = redactKoreanPII(transcription.text).redacted

  return apiResponse({
    ok: true,
    data: {
      audio: audioBase64,
      transcript: safeTranscript,
      text: fullText,
      sessionId: body.sessionId ?? `voice-${Date.now()}`,
    },
  })
}
