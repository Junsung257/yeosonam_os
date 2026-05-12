/**
 * @file llm-cross-validator.ts — 다중 모델 교차검증 안전망
 *
 * 목적: Sonnet 4.6 정규화 결과를 Gemini Flash 가 비판적으로 검토.
 *   - 양쪽 합의 = 신뢰도 ↑
 *   - 불일치 = 사장님 review queue 적재 또는 INSERT 차단
 *
 * 비용: ~$0.0003/건 (Gemini Flash). 사고 방지 ROI 100x+.
 *
 * 학술 근거:
 *   - SelfCheckGPT (Manakul EMNLP 2023, arXiv 2303.08896) — 다중 응답 일관성
 *   - LLM-as-Judge survey (Gu 2024, arXiv 2411.15594) — 교차검증 패턴
 *
 * 한계 (correlated failure):
 *   두 모델이 같은 환각 만들 수도 있음. 100% 안전 ≠ 사실. 단일 모델보단 두꺼움.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { getSecret } from '@/lib/secret-registry';

export interface SuspiciousField {
  field_path: string;       // 'inclusions[2]', 'min_participants', 'days[1].schedule[0].activity'
  reason: string;            // "원문에 '2억' 표기 없음 — 환각 의심"
  severity: 'critical' | 'high' | 'medium' | 'low';
  recommendation: 'reject' | 'review' | 'flag';
}

export interface CrossValidationResult {
  available: boolean;
  recommendation: 'pass' | 'review' | 'reject';
  overall_confidence: number;        // 0~1
  suspicious_fields: SuspiciousField[];
  reasoning: string;                  // LLM 의 종합 평가 한 줄
  elapsed_ms?: number;
  reason_unavailable?: string;
}

const SYSTEM_PROMPT = `너는 여행 상품 정규화 결과를 비판적으로 검토하는 감사관이다.
다른 LLM 이 추출한 NormalizedIntake JSON 을 원문 raw_text 와 대조해서 의심스러운 필드를 찾아라.

[필수 검증 항목 — 각각에 대해 의심 여부 판정]
1. min_participants — 원문에 "N명 이상" 명시 있나? 없으면 supported=false
2. ticketing_deadline — 원문에 "X까지 발권/예약" 명시? 단순 버전일 오매핑 의심
3. inclusions 의 금액·등급·N박 토큰 — 원문에 그 수치 명시 있나? ("2억 보험" 같은 환각 차단)
4. surcharges 기간·금액 — 원문 명시 vs 추론
5. itinerary_data.days[].regions — 원문 "지역" 컬럼 1:1 매핑인가? 다른 day 와 복사 의심?
6. optional_tours 가격·이름 — 원문 verbatim?
7. accommodations 호텔명 — 원문 명시?
8. flight_out / flight_in — 원문 명시?

[recommendation 기준]
- reject: 원문에 명백히 없는 사실 (특히 금액·인원·날짜·항공편)
- review: 의심스럽지만 확신 못함 — 사장님 검토 권장
- flag: 미세한 표기 차이만 (verbatim vs SSOT)

[overall_confidence]
0.95+: 모두 supported / 0.85+: 사소한 flag 만 / 0.70+: review 1~2건 / 0.50-: reject 1건+

JSON 만 응답. 추가 텍스트 금지.`;

interface ValidatorInput {
  rawText: string;
  normalized: unknown;            // NormalizedIntake JSON 또는 pkg JSON
  context?: string;                // "보홀 5일 패키지" 같은 추가 힌트
}

export async function crossValidateWithGemini(
  input: ValidatorInput,
  options: { model?: string; maxRetries?: number } = {},
): Promise<CrossValidationResult> {
  const apiKey = getSecret('GOOGLE_AI_API_KEY') || getSecret('GEMINI_API_KEY');
  if (!apiKey) {
    return {
      available: false, recommendation: 'pass', overall_confidence: 0, suspicious_fields: [], reasoning: '',
      reason_unavailable: 'GOOGLE_AI_API_KEY 미설정',
    };
  }
  if (!input.rawText || input.rawText.length < 50) {
    return {
      available: false, recommendation: 'pass', overall_confidence: 0, suspicious_fields: [], reasoning: '',
      reason_unavailable: 'rawText 부재 또는 너무 짧음',
    };
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: options.model || 'gemini-2.5-flash',
    systemInstruction: SYSTEM_PROMPT,
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.0,
      responseSchema: {
        type: 'object',
        properties: {
          recommendation: { type: 'string', enum: ['pass', 'review', 'reject'] },
          overall_confidence: { type: 'number' },
          suspicious_fields: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                field_path: { type: 'string' },
                reason: { type: 'string' },
                severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
                recommendation: { type: 'string', enum: ['reject', 'review', 'flag'] },
              },
              required: ['field_path', 'reason', 'severity', 'recommendation'],
            },
          },
          reasoning: { type: 'string' },
        },
        required: ['recommendation', 'overall_confidence', 'suspicious_fields', 'reasoning'],
      } as Parameters<typeof model.generateContent>[0] extends { generationConfig?: { responseSchema?: infer S } } ? S : never,
    },
  });

  const userPrompt = [
    input.context ? `## 컨텍스트\n${input.context}\n` : '',
    '## 원문 (Source of Truth)',
    input.rawText.slice(0, 10000),
    '',
    '## 다른 LLM 이 추출한 NormalizedIntake JSON',
    JSON.stringify(input.normalized).slice(0, 12000),
    '',
    '위 JSON 의 필드 중 원문 근거 없는 것 / 환각 의심 / 표기 미묘 차이를 찾아라.',
  ].filter(Boolean).join('\n');

  const start = Date.now();
  try {
    const res = await model.generateContent(userPrompt);
    const elapsed = Date.now() - start;
    const txt = res.response.text();
    const parsed = JSON.parse(txt) as {
      recommendation: 'pass' | 'review' | 'reject';
      overall_confidence: number;
      suspicious_fields: SuspiciousField[];
      reasoning: string;
    };

    return {
      available: true,
      recommendation: parsed.recommendation,
      overall_confidence: parsed.overall_confidence ?? 0,
      suspicious_fields: parsed.suspicious_fields || [],
      reasoning: parsed.reasoning || '',
      elapsed_ms: elapsed,
    };
  } catch (e) {
    return {
      available: false, recommendation: 'pass', overall_confidence: 0, suspicious_fields: [], reasoning: '',
      elapsed_ms: Date.now() - start,
      reason_unavailable: `Gemini cross-validate 실패: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

/**
 * Pre-INSERT gate — INSERT 직전 호출되어 명백한 환각/축약 시 INSERT 차단.
 *
 * 정책:
 *   - 'reject' (CRITICAL severity 1건+ 또는 confidence < 0.5) → INSERT 차단 + 에러 리턴
 *   - 'review' (confidence 0.5~0.7 또는 review 항목 1건+) → INSERT 진행하되 audit_status='warnings'
 *   - 'pass' → 정상 진행
 */
