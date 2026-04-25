/**
 * @file cove_audit.js — W3 Chain-of-Verification 감사 (E6)
 *
 * 목적:
 *   기존 E5(ai_audit_helper.aiCrossCheck) 는 "원문 ↔ 렌더링 텍스트" 전체를
 *   한 번에 비교한다. 이 방식은 일반 축약/왜곡은 잡지만, **구체적 핵심 필드**
 *   (min_participants, inclusions 금액, ticketing_deadline, surcharges 날짜)
 *   를 놓칠 수 있다.
 *
 *   CoVe(Chain-of-Verification, Dhuliawala et al. 2023) 패턴 차용:
 *     1) 파싱된 pkg에서 **검증할 주장(claim) 목록 추출** — 각 claim은
 *        "원문에 있어야만 하는 구체적 사실".
 *     2) Gemini에게 각 claim을 **yes/no + 근거 문구**로 재질의.
 *     3) "raw_text에 없음" 응답이 나온 claim = 환각 의심 → warnings 승격.
 *
 *   E5가 "렌더 기준" 의미 감사라면, E6는 "원문 기준" 사실 감사.
 *   E5보다 토큰 적게 쓰고 (claim 10개 × 50자 ≈ 500토큰), 특정 환각 유형에 강함.
 *
 * 타겟 에러:
 *   - ERR-FUK-insurance-injection ("2억 여행자보험" 환각)
 *   - ERR-20260418-01 (min_participants 템플릿 기본값)
 *   - ERR-20260418-02 (notices_parsed 예시 축약)
 *   - ERR-date-confusion (ticketing_deadline 잘못된 날짜 할당)
 *   - ERR-FUK-regions-copy (Day별 regions 복사)
 *
 * 비용: 상품 1건당 ~$0.0002 (약 0.3원). 체크하는 claim 수에 따라 변동.
 */

/**
 * pkg 에서 "원문에 존재해야 하는" 구체적 claim 들을 추출.
 * 각 claim은 자연어 문장 + DB 위치 정보를 함께 반환.
 */
function extractClaims(pkg) {
  const claims = [];

  // 1. min_participants 숫자 — 원문에 "N명 이상"이 있어야 함
  if (typeof pkg.min_participants === 'number' && pkg.min_participants > 0) {
    claims.push({
      id: 'min_participants',
      text: `이 상품은 최소 출발인원이 ${pkg.min_participants}명이다.`,
      field: 'min_participants',
      severity: 'HIGH', // 예약 가능 여부 판정에 직결
    });
  }

  // 2. ticketing_deadline — 원문에 "X까지 발권/예약/티켓팅" 문구가 있어야 함
  if (pkg.ticketing_deadline) {
    claims.push({
      id: 'ticketing_deadline',
      text: `발권/예약 마감일이 ${pkg.ticketing_deadline} 이다.`,
      field: 'ticketing_deadline',
      severity: 'HIGH', // 공지 누락 시 고객 불만 직결
    });
  }

  // 3. inclusions 중 **금액/등급 토큰이 있는 항목**만 검증 (환각 타겟)
  //    일반 "여행자보험" 같은 포함 항목은 OK, "2억 여행자보험" 같은 금액 포함은 검증.
  if (Array.isArray(pkg.inclusions)) {
    for (const item of pkg.inclusions) {
      if (typeof item !== 'string') continue;
      if (!/\d+\s*(?:억|만\s*원?|천\s*원?|성급|홀|박|일|명|회)/.test(item)) continue;
      claims.push({
        id: `inclusions:${claims.length}`,
        text: `포함사항에 "${item.slice(0, 80)}"가 포함된다.`,
        field: 'inclusions',
        severity: 'CRITICAL', // 금액 환각은 법적 리스크 (2억 보험 건)
      });
    }
  }

  // 4. surcharges 기간 — 원문에 해당 기간 + 금액이 있어야 함
  if (Array.isArray(pkg.surcharges)) {
    for (const s of pkg.surcharges) {
      if (!s?.name || !s?.start) continue;
      const period = s.start && s.end ? `${s.start} ~ ${s.end}` : s.start;
      const price = s.amount != null ? ` ${s.currency === 'USD' ? '$' : ''}${s.amount}` : '';
      claims.push({
        id: `surcharges:${claims.length}`,
        text: `"${s.name}" 기간 (${period})${price} 추가요금이 부과된다.`,
        field: 'surcharges',
        severity: 'HIGH',
      });
    }
  }

  // 5. notices_parsed 중 PAYMENT 타입 — 결제 조건 (특약) 은 반드시 원문 근거 필요
  if (Array.isArray(pkg.notices_parsed)) {
    for (const n of pkg.notices_parsed) {
      if (!n || typeof n !== 'object') continue;
      if (n.type !== 'PAYMENT') continue;
      const excerpt = String(n.text || n.title || '').slice(0, 100);
      if (!excerpt) continue;
      claims.push({
        id: `notices:PAYMENT:${claims.length}`,
        text: `결제/취소 특약: "${excerpt}"`,
        field: 'notices_parsed',
        severity: 'CRITICAL',
      });
    }
  }

  return claims;
}

