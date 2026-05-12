/**
 * 여소남 OS — Self-RAG 스타일 응답 검증자
 *
 * 레퍼런스:
 * - Self-RAG (Asai et al., 2024): ISREL(relevant) / ISSUP(supported) / ISUSE(useful) 성찰 토큰 개념을
 *   단일 검증 패스로 압축. 원 논문은 훈련된 성찰 토큰을 쓰지만, 프로덕션에선 프롬프트 기반이 현실적.
 * - CRITIC (Gou et al., 2023): 외부 툴/컨텍스트 기반 자기교정
 * - Constitutional AI (Bai et al., 2022): 원칙 기반 비평 + 리비전
 *
 * 설계 원칙:
 * 1. 호출: llm-gateway — DeepSeek Flash primary, Gemini fallback (고객 QA 생성과 동일 스택)
 * 2. 짧은 답변(<50자)은 검증 스킵 — ROI 낮고 latency만 증가
 * 3. severity 3단계: ok/warn/block — block은 폴백 + 에스컬레이션, warn은 수정본 사용
 * 4. 검증 실패 시 원본 사용 (fail-open) — 검증기 장애가 전체 채팅을 막으면 안 됨
 * 5. env DISABLE_RESPONSE_CRITIC=true 로 런타임 OFF 가능 (비상 스위치)
 */

import { llmCall } from '@/lib/llm-gateway';

export type CritiqueSeverity = 'ok' | 'warn' | 'block';

export type CritiqueResult = {
  severity: CritiqueSeverity;
  issues: string[];
  correctedReply: string | null;
};

const SAFE_FALLBACK: CritiqueResult = { severity: 'ok', issues: [], correctedReply: null };

const CRITIC_PROMPT = `당신은 여행사 AI 상담원의 답변을 검증하는 품질 관리자입니다. 공정하고 보수적으로 평가하세요.

## 검증 원칙

### 1. 근거 검증 (Self-RAG ISSUP)
- 답변의 모든 사실(상품명/가격/일정/포함사항)이 제공된 상품 컨텍스트로 뒷받침되는가?
- 존재하지 않는 상품 추천 → **block**
- 컨텍스트에 없는 숫자/가격/날짜 만들어냄 → **block**
- 추천 상품 ID가 실제 제공된 ID 목록에 없음 → **block**

### 2. 권한 검증
회사 권한 밖 약속은 에스컬레이션 대상:
- "환불 가능합니다", "10% 할인해드릴게요", "자리 확보해드렸습니다" → **block**
- "언제든 취소 가능", "원하시는 날짜 맞춰드릴게요" → **block**
- 일반 문의/추천은 OK

### 3. 톤/브랜드 검증 (Phase 2.5 연동)
- 금지 형용사: "매력적인", "아름다운", "특별한", "완벽한", "놓치지 마세요"
- 금지 표현: "다녀왔는데", "가봤어요", "직접 체크했어요" (거짓 경험)
- 발견 시 **warn**, correctedReply로 교체

### 4. 안전 검증
- 개인정보 요구 (주민번호/카드번호 등) → **block**
- 타 상담원/경쟁사 비방 → **block**

## 출력 (JSON만, 설명 금지)
\`\`\`json
{
  "severity": "ok" | "warn" | "block",
  "issues": ["구체적 문제 1", "구체적 문제 2"],
  "corrected_reply": null 또는 "warn일 때 수정된 답변 전체"
}
\`\`\`

## 입력

### 고객 질문
{USER_QUESTION}

### AI가 참조할 수 있었던 상품 컨텍스트
{PACKAGE_CONTEXT}

### AI가 추천한 상품 ID
{RECOMMENDED_IDS}

### 실제 제공된 유효 상품 ID 목록
{VALID_IDS}

### AI가 생성한 답변
{AI_REPLY}`;

/**
 * V2 휴리스틱 스킵 — 검증 ROI 가 낮은 답변을 사전에 걸러낸다.
 * 근거: db/JARVIS_V2_DESIGN.md §3 #7. Critic 호출 비용 2~6s / 답변 → 조회·인사는 스킵.
 *
 * skip 조건:
 * 1. 추천 상품 ID가 0개 (자연어 안내만) + 약속성 단어 없음 → 근거 검증할 게 없음
 * 2. 순수 인사/짧은 감사 ("안녕하세요", "감사합니다") → 위험도 0
 * 3. KPI/통계 형태의 숫자 위주 답변 ("이번 달 매출은 3,200만원입니다") → DB tool 결과 그대로
 */
