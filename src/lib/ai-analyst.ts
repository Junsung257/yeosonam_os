import { generateContent, AIModel } from './ai';
import { getApprovedPackages } from './supabase';

export interface TravelPackage {
  id: string;
  title: string;
  destination: string;
  duration: number;
  price: number;
  itinerary: string[];
  inclusions: string[];
  excludes: string[];
  accommodations: string[];
  special_notes?: string;
  confidence: number;
}

export interface QARecommendation {
  recommendedPackages: (TravelPackage & { score: number; reasons: string[] })[];
  analysis: string;
  advice: string;
}

export interface QAComparison {
  packages: (TravelPackage & { pros: string[]; cons: string[] })[];
  comparison: string;
  recommendation: string;
}

// 여행 패키지에서 특징 추출
function extractPackageFeatures(pkg: TravelPackage): string {
  return `
상품명: ${pkg.title}
목적지: ${pkg.destination}
기간: ${pkg.duration}일
가격: ${pkg.price.toLocaleString()}원
포함사항: ${pkg.inclusions.slice(0, 3).join(', ')}
특징: ${pkg.special_notes || '일반 패키지'}
`;
}

// 질문 키워드 분석
function analyzeQuestionKeywords(
  question: string
): { keywords: string[]; intent: string; budget?: number; duration?: number; destination?: string } {
  const keywords = question.match(/[\uAC00-\uD7A3]+/g) || [];

  let budget: number | undefined;
  let duration: number | undefined;
  let destination: string | undefined;

  // 예산 추출
  const budgetMatch = question.match(/(\d+)\s*만|(\d{6,})\s*원/);
  if (budgetMatch) {
    budget = budgetMatch[1] ? parseInt(budgetMatch[1]) * 10000 : parseInt(budgetMatch[2]);
  }

  // 기간 추출
  const durationMatch = question.match(/(\d+)\s*박\s*(\d+)\s*일|(\d+)\s*일/);
  if (durationMatch) {
    duration = parseInt(durationMatch[2] || durationMatch[3]);
  }

  // 목적지 추출
  const destMatch = question.match(/(오사카|도쿄|홍콩|방콕|싱가포르|괌|하와이|발리|스위스|이탈리아|그리스|미국|유럽)/i);
  if (destMatch) {
    destination = destMatch[1];
  }

  // 의도 분류
  let intent = 'general_consultation';
  if (question.includes('비교') || question.includes('어느')) {
    intent = 'price_comparison';
  } else if (question.includes('추천') || question.includes('추천해')) {
    intent = 'product_recommendation';
  } else if (
    question.includes('가능') ||
    question.includes('가능한') ||
    question.includes('할 수 있')
  ) {
    intent = 'feasibility_check';
  }

  return { keywords, intent, budget, duration, destination };
}

// 패키지와 질문 사이의 관련성 점수 계산
function calculateRelevanceScore(pkg: TravelPackage, question: string, analysis: any): number {
  let score = 0;

  // 목적지 매칭 (가장 중요)
  if (analysis.destination && pkg.destination.includes(analysis.destination)) {
    score += 40;
  }

  // 기간 매칭
  if (analysis.duration) {
    const durationDiff = Math.abs(pkg.duration - analysis.duration);
    score += Math.max(0, 30 - durationDiff * 5);
  }

  // 예산 매칭
  if (analysis.budget) {
    if (pkg.price <= analysis.budget) {
      score += 20;
    } else if (pkg.price <= analysis.budget * 1.1) {
      score += 10; // 약간 오버
    }
  }

  // 키워드 매칭
  const questionLower = question.toLowerCase();
  const titleLower = pkg.title.toLowerCase() + ' ' + pkg.destination.toLowerCase();
  const matchingKeywords = analysis.keywords.filter((kw: string) => titleLower.includes(kw.toLowerCase()));
  score += Math.min(matchingKeywords.length * 5, 10);

  return Math.round(score);
}

// 패키지별 장점/단점 분석
function analyzPackageProsCons(pkg: TravelPackage, question: string): { pros: string[]; cons: string[] } {
  const pros: string[] = [];
  const cons: string[] = [];

  // 가격 대비 평가
  if (pkg.price < 500000) {
    pros.push('경제적인 가격');
  } else if (pkg.price > 2000000) {
    cons.push('상대적으로 높은 가격대');
  }

  // 혜택 평가
  if (pkg.inclusions.length > 5) {
    pros.push('포함사항이 많음');
  }
  if (pkg.excludes.length > 0) {
    cons.push('불포함 사항 확인 필요');
  }

  // 숙박 평가
  if (pkg.accommodations.length > 0 && pkg.accommodations.some((a) => a.includes('5성'))) {
    pros.push('고급 숙박시설');
  }

  // 기간 평가
  if (question.includes('짧') && pkg.duration <= 3) {
    pros.push('짧은 기간 여행에 적합');
  } else if (question.includes('길') && pkg.duration >= 5) {
    pros.push('충분한 여행 기간');
  }

  return { pros, cons };
}

