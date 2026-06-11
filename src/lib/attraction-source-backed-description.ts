export type SourceBackedAttractionDescriptions = {
  shortDesc: string;
  longDesc: string;
};

type DescriptionInput = {
  name: string;
  aliases?: string[] | null;
  examples?: string[] | null;
  region?: string | null;
};

const KNOWN_DESCRIPTIONS: Array<{
  match: string[];
  shortDesc: string;
  longDesc: string;
}> = [
  {
    match: ['비암산일송정', '비암산 일송정', '일송정'],
    shortDesc: '독립의식을 고취하는 상징 명소',
    longDesc: '비암산 일송정은 용정 일대에서 독립 역사와 민족 정서를 함께 떠올리게 하는 상징적인 관광 포인트입니다. 일정에서는 해란강 차창관광과 함께 둘러보는 역사 명소로 구성됩니다.',
  },
  {
    match: ['윤동주생가', '윤동주 생가'],
    shortDesc: '윤동주 시인의 발자취를 만나는 역사 명소',
    longDesc: '윤동주생가는 윤동주 시인의 삶과 문학적 발자취를 떠올리며 둘러보는 역사 관광지입니다. 용정 지역의 근대사 코스와 함께 소개되는 경우가 많습니다.',
  },
  {
    match: ['명동교회', '명동 교회'],
    shortDesc: '용정 지역 근대사의 흔적을 둘러보는 교회 명소',
    longDesc: '명동교회는 용정 지역의 근대 역사와 함께 소개되는 교회 명소입니다. 윤동주생가 등 주변 역사 코스와 함께 둘러보는 일정으로 구성됩니다.',
  },
  {
    match: ['36호경계비', '36호 경계비'],
    shortDesc: '백두산 남파 코스에서 만나는 접경 경계비',
    longDesc: '36호 경계비는 백두산 남파 일정에서 북한과의 접경 분위기를 느낄 수 있는 경계 지점입니다. 현지 통제와 날씨에 따라 관람 동선은 달라질 수 있습니다.',
  },
  {
    match: ['수목한계선'],
    shortDesc: '고산초원지대의 경계를 볼 수 있는 백두산 포인트',
    longDesc: '수목한계선은 해발이 높아지며 큰 나무가 자라기 어려워지는 고산초원지대의 경계를 보여주는 자연 관찰 포인트입니다. 백두산 고지대 풍경을 이해하기 좋은 일정 요소입니다.',
  },
  {
    match: ['연길민속촌', '연길 민속촌'],
    shortDesc: '연변 조선족 문화와 생활상을 둘러보는 민속 관광지',
    longDesc: '연길민속촌은 연변 지역의 조선족 문화와 생활상을 둘러볼 수 있는 민속 관광지입니다. 지역 분위기와 전통적 요소를 가볍게 체험하는 코스로 활용됩니다.',
  },
];

function compact(value: string): string {
  return value.replace(/\s+/g, '').toLowerCase();
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function sourceExample(examples?: string[] | null): string | null {
  const found = (examples ?? [])
    .map(clean)
    .find(value => value.length >= 4);
  if (!found) return null;
  return found
    .replace(/\s*\([^)]*소요[^)]*\)\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

export function buildSourceBackedAttractionDescriptions(input: DescriptionInput): SourceBackedAttractionDescriptions {
  const labels = [input.name, ...(input.aliases ?? [])].map(compact).filter(Boolean);
  const known = KNOWN_DESCRIPTIONS.find(item => item.match.some(label => labels.includes(compact(label))));
  if (known) {
    return {
      shortDesc: known.shortDesc,
      longDesc: known.longDesc,
    };
  }

  const example = sourceExample(input.examples);
  const region = clean(input.region);
  const regionPrefix = region ? `${region} 일정에서 소개되는` : '일정에서 소개되는';
  const name = clean(input.name) || '관광지';
  const shortDesc = example
    ? example.replace(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), name).slice(0, 60)
    : `${regionPrefix} 관광 포인트`;
  const longDesc = example
    ? `원문 일정에는 "${example}"로 기재된 ${name}입니다. 고객 화면에서는 원문 표현을 기준으로 관광 포인트를 설명하며, 세부 관람 동선은 현지 사정에 따라 달라질 수 있습니다.`
    : `${name}은 ${regionPrefix} 관광 포인트입니다. 자동 생성 설명은 원문 일정과 매칭 결과를 기준으로 제공되며, 사진은 정확한 자료가 확인될 때만 노출됩니다.`;

  return {
    shortDesc,
    longDesc,
  };
}
