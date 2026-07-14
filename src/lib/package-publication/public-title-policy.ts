type AnyRecord = Record<string, unknown>;

const RISKY_TITLE_WORDS =
  /(출발\s*확정|출확|즉시\s*확정|좌석\s*확보|예약\s*즉시\s*확보|최저가\s*보장|마감\s*임박|긴급\s*특가|스팟\s*특가)/gi;

const INTERNAL_SUPPLIER_WORDS =
  /\b(?:LJ|BX|TW|ZE|7C|OZ|KE|RS|PKG|TL|NET|RMK|P\.?P\.?)\b|\[[^\]]*\]|\([^)]*(?:발권|스팟|특가|마감|TL)[^)]*\)/gi;

const KNOWN_DESTINATION_ALIASES: Array<[RegExp, string]> = [
  [/홍콩/, '홍콩'],
  [/마카오/, '마카오'],
  [/연길|백두산|장백산/, '연길·백두산'],
  [/다낭.*호이안|호이안.*다낭|다낭\s*[/+·]\s*호이안/, '다낭·호이안'],
  [/나트랑.*달랏|달랏.*나트랑|나트랑\s*[/+·]\s*달랏/, '나트랑·달랏'],
  [/하노이.*하롱|하롱.*하노이|하노이\s*[/+·]\s*하롱/, '하노이·하롱베이'],
  [/나가사키/, '나가사키'],
  [/후쿠오카|규슈|유후인|벳부|쿠로가와/, '후쿠오카·규슈'],
  [/북해도|홋카이도|삿포로|오타루|비에이|후라노|노보리베츠|죠잔케이/, '북해도'],
  [/푸꾸옥/, '푸꾸옥'],
  [/장가계|장자제/, '장가계'],
  [/청도/, '청도'],
  [/보홀/, '보홀'],
  [/세부/, '세부'],
  [/대마도|쓰시마/, '대마도'],
];

function asRecord(value: unknown): AnyRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as AnyRecord : null;
}