const PROMISE_WORDS = /(환불|할인|확보해|해드릴게요|가능합니다|맞춰드|언제든)/;
const GREETING_ONLY = /^(안녕|반갑|감사|네, 알겠|확인했습니다)[\s\S]{0,40}$/;
const PURE_KPI = /^[\s\S]{0,300}(매출|예약|건수|금액|원|명|%)[\s\S]{0,100}$/;

function shouldSkipCritic(params: {
  reply: string;
  recommendedPackageIds: string[];
}): boolean {
  const reply = params.reply.trim();
  if (reply.length < 50) return true;                                   // 기존 규칙 유지
  if (GREETING_ONLY.test(reply)) return true;                           // 인사/확인
  if (params.recommendedPackageIds.length === 0 && !PROMISE_WORDS.test(reply)) {
    // 상품 추천 0개 + 약속성 단어 없음 → 근거 검증할 claim 없음
    // 단, KPI 답변은 허용 (DB 값이므로 추가 검증 불필요)
    if (PURE_KPI.test(reply)) return true;
  }
  return false;
}

export async function critiqueReply(params: {
  userQuestion: string;
  packageContext: string;
  reply: string;
  recommendedPackageIds: string[];
  validPackageIds: string[];
}): Promise<CritiqueResult> {
  if (process.env.DISABLE_RESPONSE_CRITIC === 'true') return SAFE_FALLBACK;

  // V2 확장 휴리스틱 — 근거 검증할 claim 이 없거나 위험도 0 이면 스킵
  if (shouldSkipCritic(params)) return SAFE_FALLBACK;

  const userPrompt = CRITIC_PROMPT
    .replace('{USER_QUESTION}', params.userQuestion.slice(0, 1000))
    .replace('{PACKAGE_CONTEXT}', params.packageContext.slice(0, 3000))
    .replace('{RECOMMENDED_IDS}', (params.recommendedPackageIds ?? []).join(', ') || '(없음)')
    .replace('{VALID_IDS}', (params.validPackageIds ?? []).join(', ') || '(없음)')
    .replace('{AI_REPLY}', params.reply);

  try {
    const res = await llmCall({
      task: 'response-critic',
      systemPrompt:
        '당신은 품질 관리자입니다. 사용자 메시지의 지시만 따르고, 지정된 JSON 객체 한 개만 출력하세요. 다른 텍스트는 금지입니다.',
      userPrompt,
      temperature: 0.1,
      maxTokens: 1200,
      autoEscalate: false,
    });

    if (!res.success || !res.rawText?.trim()) {
      console.warn('[Critic] llm 실패 — fail-open:', res.errors?.join('; '));
      return SAFE_FALLBACK;
    }

    const cleaned = res.rawText
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(cleaned) as Record<string, unknown>;
    } catch {
      console.warn('[Critic] JSON 파싱 실패 — fail-open');
      return SAFE_FALLBACK;
    }

    const severity: CritiqueSeverity =
      parsed?.severity === 'block' || parsed?.severity === 'warn' ? parsed.severity : 'ok';
    const issues: string[] = Array.isArray(parsed?.issues)
      ? parsed.issues.filter((x: unknown) => typeof x === 'string').slice(0, 10)
      : [];
    const correctedReply: string | null =
      typeof parsed?.corrected_reply === 'string' && parsed.corrected_reply.trim().length > 0
        ? parsed.corrected_reply
        : null;

    return { severity, issues, correctedReply };
  } catch (e) {
    console.warn('[Critic] 실패 — fail-open:', e);
    return SAFE_FALLBACK;
  }
}

/**
 * 검증 결과를 채팅 응답에 적용.
 * - block: 안전 폴백 + 에스컬레이션
 * - warn: corrected_reply 있으면 교체
 * - ok: 원본 유지
 */
export function applyCritique(
  originalReply: string,
  originalEscalate: boolean,
  critique: CritiqueResult,
): { reply: string; escalate: boolean; wasGated: boolean } {
  if (critique.severity === 'block') {
    return {
      reply: '정확한 답변을 위해 담당자에게 확인 후 안내드리겠습니다. 잠시만 기다려주세요.',
      escalate: true,
      wasGated: true,
    };
  }
  if (critique.severity === 'warn' && critique.correctedReply) {
    return { reply: critique.correctedReply, escalate: originalEscalate, wasGated: true };
  }
  return { reply: originalReply, escalate: originalEscalate, wasGated: false };
}
