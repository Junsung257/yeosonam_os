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
  const model = genAI.getGenerativeModel({
    model: BLOG_AI_MODEL,
    generationConfig: { temperature: BLOG_AI_TEMPERATURE },
  });

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

1. **마크다운 출력** (# H1, ## H2). 코드블록(\`\`\`)으로 감싸지 말 것.
2. **H1**은 Brief.h1 그대로 사용.
3. **H2 제목은 예시처럼 \`[대괄호]\` 스타일 권장** (예: \`## [1일 차 | 천문산]\`, \`## [여소남이 이 상품을 엄선한 이유]\`).
4. 각 H2는 Brief의 "씨앗 메시지"를 4~7문장으로 확장.
5. **상품 팩트(가격/박수/호텔명/관광지명/항공편 시간)는 절대 변경 금지**. 확실치 않으면 언급하지 말 것.
6. 각 H2 바로 다음 줄에 지정된 이미지를 **그대로 복사**해 삽입. 중복 삽입 금지.
7. 문장은 60자 이내로 짧게. 한 문단은 3~5문장.
8. **항공 스케줄/요금/포함사항은 마크다운 표**로 작성 (상품 팩트가 있는 경우).
9. 마지막에 \`## [여행 준비를 위한 실전 팁]\` 섹션 추가 (여권 / 복장 / 비자 / 통신 / 상비약 등).
10. 마지막 CTA는 위 지정 문장 + 버튼: \`**[👉 ${variations.cta_button_label}](${productUrl})**\`
11. 해시태그 15개를 맨 마지막 줄에 한 줄로 (Few-shot 예시 형식 참고).
12. 전체 분량 1800~2800자.

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

  try {
    const result = await model.generateContent(prompt);
    let text = result.response.text()
      .replace(/^```markdown\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();

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

    // 금지 표현 자동 체크 및 경고 로그 (AI가 지시를 무시한 경우 추적)
    const forbidden = ['다녀왔', '가봤', '경험해보니', '직접 체크', '매력적인', '아름다운', '특별한', '완벽한', '놓치지 마세요'];
    const hits = forbidden.filter(w => text.includes(w));
    if (hits.length > 0) {
      console.warn(`[blog-body] 금지 표현 감지 (후처리 필요): ${hits.join(', ')}`);
    }

    if (text.length > 500) return text;
  } catch (err) {
    console.warn('[blog-body] Gemini 실패:', err instanceof Error ? err.message : err);
  }

  return buildFallbackBlog(input);
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

  for (const s of brief.sections) {
    sections.push(`\n## [${s.h2}]`);
    const img = (slideImageMap[s.position] && slideImageMap[s.position] !== h1Image)
      ? slideImageMap[s.position]
      : pexelsImageMap[s.position];
    if (img) sections.push(`![${s.h2}](${img})`);
    sections.push(s.blog_paragraph_seed);
  }

  // CTA
  sections.push(`\n## [지금 확인해 보세요]`);
  const ctaImage = slideImageMap[brief.sections.length + 1];
  if (ctaImage && ctaImage !== h1Image) sections.push(`![${productContext?.destination || '여소남'}](${ctaImage})`);
  sections.push(variations.urgency_line);
  sections.push(variations.cta_closer);
  sections.push(`\n**[👉 ${variations.cta_button_label}](${productUrl})**`);

  return sections.join('\n');
}
