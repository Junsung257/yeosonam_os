/**
 * rfq-ai.ts — AI 단체여행 무인 중개 엔진: 4개 AI 레이어
 *
 * 1. Interview AI    : 고객 AI 인터뷰 (RFQ 정보 수집)
 * 2. Proposal Review : 제안서 원가 체크리스트 검수 + 실질 총액 계산
 * 3. Fact-Bombing    : TOP 3 비교 팩트 폭격 리포트
 * 4. Communication   : 고객↔랜드사 양방향 AI 번역 + PII 차단
 *
 * 환경변수 MOCK_RFQ_AI=true (또는 Gemini API 키 미설정 시)
 * → Mock 응답으로 자동 fallback (테스트 친화적)
 */

import type { GroupRfq, RfqProposal } from './supabase';

// ── 공통 설정 ────────────────────────────────────────────────

const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? '';
const GEMINI_MODEL   = 'gemini-2.5-flash';
const USE_MOCK       = process.env.MOCK_RFQ_AI === 'true' || !GEMINI_API_KEY;

async function callGemini(prompt: string, history?: GeminiMessage[]): Promise<string> {
  const contents = [
    ...(history ?? []),
    { role: 'user', parts: [{ text: prompt }] },
  ];
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ contents }),
    }
  );
  const json = await res.json();
  return json?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}

// ============================================================
// 1. Interview AI — 고객 RFQ 인터뷰
// ============================================================

export interface GeminiMessage {
  role:  'user' | 'model';
  parts: [{ text: string }];
}

export interface InterviewState {
  messages:    GeminiMessage[];
  extracted:   Partial<GroupRfq>;
  isComplete:  boolean;
  stepsDone:   string[];  // ['destination','dates','people','budget',...]
}

const INTERVIEW_SYSTEM_PROMPT = `
당신은 여소남 여행사의 단체여행 전문 컨시어지 AI입니다.
고객과 자연스럽게 대화하여 단체여행 RFQ(견적 요청서)에 필요한 정보를 수집해 주세요.

수집해야 할 8가지 정보 (우선순위 순):
[필수]
1. destination   — 여행 목적지 (예: 일본 도쿄, 베트남 다낭)
2. people        — 인원 수 (성인/아동 구분)
3. budget        — 1인당 예산 또는 총 예산

[권장]
4. dates         — 출발/도착 날짜 또는 기간 (예: 3월 말, 5박 6일)
5. hotel_grade   — 호텔 등급 (3성/4성/5성/무관)
6. meal_plan     — 식사 형태 (전식포함/조식/불포함)
7. transportation — 이동 수단 (전세버스/기차/자유이동)
8. special       — 특별 요청사항 (어린이 동반, 휠체어, 알레르기 등)

규칙:
- 한 번에 1-2가지만 질문하세요 (너무 많은 질문은 부담)
- 이미 언급된 정보는 다시 묻지 마세요
- 필수 3개 수집 완료 시 마지막 메시지에 "[RFQ_READY]" 태그를 포함하세요
- 금액은 한국어로 자연스럽게 (예: "1인당 100만원")
- JSON 형식이나 기술적 용어 사용 금지
`.trim();

export async function runInterviewTurn(
  userMessage: string,
  state: InterviewState
): Promise<{ reply: string; state: InterviewState }> {

  if (USE_MOCK) return runMockInterviewTurn(userMessage, state);

  const newMessages: GeminiMessage[] = [
    ...state.messages,
    { role: 'user', parts: [{ text: userMessage }] },
  ];

  // 시스템 프롬프트를 첫 번째 모델 메시지로 주입
  const historyWithSystem: GeminiMessage[] = [
    { role: 'user',  parts: [{ text: '지금부터 단체여행 RFQ 인터뷰를 시작해 주세요.' }] },
    { role: 'model', parts: [{ text: INTERVIEW_SYSTEM_PROMPT + '\n\n안녕하세요! 단체여행 전문 컨시어지 AI입니다. 어떤 여행을 계획하고 계신가요?' }] },
    ...newMessages,
  ];

  const reply = await callGemini(
    '다음 수집해야 할 정보를 자연스럽게 질문하거나, 필수 정보 3개가 모두 수집되었으면 "[RFQ_READY]"를 포함하여 응답하세요.',
    historyWithSystem
  );

  const extracted = extractFromConversation([...newMessages, { role: 'model', parts: [{ text: reply }] }], state.extracted);
  const isComplete = reply.includes('[RFQ_READY]') || hasRequiredFields(extracted);
  const cleanReply = reply.replace('[RFQ_READY]', '').trim();

  return {
    reply: cleanReply,
    state: {
      messages:   [...newMessages, { role: 'model', parts: [{ text: cleanReply }] }],
      extracted,
      isComplete,
      stepsDone:  state.stepsDone,
    },
  };
}

