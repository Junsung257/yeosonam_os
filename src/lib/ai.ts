import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';

// AI 모델 타입
export type AIModel = 'openai' | 'claude' | 'gemini';

// 여행 상품 데이터 인터페이스
export interface TravelPackage {
  id: string;
  title: string;
  destination: string;
  duration: number;
  price: number;
  description?: string;
  itinerary?: string[];
  inclusions?: string[];
  exclusions?: string[];
  parsedData?: {
    요금: string;
    일정: string;
    써차지: string;
    [key: string]: string;
  };
}

// AI 클라이언트 lazy 초기화
function getOpenAI() {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

function getAnthropic() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

function getGenAI() {
  return new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY || '');
}

// OpenAI로 콘텐츠 생성
async function generateWithOpenAI(packageData: TravelPackage, contentType: string): Promise<string> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OpenAI API 키가 설정되지 않았습니다. .env.local 파일을 확인해주세요.');
  }

  const prompt = createPrompt(packageData, contentType);

  try {
    const completion = await getOpenAI().chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: '당신은 전문 여행 상품 마케팅 전문가입니다. 매력적이고 설득력 있는 여행 상품 설명을 작성해주세요.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      max_tokens: 2000,
      temperature: 0.7,
    });

    return completion.choices[0]?.message?.content || '';
  } catch (error) {
    throw new Error(`OpenAI API 오류: ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
  }
}

// Claude로 콘텐츠 생성
async function generateWithClaude(packageData: TravelPackage, contentType: string): Promise<string> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('Claude API 키가 설정되지 않았습니다. .env.local 파일을 확인해주세요.');
  }

  const prompt = createPrompt(packageData, contentType);

  try {
    const message = await getAnthropic().messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 2000,
      temperature: 0.7,
      system: '당신은 전문 여행 상품 마케팅 전문가입니다. 매력적이고 설득력 있는 여행 상품 설명을 작성해주세요.',
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ],
    });

    return message.content[0]?.type === 'text' ? message.content[0].text : '';
  } catch (error) {
    throw new Error(`Claude API 오류: ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
  }
}

// Gemini로 콘텐츠 생성
// 더미 콘텐츠 생성 (API 키 없을 때 테스트용)
function generateDummyContent(packageData: TravelPackage, contentType: string): string {
  switch (contentType) {
    case 'description':
      return `✨ ${packageData.title}
      
${packageData.destination}의 아름다운 풍경과 문화를 만끽할 수 있는 최고의 여행 상품입니다. ${packageData.duration}일간의 완벽한 여정에서 지역의 숨은 매력과 특색 있는 경험들을 모두 담았습니다.

💰 가격: ${packageData.price.toLocaleString()}원
📅 기간: ${packageData.duration}일
🌍 목적지: ${packageData.destination}

이 상품은 전문 가이드와 함께 ${packageData.destination}의 주요 관광지를 돌아보며, 현지의 음식 문화도 즐길 수 있도록 구성되었습니다. 편안한 숙박과 함께 잊지 못할 추억을 만드세요!`;

    case 'itinerary':
      return `🗓️ ${packageData.title} - ${packageData.duration}일 일정

📍 Day 1: 출발 및 도착
- 출발지에서 비행기 탑승
- ${packageData.destination} 도착
- 호텔 체크인 및 휴식

📍 Day 2: ${packageData.destination} 주요 관광지 탐방
- 아침 식사 후 가이드 미팅
- 현지 주요 명소 투어 (약 4시간)
- 점심 시간 및 자유 시간
- 저녁 현지 음식 체험

${packageData.duration > 3 ? `📍 Day 3: 심화 체험 투어
- 특색 있는 지역 문화 체험
- 현지인과의 교류 프로그램
- 특산품 시장 방문

📍 Day ${packageData.duration}: 귀국
- 호텔 체크아웃
- 공항 이동 및 탑승
- 출발지 도착` : `📍 Day 3: 귀국
- 호텔 체크아웃
- 공항 이동 및 탑승
- 출발지 도착`}`;

    case 'inclusions':
      return `✅ 포함사항
- 왕복 항공료
- ${packageData.duration}박 숙박비 (3성급 호텔 이상)
- 모든 식사비 (조식, 중식, 석식)
- 현지 투어 가이드비
- 입장료 및 체험비
- 여행자 보험

❌ 불포함사항
- 개인 용돈 및 추가 쇼핑비
- 짐 추가 요금
- 개인적인 음료 및 간식
- 가이드 및 기사 팁
- 여권 갱신비`;

    case 'highlights':
      return `🌟 주요 하이라이트 포인트

1️⃣ 현지 문화 체험
${packageData.destination}의 정통 문화를 전문가 가이드와 함께 깊이 있게 경험합니다.

2️⃣ 최고급 숙박시설
편안하고 깨끗한 3성급 이상 호텔에서 휴식을 취할 수 있습니다.

3️⃣ 맛있는 식사
현지의 대표 음식뿐만 아니라 국제적 수준의 요리도 즐길 수 있습니다.

4️⃣ 안전한 여행
경험 많은 가이드와 신뢰할 수 있는 운전기사가 안전한 여행을 보장합니다.

5️⃣ 일정 유연성
여행 중 현지 상황에 따라 일정을 조정할 수 있는 융통성이 있습니다.`;

    default:
      return `${packageData.title}

${packageData.destination}로의 여행은 새로운 문화, 아름다운 자연 풍경, 그리고 현지인들과의 만남을 통해 평생의 추억을 만드는 기회입니다.

📌 기본 정보
- 여행지: ${packageData.destination}
- 기간: ${packageData.duration}일
- 가격: ${packageData.price.toLocaleString()}원

우리의 전문 여행팀이 모든 과정을 세심하게 준비하여, 당신이 쾌적하고 안전하게 여행할 수 있도록 보장합니다.`;
  }
}

