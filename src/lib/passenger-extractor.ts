/**
 * Passenger Extractor — PII 제거 전 원문 카카오 대화에서 탑승자 정보를 추출.
 * 생년월일·여권·전화번호 등 개인정보 포함. 어드민 서버사이드 전용.
 *
 * V3 (2026-05-01): DeepSeek V4-Flash로 전환 (Claude Haiku 대비 93% 비용 절감)
 */

import OpenAI from 'openai';
import { z } from 'zod';
import { callWithZodValidation } from './llm-validate-retry';
import { getSecret } from '@/lib/secret-registry';

const ROLE_VALUES = ['representative', 'adult', 'child', 'infant'] as const;
const GENDER_VALUES = ['male', 'female', 'unknown'] as const;

export const PassengerCandidateSchema = z.object({
  name: z.string().nullable(),
  phone: z.string().nullable(),              // 정규화: 01x-xxxx-xxxx
  birth_date: z.string().nullable(),         // YYYY-MM-DD (추정 포함)
  gender: z.enum(GENDER_VALUES),
  role: z.enum(ROLE_VALUES),                 // representative=대표자 연락처, infant=만 2세 미만
  passport_no: z.string().nullable(),
  passport_expiry: z.string().nullable(),    // YYYY-MM-DD
  confidence: z.number().min(0).max(1),
  source_hint: z.string().max(120).nullable(),// 어디서 추출했는지 원문 인용 (디버그용)
});

export const PassengerExtractionSchema = z.object({
  passengers: z.array(PassengerCandidateSchema).max(20),
  total_pax_note: z.string().nullable(),     // "성인 4명+유아 1명" 같은 원문 표기
});

export type PassengerCandidate = z.infer<typeof PassengerCandidateSchema>;
export type PassengerExtraction = z.infer<typeof PassengerExtractionSchema>;

const SYSTEM_PROMPT = `당신은 한국 여행사 카카오톡 상담 대화에서 탑승자(여행 일행) 정보를 추출하는 전문가다.

추출 대상 정보:
- 이름: 한국어 실명 또는 여권 영문명 (예: 홍길동, HONG GILDONG)
- 전화번호: 01x-xxxx-xxxx 형식으로 정규화 (공백·점 제거)
- 생년월일: YYYY-MM-DD. "96년생" → "1996-01-01" (일 불명이면 01), "960512" → "1996-05-12"
- 성별: male/female/unknown. 이름·문맥·"남편"/"아내"/"여아"/"남아" 등으로 추론
- 역할: representative(대표자·연락처 제공한 사람) / adult(만12세 이상) / child(만2~12세) / infant(만2세 미만)
- 여권번호: 영문+숫자 조합 (예: M12345678)
- 여권만료일: YYYY-MM-DD

규칙:
1. 명시된 정보만 추출 — 추측 금지 (단, 생년월일의 연도는 추론 허용)
2. "성인 4명"만 언급되고 이름이 없으면 name=null인 4개 row 생성
3. 대화에서 "예약자" "대표자" 역할이 명확한 사람: role=representative
4. 유아 나이 단서: "xx개월", "xx살 아이" — 만 2세 미만이면 infant
5. 여권정보가 있으면 반드시 포함 (국제여행 필수)
6. confidence: 정보가 명확히 언급됐으면 0.9+, 추론이면 0.6~0.8, 개수만 알면 0.4 이하
7. source_hint: 해당 정보가 나온 원문 일부 (30자 이내)
8. 출력은 순수 JSON (코드펜스 없음)`;

const USER_TEMPLATE = `다음 카카오톡 대화에서 모든 탑승자 정보를 추출하라.

대화 ▼
{{MESSAGES}}
대화 ▲

출력 예시:
{
  "passengers": [
    {
      "name": "홍길동",
      "phone": "010-1234-5678",
      "birth_date": "1990-05-12",
      "gender": "male",
      "role": "representative",
      "passport_no": null,
      "passport_expiry": null,
      "confidence": 0.95,
      "source_hint": "예약자 홍길동 010-1234-5678"
    },
    {
      "name": null,
      "phone": null,
      "birth_date": "2023-03-01",
      "gender": "female",
      "role": "infant",
      "passport_no": null,
      "passport_expiry": null,
      "confidence": 0.55,
      "source_hint": "여아 14개월"
    }
  ],
  "total_pax_note": "성인 4명 + 유아 1명"
}`;

function getDeepSeek(): OpenAI {
  const key = getSecret('DEEPSEEK_API_KEY');
  if (!key) throw new Error('DEEPSEEK_API_KEY 미설정');
  return new OpenAI({ apiKey: key, baseURL: 'https://api.deepseek.com' });
}

export async function extractPassengers(rawMessages: string): Promise<PassengerExtraction> {
  const client = getDeepSeek();
  const userPrompt = USER_TEMPLATE.replace('{{MESSAGES}}', rawMessages.slice(0, 8000));

  const result = await callWithZodValidation({
    label: 'passenger-extract',
    schema: PassengerExtractionSchema,
    maxAttempts: 3,
    fn: async (feedback) => {
      const finalUser = feedback ? `${userPrompt}\n${feedback}` : userPrompt;
      const response = await client.chat.completions.create({
        model: 'deepseek-v4-flash',
        max_tokens: 2048,
        temperature: 0.0,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: finalUser },
        ],
        response_format: { type: 'json_object' },
      });
      return response.choices?.[0]?.message?.content || '';
    },
  });

  if (!result.success) {
    // 추출 실패 시 빈 결과 반환 (전체 흐름 차단 방지)
    return { passengers: [], total_pax_note: null };
  }
  return result.value;
}