// 추천 패키지 분석
export async function analyzeRecommendation(
  question: string,
  model: AIModel = 'gemini'
): Promise<QARecommendation> {
  const analysis = analyzeQuestionKeywords(question);

  // DB에서 승인된 패키지 조회
  const packages = await getApprovedPackages(analysis.destination);

  if (packages.length === 0) {
    return {
      recommendedPackages: [],
      analysis: '죄송합니다. 현재 요청하신 조건에 맞는 패키지가 없습니다.',
      advice: '다른 목적지나 기간을 검토해보시거나, 직접 상담을 받으시길 권장합니다.',
    };
  }

  // 패키지 관련성 점수 계산
  const scoredPackages = packages.map((pkg: TravelPackage) => ({
    ...pkg,
    score: calculateRelevanceScore(pkg, question, analysis),
    reasons: [
      `목적지: ${pkg.destination}`,
      `기간: ${pkg.duration}일`,
      `가격: ${pkg.price.toLocaleString()}원`,
    ],
  }));

  // 점수 순으로 정렬
  const recommendedPackages = scoredPackages
    .sort((a: any, b: any) => b.score - a.score)
    .slice(0, 3);

  // AI를 사용한 상세 분석
  const packagesSummary = recommendedPackages
    .map(
      (pkg: any) =>
        `${pkg.title} (점수: ${pkg.score}/100) - ${pkg.destination} ${pkg.duration}일 \
      가격: ${pkg.price.toLocaleString()}원`
    )
    .join('\n');

  const analysisPrompt = `
사용자의 여행 문의: "${question}"

추천 패키지들:
${packagesSummary}

위 패키지들이 사용자의 요구사항에 얼마나 적합한지 상세히 분석해주세요.
각 패키지별 강점과 약점을 설명하고, 최종 추천 이유를 제시해주세요.`;

  const analysis_text = await generateContent(
    {
      id: 'analysis',
      title: '여행 추천 분석',
      destination: analysis.destination || '',
      duration: analysis.duration || 0,
      price: 0,
      parsedData: {
        요금: '미정',
        일정: analysis.duration?.toString() || '0일',
        써차지: '',
      },
    },
    'description',
    model
  );

  const advicePrompt = `
여행 문의: "${question}"

위 문의에 대해 여행 전문가로서 다음을 제공해주세요:
1. 여행 시기에 대한 조언
2. 예상 비용 및 예산 관리 팁
3. 준비물 및 주의사항
4. 추가적으로 고려할 사항`;

  const advice = await generateContent(
    {
      id: 'advice',
      title: '여행 전문 조언',
      destination: analysis.destination || '',
      duration: analysis.duration || 0,
      price: 0,
      parsedData: {
        요금: '미정',
        일정: analysis.duration?.toString() || '0일',
        써차지: '',
      },
    },
    'description',
    model
  );

  return {
    recommendedPackages,
    analysis: analysis_text,
    advice,
  };
}

// 패키지 비교 분석
export async function analyzeComparison(
  packageIds: string[],
  model: AIModel = 'gemini'
): Promise<QAComparison> {
  const packages = await getApprovedPackages();
  const selectedPackages = (packages as TravelPackage[]).filter((pkg) => packageIds.includes(pkg.id)).slice(0, 3);

  if (selectedPackages.length === 0) {
    throw new Error('선택한 패키지를 찾을 수 없습니다.');
  }

  // 각 패키지의 장단점 분석
  const packagesWithAnalysis = selectedPackages.map((pkg: TravelPackage) => ({
    ...pkg,
    ...analyzPackageProsCons(pkg, ''),
  }));

  // AI를 사용한 상세 비교
  const comparisonPrompt = `
다음 여행 패키지들을 상세히 비교해주세요:

${packagesWithAnalysis
  .map(
    (pkg) =>
      `패키지: ${pkg.title}
목적지: ${pkg.destination} / 기간: ${pkg.duration}일 / 가격: ${pkg.price.toLocaleString()}원
포함: ${pkg.inclusions.slice(0, 2).join(', ')}
장점: ${pkg.pros.join(', ')}
단점: ${pkg.cons.join(', ')}`
  )
  .join('\n\n')}

각 패키지의 가성비, 경험의 다양성, 휴식, 액티비티 관점에서 비교분석해주세요.`;

  const comparison = await generateContent(
    {
      id: 'comparison',
      title: '패키지 비교',
      destination: '',
      duration: 0,
      price: 0,
      parsedData: {
        요금: '미정',
        일정: '0일',
        써차지: '',
      },
    },
    'description',
    model
  );

  const recommendationPrompt = `
위 비교 분석을 바탕으로, 다음을 고려한 최종 추천을 해주세요:
1. 가성비 최고: 어느 패키지인가?
2. 휴식 원하면: 어느 패키지?
3. 액티비티 원하면: 어느 패키지?
4. 당신의 최고 추천: 왜?`;

  const recommendation = await generateContent(
    {
      id: 'rec',
      title: '추천',
      destination: '',
      duration: 0,
      price: 0,
      parsedData: {
        요금: '미정',
        일정: '0일',
        써차지: '',
      },
    },
    'description',
    model
  );

  return {
    packages: packagesWithAnalysis,
    comparison,
    recommendation,
  };
}

// 일반 상담 (전문가 조언)
export async function getConsultationAdvice(question: string, model: AIModel = 'gemini'): Promise<string> {
  const analysis = analyzeQuestionKeywords(question);

  // 관련 패키지 정보 포함
  const packages = (await getApprovedPackages(analysis.destination)) as TravelPackage[];
  const packageInfo =
    packages.length > 0
      ? `참고할 수 있는 유사 패키지들:\n${packages
          .slice(0, 3)
          .map((p: TravelPackage) => `- ${p.title} (${p.price.toLocaleString()}원)`)
          .join('\n')}`
      : '';

  const consultationPrompt = `
고객 문의: "${question}"

${packageInfo}

위 문의에 대해 여행 전문가로서 다음을 포함한 상담을 제공해주세요:
1. 문의 내용에 대한 정확한 이해 및 조언
2. 고려할 사항들
3. 추천하는 접근 방식
4. 추가 정보 또는 준비물`;

  return generateContent(
    {
      id: 'consultation',
      title: '여행 상담',
      destination: analysis.destination || '',
      duration: analysis.duration || 0,
      price: 0,
      parsedData: {
        요금: '미정',
        일정: analysis.duration?.toString() || '0일',
        써차지: '',
      },
    },
    'description',
    model
  );
}