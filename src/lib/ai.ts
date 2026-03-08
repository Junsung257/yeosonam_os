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

// AI 클라이언트 초기화
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY || '');

// OpenAI로 콘텐츠 생성
async function generateWithOpenAI(packageData: TravelPackage, contentType: string): Promise<string> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OpenAI API 키가 설정되지 않았습니다. .env.local 파일을 확인해주세요.');
  }

  const prompt = createPrompt(packageData, contentType);

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4-turbo-preview',
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
    const message = await anthropic.messages.create({
      model: 'claude-3-sonnet-20240229',
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
    const models = ['gemini-2.0-flash', 'gemini-1.5-flash-001', 'gemini-pro'];
    let lastError = null;

    for (const modelName of models) {
      try {
        const model = genAI.getGenerativeModel({ model: modelName });
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