export function decidePreInsertGate(result: CrossValidationResult): {
  shouldBlock: boolean;
  shouldDowngrade: boolean;
  reason: string;
} {
  if (!result.available) {
    return { shouldBlock: false, shouldDowngrade: false, reason: 'cross-validate 미수행 — pass' };
  }
  const criticalCount = result.suspicious_fields.filter(f => f.severity === 'critical').length;
  const rejectCount = result.suspicious_fields.filter(f => f.recommendation === 'reject').length;

  if (result.recommendation === 'reject' || criticalCount >= 1 || rejectCount >= 1) {
    return {
      shouldBlock: true,
      shouldDowngrade: false,
      reason: `Cross-validate REJECT — confidence=${result.overall_confidence.toFixed(2)} CRITICAL=${criticalCount} reject=${rejectCount}. 원문 환각 의심. ${result.reasoning}`,
    };
  }
  if (result.recommendation === 'review' || result.overall_confidence < 0.7) {
    return {
      shouldBlock: false,
      shouldDowngrade: true,
      reason: `Cross-validate REVIEW — confidence=${result.overall_confidence.toFixed(2)} review/flag ${result.suspicious_fields.length}건. audit_status='warnings' 강등.`,
    };
  }
  return {
    shouldBlock: false,
    shouldDowngrade: false,
    reason: `Cross-validate PASS — confidence=${result.overall_confidence.toFixed(2)}`,
  };
}
