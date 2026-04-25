/**
 * @file seasonal.ts — 한국 여행 시즌 사전
 *
 * 월별 트렌드/감정 키워드. 시즈널 cron 에서 자동 카드뉴스 생성 시 toneHint 로 주입.
 * 사장님이 가이드 추가/조정할 수 있도록 단일 export 로 분리.
 */

export interface SeasonalContext {
  month: number;            // 1-12
  themes: string[];         // 검색 트렌드 키워드
  toneHint: string;         // generate.ts toneHint 로 주입
  preferredAngles: Array<
    'luxury' | 'value' | 'urgency' | 'emotional' | 'filial' | 'activity' | 'food'
  >;
}

const CALENDAR: Record<number, Omit<SeasonalContext, 'month'>> = {
  1: {
    themes: ['겨울 휴가', '신년 선물 여행', '온천', '눈 풍경'],
    toneHint: '신년 새출발 · 겨울 따뜻함 · 가족 함께',
    preferredAngles: ['emotional', 'filial', 'luxury'],
  },
  2: {
    themes: ['졸업 여행', '입학 선물', '설 연휴 여행'],
    toneHint: '시작과 축하 · 학생/가족 첫 해외',
    preferredAngles: ['emotional', 'value', 'activity'],
  },
  3: {
    themes: ['벚꽃', '봄 휴가', '꽃놀이', '신혼여행 시즌'],
    toneHint: '봄 설렘 · 벚꽃 · 신혼 · 부드러운 톤',
    preferredAngles: ['emotional', 'luxury', 'value'],
  },
  4: {
    themes: ['황금연휴 준비', '5월 가족여행', '벚꽃 막바지'],
    toneHint: '5월 연휴 임박 · 가족 단합 · 빠른 결정',
    preferredAngles: ['urgency', 'filial', 'value'],
  },
  5: {
    themes: ['초여름', '가족여행', '어린이날 선물 여행', '신혼여행'],
    toneHint: '초여름 가족 · 어린이날 · 부모님 효도',
    preferredAngles: ['filial', 'emotional', 'activity'],
  },
  6: {
    themes: ['여름휴가 예약', '얼리버드', '바다·휴양지'],
    toneHint: '여름 휴가 사전 예약 · 얼리버드 혜택',
    preferredAngles: ['value', 'urgency', 'emotional'],
  },
  7: {
    themes: ['여름성수기', '동남아 우기 회피', '시원한 휴양지'],
    toneHint: '한여름 무더위 탈출 · 가족 휴가 절정',
    preferredAngles: ['emotional', 'luxury', 'activity'],
  },
  8: {
    themes: ['휴가 막바지', '늦여름 휴양', '가을 사전 예약'],
    toneHint: '여름 막바지 · 가을 얼리버드 시작',
    preferredAngles: ['urgency', 'value', 'emotional'],
  },
  9: {
    themes: ['추석 연휴', '가을 단풍 사전', '효도 여행'],
    toneHint: '추석 가족 모임 · 부모님 모시고 · 가을 시작',
    preferredAngles: ['filial', 'emotional', 'luxury'],
  },
  10: {
    themes: ['단풍', '가을 절정', '하이킹', '문화 여행'],
    toneHint: '단풍 절정 · 가을 정취 · 어르신 동반 추천',
    preferredAngles: ['filial', 'emotional', 'activity'],
  },
  11: {
    themes: ['따뜻한 휴양지', '겨울 이른 예약', '연말 보너스 여행'],
    toneHint: '추위 시작 · 따뜻한 동남아 · 연말 휴식',
    preferredAngles: ['luxury', 'emotional', 'value'],
  },
  12: {
    themes: ['연말연시', '크리스마스 마켓', '신혼여행', '오로라'],
    toneHint: '연말 분위기 · 신혼 · 특별한 추억 · 오로라/유럽',
    preferredAngles: ['luxury', 'emotional', 'urgency'],
  },
};

export function getSeasonalContext(date: Date = new Date()): SeasonalContext {
  const month = date.getMonth() + 1;
  return { month, ...CALENDAR[month] };
}

/**
 * 카드뉴스 시드 텍스트 — 원문 없이 시즈널 정보만으로 생성할 때 사용.
 */
export function buildSeasonalSeed(
  context: SeasonalContext,
  productHint?: { destination?: string; nights?: number; price?: number },
): string {
  const lines: string[] = [];
  lines.push(`# ${context.month}월 시즈널 트렌드`);
  lines.push(`테마: ${context.themes.join(', ')}`);
  lines.push(`톤 가이드: ${context.toneHint}`);
  lines.push('');
  if (productHint?.destination) {
    lines.push(`이번 호 추천 목적지: ${productHint.destination}`);
  }
  if (productHint?.nights) {
    lines.push(`기간: ${productHint.nights}박`);
  }
  if (productHint?.price) {
    lines.push(`가격대: ${productHint.price.toLocaleString('ko-KR')}원~`);
  }
  return lines.join('\n');
}
