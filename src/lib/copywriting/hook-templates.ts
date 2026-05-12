/**
 * Hook Templates Library — 한국형 카피 검증 사례 기반
 *
 * 6 angle × 5 trigger = 30 템플릿. blog-publisher / bulk-generate / card-news-copywriter
 * 가 prompt 에 후킹 후보로 주입한다. EPR(blog-few-shot)이 "성과 좋은 후킹"만 살아남도록
 * compound learning 강화하는 입력 시드.
 *
 * 검증 출처:
 *   - 무신사·컬리·야놀자·여기어때 1군 커머스 후킹 패턴
 *   - 2025 트립스토어 효도/2030 패키지 후킹 데이터
 *   - 첫 200자 트리거 5종(숫자/질문/시간/비교/고민) — Hook 게이트(blog-quality-gate.checkHook)와 동일 분류
 *
 * 데이터 무결성:
 *   - placeholder 만 정의 ({dest}, {dur}, {priceMan}, {nightCount}, {savingMan}…)
 *   - LLM 이 placeholder 를 채우되, 원문에 없는 수치는 "약 ~" 추정 표기 강제
 */

import type { AngleType } from '@/lib/content-generator';

// AngleType 외에 카드뉴스/마케팅 콘텐츠에서 쓰는 추가 angle 도 수용
export type HookAngle =
  | 'value'      // 가성비
  | 'emotional'  // 감성·로맨틱
  | 'filial'     // 효도
  | 'luxury'     // 럭셔리
  | 'urgency'    // 희소성·마감
  | 'activity'   // 액티비티·체험
  | 'food'       // 미식
  | 'family'     // 가족·아이동반
  | 'noshopping' // 노쇼핑
  | 'twozero';   // 2030·혼행/소셜

export type HookTrigger = 'number' | 'question' | 'time' | 'compare' | 'pain';

export interface HookTemplate {
  angle: HookAngle;
  trigger: HookTrigger;
  /** placeholders: {dest} {dur} {priceMan} {savingMan} {nightCount} {airline} {departure} */
  template: string;
  /** 어떤 상품 메타가 있어야 적용 가능한지 — 부족하면 LLM이 다른 trigger 선택 */
  requires?: Array<'priceMan' | 'savingMan' | 'airline' | 'duration'>;
}