function hasRequiredFields(e: Partial<GroupRfq>): boolean {
  return !!(e.destination && (e.adult_count ?? 0) > 0 && (e.budget_per_person ?? e.total_budget ?? 0) > 0);
}

function extractFromConversation(messages: GeminiMessage[], prev: Partial<GroupRfq>): Partial<GroupRfq> {
  const text = messages.map(m => m.parts[0].text).join(' ');
  const ext: Partial<GroupRfq> = { ...prev };

  // 목적지
  const destMatch = text.match(/([가-힣]{2,}(?:\s[가-힣]{2,})?)\s*(?:여행|투어|방문)/);
  if (destMatch && !ext.destination) ext.destination = destMatch[1];

  // 인원
  const adultMatch = text.match(/성인\s*(\d+)/);
  if (adultMatch) ext.adult_count = parseInt(adultMatch[1]);
  const childMatch = text.match(/아동\s*(\d+)/);
  if (childMatch) ext.child_count = parseInt(childMatch[1]);
  const totalMatch = text.match(/(\d+)\s*명/);
  if (totalMatch && !ext.adult_count) ext.adult_count = parseInt(totalMatch[1]);

  // 예산
  const budgetMatch = text.match(/(\d+(?:\.\d+)?)\s*만\s*원/);
  if (budgetMatch) ext.budget_per_person = parseInt(budgetMatch[1]) * 10000;

  // 호텔
  if (text.includes('5성')) ext.hotel_grade = '5성';
  else if (text.includes('4성')) ext.hotel_grade = '4성';
  else if (text.includes('3성')) ext.hotel_grade = '3성';

  // 식사
  if (text.includes('전식포함') || text.includes('전 식사 포함')) ext.meal_plan = '전식포함';
  else if (text.includes('조식')) ext.meal_plan = '조식';
  else if (text.includes('불포함')) ext.meal_plan = '불포함';

  return ext;
}

// Mock 인터뷰 (테스트용)
function runMockInterviewTurn(userMessage: string, state: InterviewState): { reply: string; state: InterviewState } {
  const stepCount = state.messages.length;
  const replies = [
    '안녕하세요! 단체여행 전문 컨시어지 AI입니다. 어떤 목적지를 생각하고 계신가요?',
    '좋습니다! 몇 분이서 함께 여행하시나요? 성인/아동 구분해서 알려주시면 더 정확한 견적을 드릴 수 있어요.',
    '알겠습니다! 1인당 예산은 어느 정도로 생각하고 계신가요? 숙박과 식사 포함 여부도 알려주시면 좋겠어요.',
    '감사합니다! 필요한 기본 정보가 모두 수집되었습니다. 이 정보를 바탕으로 랜드사들에게 견적을 요청할게요!',
  ];

  const reply = replies[Math.min(stepCount / 2, replies.length - 1)] ?? replies[replies.length - 1];
  const isComplete = stepCount >= 6;

  const newMessages: GeminiMessage[] = [
    ...state.messages,
    { role: 'user',  parts: [{ text: userMessage }] },
    { role: 'model', parts: [{ text: reply }] },
  ];

  const mockExtracted: Partial<GroupRfq> = {
    ...state.extracted,
    destination:       state.extracted.destination    ?? '일본 도쿄',
    adult_count:       state.extracted.adult_count    ?? 20,
    child_count:       state.extracted.child_count    ?? 5,
    budget_per_person: state.extracted.budget_per_person ?? 1200000,
    hotel_grade:       state.extracted.hotel_grade    ?? '4성',
    meal_plan:         state.extracted.meal_plan      ?? '전식포함',
    duration_nights:   state.extracted.duration_nights ?? 4,
  };

  return {
    reply,
    state: { messages: newMessages, extracted: isComplete ? mockExtracted : state.extracted, isComplete, stepsDone: state.stepsDone },
  };
}

// ============================================================
// 2. Proposal Review AI — 제안서 원가 검수
// ============================================================

