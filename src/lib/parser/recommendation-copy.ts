import { isRealPerk } from '@/lib/render-contract';

interface CopyInput {
  title?: string | null;
  destination?: string | null;
  duration?: number | null;
  trip_style?: string | null;
  departure?: string | null;
  product_type?: string | null;
  inclusions?: string[] | null;
  product_highlights?: string[] | null;
  airline?: string | null;
}

const INTERNAL_COPY_PATTERN = /(배포|선발특가|스팟특가|초특가|특가\s*배포|\d{1,2}\s*\/\s*까지)/g;

function cleanText(value: string | null | undefined): string {
  return String(value ?? '')
    .replace(INTERNAL_COPY_PATTERN, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatDuration(input: CopyInput): string | null {
  const tripStyle = cleanText(input.trip_style);
  if (tripStyle && tripStyle !== 'UNK') return tripStyle;
  if (input.duration && input.duration > 0) return `${input.duration}일`;
  return null;
}

function labelDestination(input: CopyInput): string {
  const dest = cleanText(input.destination);
  if (dest && dest !== 'UNK') return dest;

  const title = cleanText(input.title);
  const firstToken = title.split(/\s+/).find(token => token && !/^(BX|KE|LJ|TW|7C|ZE|OZ)$/i.test(token));
  return firstToken || '여행지';
}

function eulReul(value: string): string {
  const last = value.charCodeAt(value.length - 1);
  if (last < 0xac00 || last > 0xd7a3) return `${value}을(를)`;
  return `${value}${(last - 0xac00) % 28 === 0 ? '를' : '을'}`;
}

function pickHighlights(input: CopyInput): string[] {
  const out: string[] = [];
  if (input.product_highlights && input.product_highlights.length > 0) {
    out.push(...input.product_highlights.map(cleanText).filter(Boolean).slice(0, 2));
  }
  if (out.length < 2 && input.inclusions) {
    const perks = input.inclusions
      .map(cleanText)
      .filter(s => s && isRealPerk(s))
      .slice(0, 2 - out.length);
    out.push(...perks);
  }
  return out;
}

function haystack(input: CopyInput): string {
  return [
    input.title,
    input.destination,
    input.product_type,
    input.airline,
    ...(input.product_highlights ?? []),
    ...(input.inclusions ?? []),
  ]
    .map(cleanText)
    .join(' ');
}

function isGolf(input: CopyInput): boolean {
  return /(골프|라운딩|\bCC\b|C\.C|golf)/i.test(haystack(input));
}

function isFerry(input: CopyInput): boolean {
  const type = cleanText(input.product_type).toLowerCase();
  return type === 'cruise' || type === 'ferry' || /(훼리|페리|선박|배편|크루즈|부관훼리)/.test(haystack(input));
}

function isOnsen(input: CopyInput): boolean {
  return /(온천|료칸|유노하나|벳부|쿠로가와|노천탕)/.test(haystack(input));
}

function extractGolfStayPhrase(input: CopyInput): string | null {
  const dest = labelDestination(input);
  const tokens = cleanText(input.title)
    .split(/\s+/)
    .filter(token => token && token !== dest && !/^(BX|KE|LJ|TW|7C|ZE|OZ|에어부산|대한항공|진에어|티웨이|제주항공)$/i.test(token));

  const idx = tokens.findIndex(token => /(골프텔|골프장|리조트|호텔|\bCC\b|C\.C)/i.test(token));
  if (idx >= 0) {
    return tokens.slice(Math.max(0, idx - 1), idx + 1).join(' ');
  }

  const fromHighlights = pickHighlights(input).find(item => /(골프텔|골프장|리조트|호텔|\bCC\b|C\.C)/i.test(item));
  if (fromHighlights) return fromHighlights.replace(/[.,]?\s*(포함|이용|숙박).*$/g, '').trim();

  return null;
}

function joinLines(lines: string[]): string {
  return lines.map(line => line.trim()).filter(Boolean).join('\n\n');
}

export function generateRecommendationCopy(input: CopyInput): string {
  const destination = labelDestination(input);
  const duration = formatDuration(input);
  const highlights = pickHighlights(input);

  if (isGolf(input)) {
    const stay = extractGolfStayPhrase(input) ?? `${destination} 골프텔`;
    return joinLines([
      `⛳ 골프를 중심으로 ${eulReul(destination)} 편하게 즐기고 싶은 분께 좋은 일정입니다.`,
      `🏨 ${stay}에 머물며 라운딩 동선을 줄이고, 남는 시간은 휴식에 집중할 수 있어요.`,
      `🌴 ${duration ? `${duration} 안에서도` : '짧은 일정 안에서도'} 라운딩과 리조트형 휴식을 함께 기대할 수 있는 ${destination} 골프 여행입니다.`,
    ]);
  }

  if (isFerry(input)) {
    const carrier = cleanText(input.airline);
    return joinLines([
      `🛳️ ${carrier ? `${carrier}로 ` : ''}${destination}까지 이동하는 순간부터 여행 분위기를 느낄 수 있는 일정입니다.`,
      `🧭 ${highlights[0] ? `${highlights[0]} 등` : '대표 코스와 이동 동선'}을 일정표 흐름에 맞춰 둘러보도록 구성했어요.`,
      `🌊 ${duration ? `${duration} 동안` : '짧은 일정에도'} 부담을 줄이고 핵심 경험에 집중할 수 있는 ${destination} 여행입니다.`,
    ]);
  }

  if (isOnsen(input)) {
    return joinLines([
      `♨️ ${destination}의 온천과 주요 관광을 함께 즐기고 싶은 분께 잘 맞는 일정입니다.`,
      `🏨 ${highlights[0] ? `${highlights[0]}을 중심으로` : '숙박과 이동 흐름을'} 여행 피로를 줄이는 방향으로 구성했어요.`,
      `🌿 ${duration ? `${duration} 동안` : '여행 중'} 관광과 휴식을 균형 있게 기대할 수 있는 ${destination} 여행입니다.`,
    ]);
  }

  return joinLines([
    `✈️ ${eulReul(destination)} 처음 방문해도 일정 흐름을 따라가기 쉬운 패키지입니다.`,
    `📍 ${highlights[0] ? `${highlights[0]} 등 핵심 포인트를` : '대표 관광지와 이동 동선을'} 하루별 일정에 맞춰 둘러보도록 구성했어요.`,
    `🌿 ${duration ? `${duration} 동안` : '여행 중'} 관광, 식사, 이동이 자연스럽게 이어지는 ${destination} 여행을 기대할 수 있습니다.`,
  ]);
}

export function isWeakCopy(copy: string | null | undefined, title?: string | null): boolean {
  const rawCopy = String(copy ?? '');
  if (INTERNAL_COPY_PATTERN.test(rawCopy)) {
    INTERNAL_COPY_PATTERN.lastIndex = 0;
    return true;
  }
  INTERNAL_COPY_PATTERN.lastIndex = 0;

  const cleanCopy = cleanText(copy);
  if (!cleanCopy || cleanCopy.length < 20) return true;
  if (/현지에서\s*따로\s*드는\s*비용|상담\s*때\s*.*정리/.test(cleanCopy)) return true;
  if (/^[가-힣A-Za-z0-9\s/·+-]+패키지\s*여행$/.test(cleanCopy)) return true;

  const cleanTitle = cleanText(title);
  if (cleanTitle && cleanCopy.includes(cleanTitle) && cleanCopy.length < cleanTitle.length + 35) {
    return true;
  }

  return false;
}
