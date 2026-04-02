import { RouterResult } from './types'
import { ROUTER_PROMPT } from './prompts'

export async function routeMessage(
  userMessage: string,
  context: Record<string, any>
): Promise<RouterResult> {
  const apiKey = process.env.GOOGLE_AI_API_KEY
  if (!apiKey) {
    return { agent: 'operations', confidence: 0.5, reasoning: 'API 키 미설정' }
  }

  const model = process.env.JARVIS_ROUTER_MODEL || 'gemini-2.0-flash'
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: ROUTER_PROMPT }] },
        contents: [{
          role: 'user',
          parts: [{ text: `컨텍스트: ${JSON.stringify(context)}\n\n사용자 메시지: ${userMessage}` }],
        }],
        generationConfig: { temperature: 0.1 },
      }),
    })

    if (!res.ok) throw new Error(`Gemini ${res.status}`)

    const json = await res.json()
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text || ''
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('No JSON in router response')
    return JSON.parse(jsonMatch[0]) as RouterResult
  } catch {
    return { agent: 'operations', confidence: 0.5, reasoning: '라우팅 실패, 기본 에이전트 사용' }
  }
}
