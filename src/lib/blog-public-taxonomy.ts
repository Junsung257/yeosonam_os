export const BLOG_PUBLIC_ANGLES = [
  {
    key: 'value',
    label: '가성비',
    icon: '💰',
    tagline: '합리적인 가격으로 즐기는 알찬 여행',
    chipClass: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
  },
  {
    key: 'luxury',
    label: '럭셔리',
    icon: '✨',
    tagline: '특별한 하루를 위한 프리미엄 여행',
    chipClass: 'bg-amber-50 text-amber-700 border border-amber-200',
  },
  {
    key: 'filial',
    label: '효도',
    icon: '🎁',
    tagline: '부모님과 함께하는 편안한 효도 여행',
    chipClass: 'bg-pink-50 text-pink-700 border border-pink-200',
  },
  {
    key: 'emotional',
    label: '감성',
    icon: '🌸',
    tagline: '잊지 못할 순간을 만드는 감성 여행',
    chipClass: 'bg-purple-50 text-purple-700 border border-purple-200',
  },
  {
    key: 'activity',
    label: '액티비티',
    icon: '🏄',
    tagline: '온몸으로 즐기는 다이내믹한 액티비티 여행',
    chipClass: 'bg-blue-50 text-blue-700 border border-blue-200',
  },
  {
    key: 'food',
    label: '미식',
    icon: '🍜',
    tagline: '현지 입맛으로 즐기는 미식 여행',
    chipClass: 'bg-orange-50 text-orange-700 border border-orange-200',
  },
  {
    key: 'urgency',
    label: '긴급특가',
    icon: '⚡',
    tagline: '출발 조건과 잔여 좌석을 먼저 확인해야 하는 특가 여행',
    chipClass: 'bg-red-50 text-red-700 border border-red-200',
  },
] as const;

export type BlogPublicAngle = (typeof BLOG_PUBLIC_ANGLES)[number]['key'];
export type BlogPublicAngleMeta = (typeof BLOG_PUBLIC_ANGLES)[number];

export const BLOG_PUBLIC_ANGLE_META = Object.fromEntries(
  BLOG_PUBLIC_ANGLES.map((angle) => [angle.key, angle]),
) as Record<string, BlogPublicAngleMeta | undefined>;

export const BLOG_PUBLIC_ANGLE_LABELS: Record<string, string> = Object.fromEntries(
  BLOG_PUBLIC_ANGLES.map((angle) => [angle.key, angle.label]),
);

export const BLOG_PUBLIC_ANGLE_LABELS_WITH_ICON: Record<string, string> = Object.fromEntries(
  BLOG_PUBLIC_ANGLES.map((angle) => [angle.key, `${angle.icon} ${angle.label}`]),
);

export const BLOG_PUBLIC_ANGLE_CHIP_CLASSES: Record<string, string> = Object.fromEntries(
  BLOG_PUBLIC_ANGLES.map((angle) => [angle.key, angle.chipClass]),
);
