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
function normalizeForExactEvidence(text) {
  return String(text || '')
    .replace(/^[\s*•·\-]+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function noticeLinesHaveExactRawEvidence(noticeText, rawText) {
  const raw = normalizeForExactEvidence(rawText);
  if (!raw) return false;
  const lines = String(noticeText || '')
    .split(/\n/)
    .map(normalizeForExactEvidence)
    .filter(line => line.length >= 6);
  if (lines.length === 0) return false;
  return lines.every(line => raw.includes(line));
}

function extractClaims(pkg) {
  const claims = [];
  const rawText = pkg.raw_text || pkg.rawText || pkg.raw_extracted_text || '';

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
      // Deterministic/raw supplier notices often contain 발권마감 or 불포함 cost bullets
      // copied verbatim from raw_text. Exact source coverage already proves those claims;
      // sending them to CoVe as "결제/취소 특약" creates false positives and wastes tokens.
      if (noticeLinesHaveExactRawEvidence(n.text || n.title || '', rawText)) continue;
      claims.push({
        id: `notices:PAYMENT:${claims.length}`,
        text: `추가비용/결제 안내: "${excerpt}"`,
        field: 'notices_parsed',
        severity: 'CRITICAL',
      });
    }
  }

  return claims;
}

// ═══════════════════════════════════════════════════════════════════════════
//  RARR (Researching and Revising) 패턴 헬퍼 (2026-05-10 추가)
//
//  기존 CoVe: raw_text 전체(~10K자) + 모든 claim 을 한 번에 던짐 → LLM 이 스캔.
//  RARR  : claim 마다 ① 검증 질문 생성 ② 키워드 점수로 가장 관련 깊은 단락 retrieve
//          ③ (claim, question, focused_chunk) 묶음으로 전달 → LLM 이 좁은 범위만 비교.
//
//  근거 논문/실증:
//    - RARR (Chen et al., arxiv 2210.08726)
//    - SIGIR 2025 (10.1145/3726302.3730337) "Component-Level Insights" — verification
//      question 형태로 던질 때 hallucination 감지율 +20%p
//
//  타협:
//    - 호출 횟수는 그대로 (단일 Gemini batch). 토큰량은 비슷하거나 약간 감소.
//    - 정확도는 명백히 ↑ (long-context 스캔 부담 제거).
// ═══════════════════════════════════════════════════════════════════════════

/**
 * raw_text 를 chunk 로 분할. 빈 줄 기준 paragraph 분리 후, 너무 길면 추가 분할.
 * Korean 친화적 — "니다.", "다.", "요." 문장 종료 패턴도 보조 분할 기준.
 */
function chunkRawText(rawText, maxChars = 1200) {
  if (!rawText) return [];
  const paragraphs = rawText.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  const chunks = [];
  for (const p of paragraphs) {
    if (p.length <= maxChars) { chunks.push(p); continue; }
    // 큰 단락은 문장 단위 분할
    const sentences = p.split(/(?<=[.!?。]|니다\.|다\.|요\.)\s+/);
    let buf = '';
    for (const s of sentences) {
      if ((buf + s).length > maxChars && buf) { chunks.push(buf.trim()); buf = ''; }
      buf += (buf ? ' ' : '') + s;
    }
    if (buf.trim()) chunks.push(buf.trim());
  }
  return chunks.map((text, idx) => ({ idx, text }));
}

/**
 * claim 에서 검색용 키워드 추출 — 한국어 2자+ 토큰 + 숫자 + 영문.
 * 조사·접미어("은","는","이","가","의") 제거.
 */
const STOP_TOKENS = new Set(['있다', '없다', '이다', '한다', '되다', '하다', '있음', '없음']);
function extractKeywords(text) {
  if (!text) return [];
  // 한국어 토큰 (2~10자), 숫자(쉼표 포함), 영문 (2자+)
  const tokens = (text.match(/[가-힣]{2,10}|[\d,]+|[A-Za-z]{2,}/g) || []);
  return tokens
    .map(t => t.replace(/[은는이가의을를에서로으로]+$/, ''))
    .filter(t => t.length >= 2 && !STOP_TOKENS.has(t));
}

/**
 * field 별 보조 키워드 — claim text 에 안 나와도 매칭에 도움.
 * 예: min_participants 검증할 때 "인원·명·출발" 등을 포함한 단락이 정답일 가능성.
 */
const FIELD_HINT_KEYWORDS = {
  min_participants: ['인원', '명', '최소', '출발'],
  ticketing_deadline: ['발권', '예약', '마감', '티켓팅', '기한'],
  inclusions: ['포함', '제공'],
  surcharges: ['추가요금', '추가', '성수기', '할증'],
  notices_parsed: ['취소', '환불', '계약금', '특약', '결제'],
};

function scoreChunkRelevance(chunk, claim) {
  const claimTokens = new Set(extractKeywords(claim.text));
  const fieldHints = FIELD_HINT_KEYWORDS[claim.field] || [];
  let score = 0;
  for (const tok of claimTokens) if (chunk.text.includes(tok)) score += 2;
  for (const hint of fieldHints) if (chunk.text.includes(hint)) score += 1;
  return score;
}