export interface ProposalReviewResult {
  score:                number;        // 0~100
  issues:               string[];
  suggestions:          string[];
  fact_check:           string[];
  hidden_cost_estimate: number;        // 불포함 비용 합계 (원)
  real_total_price:     number;        // 판매가 + 숨은 비용
}

const REVIEW_PROMPT_TEMPLATE = (rfq: GroupRfq, p: RfqProposal) => `
당신은 여행 원가 전문 심사관입니다. 아래 단체여행 제안서를 엄격하게 검수해 주세요.

[여행 요건]
- 목적지: ${rfq.destination}
- 인원: 성인 ${rfq.adult_count}명 / 아동 ${rfq.child_count}명
- 1인 예산: ${rfq.budget_per_person ? `${(rfq.budget_per_person / 10000).toFixed(0)}만원` : '미정'}
- 호텔 등급: ${rfq.hotel_grade ?? '미정'}
- 식사: ${rfq.meal_plan ?? '미정'}

[제안서 정보]
- 제안 제목: ${p.proposal_title ?? '(제목 없음)'}
- 판매가: ${(p.total_selling_price / 10000).toFixed(0)}만원
- 원가: ${(p.total_cost / 10000).toFixed(0)}만원
- 체크리스트:
  가이드비: ${JSON.stringify((p.checklist as { guide_fee?: unknown })?.guide_fee ?? '미입력')}
  기사 팁: ${JSON.stringify((p.checklist as { driver_tip?: unknown })?.driver_tip ?? '미입력')}
  유류 할증료: ${JSON.stringify((p.checklist as { fuel_surcharge?: unknown })?.fuel_surcharge ?? '미입력')}
  현지 세금: ${JSON.stringify((p.checklist as { local_tax?: unknown })?.local_tax ?? '미입력')}
  생수 비용: ${JSON.stringify((p.checklist as { water_cost?: unknown })?.water_cost ?? '미입력')}
  불포함 내역: ${JSON.stringify((p.checklist as { exclusions?: unknown })?.exclusions ?? [])}

다음 JSON 형식으로만 응답하세요:
{
  "score": 0~100,
  "issues": ["문제점1", "문제점2"],
  "suggestions": ["개선사항1"],
  "fact_check": ["팩트1", "팩트2"],
  "hidden_cost_estimate": 예상 숨은 비용 합계 (원, 숫자만),
  "real_total_price": 판매가 + 숨은 비용 합계 (원, 숫자만)
}
`.trim();

export async function reviewProposal(
  rfq: GroupRfq,
  proposal: RfqProposal
): Promise<ProposalReviewResult> {
  if (USE_MOCK) return mockReviewProposal(rfq, proposal);

  try {
    const text = await callGemini(REVIEW_PROMPT_TEMPLATE(rfq, proposal));
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('JSON 파싱 실패');
    const result = JSON.parse(jsonMatch[0]) as ProposalReviewResult;
    return {
      score:                Math.min(100, Math.max(0, result.score ?? 50)),
      issues:               result.issues ?? [],
      suggestions:          result.suggestions ?? [],
      fact_check:           result.fact_check ?? [],
      hidden_cost_estimate: result.hidden_cost_estimate ?? 0,
      real_total_price:     result.real_total_price ?? proposal.total_selling_price,
    };
  } catch {
    return mockReviewProposal(rfq, proposal);
  }
}

function mockReviewProposal(_rfq: GroupRfq, p: RfqProposal): ProposalReviewResult {
  const checklist = p.checklist as Record<string, unknown>;
  const missing: string[] = [];
  for (const key of ['guide_fee', 'driver_tip', 'fuel_surcharge', 'local_tax', 'water_cost']) {
    if (!checklist[key]) missing.push(key);
  }
  const score = Math.max(30, 100 - missing.length * 12);
  const hiddenCost = missing.length * 50000 * (p.total_selling_price > 0 ? 1 : 0);
  return {
    score,
    issues:               missing.map(k => `${k} 항목이 입력되지 않았습니다.`),
    suggestions:          ['불포함 내역에 대한 예상 비용을 추가하면 고객 신뢰도가 높아집니다.'],
    fact_check:           [`판매가 ${(p.total_selling_price / 10000).toFixed(0)}만원 대비 원가율 ${Math.round(p.total_cost / p.total_selling_price * 100)}%`],
    hidden_cost_estimate: hiddenCost,
    real_total_price:     p.total_selling_price + hiddenCost,
  };
}