// Gemini로 콘텐츠 생성
async function generateWithGemini(packageData: TravelPackage, contentType: string): Promise<string> {
  if (!process.env.GOOGLE_AI_API_KEY) {
    throw new Error('Gemini API 키가 설정되지 않았습니다. .env.local 파일을 확인해주세요.');
  }

  const prompt = createPrompt(packageData, contentType);

  try {
    // 여러 모델 순서대로 시도
    const models = ['gemini-2.5-flash', 'gemini-1.5-flash-001', 'gemini-pro'];
    let lastError = null;

    for (const modelName of models) {
      try {
        const model = getGenAI().getGenerativeModel({ model: modelName });
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();
        return text;
      } catch (error) {
        lastError = error;
        continue;
      }
    }

    // 모든 모델 실패 시 더미 콘텐츠 반환
    console.warn('Gemini 모델 사용 불가, 샘플 콘텐츠 생성');
    return generateDummyContent(packageData, contentType);
  } catch (error) {
    throw new Error(`Gemini API 오류: ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
  }
}

// 프롬프트 생성 함수
function createPrompt(packageData: TravelPackage, contentType: string): string {
  const baseInfo = `
여행 상품 정보:
- 상품명: ${packageData.title}
- 여행지: ${packageData.destination}
- 기간: ${packageData.duration}일
- 가격: ${packageData.price.toLocaleString()}원
${packageData.parsedData ? Object.entries(packageData.parsedData).map(([key, value]) => `- ${key}: ${value}`).join('\n') : ''}
  `.trim();

  switch (contentType) {
    case 'description':
      return `${baseInfo}

위 여행 상품 정보를 바탕으로 매력적인 상품 소개글을 작성해주세요. 200-300자 정도로 작성하고, 여행의 매력과 특별한 경험을 강조해주세요.`;

    case 'itinerary':
      return `${baseInfo}

위 여행 상품 정보를 바탕으로 상세한 일정표를 작성해주세요. 각 날짜별로 어떤 활동을 하는지 구체적으로 설명해주세요.`;

    case 'inclusions':
      return `${baseInfo}

위 여행 상품의 포함사항과 불포함사항을 명확하게 구분해서 작성해주세요.`;

    case 'highlights':
      return `${baseInfo}

위 여행 상품의 주요 하이라이트 포인트 5개를 작성해주세요. 각 포인트는 간단하고 매력적으로 설명해주세요.`;

    default:
      return `${baseInfo}

위 여행 상품 정보를 바탕으로 종합적인 마케팅 콘텐츠를 작성해주세요.`;
  }
}

// 메인 생성 함수
export async function generateContent(
  packageData: TravelPackage,
  contentType: string = 'description',
  model: AIModel = 'openai'
): Promise<string> {
  try {
    switch (model) {
      case 'openai':
        return await generateWithOpenAI(packageData, contentType);
      case 'claude':
        return await generateWithClaude(packageData, contentType);
      case 'gemini':
        return await generateWithGemini(packageData, contentType);
      default:
        throw new Error(`지원하지 않는 AI 모델: ${model}`);
    }
  } catch (error) {
    console.error(`AI 콘텐츠 생성 실패 (${model}):`, error);
    throw new Error(`콘텐츠 생성에 실패했습니다: ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
  }
}

// ─────────────────────────────────────────────────────────
// 광고 카피 변형 생성 (Meta Ads 자동화용)
// platform: 'thread' | 'instagram' | 'blog'
// 각 10개 변형을 JSON 배열로 반환
// ─────────────────────────────────────────────────────────

export interface AdVariant {
  headline?: string;
  body_copy: string;
}

interface AdPackageInput {
  destination: string;
  price: number;
  duration: number;
  product_highlights?: string[];
  inclusions?: string[];
  product_summary?: string;
}

function buildAdSystemPrompt(platform: 'thread' | 'instagram' | 'blog'): string {
  switch (platform) {
    case 'thread':
      return '당신은 Threads(스레드) 플랫폼 전문 광고 카피라이터입니다. 친근하고 대화체의 자연스러운 문체로, 200자 이내 짧은 포스팅을 작성합니다. 억지스러운 광고 느낌 없이 친구에게 추천하듯 써주세요.';
    case 'instagram':
      return '당신은 인스타그램 광고 카피라이터입니다. 눈길을 끄는 후킹 헤드라인과 이모지를 활용한 감성적인 본문을 작성합니다. 헤드라인은 15자 이내, 본문은 150자 이내로 작성해주세요.';
    case 'blog':
      return '당신은 SEO 최적화 블로그 광고 콘텐츠 전문가입니다. 검색 키워드를 자연스럽게 포함하고, 여행 정보와 혜택을 상세히 설명하는 300-500자의 블로그 포스팅을 작성합니다.';
  }
}

function buildAdUserPrompt(pkg: AdPackageInput, platform: 'thread' | 'instagram' | 'blog'): string {
  const info = `
여행 상품 정보:
- 목적지: ${pkg.destination}
- 기간: ${pkg.duration}일
- 가격: ${pkg.price.toLocaleString()}원
${pkg.product_highlights?.length ? `- 주요 특징: ${pkg.product_highlights.slice(0, 3).join(', ')}` : ''}
${pkg.inclusions?.length ? `- 포함 내역: ${pkg.inclusions.slice(0, 3).join(', ')}` : ''}
${pkg.product_summary ? `- 요약: ${pkg.product_summary}` : ''}
`.trim();

  const formatInstructions =
    platform === 'instagram'
      ? '반드시 아래 JSON 배열 형식으로 10개를 반환하세요 (헤드라인 + 본문 포함):\n[{"headline":"...", "body_copy":"..."},...]\n다른 텍스트 없이 JSON만 반환하세요.'
      : '반드시 아래 JSON 배열 형식으로 10개를 반환하세요:\n[{"body_copy":"..."},...]\n다른 텍스트 없이 JSON만 반환하세요.';

  return `${info}\n\n위 상품 정보를 바탕으로 ${platform} 플랫폼용 광고 카피 10종을 생성해주세요.\n${formatInstructions}`;
}

function parseAdVariantsFromText(text: string): AdVariant[] {
  // JSON 파싱 시도
  try {
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.slice(0, 10).map((item, i) => ({
          headline: item.headline ?? undefined,
          body_copy: item.body_copy ?? item.text ?? `변형 ${i + 1}`,
        }));
      }
    }
  } catch { /* fallback */ }

  // 줄바꿈 기반 폴백 파싱
  const lines = text.split('\n').filter(l => l.trim().length > 10);
  return lines.slice(0, 10).map((line, i) => ({
    body_copy: line.replace(/^\d+[.)\s]+/, '').trim() || `변형 ${i + 1}`,
  }));
}