/**
 * Gemini 한 번에 여러 claim 을 검증 (배치).
 * 토큰 절감 + 일관성 향상.
 */
async function verifyClaimsWithGemini(rawText, claims, title) {
  const apiKey = process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) return { available: false, reason: 'GOOGLE_AI_API_KEY 미설정' };
  if (!rawText || claims.length === 0) return { available: false, reason: 'raw_text 또는 claims 부재' };

  let GoogleGenerativeAI;
  try {
    ({ GoogleGenerativeAI } = require('@google/generative-ai'));
  } catch {
    return { available: false, reason: '@google/generative-ai 미설치' };
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: { responseMimeType: 'application/json', temperature: 0.0 },
  });

  const claimsList = claims.map((c, i) => `${i + 1}. ${c.text}`).join('\n');

  const prompt = `너는 여행 상품 등록 감사관이다. DB에 저장된 **주장(claim) 목록**이 **원문(raw_text)** 에 실제로 근거를 두고 있는지 **한 건씩** 검증하라.

상품명: ${title}

===== 원문 (Source of Truth) =====
${rawText.slice(0, 10000)}

===== 검증할 주장 목록 =====
${claimsList}

규칙:
- 각 주장이 원문에 **구체적 문구로 직접 근거가 있으면** supported=true
- **비슷한 일반 상식이나 업계 관례**로만 추론될 수 있고 원문 명시는 없으면 supported=false (= 환각 의심)
- 괄호/조사/천단위 콤마 같은 사소한 표기 차이는 supported=true 로 판정
- 원문 길이가 짧아 확정 불가면 supported=null

다음 JSON으로만 답변 (claim 번호 순서대로):
{
  "results": [
    { "n": 1, "supported": true|false|null, "evidence": "원문에서 발견된 문구 또는 null", "note": "불일치 시 설명 (한 줄)" }
  ]
}`;

  try {
    const start = Date.now();
    const res = await model.generateContent(prompt);
    const elapsed = Date.now() - start;
    const raw = res.response.text().replace(/^```json\s*|\s*```\s*$/g, '').trim();
    const parsed = JSON.parse(raw);
    const results = Array.isArray(parsed.results) ? parsed.results : [];
    return {
      available: true,
      elapsed_ms: elapsed,
      verdicts: results.map((r, i) => {
        const claim = claims[i];
        return {
          claim_id: claim?.id,
          field: claim?.field,
          severity: claim?.severity,
          text: claim?.text,
          supported: r.supported,
          evidence: r.evidence || null,
          note: r.note || null,
        };
      }),
    };
  } catch (e) {
    return { available: false, reason: `CoVe Gemini 호출 실패: ${e.message}` };
  }
}

/**
 * 메인: pkg 에서 claim 추출 → Gemini 로 검증 → warnings 목록 반환.
 *
 * @returns {{ available: boolean, warnings: string[], verdicts?: Array, elapsed_ms?: number, reason?: string }}
 */
async function runCoVeAudit(pkg) {
  const claims = extractClaims(pkg);
  if (claims.length === 0) {
    return { available: true, warnings: [], verdicts: [], elapsed_ms: 0, skipped: 'no claims' };
  }

  const ai = await verifyClaimsWithGemini(pkg.raw_text, claims, pkg.title || pkg.short_code || '');
  if (!ai.available) return { available: false, warnings: [], reason: ai.reason };

  // 검증 실패 claim → warnings 승격
  const warnings = [];
  for (const v of ai.verdicts) {
    if (v.supported === false) {
      const prefix = v.severity === 'CRITICAL' ? 'E6 [CoVe:CRITICAL]' : 'E6 [CoVe:HIGH]';
      warnings.push(`${prefix} ${v.field} "${(v.text || '').slice(0, 100)}" — ${v.note || '원문 근거 없음'}`);
    }
  }

  return {
    available: true,
    warnings,
    verdicts: ai.verdicts,
    elapsed_ms: ai.elapsed_ms,
    total_claims: claims.length,
    unsupported_count: warnings.length,
  };
}

module.exports = { runCoVeAudit, extractClaims };