// ============================================================
// 3. Fact-Bombing Analysis — TOP 3 비교 리포트
// ============================================================

export interface FactBombingResult {
  ranked:        RfqProposal[];
  report_html:   string;
  key_insights:  string[];
}

const FACTBOMBING_PROMPT = (rfq: GroupRfq, proposals: RfqProposal[]) => `
당신은 단체여행 원가 분석 전문가입니다. 아래 ${proposals.length}개 제안서를 비교 분석하여 고객이 올바른 선택을 할 수 있도록 "팩트 폭격" 리포트를 작성해 주세요.

[여행 요건]
목적지: ${rfq.destination} | 인원: 성인${rfq.adult_count}+아동${rfq.child_count} | 기간: ${rfq.duration_nights ?? '?'}박

[제안서 목록]
${proposals.map((p, i) => `
${String.fromCharCode(65 + i)}사:
- 판매가: ${(p.total_selling_price / 10000).toFixed(0)}만원
- 실질 총액(불포함 포함): ${p.real_total_price ? (p.real_total_price / 10000).toFixed(0) : '?'}만원
- AI 검수 점수: ${p.ai_review?.score ?? '?'}점
- 불포함 예상 비용: ${(p.hidden_cost_estimate / 10000).toFixed(0)}만원
- 주요 불포함: ${JSON.stringify((p.checklist as { exclusions?: string[] })?.exclusions ?? [])}
`).join('\n')}

다음 JSON 형식으로만 응답하세요:
{
  "ranked_indices": [0, 1, 2],  // 실질 총액 기준 최적 순서 (인덱스)
  "report_html": "HTML 형식 비교 분석 리포트 (2~3단락, 한국어)",
  "key_insights": ["인사이트1", "인사이트2", "인사이트3"]
}

report_html 예시:
"<p><strong>실질 비용 비교</strong>: A사의 판매가는 ${proposals[0] ? (proposals[0].total_selling_price/10000).toFixed(0) : '?'}만원으로 가장 저렴해 보이지만...</p>"
`.trim();

export async function generateFactBombingReport(
  rfq: GroupRfq,
  proposals: RfqProposal[]
): Promise<FactBombingResult> {
  if (USE_MOCK) return mockFactBombing(rfq, proposals);

  try {
    const text = await callGemini(FACTBOMBING_PROMPT(rfq, proposals));
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('JSON 파싱 실패');
    const result = JSON.parse(jsonMatch[0]) as {
      ranked_indices: number[];
      report_html:    string;
      key_insights:   string[];
    };
    const ranked = (result.ranked_indices ?? proposals.map((_, i) => i))
      .map(i => proposals[i])
      .filter(Boolean);
    return { ranked, report_html: result.report_html ?? '', key_insights: result.key_insights ?? [] };
  } catch {
    return mockFactBombing(rfq, proposals);
  }
}

function mockFactBombing(_rfq: GroupRfq, proposals: RfqProposal[]): FactBombingResult {
  const sorted = [...proposals].sort((a, b) =>
    (a.real_total_price ?? a.total_selling_price) - (b.real_total_price ?? b.total_selling_price)
  );
  const labels = ['A', 'B', 'C', 'D', 'E'];

  const report_html = `
<p><strong>실질 비용 비교 분석</strong>: 제출된 ${proposals.length}개 제안서를 '불포함 비용 포함 실질 총액' 기준으로 분석했습니다.</p>
<p>${labels[proposals.indexOf(sorted[0])]}사의 판매가는 ${(sorted[0]?.total_selling_price / 10000).toFixed(0)}만원으로 ${sorted.length > 1 ? `${labels[proposals.indexOf(sorted[1])]}사보다 ${((sorted[1]?.total_selling_price - sorted[0]?.total_selling_price) / 10000).toFixed(0)}만원 높지만,` : ''} 가이드비·기사 팁 등 불포함 비용까지 합산하면 실질 총액이 가장 낮아 실제로는 가장 유리한 제안입니다.</p>
<p><strong>권장</strong>: ${labels[proposals.indexOf(sorted[0])]}사를 선택하시면 숨은 비용 없이 투명한 여행이 가능합니다.</p>
  `.trim();

  return {
    ranked:       sorted,
    report_html,
    key_insights: [
      `실질 총액 최저: ${labels[proposals.indexOf(sorted[0])]}사 (${(( sorted[0]?.real_total_price ?? sorted[0]?.total_selling_price) / 10000).toFixed(0)}만원)`,
      `AI 검수 점수 최고: ${labels[proposals.indexOf([...proposals].sort((a, b) => (b.ai_review?.score ?? 0) - (a.ai_review?.score ?? 0))[0])]}사`,
      '불포함 비용을 반드시 확인하고 실질 총액으로 비교하세요.',
    ],
  };
}