function findBestChunks(chunks, claim, k = 2) {
  if (chunks.length === 0) return [];
  const scored = chunks.map(c => ({ ...c, score: scoreChunkRelevance(c, claim) }));
  scored.sort((a, b) => b.score - a.score);
  // 최소 1개는 반환 (점수 0이라도 첫 chunk)
  const top = scored.slice(0, k).filter((c, i) => i === 0 || c.score > 0);
  return top;
}

/**
 * claim 을 자연어 검증 질문으로 변환.
 * 일반 진술문보다 질문 형태가 LLM 이 답을 원문에서 찾도록 유도하는 데 효과적
 * (RARR 핵심 아이디어).
 */
function generateVerificationQuestion(claim) {
  switch (claim.field) {
    case 'min_participants':
      return '이 상품의 최소 출발 인원은 원문에 몇 명으로 명시되어 있는가? (없으면 "명시 없음")';
    case 'ticketing_deadline':
      return '발권/예약/티켓팅 마감일이 원문에 명시되어 있는가? 있다면 어떤 날짜인가?';
    case 'inclusions':
      return `포함사항에 "${(claim.text.match(/"([^"]+)"/) || [, ''])[1]}" 라는 구체적 문구가 원문에 있는가?`;
    case 'surcharges':
      return `다음 추가요금이 원문에 기간·금액과 함께 명시되어 있는가? — "${(claim.text.match(/"([^"]+)"/) || [, ''])[1]}"`;
    case 'notices_parsed':
      return `다음 결제/취소 특약 문구가 원문에 명시되어 있는가? — "${(claim.text.match(/"([^"]+)"/) || [, ''])[1]}"`;
    default:
      return `다음 주장이 원문에 명시되어 있는가? — ${claim.text}`;
  }
}

/**
 * Gemini 한 번에 여러 claim 을 검증 (배치).
 * 토큰 절감 + 일관성 향상.
 *
 * 2026-05-10 RARR 패턴: claim 별로 검증 질문 + 가장 관련 깊은 단락 짝지어 전달.
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

  // RARR — claim 별로 검증 질문 생성 + 가장 관련 깊은 단락 retrieve
  const chunks = chunkRawText(rawText, 1200);
  const claimContexts = claims.map(c => ({
    claim: c,
    question: generateVerificationQuestion(c),
    bestChunks: findBestChunks(chunks, c, 2),
  }));

  // 점수 0인 모든 chunks → 원문이 너무 짧거나 키워드가 일반적. 짧은 raw_text 는 통째로 한 번 더 첨부 (안전장치)
  const allWeakRetrieval = claimContexts.every(cc => cc.bestChunks.length === 0 || cc.bestChunks[0].score === 0);
  const fallbackFullText = allWeakRetrieval && rawText.length < 4000 ? rawText : null;

  const claimSections = claimContexts.map((cc, i) => {
    const evidence = cc.bestChunks.length
      ? cc.bestChunks.map(b => `[원문 단락 #${b.idx + 1}, score=${b.score}]\n${b.text}`).join('\n\n')
      : '(관련 단락 retrieve 실패 — 전체 원문 참조)';
    return `[claim ${i + 1}] ${cc.claim.text}
[검증 질문] ${cc.question}
[근거 후보 단락]
${evidence}`;
  }).join('\n\n---\n\n');

  const prompt = `너는 여행 상품 등록 감사관이다. DB에 저장된 **주장(claim)** 들이 **원문(raw_text)** 의 어느 부분에 근거를 두고 있는지 **검증 질문 형태로** 확인하라.

상품명: ${title}
${fallbackFullText ? `\n===== 원문 전체 (짧음) =====\n${fallbackFullText}\n` : ''}
===== claim별 focused 컨텍스트 =====

${claimSections}

규칙:
- 검증 질문에 답하기 위해 **근거 후보 단락만 우선** 본다. 단락에서 답이 명확히 발견되면 supported=true, evidence 에 정확한 인용 문구 (40자 이내) 넣기.
- 단락에 없거나 일반 상식·업계 관례로만 추론 가능하면 supported=false (환각 의심).
- 괄호·조사·천단위 콤마 같은 사소한 표기 차이는 supported=true 로 판정.
- 단락 정보가 모자라 확정 불가면 supported=null.
- evidence 는 raw_text 에서 그대로 따온 문구만 (창작 금지).

JSON 만 출력 (claim 순서대로):
{
  "results": [
    { "n": 1, "supported": true|false|null, "evidence": "원문 인용 또는 null", "note": "불일치 시 한 줄 설명" }
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

module.exports = {
  runCoVeAudit,
  extractClaims,
  // RARR helpers — 디버그·후속 튜닝·테스트용
  chunkRawText,
  extractKeywords,
  scoreChunkRelevance,
  findBestChunks,
  generateVerificationQuestion,
};
