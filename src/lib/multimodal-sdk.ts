/**
 * 여소남 OS — 멀티모달/음성 AI SDK (Phase 3-4)
 *
 * 장기 로드맵. 하위 파트:
 *   1. Voice SDK — STT (음성→텍스트) + TTS (텍스트→음성)
 *   2. Vision — 이미지 분석 (Gemini Vision)
 *   3. 멀티모달 QA — 음성+이미지 입력 → LLM 응답
 *
 * 현재 구현: Google Cloud STT/TTS 기본 구조 + Gemini Vision.
 * Priceline Penny Voice 패턴 참고.
 *
 * 사용:
 *   import { transcribeSpeech, synthesizeSpeech, analyzeImage } from '@/lib/multimodal-sdk'
 *
 *   // STT: 음성 파일 → 텍스트
 *   const text = await transcribeSpeech(audioBuffer, 'webm')
 *
 *   // TTS: 텍스트 → 음성 버퍼
 *   const audio = await synthesizeSpeech('안녕하세요', 'ko-KR')
 *
 *   // Vision: 이미지 분석
 *   const description = await analyzeImage(imageBuffer, '이 사진에 뭐가 있나요?')
 */

import { getSecret } from '@/lib/secret-registry'

// ─── 환경 변수 ──────────────────────────────────────────────────────────

const GOOGLE_CLOUD_API_KEY = () => getSecret('GOOGLE_API_KEY') ?? process.env.GOOGLE_AI_API_KEY

// ─── STT: Speech-to-Text ──────────────────────────────────────────────

export interface TranscriptionResult {
  text: string
  confidence: number
  languageCode: string
}

/**
 * Google Cloud Speech-to-Text API 를 호출하여 음성을 텍스트로 변환한다.
 * 지원 포맷: webm, ogg, wav, mp3 (16kHz 모노 권장)
 */
export async function transcribeSpeech(
  audioBuffer: ArrayBuffer,
  mimeType: string,
  languageCode = 'ko-KR',
): Promise<TranscriptionResult | null> {
  const apiKey = GOOGLE_CLOUD_API_KEY()
  if (!apiKey) {
    console.warn('[multimodal] Google Cloud API 키 없음')
    return null
  }

  try {
    const base64Audio = Buffer.from(audioBuffer).toString('base64')
    const res = await fetch(
      `https://speech.googleapis.com/v1/speech:recognize?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          config: {
            encoding: mimeTypeToEncoding(mimeType),
            sampleRateHertz: 16000,
            languageCode,
            enableAutomaticPunctuation: true,
            model: 'latest_long',
          },
          audio: { content: base64Audio },
        }),
      },
    )

    const data = await res.json()
    if (!res.ok) {
      console.warn('[multimodal] STT 실패:', data)
      return null
    }

    const results = data.results as Array<{
      alternatives: Array<{ transcript: string; confidence: number }>
    }> | undefined

    if (!results || results.length === 0) return null

    const best = results[0].alternatives[0]
    return {
      text: best.transcript,
      confidence: best.confidence ?? 0,
      languageCode,
    }
  } catch (err) {
    console.warn('[multimodal] STT 오류:', err)
    return null
  }
}

function mimeTypeToEncoding(mimeType: string): string {
  const map: Record<string, string> = {
    'audio/webm': 'WEBM_OPUS',
    'audio/ogg': 'OGG_OPUS',
    'audio/wav': 'LINEAR16',
    'audio/mp3': 'MP3',
    'audio/mpeg': 'MP3',
  }
  return map[mimeType] ?? 'WEBM_OPUS'
}

// ─── TTS: Text-to-Speech ──────────────────────────────────────────────

/**
 * Google Cloud Text-to-Speech API 를 호출하여 텍스트를 음성 버퍼로 변환한다.
 */
export async function synthesizeSpeech(
  text: string,
  languageCode = 'ko-KR',
  voiceName = 'ko-KR-Wavenet-C',
  speakingRate = 1.0,
): Promise<ArrayBuffer | null> {
  const apiKey = GOOGLE_CLOUD_API_KEY()
  if (!apiKey) {
    console.warn('[multimodal] Google Cloud API 키 없음')
    return null
  }

  try {
    const res = await fetch(
      `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: { text },
          voice: { languageCode, name: voiceName },
          audioConfig: {
            audioEncoding: 'MP3',
            speakingRate,
            pitch: 0,
          },
        }),
      },
    )

    const data = await res.json()
    if (!res.ok) {
      console.warn('[multimodal] TTS 실패:', data)
      return null
    }

    const audioContent = data.audioContent as string
    if (!audioContent) return null

    return Buffer.from(audioContent, 'base64').buffer
  } catch (err) {
    console.warn('[multimodal] TTS 오류:', err)
    return null
  }
}

// ─── Vision: 이미지 분석 (Gemini Vision) ──────────────────────────────

export interface VisionAnalysisResult {
  description: string
  labels?: string[]
  text?: string
}

/**
 * Gemini Vision API 를 호출하여 이미지를 분석한다.
 * Gemini 가 multimodal native 라서 별도 Vision API 필요 없음.
 */
export async function analyzeImage(
  imageBuffer: ArrayBuffer,
  prompt: string,
): Promise<VisionAnalysisResult | null> {
  const apiKey = GOOGLE_CLOUD_API_KEY()
  if (!apiKey) return null

  const base64Image = Buffer.from(imageBuffer).toString('base64')
  const mimeType = detectMimeType(imageBuffer)

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType,
                  data: base64Image,
                },
              },
            ],
          }],
        }),
      },
    )

    const data = await res.json()
    if (!res.ok) {
      console.warn('[multimodal] Vision 실패:', data)
      return null
    }

    const candidates = data.candidates as Array<{
      content: { parts: Array<{ text: string }> }
    }> | undefined

    if (!candidates || candidates.length === 0) return null

    return {
      description: candidates[0].content.parts.map((p) => p.text).join('\n'),
    }
  } catch (err) {
    console.warn('[multimodal] Vision 오류:', err)
    return null
  }
}

function detectMimeType(buffer: ArrayBuffer): string {
  const arr = new Uint8Array(buffer.slice(0, 4))
  const hex = Array.from(arr).map((b) => b.toString(16)).join('')

  if (hex.startsWith('89504e47')) return 'image/png'
  if (hex.startsWith('ffd8ffe0') || hex.startsWith('ffd8ffe1')) return 'image/jpeg'
  if (hex.startsWith('52494646')) return 'image/webp'
  return 'image/png'
}

// ─── Voice Chat API Route 기본 구조 ──────────────────────────────────

/**
 * Voice Chat API 에 전송할 DTO.
 * POST /api/v1/voice/chat
 */
export interface VoiceChatRequest {
  /** base64 인코딩된 오디오 데이터 */
  audio: string
  /** MIME 타입 (audio/webm, audio/wav, audio/mp3) */
  mimeType: string
  /** 기존 대화 히스토리 (선택) */
  history?: Array<{ role: string; content: string }>
  /** 세션 ID (선택) */
  sessionId?: string
  /** 테넌트 ID (선택) */
  tenantId?: string
}

export interface VoiceChatResponse {
  /** 음성 응답 (base64 인코딩 MP3) */
  audio: string
  /** 음성을 텍스트로 변환한 결과 */
  transcript: string
  /** AI 응답 텍스트 */
  text: string
  /** 세션 ID */
  sessionId: string
}