// ============================================================
// 4. Communication AI — 양방향 AI 번역 + PII 차단
// ============================================================

export interface MessageProcessResult {
  processed:    string;
  pii_detected: boolean;
  pii_details?: string;
}

// PII 감지 패턴
const PII_PATTERNS = [
  { pattern: /\d{2,3}-\d{3,4}-\d{4}/g,          label: '전화번호' },
  { pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, label: '이메일' },
  { pattern: /\d{3}-\d{2}-\d{5}/g,               label: '사업자등록번호' },
  { pattern: /kakao|카카오톡|카톡|라인|line|wechat|위챗/gi, label: '메신저 ID' },
  { pattern: /계좌\s*번호|통장\s*번호/g,          label: '계좌정보' },
];

export function detectPII(text: string): { found: boolean; details: string } {
  const found: string[] = [];
  for (const { pattern, label } of PII_PATTERNS) {
    if (pattern.test(text)) found.push(label);
    pattern.lastIndex = 0; // regex 상태 초기화
  }
  return { found: found.length > 0, details: found.join(', ') };
}

function maskPII(text: string): string {
  let masked = text;
  for (const { pattern } of PII_PATTERNS) {
    masked = masked.replace(pattern, '[개인정보 차단]');
    pattern.lastIndex = 0;
  }
  return masked;
}

export async function processCustomerMessage(
  raw: string,
  rfq: GroupRfq
): Promise<MessageProcessResult> {
  const piiCheck = detectPII(raw);
  if (piiCheck.found) {
    return {
      processed:    '[개인정보 보호를 위해 차단됨]',
      pii_detected: true,
      pii_details:  piiCheck.details,
    };
  }

  if (USE_MOCK) {
    return {
      processed:    `[업무 지시] ${rfq.destination} 여행 관련 고객 요청: ${raw}`,
      pii_detected: false,
    };
  }

  try {
    const prompt = `
다음 고객 메시지를 랜드사에 전달할 "업무 지시 형식"으로 번역해 주세요.
고객의 감정적 표현은 정중하고 명확한 업무 언어로 변환하세요.
개인정보(이름, 연락처 등)는 절대 포함하지 마세요.

여행 맥락: ${rfq.destination}, 성인${rfq.adult_count}명

고객 원본: "${raw}"

번역 결과만 출력하세요.
    `.trim();
    const processed = await callGemini(prompt);
    return { processed: processed.trim(), pii_detected: false };
  } catch {
    return { processed: `[업무 지시] ${raw}`, pii_detected: false };
  }
}

export async function processTenantMessage(
  raw: string,
  rfq: GroupRfq
): Promise<MessageProcessResult> {
  const piiCheck = detectPII(raw);
  const maskedRaw = piiCheck.found ? maskPII(raw) : raw;

  if (USE_MOCK) {
    return {
      processed:    `고객님의 문의에 대한 답변: ${maskedRaw}`,
      pii_detected: piiCheck.found,
      pii_details:  piiCheck.details,
    };
  }

  try {
    const prompt = `
다음 랜드사 메시지를 고객에게 전달할 "친절한 고객 서비스 언어"로 정제해 주세요.
랜드사의 회사명, 담당자 이름, 연락처 등 식별 가능한 정보는 모두 익명화하세요 (예: "담당 여행사", "담당 매니저").
전문 용어는 쉬운 표현으로 바꿔주세요.

여행 맥락: ${rfq.destination}

원본: "${maskedRaw}"

정제 결과만 출력하세요.
    `.trim();
    const processed = await callGemini(prompt);
    return {
      processed:    processed.trim(),
      pii_detected: piiCheck.found,
      pii_details:  piiCheck.details,
    };
  } catch {
    return { processed: maskedRaw, pii_detected: piiCheck.found, pii_details: piiCheck.details };
  }
}