export const HOOK_TEMPLATES: HookTemplate[] = [
  // ─── value (가성비) ─────────────────────────────────────────
  {
    angle: 'value', trigger: 'compare',
    template: '같은 일정 직접 잡으면 약 {comparePriceMan}만원, 여소남 패키지는 {priceMan}만원~ — {savingMan}만원 차이를 어디서 만들었는지 풀어드립니다.',
    requires: ['priceMan'],
  },
  {
    angle: 'value', trigger: 'number',
    template: '{dur} {dest} 패키지가 {priceMan}만원대로 가능한 진짜 이유 3가지.',
    requires: ['priceMan', 'duration'],
  },
  {
    angle: 'value', trigger: 'question',
    template: '"{dest} {dur}이 정말 {priceMan}만원대?" — 가격 분해해서 보여드릴게요.',
    requires: ['priceMan', 'duration'],
  },
  {
    angle: 'value', trigger: 'time',
    template: '항공·호텔·일정 직접 짜는 데 평균 12시간. 같은 결과를 5분 안에 받아보는 방법.',
  },
  {
    angle: 'value', trigger: 'pain',
    template: '"{dest} 단품으로 잡았다가 호텔만 80만원 더 나간" 케이스, 패키지 한 번에 막아드립니다.',
  },

  // ─── emotional (감성·신혼) ──────────────────────────────────
  {
    angle: 'emotional', trigger: 'time',
    template: '체크인 30분 만에 발코니 욕조에서 마주하는 첫 일몰 — {dur} 중 가장 오래 기억되는 순간.',
  },
  {
    angle: 'emotional', trigger: 'compare',
    template: '"휴양 70% + 관광 30% 황금비" — 신혼여행 후기에서 가장 많이 나온 비율로 일정을 짰습니다.',
  },
  {
    angle: 'emotional', trigger: 'question',
    template: '"신혼인데 풀빌라 1박 vs 시티뷰 4박, 무엇이 더 기억에 남나요?" — 200쌍 후기의 답.',
  },
  {
    angle: 'emotional', trigger: 'number',
    template: '{dest} 신혼여행 다녀온 200쌍 평점 4.8/5 — 이 코스가 사랑받은 이유.',
  },
  {
    angle: 'emotional', trigger: 'pain',
    template: '신혼 일정 짜다 첫 싸움하는 커플 흔합니다. 의사결정 줄여주는 패키지 코스 그대로.',
  },

  // ─── filial (효도) ──────────────────────────────────────────
  {
    angle: 'filial', trigger: 'pain',
    template: '"부모님 무릎 때문에 못 가신다더라" — 1일 보행 1.5km 이하 효도 코스로 짜드렸습니다.',
  },
  {
    angle: 'filial', trigger: 'time',
    template: '하루 이동 4시간 미만, 식사 간격 4시간 이내 — 60대 부모님 컨디션에 맞춘 {dur} 동선.',
    requires: ['duration'],
  },
  {
    angle: 'filial', trigger: 'compare',
    template: '효도 패키지 = "여행 = 강행군"이 아닙니다. 자유여행 일정과 무엇이 다른지 비교해드릴게요.',
  },
  {
    angle: 'filial', trigger: 'question',
    template: '"부모님 처음 해외인데 이 나라 괜찮을까요?" — 화장실·식사·언어까지 점검한 효도용 {dest}.',
  },
  {
    angle: 'filial', trigger: 'number',
    template: '효도 {dest} 다녀온 분들 87%가 "다음에도 같은 패키지" — 어떤 부분이 안심됐는지.',
  },

  // ─── luxury (럭셔리) ────────────────────────────────────────
  {
    angle: 'luxury', trigger: 'number',
    template: '5성급 풀빌라 + 미슐랭 1스타 디너 포함 — 같은 구성 자유여행 견적 약 {comparePriceMan}만원.',
    requires: ['priceMan'],
  },
  {
    angle: 'luxury', trigger: 'time',
    template: '도착 즉시 VIP 라운지, 90분 만에 풀빌라 체크인 — 첫 시간을 줄이는 고급 동선.',
  },
  {
    angle: 'luxury', trigger: 'question',
    template: '"럭셔리 패키지인데 가이드 강제 일정 있나요?" — 자유시간 70% 이상 보장된 코스.',
  },
  {
    angle: 'luxury', trigger: 'compare',
    template: '풀빌라 직접 예약 vs 패키지 — 같은 객실인데 패키지가 더 저렴한 구조 분해.',
  },
  {
    angle: 'luxury', trigger: 'pain',
    template: '"럭셔리 = 가이드와 단체이동" 편견 깨드립니다. 프라이빗 차량 단독 운영 코스만 추렸어요.',
  },

  // ─── urgency (희소성) ──────────────────────────────────────
  {
    angle: 'urgency', trigger: 'time',
    template: '{dest} {monthLabel} 출발 좌석 마지막 N석 — 1주일 안에 마감되는 패턴 반복 중.',
  },
  {
    angle: 'urgency', trigger: 'number',
    template: '같은 호텔 다음 달 가격이 {priceUpPct}% 인상 예정 — 이번 달 출발이 마지막 기회.',
  },
  {
    angle: 'urgency', trigger: 'question',
    template: '"성수기 가격으로 비수기 일정 잡는 법?" — 출발일 1주만 당기면 {savingMan}만원 차이.',
    requires: ['savingMan'],
  },
  {
    angle: 'urgency', trigger: 'compare',
    template: '7월 vs 8월 같은 호텔, 같은 항공 — 가격이 70만원 차이나는 진짜 이유.',
  },
  {
    angle: 'urgency', trigger: 'pain',
    template: '"좌석 있을 때 잡지 그랬어" 매년 듣는 후회. 잔여 좌석 추적해서 알려드립니다.',
  },

  // ─── activity (액티비티) ────────────────────────────────────
  {
    angle: 'activity', trigger: 'number',
    template: '{dest} 인기 액티비티 5종 (스노쿨링·ATV·열기구·서핑·다이빙) 모두 포함하면 1인 50만원? 패키지 비교.',
  },
  {
    angle: 'activity', trigger: 'time',
    template: '아침 8시 스노쿨링, 오후 5시 일몰 ATV — 이동시간 줄이는 동선으로 액티비티 2개 가능.',
  },
  {
    angle: 'activity', trigger: 'compare',
    template: '단품 액티비티 예약 vs 패키지 동시 진행 — 가격·예약 안정성 어디가 유리한가요?',
  },
  {
    angle: 'activity', trigger: 'question',
    template: '"수영 못해도 스노쿨링 되나요?" 같은 60개 자주 묻는 질문, {dest} 액티비티 가이드 한 번에.',
  },
  {
    angle: 'activity', trigger: 'pain',
    template: '액티비티 현장 결제 = 바가지 위험. 한국어 통역 + 한국 카드 결제 가능한 패키지만 골랐습니다.',
  },

  // ─── food (미식) ────────────────────────────────────────────
  {
    angle: 'food', trigger: 'number',
    template: '{dest} 현지인 평점 4.5+ 맛집 12곳 중 패키지 식사로 묶이는 7곳, 비교해드립니다.',
  },
  {
    angle: 'food', trigger: 'time',
    template: '저녁 7시 핫플 맛집은 1시간 대기 — 패키지 6시 예약으로 줄 안 서고 바로 입장.',
  },
  {
    angle: 'food', trigger: 'question',
    template: '"한국에선 못 먹는 {dest} 시그니처 음식 BEST 5?" — 현지인이 진짜 가는 식당.',
  },
  {
    angle: 'food', trigger: 'compare',
    template: '현지 식음료비 가족 4인 기준 약 80만원. 올인클루시브 패키지가 진짜 절약되는지 비교.',
  },
  {
    angle: 'food', trigger: 'pain',
    template: '"메뉴 못 읽어서 사진 보고 시켰는데 먹기 힘든 음식이" — 한국어 메뉴 가능한 식당만 묶었어요.',
  },

  // ─── family (가족) ──────────────────────────────────────────
  {
    angle: 'family', trigger: 'pain',
    template: '"유모차 끌고 갈 수 있나" 가장 많이 받는 질문. 휠 진입 가능한 코스만 정리했습니다.',
  },
  {
    angle: 'family', trigger: 'number',
    template: '아이 만 3~7세 동반 가족 200팀 후기 평균 4.7/5 — {dest} 가족여행 베스트 일정.',
  },
  {
    angle: 'family', trigger: 'time',
    template: '낮잠 시간 13~15시 차량 이동 / 식사 간격 4시간 — 아이 컨디션에 맞춘 {dur} 동선.',
  },
  {
    angle: 'family', trigger: 'question',
    template: '"아이가 비행기 처음인데 어디까지 봐야 할까요?" — 만 7세 미만 동반 패키지 체크리스트.',
  },
  {
    angle: 'family', trigger: 'compare',
    template: '아이 동반 자유여행 vs 패키지 — 어떤 점에서 가족이 덜 피곤한지 18개 항목 비교.',
  },

  // ─── noshopping (노쇼핑) ────────────────────────────────────
  {
    angle: 'noshopping', trigger: 'number',
    template: '쇼핑 0회 보장 / 옵션 강제 0회 — {dest} 패키지 중 자유시간 비중 70% 이상 코스만.',
  },
  {
    angle: 'noshopping', trigger: 'pain',
    template: '"패키지 = 강제 쇼핑" 인식 깨드립니다. 쇼핑 N회 명시된 코스만 골라 정리했어요.',
  },
  {
    angle: 'noshopping', trigger: 'question',
    template: '"가이드 강제 옵션 없는 {dest} 패키지 있을까요?" — 옵션 자율 선택 코스 비교.',
  },
  {
    angle: 'noshopping', trigger: 'compare',
    template: '쇼핑 포함 패키지 vs 노쇼핑 패키지 — 가격·자유시간·만족도 3축 비교.',
  },
  {
    angle: 'noshopping', trigger: 'time',
    template: '관광 4일 중 자유시간 12시간 보장 — 가이드 동선 강제되는 시간을 분 단위로 공개.',
  },

  // ─── twozero (2030·혼행/소셜) ───────────────────────────────
  {
    angle: 'twozero', trigger: 'pain',
    template: '"혼자 가도 어색하지 않을까?" — 2030 패키지에서 친구 만나는 빈도 80% 코스만 모았습니다.',
  },
  {
    angle: 'twozero', trigger: 'number',
    template: '20·30대 단독 참여 비중 60%+ {dest} 패키지 — 출발 전 단톡으로 동행 매칭 자동.',
  },
  {
    angle: 'twozero', trigger: 'question',
    template: '"혼자인데 패키지 가면 룸메 어떻게 정해지나요?" — 2030 혼행 객실 매칭 규정 정리.',
  },
  {
    angle: 'twozero', trigger: 'time',
    template: '평일 출발 / 자유시간 위주 — 직장인 연차 3일로 가능한 {dur} 단기 코스.',
  },
  {
    angle: 'twozero', trigger: 'compare',
    template: '혼행 자유여행 vs 2030 패키지 — 어디서 친구가 생기는지, 어디서 비용이 차이나는지.',
  },
];