export async function generateAdVariants(
  pkg: AdPackageInput,
  platform: 'thread' | 'instagram' | 'blog',
  model: AIModel = 'openai'
): Promise<AdVariant[]> {
  const systemPrompt = buildAdSystemPrompt(platform);
  const userPrompt = buildAdUserPrompt(pkg, platform);

  let rawText = '';

  try {
    switch (model) {
      case 'openai': {
        const completion = await getOpenAI().chat.completions.create({
          model: 'gpt-4o',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          max_tokens: 3000,
          temperature: 0.7,
        });
        rawText = completion.choices[0]?.message?.content ?? '';
        break;
      }
      case 'claude': {
        const msg = await getAnthropic().messages.create({
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 3000,
          temperature: 0.7,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
        });
        rawText = msg.content[0]?.type === 'text' ? msg.content[0].text : '';
        break;
      }
      case 'gemini': {
        const models = ['gemini-2.5-flash', 'gemini-1.5-flash-001', 'gemini-pro'];
        for (const m of models) {
          try {
            const genModel = getGenAI().getGenerativeModel({ model: m });
            const result = await genModel.generateContent(`${systemPrompt}\n\n${userPrompt}`);
            rawText = result.response.text();
            break;
          } catch { continue; }
        }
        break;
      }
    }
  } catch (error) {
    throw new Error(`광고 카피 생성 실패 (${model}/${platform}): ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
  }

  return parseAdVariantsFromText(rawText);
}

// 여러 모델로 동시에 생성 (비교용)
export async function generateContentComparison(
  packageData: TravelPackage,
  contentType: string = 'description'
): Promise<Record<AIModel, string>> {
  const results: Partial<Record<AIModel, string>> = {};

  const models: AIModel[] = ['openai', 'claude', 'gemini'];

  await Promise.allSettled(
    models.map(async (model) => {
      try {
        results[model] = await generateContent(packageData, contentType, model);
      } catch (error) {
        results[model] = `생성 실패: ${error instanceof Error ? error.message : '알 수 없는 오류'}`;
      }
    })
  );

  return results as Record<AIModel, string>;
}

// ─── 마케팅 카피 자동 생성 (Human-in-the-loop 승인 시스템용) ─────────────────

export interface MarketingCopy {
  type: '감성형' | '신뢰형' | '희소성형';
  title: string;    // 30자 이내
  summary: string;  // 80자 이내
  selected?: boolean;
}

interface MarketingCopyParams {
  destination: string;
  duration: number;
  price: number;
  highlights: string[];
  inclusions: string[];
  rawText: string;     // 문서 원문 (셀링포인트 추출용, 최대 3000자)
}

const MARKETING_SYSTEM_PROMPT = `당신은 대한민국 최고의 여행 B2C 마케터입니다.
반드시 유효한 JSON만 반환하세요. 다른 텍스트, 설명, 마크다운 코드블록 일절 금지.

[절대 원칙 — 위반 시 카피 무효]
1. 브랜드 블라인드: 공급사/랜드사명을 삭제하고 반드시 '여소남'으로 고정
2. 금지어: '원가', '원가 기반', '랜드사', '현지여행사' 및 실제 랜드사명 절대 금지
3. 셀링포인트: 제공된 데이터(호텔명, 핵심 관광지, 항공사 등)를 1개 이상 구체적으로 언급.
   "잊지 못할 추억", "특별한 여행", "아름다운 경험" 같은 클리셰 금지.

[반환 JSON 형식 — 정확히 이 구조만]
{
  "marketing_copies": [
    { "type": "감성형",   "title": "30자 이내 감성적 헤드카피", "summary": "80자 이내 감성 설명" },
    { "type": "신뢰형",   "title": "30자 이내 신뢰감 강조 헤드카피", "summary": "80자 이내 신뢰 설명" },
    { "type": "희소성형", "title": "30자 이내 한정성 강조 헤드카피", "summary": "80자 이내 희소성 설명" }
  ]
}`;

function buildMarketingUserPrompt(params: MarketingCopyParams): string {
  const fmt = (n: number) => n.toLocaleString('ko-KR');
  return `아래 여행 상품 데이터를 분석해 마케팅 카피 3종을 생성하세요.

[상품 기본 정보]
- 목적지: ${params.destination}
- 여행 기간: ${params.duration}일
- 판매가: ${fmt(params.price)}원~/인
- 하이라이트: ${params.highlights.length > 0 ? params.highlights.join(', ') : '(없음)'}
- 포함 사항: ${params.inclusions.slice(0, 5).join(', ') || '(없음)'}

[원본 상품 자료 (셀링포인트 추출용)]
${params.rawText.slice(0, 3000)}`;
}

/** AI 생성 실패 시 관리자가 수동 편집할 수 있도록 반환하는 기본 카피 세트 */
function fallbackCopies(destination: string): MarketingCopy[] {
  const dest = destination || '여행지';
  return [
    {
      type: '감성형',
      title: `${dest} 여행 — 제목을 입력하세요`,
      summary: 'AI 생성 지연 — 직접 입력하세요.',
      selected: false,
    },
    {
      type: '신뢰형',
      title: `${dest} 패키지 — 제목을 입력하세요`,
      summary: 'AI 생성 지연 — 직접 입력하세요.',
      selected: false,
    },
    {
      type: '희소성형',
      title: `${dest} 한정 특가 — 제목을 입력하세요`,
      summary: 'AI 생성 지연 — 직접 입력하세요.',
      selected: false,
    },
  ];
}

/**
 * Gemini를 사용해 3컨셉 마케팅 카피를 생성합니다.
 * API 키 미설정 또는 오류 시 수동 편집 가능한 기본 카피 1세트 반환 (파이프라인 비중단).
 */
export async function generateMarketingCopies(
  params: MarketingCopyParams,
): Promise<MarketingCopy[]> {
  if (!process.env.GOOGLE_AI_API_KEY) {
    console.warn('[generateMarketingCopies] GOOGLE_AI_API_KEY 미설정 — 기본 카피 반환');
    return fallbackCopies(params.destination);
  }

  try {
    const model = getGenAI().getGenerativeModel({ model: 'gemini-2.5-flash' });
    const prompt = MARKETING_SYSTEM_PROMPT + '\n\n' + buildMarketingUserPrompt(params);
    const result = await model.generateContent(prompt);
    const raw = result.response.text()
      .replace(/```json\s*/g, '')
      .replace(/```\s*/g, '')
      .trim();

    const parsed = JSON.parse(raw) as { marketing_copies?: MarketingCopy[] };
    const copies = parsed.marketing_copies;

    if (!Array.isArray(copies) || copies.length === 0) {
      throw new Error('marketing_copies 배열이 없거나 비어있습니다.');
    }

    // 타입 안전 필터링 (필수 필드 보장)
    return copies
      .filter((c): c is MarketingCopy =>
        typeof c.type === 'string' &&
        typeof c.title === 'string' &&
        typeof c.summary === 'string',
      )
      .slice(0, 3)
      .map(c => ({ ...c, selected: false }));

  } catch (err) {
    console.error('[generateMarketingCopies] 생성 실패 — 기본 카피 반환:', err instanceof Error ? err.message : err);
    return fallbackCopies(params.destination);
  }
}