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
// Gemini로 콘텐츠 생성
async function generateWithGemini(packageData: TravelPackage, contentType: string): Promise<string> {
  if (!process.env.GOOGLE_AI_API_KEY) {
    throw new Error('Gemini API 키가 설정되지 않았습니다. .env.local 파일을 확인해주세요.');
  }

  const model = genAI.getGenerativeModel({ model: 'gemini-pro' });
  const prompt = createPrompt(packageData, contentType);

  try {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    return text;
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