/**
 * angle에 해당하는 템플릿 N개 (기본 5개) 픽업.
 * 부족하면 모든 trigger 종류 1개씩 보장.
 */
export function pickHookCandidates(angle: HookAngle, count: number = 5): HookTemplate[] {
  const matches = HOOK_TEMPLATES.filter(t => t.angle === angle);
  if (matches.length === 0) return [];

  // trigger 다양성 확보 — 같은 trigger 중복 최소화
  const seen = new Set<HookTrigger>();
  const picked: HookTemplate[] = [];
  for (const t of matches) {
    if (!seen.has(t.trigger)) {
      seen.add(t.trigger);
      picked.push(t);
      if (picked.length >= count) break;
    }
  }
  // 부족하면 나머지 채움
  if (picked.length < count) {
    for (const t of matches) {
      if (!picked.includes(t)) {
        picked.push(t);
        if (picked.length >= count) break;
      }
    }
  }
  return picked;
}

/**
 * AngleType(blog 7종) → HookAngle 매핑
 */
const ANGLE_TYPE_MAP: Record<AngleType, HookAngle> = {
  value: 'value',
  emotional: 'emotional',
  filial: 'filial',
  luxury: 'luxury',
  urgency: 'urgency',
  activity: 'activity',
  food: 'food',
};

