/**
 * @file ai_audit_helper.js
 * @description Gemini 2.5 Flash로 "원문 ↔ 렌더 결과"를 의미 대조하는 공용 헬퍼.
 *
 * 왜 필요한가: E1~E4 구조 감사는 "2억" 같은 토큰 주입은 잡지만
 *   "송영비 추가 경고 삭제" / "클럽식 예외 누락" 같은 **의미적 축약**은
 *   못 잡는다. AI가 원문 전체를 읽고 렌더에서 누락/왜곡된 부분을 집어낸다.
 *
 * 비용: 상품 1건당 ~$0.0004 (약 0.5원). 무시 가능.
 *
 * 사용:
 *   const ai = await aiCrossCheck(rawText, renderedText, title);
 *   // ai = { available, severity, overall_faithfulness_pct, missing_from_render, distorted_in_render, summary }
 */

async function aiCrossCheck(rawText, renderedText, title) {
  const apiKey = process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { available: false, reason: 'GOOGLE_AI_API_KEY/GEMINI_API_KEY 미설정' };
  }
  if (!rawText || !renderedText) {
    return { available: false, reason: 'raw_text 또는 rendered_text 부재' };
  }

  let GoogleGenerativeAI;
  try {
    ({ GoogleGenerativeAI } = require('@google/generative-ai'));
  } catch {
    return { available: false, reason: '@google/generative-ai 미설치' };
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
  });

  const prompt = `너는 여행 상품 등록 감사관이다. 아래 두 텍스트를 대조하여, 원문에 있지만 렌더링에 **누락**되었거나 **왜곡**된 정보를 찾아라.

특히 다음 유형을 중점 감지:
- 특약/예외 조건 누락 (예: "골프장 변경 시 송영비 추가 발생" 같은 경고)
- 특정 조건부 포함/제외 (예: "사세보국제CC만 클럽식 포함")
- 금액/수치 창작 (원문에 없는 "N억 보험", "N성급" 임의 주입)
- 지역/이동 경로 누락 (Day별 지역 이동)
- 고객 권리 영향 조건 (환불/취소/현금영수증 기한)

원문에 없는 일반 상식이나 표준 약관을 렌더링에 덧붙인 것도 "왜곡"으로 표시.

**비교 대상에서 제외할 것 (false positive 방지)**:
- 사이트 공용 UI 요소 (네비게이션, 공유/찜 버튼, 상품 카드 배지, "여소남의 추천 코멘트" 같은 공통 마케팅 헤더, 해시태그, 이모지)
- 원문 표현이 "출발 2시간 전 미팅" 같은 상대적 설명이고 렌더는 계산된 절대시각("05:30 미팅")인 경우 — 계산 결과가 일관되면 왜곡 아님
- 원문 "(2인1실)"과 렌더 "2인1실 기준" 같이 괄호/조사 차이만 있는 경우
- 가격 표기 천단위 콤마 차이 (1,459,000 vs 1459000)

상품명: ${title}

===== 원문 (Source of Truth) =====
${rawText.slice(0, 8000)}

===== 렌더링 결과 (고객이 실제로 보는 화면의 텍스트) =====
${renderedText.slice(0, 8000)}

다음 JSON으로만 답변:
{
  "missing_from_render": ["원문에 있지만 렌더에 누락된 구체적 문구 최대 10개"],
  "distorted_in_render": ["원문과 다르게 렌더된 구체적 항목 최대 10개"],
  "hallucinated_in_render": ["원문에 없는데 렌더에 추가된 정보 최대 5개"],
  "severity": "CRITICAL | HIGH | MEDIUM | LOW | NONE",
  "overall_faithfulness_pct": 0-100 정수,
  "summary": "한 줄 요약 (80자 이내)"
}

severity 기준:
- CRITICAL: 고객 권리/금전/안전에 직결되는 누락·왜곡 (환불 약관, 금액 창작, 특약 증발)
- HIGH: 상품 구성 오인 가능 (지역/일정/포함사항 주요 누락)
- MEDIUM: 부가 정보 축약
- LOW: 표현 차이, 경미한 요약
- NONE: 충실함`;

  try {
    const start = Date.now();
    const result = await model.generateContent(prompt);
    const elapsed = Date.now() - start;
    const raw = result.response.text().replace(/^```json\s*|\s*```\s*$/g, '').trim();
    const parsed = JSON.parse(raw);
    return {
      available: true,
      elapsed_ms: elapsed,
      severity: parsed.severity || 'LOW',
      overall_faithfulness_pct: parsed.overall_faithfulness_pct || null,
      missing_from_render: parsed.missing_from_render || [],
      distorted_in_render: parsed.distorted_in_render || [],
      hallucinated_in_render: parsed.hallucinated_in_render || [],
      summary: parsed.summary || '',
    };
  } catch (e) {
    return { available: false, reason: `AI 호출 실패: ${e.message}` };
  }
}

module.exports = { aiCrossCheck };
