import { GoogleGenerativeAI } from '@google/generative-ai';
import { ContentBrief } from '@/lib/validators/content-brief';
import { BLOG_AI_MODEL, BLOG_AI_TEMPERATURE } from '@/lib/prompt-version';
import { BLOG_STYLE_GUIDE } from '@/prompts/blog/style-guide';
import { FEW_SHOT_EXAMPLES } from '@/prompts/blog/few-shot-examples';
import { pickBlogVariations } from '@/prompts/blog/variations';

/**
 * Call 3: 여소남 블로그 에디터 (큐레이터 페르소나)
 *
 * 역할: Brief의 sections[].blog_paragraph_seed를 H2별 본문으로 확장
 * 주입:
 *   1. 시스템 프롬프트 = BLOG_STYLE_GUIDE (페르소나 + 금지/권장 표현)
 *   2. Few-shot 예시 = FEW_SHOT_EXAMPLES (정제된 사장님 블로그 2편)
 *   3. 변형 풀 = pickBlogVariations (매 글 다른 오프닝/클로징)
 *   4. Brief + 이미지 맵 + 상품 팩트
 *
 * 출력: 마크다운 본문
 */

// SEO thin content 회피선. Backlinko (Brian Dean) 1,180만건 분석에서
// Google top 10 결과의 평균 길이가 1,447 영어 단어였고, 한국어는 단어가 더 짧으므로
// 마크다운 포함 1,500자를 하한으로 잡는다 (목표는 프롬프트의 2,200~3,200자).
// https://backlinko.com/search-engine-ranking
const MIN_BODY_CHARS = 1500;

export interface BlogBodyInput {
  brief: ContentBrief;
  slideImageMap?: Record<number, string>;
  pexelsImageMap?: Record<number, string>;
  productContext?: {
    title: string;
    destination?: string;
    duration?: number;
    nights?: number;
    price?: number;
    airline?: string;
    departure_airport?: string;
    inclusions?: string[];
    itinerary?: string[];
    product_id?: string;
  };
  baseUrl?: string;
}

export async function generateBlogBody(input: BlogBodyInput): Promise<string> {
  const { brief, slideImageMap = {}, pexelsImageMap = {}, productContext, baseUrl } = input;

  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) {
    return buildFallbackBlog(input);
  }

  const genAI = new GoogleGenerativeAI(apiKey);

  const productUrl = productContext?.product_id && baseUrl
    ? `${baseUrl}/packages/${productContext.product_id}`
    : baseUrl || 'https://yeosonam.com';

  // 변형 풀에서 랜덤 선택 (매 글 다른 오프닝/클로징)
  const dur = productContext?.duration && productContext?.nights
    ? `${productContext.nights}박${productContext.duration}일`
    : '';
  const priceStr = productContext?.price ? `${Math.round(productContext.price / 10000)}만원대` : '';
  const variations = pickBlogVariations({
    dest: brief.h1 ? productContext?.destination : undefined,
    duration: dur,
    price: priceStr,
  });

  // 섹션별 이미지 사전 매핑 (중복/누락 방지)
  const h1Image = slideImageMap[1] || null;
  const sectionImageMap: { position: number; h2: string; image_url: string | null }[] = brief.sections.map(s => ({
    position: s.position,
    h2: s.h2,
    // 카드뉴스 PNG 우선, 없으면 Pexels. 동일 이미지 H1에 사용됐으면 스킵
    image_url: (slideImageMap[s.position] && slideImageMap[s.position] !== h1Image)
      ? slideImageMap[s.position]
      : (pexelsImageMap[s.position] || null),
  }));
  const ctaPosition = brief.sections.length + 1;
  const ctaImage = slideImageMap[ctaPosition] && slideImageMap[ctaPosition] !== h1Image
    ? slideImageMap[ctaPosition]
    : null;

  // Few-shot 예시: 상품 모드면 product_* 예시 우선
  const relevantExamples = productContext
    ? FEW_SHOT_EXAMPLES.filter(e => e.product_type.startsWith('product_'))
    : FEW_SHOT_EXAMPLES;
  const fewShotBlock = relevantExamples.slice(0, 2).map((ex, i) =>
    `### 예시 ${i + 1}: ${ex.title}\n\n${ex.body}`
  ).join('\n\n---\n\n');

  const prompt = `${BLOG_STYLE_GUIDE}

---

# Few-shot 학습 예시 (이 스타일을 흉내낼 것)

아래 2편은 "여소남 스타일"의 정석 예시다. 구조, 톤, 대괄호 제목, 표, 해시태그 사용 방식을 참고하되 **내용은 절대 복붙하지 말 것**.

${fewShotBlock}

---

# 이번 글의 Brief

## 메타 정보
- H1: ${brief.h1}
- 타겟 고객: ${brief.target_audience}
- 핵심 소구점: ${brief.key_selling_points.join(' / ')}

## 섹션 구조 (H2 제목은 절대 변경 금지, 이 순서 그대로)
${brief.sections.map(s => `
${s.position}. H2 제목: **${s.h2}** (역할: ${s.role})
   씨앗 메시지: ${s.blog_paragraph_seed}