export function mapAngleType(angle: AngleType | string): HookAngle {
  if (angle in ANGLE_TYPE_MAP) return ANGLE_TYPE_MAP[angle as AngleType];
  // 카드뉴스/마케팅 추가 angle
  if (['family', 'noshopping', 'twozero'].includes(angle)) return angle as HookAngle;
  return 'value';  // safe default
}

/**
 * Prompt 주입용 마크다운 블록 — placeholder 보존, LLM이 채우게 함.
 * 빈 배열(매핑 없는 angle) 이면 빈 문자열.
 */
export function formatHookCandidatesBlock(
  angle: AngleType | HookAngle | string,
  options?: { count?: number; label?: string },
): string {
  const ha = mapAngleType(angle);
  const candidates = pickHookCandidates(ha, options?.count ?? 5);
  if (candidates.length === 0) return '';

  const label = options?.label ?? `📌 후킹 후보 (${ha} angle)`;
  const lines = candidates.map((t, i) =>
    `${i + 1}. [${t.trigger}] ${t.template}${t.requires ? ` _(필요 데이터: ${t.requires.join(', ')})_` : ''}`,
  );

  return `\n## ${label}
아래 5개 후킹 후보 중 **현재 상품 데이터에 가장 자연스러운 1개를 골라 도입부 첫 200자에 박제**하세요.
placeholder({dest}/{dur}/{priceMan}/{savingMan} 등)는 실제 값으로 치환. 원문에 없는 수치는 "약 ~" 추정 표기로 명시.

${lines.join('\n')}

— 위 후보를 베끼지 말고, **1개 골라 현재 상품 디테일을 박아넣은 자연스러운 첫 문장**으로 변주하세요.
`;
}
