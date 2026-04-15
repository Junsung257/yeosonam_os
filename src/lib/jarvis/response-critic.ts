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
 * 1. 생성기(Gemini Flash Lite)와 검증기(Gemini Flash)를 분리 — 같은 모델이 자기 답을 검증하면 blind spot
 * 2. 짧은 답변(<50자)은 검증 스킵 — ROI 낮고 latency만 증가
 * 3. severity 3단계: ok/warn/block — block은 폴백 + 에스컬레이션, warn은 수정본 사용
 * 4. 검증 실패 시 원본 사용 (fail-open) — 검증기 장애가 전체 채팅을 막으면 안 됨
 * 5. env DISABLE_RESPONSE_CRITIC=true 로 런타임 OFF 가능 (비상 스위치)
 */

export type CritiqueSeverity = 'ok' | 'warn' | 'block';

export type CritiqueResult = {
  severity: CritiqueSeverity;
  issues: string[];
  correctedReply: string | null;
};

const SAFE_FALLBACK: CritiqueResult = { severity: 'ok', issues: [], correctedReply: null };

const GEMINI_CRITIC_MODEL = 'gemini-2.5-flash';

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

export async function critiqueReply(params: {
  userQuestion: string;
  packageContext: string;
  reply: string;
  recommendedPackageIds: string[];
  validPackageIds: string[];
  apiKey: string;
}): Promise<CritiqueResult> {
  if (process.env.DISABLE_RESPONSE_CRITIC === 'true') return SAFE_FALLBACK;
  if (!params.apiKey) return SAFE_FALLBACK;

  // 짧은 답변은 스킵 — ROI 낮음
  if (params.reply.trim().length < 50) return SAFE_FALLBACK;

  const prompt = CRITIC_PROMPT
    .replace('{USER_QUESTION}', params.userQuestion.slice(0, 1000))
    .replace('{PACKAGE_CONTEXT}', params.packageContext.slice(0, 3000))
    .replace('{RECOMMENDED_IDS}', (params.recommendedPackageIds ?? []).join(', ') || '(없음)')
    .replace('{VALID_IDS}', (params.validPackageIds ?? []).join(', ') || '(없음)')
    .replace('{AI_REPLY}', params.reply);

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_CRITIC_MODEL}:generateContent?key=${params.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
        }),
      },
    );

    if (!res.ok) {
      console.warn('[Critic] Gemini HTTP', res.status, '— fail-open');
      return SAFE_FALLBACK;
    }

    const json = await res.json();
    const raw = json.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
    const parsed = JSON.parse(cleaned);

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