function cleanText(value: unknown): string {
  return String(value ?? '')
    .replace(INTERNAL_SUPPLIER_WORDS, ' ')
    .replace(RISKY_TITLE_WORDS, ' ')
    .replace(/[_*#♥★◆◇]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanDestinationText(value: unknown): string {
  return cleanText(value)
    .replace(/노\s*팁\s*[/+·&]?\s*노\s*옵션|노\s*옵션|노\s*팁/gi, ' ')
    .replace(/특급\s*호텔|프리미엄\s*(?:호텔|리조트)?|준?\s*5\s*성(?:급)?\s*(?:호텔|리조트)?/gi, ' ')
    .replace(/\b(?:LJ|BX|TW|ZE|7C|OZ|KE|RS|PKG|TL)\b/gi, ' ')
    .replace(/\s*[/+&]\s*/g, '·')
    .replace(/\s+/g, ' ')
    .replace(/^·|·$/g, '')
    .trim();
}

function collectStrings(value: unknown, output: string[] = [], depth = 0): string[] {
  if (depth > 5) return output;
  if (typeof value === 'string' || typeof value === 'number') {
    const text = cleanText(value);
    if (text) output.push(text);
    return output;
  }
  if (Array.isArray(value)) {
    value.forEach(item => collectStrings(item, output, depth + 1));
    return output;
  }
  const record = asRecord(value);
  if (!record) return output;
  for (const [key, child] of Object.entries(record)) {
    if (
      /raw_html|audit|admin|internal|commission|margin|supplier|operator/i.test(key)
      || /^(?:a4_sentence|landing_sentence|entity_kind|attraction_query|attraction_queries|source_span|source_section)$/i.test(key)
    ) continue;
    collectStrings(child, output, depth + 1);
  }
  return output;
}

function sourceText(pkg: AnyRecord): string {
  return [
    pkg.destination,
    pkg.title,
    pkg.display_title,
    pkg.product_summary,
    pkg.raw_text,
    pkg.trip_style,
    ...(Array.isArray(pkg.product_highlights) ? pkg.product_highlights : []),
    ...(Array.isArray(pkg.inclusions) ? pkg.inclusions : []),
    ...(Array.isArray(pkg.excludes) ? pkg.excludes : []),
    ...collectStrings(pkg.accommodations),
    ...collectStrings(pkg.hotels),
    ...collectStrings(pkg.itinerary_data),
  ]
    .map(cleanText)
    .filter(Boolean)
    .join(' ');
}

function numberValue(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function inferSegmentedSourceDuration(text: string): string | null {
  const dayMatches = [...text.matchAll(/(\d+)\s*일/g)];
  const nightMatches = [...text.matchAll(/(\d+)\s*박/g)]
    .map(match => ({ value: Number(match[1]), index: match.index ?? -1 }))
    .filter(match => Number.isFinite(match.value) && match.value > 0 && match.index >= 0);

  let segmentStart = 0;
  for (const dayMatch of dayMatches) {
    const sourceDuration = Number(dayMatch[1]);
    const dayIndex = dayMatch.index ?? -1;
    if (!Number.isFinite(sourceDuration) || sourceDuration <= 0 || dayIndex < 0) continue;

    const segmentText = text.slice(segmentStart, dayIndex);
    const segmentNights = nightMatches
      .filter(match => match.index >= segmentStart && match.index < dayIndex)
      .map(match => match.value);
    segmentStart = dayIndex + dayMatch[0].length;

    if (segmentText.length > 80) continue;
    if (segmentNights.length < 2) continue;
    const sourceNights = segmentNights.reduce((sum, value) => sum + value, 0);
    if (sourceNights > 0 && sourceNights < sourceDuration) {
      return `${sourceNights}박${sourceDuration}일`;
    }
  }

  return null;
}

export function inferPublicTitleDuration(pkg: AnyRecord, text = sourceText(pkg)): string | null {
  const nights = numberValue(pkg.nights);
  const duration = numberValue(pkg.duration);

  const match = text.match(/(\d+)\s*박\s*(\d+)\s*일/);
  if (match) {
    const sourceNights = Number(match[1]);
    const sourceDuration = Number(match[2]);
    const segmentedDuration = inferSegmentedSourceDuration(text);
    if (sourceNights <= 1 && segmentedDuration?.endsWith(`${sourceDuration}일`)) {
      return segmentedDuration;
    }
    if (!duration || sourceDuration === duration || !nights || nights !== sourceNights) {
      return `${sourceNights}박${sourceDuration}일`;
    }
  }
  const segmentedDuration = inferSegmentedSourceDuration(text);
  if (segmentedDuration) return segmentedDuration;
  if (nights && duration) return `${nights}박${duration}일`;
  if (duration && duration > 1) return `${duration - 1}박${duration}일`;
  return null;
}

export function inferPublicTitleDestination(pkg: AnyRecord, text = sourceText(pkg)): string | null {
  const destinationText = cleanDestinationText(pkg.destination);
  const combined = `${destinationText} ${text}`;
  for (const [pattern, label] of KNOWN_DESTINATION_ALIASES) {
    if (pattern.test(combined)) return label;
  }
  const normalized = destinationText
    .replace(/\s*[/+&]\s*/g, '·')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized || null;
}

function hasNoOptionEvidence(text: string, optionBadges: string[]): boolean {
  return optionBadges.some(badge => /노\s*옵션/.test(badge))
    || /(노\s*옵션|NO\s*OPTION|선택\s*관광\s*[:：-]?\s*(없음|무|노옵션|0))/i.test(text);
}

function hasNoTipEvidence(text: string, optionBadges: string[]): boolean {
  return optionBadges.some(badge => /노\s*팁/.test(badge))
    || /(노\s*팁|NO\s*TIP|기사\s*\/?\s*가이드\s*팁\s*포함)/i.test(text);
}

function hasNoShoppingEvidence(text: string): boolean {
  return /(노\s*쇼핑|NO\s*SHOPPING|쇼핑\s*[:：-]?\s*(없음|무|0회))/i.test(text);
}

function hasHotelGradeEvidence(text: string): boolean {
  return /(호텔|리조트|숙박|동급).{0,20}(5\s*성|준\s*5\s*성|특급|특급호텔)|(5\s*성|준\s*5\s*성|특급).{0,20}(호텔|리조트|숙박|동급)/i.test(text);
}

function hasStrongOnsenEvidence(text: string): boolean {
  return /(온천\s*(마을|호텔|리조트|숙박|2박|여행|관광|테마)|료칸|노보리베츠|죠잔케이|벳부|유후인|쿠로가와)/i.test(text);
}

function inferCondition(text: string, optionBadges: string[]): string | null {
  const noTip = hasNoTipEvidence(text, optionBadges);
  const noOption = hasNoOptionEvidence(text, optionBadges);
  if (noTip && noOption) return '노팁·노옵션';
  if (noOption) return '노옵션';
  if (noTip) return '노팁';
  if (hasNoShoppingEvidence(text)) return '노쇼핑';
  if (hasHotelGradeEvidence(text)) return '5성호텔';
  return null;
}

function inferTheme(text: string, destination: string): string {
  if (/골프|라운드|(?:^|[\s/])C\.?C\.?(?:$|[\s/])/i.test(text)) return '골프';
  if (!/연길·백두산/.test(destination) && hasStrongOnsenEvidence(text)) return '온천·관광';
  if (/자유\s*일정|자유\s*시간|1일\s*자유|반일\s*자유/i.test(text)) return '자유일정';
  if (/다낭·호이안|푸꾸옥|리조트|비치|해변|호핑|휴양/i.test(`${destination} ${text}`) || (/세부/.test(destination) && /세부/.test(text))) return '휴양관광';
  return '핵심관광';
}

function uniqueParts(parts: Array<string | null>): string[] {
  const seen = new Set<string>();
  return parts
    .map(part => cleanText(part))
    .filter(Boolean)
    .filter((part) => {
      if (seen.has(part)) return false;
      seen.add(part);
      return true;
    });
}

export function composeCustomerPublicTitle(
  pkg: AnyRecord,
  optionBadges: string[] = [],
): string {
  const text = sourceText(pkg);
  const destination = inferPublicTitleDestination(pkg, text);
  const duration = inferPublicTitleDuration(pkg, text);
  if (!destination || !duration) return '';

  const condition = inferCondition(text, optionBadges);
  const theme = inferTheme(text, destination);
  return uniqueParts([destination, condition, theme, duration]).join(' ');
}