`).join('')}

${productContext ? `## 상품 팩트 (절대 변경 금지, 이 정보만 사용)
- 상품명: ${productContext.title}
- 목적지: ${productContext.destination ?? ''}
- 기간: ${productContext.nights ?? ''}박${productContext.duration ?? ''}일
- 가격: ${productContext.price ? `${productContext.price.toLocaleString()}원~` : ''}
- 항공: ${productContext.airline ?? ''}
- 출발: ${productContext.departure_airport ?? ''}
- 포함사항: ${(productContext.inclusions ?? []).join(', ')}
- 일정: ${(productContext.itinerary ?? []).join(' / ')}
` : ''}

## 이미지 배치 (URL 한 글자도 변경 금지, 지정된 위치에 한 번만 삽입)

### H1 바로 아래:
${h1Image ? `![${productContext?.destination || brief.h1.slice(0, 20)}](${h1Image})` : '(이미지 없음 — 생략)'}

### 각 H2 바로 아래:
${sectionImageMap.map(s => `
${s.position}. H2 "${s.h2}" 아래:
   ${s.image_url ? `![${s.h2}](${s.image_url})` : '(이미지 없음 — 이 섹션은 이미지 생략)'}
`).join('')}

### 마지막 CTA 섹션 아래:
${ctaImage ? `![${productContext?.destination || '여소남'}](${ctaImage})` : '(이미지 없음)'}

## 변형 지시 (이번 글에서 반드시 이 조합을 사용)

- **인트로 오프닝** (H1 다음 문단 시작): "${variations.opening_hook}"
  → 이 문장을 자연스럽게 변주하여 인트로 첫 문장으로 사용
- **긴급감 멘트** (CTA 섹션 직전): "${variations.urgency_line}"
- **CTA 유도 문장** (CTA 버튼 직전): "${variations.cta_closer}"
- **CTA 버튼 텍스트**: "${variations.cta_button_label}"

## 작성 규칙 (필수)

### 0-A. 출처 제약 (Faithfulness — 톤보다 먼저 점검)

- 본문에 등장하는 **모든 사실 주장**은 위 "상품 팩트" 또는 입력 brief/sections 에 명시된 정보에서만 추출한다.
- 입력에 없는 운영 시간, 시설(수영장·라이브쇼·인증제도), 수치(만족도 N%, 재구매율 N%, 거리·소요 시간 등)를 **임의로 만들지 마라.**
- 모르거나 입력에 없으면 일반적인 톤으로 우회한다 ("자세한 일정은 본문에서 확인하세요" 등). 추측한 사실 적지 말 것.
- 위반 시 전체 재작성.

### 0. 톤 (제일 중요 — 어기면 전체 재작성)

- **페르소나**: "가치 있는 여행을 소개하는 여소남 에디터". 친구에게 좋은 여행을 추천하듯 친근한 존댓말.
- **허용 종결어미**: \`~이에요\`, \`~입니다\`, \`~추천드려요\`, \`~더라고요\`, \`~이시죠?\`, \`~하시게 돼요\` 등을 섞어 써라. 동일 종결어미 3연속 금지.
- **금지 종결**: 평서체 "~한다", "~있다", "~된다" (건조함), 반말.
- **금지 단어 (절대 사용 금지)**: 아름다운, 환상적인, 완벽한, 특별한, 매력적인, 잊지 못할, 최고의, 인생샷, 놓치지 마세요, 꼭 가봐야 할, 제대로, 알찬, 만끽, 힐링, 설레는, 낭만적인, 한 번쯤은.
- **매 H2마다 3요소 체크**: (a) 감각 디테일 1개(온도·시야·피로도 등 구체) / (b) 2인칭 시나리오 1개("~하시게 돼요") / (c) 구체 수치 2개.
- **편집자 판단 문장**: 글 전체에 2곳 이상. 예: "같은 가격대 다낭 상품 중 바나산 2시간 체류는 흔하지 않아요."

1. **마크다운 출력** (# H1, ## H2). 코드블록(\`\`\`)으로 감싸지 말 것.
2. **H1**은 Brief.h1 그대로 사용.
3. **H1 바로 아래 "## 핵심 요약" 섹션을 필수로 넣을 것** (TL;DR).
   - \`## 핵심 요약\` 제목에 이어 bullet 3~5개 (\`- \` 로 시작)
   - 각 bullet은 20자~40자 내외, 숫자·고유명사 포함 (예: "- 부산(김해) 출발 에어부산 직항 3박5일")
   - AI Overviews/SGE가 인용하기 좋은 사실 중심 문장으로
4. **H2 제목은 예시처럼 \`[대괄호]\` 스타일 권장** (예: \`## [1일 차 | 천문산]\`, \`## [여소남이 이 상품을 엄선한 이유]\`).
5. 각 H2는 Brief의 "씨앗 메시지"를 4~7문장으로 확장.
6. **상품 팩트(가격/박수/호텔명/관광지명/항공편 시간)는 절대 변경 금지**. 확실치 않으면 언급하지 말 것.
7. 각 H2 바로 다음 줄에 지정된 이미지를 **그대로 복사**해 삽입. 중복 삽입 금지.
   - 이미지 alt는 \`![목적지 - 섹션명](URL)\` 형식 권장 (예: \`![다낭 - 바나산 국립공원](...)\`)
8. 문장은 60자 이내로 짧게. 한 문단은 3~5문장.
9. **항공 스케줄/요금/포함사항은 마크다운 표**로 작성 (상품 팩트가 있는 경우).
10. **"## [자주 묻는 질문]" 섹션을 CTA 직전에 필수로 넣을 것** (FAQPage 리치 스니펫 + 롱테일 검색 유입 목적).
    - Q&A 3~5개. 포맷은 다음과 같이 엄격히 준수:
      \`\`\`
      **Q. 구체적인 질문 (30자 이내)**

      A. 답변 (2~4문장, 사실 기반)
      \`\`\`
    - 질문 예시: 수하물 규정 / 공항 집합 시간 / 비자 / 우기·성수기 / 체력 난이도 / 4인 룸 가능 여부 / 현지 결제 수단 / 기내식 유무
    - 답변은 상품 팩트에서 확인되지 않으면 "여소남 예약 시 OP가 안내해 드립니다" 같이 안전한 안내 문장으로
11. 마지막에 \`## [여행 준비를 위한 실전 팁]\` 섹션 추가 (여권 / 복장 / 비자 / 통신 / 상비약 등).
12. 마지막 CTA는 위 지정 문장 + 버튼: \`**[👉 ${variations.cta_button_label}](${productUrl})**\`
13. 해시태그 15개를 맨 마지막 줄에 한 줄로 (Few-shot 예시 형식 참고).
14. 전체 분량 2200~3200자.

## 절대 금지 사항 (재확인)

- 자기소개 ("안녕하세요" 개의 오프닝 지양, 큐레이터 톤으로 바로 본론 진입 권장)
- **거짓 경험 표현 절대 금지**: "다녀왔다", "가봤는데", "경험해보니", "직접 체크했다", "가족을 모시고"
- **공허한 형용사 금지**: "매력적인", "아름다운", "특별한", "완벽한", "환상적인", "놓치지 마세요", "잊지 못할"
- 본문 볼드 마커(\`**\`) 사용 금지 (CTA 링크의 \`**[👉 ...](...)\`만 예외)
- 영어 약어 풀어쓰기: TAX → 세금, BX → 에어부산, LJ → 진에어
- 이미지 URL 한 글자도 변경 금지 (특히 images.pexels.com, supabase.co 도메인)
- 같은 이미지 중복 삽입 금지
- 원가, 랜드사명, 마진 언급 금지
- 섹션 순서/H2 제목 변경 금지

자, 이제 위 Brief와 이미지 배치에 따라 여소남 스타일로 블로그를 작성하라.`;

  // 1차 시도 → 길이 미달이면 1회 재시도. 재시도 프롬프트는 "현재 결과가 너무 짧다.
  // 정보 밀도를 유지하며 ${MIN_BODY_CHARS}자 이상으로 확장하라"를 prepend 한다.
  // (Gemini가 한 번에 짧게 자르는 케이스 방어 — Backlinko 본문 길이 분석 기반)
  const callOnce = async (extraSystem: string, temp: number): Promise<string> => {
    const finalPrompt = extraSystem ? `${extraSystem}\n\n---\n\n${prompt}` : prompt;
    const localModel = genAI.getGenerativeModel({
      model: BLOG_AI_MODEL,
      generationConfig: { temperature: temp },
    });
    const r = await localModel.generateContent(finalPrompt);
    return r.response.text()
      .replace(/^```markdown\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
  };

  try {
    let text = await callOnce('', BLOG_AI_TEMPERATURE);
    if (text.length < MIN_BODY_CHARS) {
      console.warn(`[blog-body] 1차 결과 ${text.length}자 → 재생성 (목표 ${MIN_BODY_CHARS}자+)`);
      try {
        const retry = await callOnce(
          `[CRITICAL] 직전 본문이 ${text.length}자로 너무 짧다. 정보 밀도를 유지하며 최소 ${MIN_BODY_CHARS}자, 목표 2,200~3,200자로 확장하라. ` +
          `각 H2 문단을 4~6 문장으로 풀고, 일차별 섹션은 동선·시간·체감 디테일을 추가하라. 거짓 경험·공허한 형용사 금지.`,
          Math.min(0.95, BLOG_AI_TEMPERATURE + 0.1),
        );
        if (retry.length > text.length) text = retry;
      } catch (retryErr) {
        console.warn('[blog-body] 재생성 실패 (1차 결과 사용):',
          retryErr instanceof Error ? retryErr.message : retryErr);
      }
    }

    // 이미지 URL 오타 자동 복구
    text = text
      .replace(/https:\/\/images\/pexels\.com/g, 'https://images.pexels.com')
      .replace(/https:\/\/images-pexels\.com/g, 'https://images.pexels.com');

    // 본문 볼드 마커 제거 (CTA 링크 제외)
    text = text.replace(/\*\*([^*\n\[]+?)\*\*/g, (_m, inner) => inner);

    // 동일 이미지 URL 중복 제거 (AI가 같은 슬라이드를 반복 삽입한 경우 방어)
    {
      const seen = new Set<string>();
      text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, _alt, url) => {
        if (seen.has(url)) return '';
        seen.add(url);
        return match;
      });
      text = text.replace(/\n{3,}/g, '\n\n');
    }

    // 내부명 alt 텍스트 정리
    text = text.replace(/!\[\s*슬라이드\s*\d+\s*\]/g, `![${productContext?.destination || '여행'}]`);

    // 빈 alt 방어 — `![](url)` 처럼 alt 누락된 이미지는 destination으로 채움
    {
      const destTag = productContext?.destination || '여행';
      text = text.replace(/!\[\s*\]\(/g, `![${destTag}](`);
    }

    // FAQ 섹션 누락 방어 — CTA 이전에 최소 Q&A 3개 자동 삽입
    if (!/##\s*\[?자주\s*묻는\s*질문\]?/i.test(text) && !/\*\*Q\.\s/.test(text)) {
      const destTag = productContext?.destination || '여행지';
      const dep = productContext?.departure_airport?.replace(/\(.*?\)/g, '').trim() || '출발 공항';
      const airline = productContext?.airline || '이용 항공사';
      const fallbackFaq = `\n## [자주 묻는 질문]\n\n**Q. ${dep} 공항 몇 시간 전에 도착해야 하나요?**\n\nA. 국제선이라 출발 2시간 30분 전 도착을 권장합니다. ${airline} 카운터 위치는 출국장 전광판에서 확인하실 수 있고, 여소남 예약 확정서에도 표기해 드립니다.\n\n**Q. ${destTag} 여행에 비자가 필요한가요?**\n\nA. 여소남은 예약 확정 시 비자 정책과 여권 유효기간(보통 6개월 이상)을 안내해 드립니다. 단수·복수 여부나 도착비자 운영은 변동될 수 있어 출발 전 재확인이 원칙입니다.\n\n**Q. 현지 사정으로 일정이 변경될 수 있나요?**\n\nA. 기상·항공 스케줄·현지 운영 사정에 따라 순서 조정이 있을 수 있으며, 동급 대체 일정으로 진행됩니다. 여소남 OP가 출발 전 최종 일정을 재확인해 드립니다.\n`;
      // CTA(마지막 H2) 직전에 삽입
      const lastCtaMatch = text.match(/\n##\s*\[?[^\n]*?(?:예약|지금\s*확인|상담|바로)[^\n]*\]?/);
      if (lastCtaMatch && lastCtaMatch.index !== undefined) {
        text = text.slice(0, lastCtaMatch.index) + fallbackFaq + text.slice(lastCtaMatch.index);
      } else {
        text += fallbackFaq;
      }
    }

    // 금지 표현 자동 치환 (AI 클리셰 하드 제거)
    // 규칙: 형용사만 붙인 단어는 수식어 제거, 감탄/클리셰는 삭제 또는 안전 치환
    text = applyForbiddenReplacements(text);

    // 거짓 경험 표현은 치환 대신 경고 (법적 리스크라 문장 맥락 인지 필요)
    const experienceLies = ['다녀왔', '가봤', '경험해보니', '직접 체크', '제가 확인'];
    const lieHits = experienceLies.filter((w) => text.includes(w));
    if (lieHits.length > 0) {
      console.warn(`[blog-body] 거짓 경험 표현 감지 (수동 확인 필요): ${lieHits.join(', ')}`);
    }

    // 선택적 2차 품질 리뷰 (ENV: BLOG_QUALITY_REVIEW=true)
    // 토큰 비용 약 2배 — 중요 상품에만 활성화 권장
    if (process.env.BLOG_QUALITY_REVIEW === 'true' && apiKey) {
      try {
        text = await runQualityReviewPass(text, productContext, apiKey);
      } catch (reviewErr) {
        console.warn(
          '[blog-body] 2차 품질 리뷰 실패 (원본 사용):',
          reviewErr instanceof Error ? reviewErr.message : reviewErr,
        );
      }
    }

    // EEAT 보강 박스 — 본문 끝 CTA·해시태그 직전에 한 번만 삽입.
    // 출처: Google Helpful Content System ("AI-generation, self-evident through disclosures") +
    // Quality Rater Guidelines 2025 (Experience 시그널 = first-hand 검증).
    // 거짓 경험은 만들지 않고, "여소남 운영팀 OP가 검수했다"는 사실만 적시한다.
    text = injectEeatBox(text, productContext);

    if (text.length >= MIN_BODY_CHARS) return text;
    console.warn(`[blog-body] 최종 ${text.length}자 < ${MIN_BODY_CHARS}자 → fallback 사용`);
  } catch (err) {
    console.warn('[blog-body] Gemini 실패:', err instanceof Error ? err.message : err);
  }

  return buildFallbackBlog(input);
}

/**
 * EEAT 보강 박스 — 검증 시그널 + AI 디스클로저.
 *
 * Google Helpful Content System (https://developers.google.com/search/docs/fundamentals/creating-helpful-content)
 * 의 "Is the use of automation, including AI-generation, self-evident to visitors through disclosures?"
 * 자가진단 항목을 충족시키기 위함. 동시에 Quality Rater Guidelines의 Experience 시그널
 * ("first-hand expertise from having actually used a product or service")을 거짓 없이 반영하기 위해
 * "운영팀 OP가 사실 검증" 형태로만 표기 — 가짜 답사 경험은 생성하지 않는다.
 *
 * CTA H2 직전(또는 해시태그 직전)에 1회 삽입. 이미 삽입돼 있으면 멱등하게 스킵.
 */
function injectEeatBox(
  text: string,
  productContext?: BlogBodyInput['productContext'],
): string {
  if (/<!-- yeosonam-eeat -->/.test(text)) return text;

  const today = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
  const dest = productContext?.destination || '여행지';
  const facts: string[] = [];
  if (productContext?.airline) facts.push(`항공편: ${productContext.airline}`);
  if (productContext?.departure_airport) {
    facts.push(`출발: ${productContext.departure_airport.replace(/\(.*?\)/g, '').trim()}`);
  }
  if (productContext?.nights && productContext?.duration) {
    facts.push(`일정: ${productContext.nights}박${productContext.duration}일`);
  }
  if (productContext?.price) {
    facts.push(`출발가: ${productContext.price.toLocaleString()}원~`);
  }
  const factLine = facts.length ? `> ${facts.join(' · ')}\n>\n` : '';

  const box =
    `\n<!-- yeosonam-eeat -->\n` +
    `> **여소남 운영팀 검증 메모 (${today} 기준)**\n>\n` +
    `${factLine}` +
    `> 본 글의 일정·요금·포함사항은 여소남 OP가 랜드사 원본 견적과 1:1 대조해 검수한 내용입니다.\n` +
    `> 현지 운영 사정으로 일부 순서가 바뀔 수 있으며, 출발 전 최종 일정을 다시 안내해 드립니다.\n>\n` +
    `> 글 작성: 여소남 OS AI 보조 + 운영팀 검수. ${dest} 관련 시즌별 최신가는 상품 페이지에서 확인하실 수 있습니다.\n\n`;

  // CTA H2 (예약·지금 확인·상담 등) 또는 해시태그(#) 라인 직전에 삽입.
  const ctaMatch = text.match(/\n##\s*\[?[^\n]*?(?:예약|지금\s*확인|상담|바로|👉)[^\n]*\]?/);
  if (ctaMatch && ctaMatch.index !== undefined) {
    return text.slice(0, ctaMatch.index) + box + text.slice(ctaMatch.index);
  }
  const tagMatch = text.match(/\n#[^\s\n]/);
  if (tagMatch && tagMatch.index !== undefined) {
    return text.slice(0, tagMatch.index) + box + text.slice(tagMatch.index);
  }
  return text.trimEnd() + '\n\n' + box;
}

/**
 * AI 클리셰 자동 치환 — style-guide의 "절대 금지 표현"과 1:1 매핑.
 * 수식어만 제거하면 되는 경우는 제거, 감탄·구호류는 삭제, 일부는 안전한 표현으로 치환.
 */
function applyForbiddenReplacements(input: string): string {
  let text = input;
  // ── 코드블록/이미지 alt 보호: 치환은 "본문 평문"에만 적용해야 안전.
  //    대략적으로 마크다운 이미지 alt `![...]` 안쪽은 보호.
  const PROTECTED: string[] = [];
  text = text.replace(/!\[[^\]]*\]/g, (m) => {
    PROTECTED.push(m);
    return `__IMG_ALT_${PROTECTED.length - 1}__`;
  });

  const rules: Array<[RegExp, string]> = [
    // 형용사만 있는 경우 → 수식어 제거 (뒤 공백 포함 매칭으로 자연스럽게)
    [/\b아름다운\s+/g, ''],
    [/\b환상적(?:인|으로)\s*/g, ''],
    [/\b완벽한\s+/g, ''],
    [/\b특별한\s+/g, ''],
    [/\b매력적(?:인|으로)\s*/g, ''],
    [/\b최고의\s+/g, ''],
    [/\b설레는\s+/g, ''],
    [/\b낭만적(?:인|으로)\s*/g, ''],
    [/\b알찬\s+/g, ''],
    [/\b힘찬\s+/g, ''],
    [/\b잊지\s*못할\s+/g, ''],
    [/\b꼭\s*가\s*봐야\s*할\s+/g, ''],
    [/\b한\s*번쯤은?\s*경험해\s*볼\s*만한\s+/g, ''],
    [/\b추억에\s*남는?\s+/g, ''],

    // 감탄·구호
    [/\s*놓치지\s*마세요\.?/g, ''],
    [/\s*잊지\s*마세요\.?/g, ''],

    // 안전한 표현으로 치환
    [/\b인생\s*샷/g, '사진 스팟'],
    [/\b제대로\s+(?=즐|경험|만끽)/g, '충분히 '],
    [/\b만끽해\s*보세요\.?/g, '즐겨 보세요.'],
    [/\b만끽하세요\.?/g, '즐겨 보세요.'],
    [/\b만끽하십시오\.?/g, '즐겨 보세요.'],
    [/\b만끽합니다\.?/g, '즐길 수 있어요.'],
    [/\b만끽할\s*수\s*있습니다\.?/g, '즐기실 수 있어요.'],
    [/\b힐링(?:의\s*시간|\s*타임)?/g, '휴식'],

    // 연속 공백 정리
    [/[ \t]{2,}/g, ' '],
    // 문장 시작의 공백/콤마 제거 (치환 후 생길 수 있는 잔여)
    [/([.!?。\n])\s+,/g, '$1'],
    // 빈 bullet 라인 정리 ("- " 만 남은 경우)
    [/^-\s*$/gm, ''],
  ];

  for (const [re, rep] of rules) {
    text = text.replace(re, rep);
  }

  // 보호 영역 복원
  text = text.replace(/__IMG_ALT_(\d+)__/g, (_, i) => PROTECTED[Number(i)] ?? '');

  return text;
}

/**
 * 2차 품질 리뷰 — style-guide rubric에 따른 교정.
 * - 이미 사용된 Gemini 모델로 같은 text를 평가·수정.
 * - 구조·팩트는 보존, 톤·감각·편집자 판단만 보완.
 */
async function runQualityReviewPass(
  text: string,
  productContext: BlogBodyInput['productContext'] | undefined,
  apiKey: string,
): Promise<string> {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: BLOG_AI_MODEL,
    generationConfig: { temperature: 0.4 },
  });

  const prompt = `아래는 여소남 여행 블로그 초안이다. "여소남 에디터" 스타일에 맞게 다시 다듬어라.

## 톤 규칙 (변경 금지)
- 친근한 존댓말 (\`~이에요\`, \`~추천드려요\`, \`~더라고요\` 섞어 쓰기)
- 동일 종결어미 3연속 금지
- 평서체 "~한다" 종결 금지

## 내용 규칙 (매 H2마다 체크)
- 감각 디테일 1개 (온도·시야·피로도·소리 등 구체)
- 2인칭 시나리오 1개 ("~하시게 돼요", "~이 드실 거예요")
- 구체 수치 2개 이상
- 편집자 판단 문장이 글 전체에 2곳 이상

## 절대 금지 (남아 있으면 반드시 고칠 것)
- "아름다운", "환상적인", "완벽한", "특별한", "잊지 못할", "최고의", "인생샷", "설레는", "힐링", "알찬", "만끽", "한 번쯤은"
- 거짓 경험 표현 ("제가 가봤", "다녀왔는데")

## 팩트 보존 (절대 바꾸지 말 것)
- 가격·박수·호텔명·관광지명·항공편명·시간
- 이미지 URL
- H1, H2 제목, 해시태그
- CTA 링크

## 출력
수정된 마크다운 전문. 코드블록(\`\`\`) 금지.
변경이 필요 없는 문장은 그대로 두고, 위 규칙에 어긋난 문장만 고쳐라.

## 상품 컨텍스트
- 목적지: ${productContext?.destination ?? ''}
- 기간: ${productContext?.nights ?? ''}박${productContext?.duration ?? ''}일
- 가격: ${productContext?.price ? `${productContext.price.toLocaleString()}원~` : ''}
- 항공: ${productContext?.airline ?? ''}

---

## 초안

${text}`;

  const result = await model.generateContent(prompt);
  const revised = result.response
    .text()
    .replace(/^```markdown\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  // 보호 규칙: 길이가 심하게 짧아졌거나 H1이 사라진 경우 원본 유지
  if (!revised || revised.length < text.length * 0.6 || !/^#\s/m.test(revised)) {
    console.warn('[blog-body] 2차 리뷰 결과가 안전 범위를 벗어남 — 원본 사용');
    return text;
  }

  // 2차 리뷰 결과에도 동일한 자동 치환 재적용 (안전장치)
  return applyForbiddenReplacements(revised);
}

/**
 * AI 실패 시 결정론적 Fallback 블로그 (변형 풀 + 이미지 사전 매핑 적용)
 */
function buildFallbackBlog(input: BlogBodyInput): string {
  const { brief, slideImageMap = {}, pexelsImageMap = {}, productContext, baseUrl } = input;
  const productUrl = productContext?.product_id && baseUrl
    ? `${baseUrl}/packages/${productContext.product_id}`
    : baseUrl || 'https://yeosonam.com';

  const dur = productContext?.duration && productContext?.nights
    ? `${productContext.nights}박${productContext.duration}일`
    : '';
  const variations = pickBlogVariations({
    dest: productContext?.destination,
    duration: dur,
  });

  const h1Image = slideImageMap[1] || null;

  const sections: string[] = [];
  sections.push(`# ${brief.h1}`);
  sections.push(`\n${variations.opening_hook}\n`);
  if (h1Image) sections.push(`![${productContext?.destination || '여행'}](${h1Image})\n`);

  // TL;DR (핵심 요약)
  const tldr: string[] = [];
  if (productContext?.destination && dur) tldr.push(`- ${productContext.destination} ${dur} 여행`);
  if (productContext?.price) tldr.push(`- 출발가 ${productContext.price.toLocaleString()}원~`);
  if (productContext?.airline) tldr.push(`- ${productContext.airline} 이용`);
  if (productContext?.departure_airport) {
    tldr.push(`- ${productContext.departure_airport.replace(/\(.*?\)/g, '').trim()} 출발`);
  }
  if (tldr.length >= 2) {
    sections.push(`\n## 핵심 요약`);
    sections.push(tldr.join('\n'));
  }

  for (const s of brief.sections) {
    sections.push(`\n## [${s.h2}]`);
    const img = (slideImageMap[s.position] && slideImageMap[s.position] !== h1Image)
      ? slideImageMap[s.position]
      : pexelsImageMap[s.position];
    if (img) sections.push(`![${s.h2}](${img})`);
    sections.push(s.blog_paragraph_seed);
  }

  // FAQ (fallback — FAQPage JSON-LD 자동 추출 대상)
  const destTag = productContext?.destination || '여행지';
  const dep = productContext?.departure_airport?.replace(/\(.*?\)/g, '').trim() || '공항';
  const airline = productContext?.airline || '이용 항공사';
  sections.push(`\n## [자주 묻는 질문]`);
  sections.push(`\n**Q. ${dep} 공항 몇 시간 전에 도착해야 하나요?**\n\nA. 국제선이라 출발 2시간 30분 전 도착을 권장합니다. ${airline} 카운터 위치는 출국장 전광판에서 확인하실 수 있고, 여소남 예약 확정서에도 표기해 드립니다.`);
  sections.push(`\n**Q. ${destTag} 여행에 비자가 필요한가요?**\n\nA. 여소남은 예약 확정 시 비자 정책과 여권 유효기간(보통 6개월 이상)을 안내해 드립니다. 단수·복수 여부나 도착비자 운영은 변동될 수 있어 출발 전 재확인이 원칙입니다.`);
  sections.push(`\n**Q. 현지 사정으로 일정이 변경될 수 있나요?**\n\nA. 기상·항공 스케줄·현지 운영 사정에 따라 순서 조정이 있을 수 있으며, 동급 대체 일정으로 진행됩니다. 여소남 OP가 출발 전 최종 일정을 재확인해 드립니다.`);

  // CTA
  sections.push(`\n## [지금 확인해 보세요]`);
  const ctaImage = slideImageMap[brief.sections.length + 1];
  if (ctaImage && ctaImage !== h1Image) sections.push(`![${productContext?.destination || '여소남'}](${ctaImage})`);
  sections.push(variations.urgency_line);
  sections.push(variations.cta_closer);
  sections.push(`\n**[👉 ${variations.cta_button_label}](${productUrl})**`);

  return sections.join('\n');
}
