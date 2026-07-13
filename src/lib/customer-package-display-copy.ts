import { hasCustomerCopyQualityIssues, normalizeCustomerVisibleCopy } from '@/lib/customer-copy-quality';

export type PackageCopySource = 'display_title' | 'product_display_name' | 'title' | 'generated';

export interface CustomerPackageDisplayCopyInput {
  title?: string | null;
  display_title?: string | null;
  product_display_name?: string | null;
  hero_tagline?: string | null;
  product_summary?: string | null;
  destination?: string | null;
  duration?: number | null;
  nights?: number | null;
  trip_style?: string | null;
  product_type?: string | null;
  airline?: string | null;
  product_highlights?: string[] | null;
  inclusions?: string[] | null;
  excludes?: string[] | null;
  customer_notes?: string | null;
  optional_tours?: Array<string | { name?: string | null; displayName?: string | null; note?: string | null }> | null;
}

export interface CustomerPackageDisplayCopy {
  heroHeadline: string;
  heroSubline: string;
  cardTitle: string;
  summaryLead: string;
  summaryBody: string;
  seoTitle: string;
  badges: string[];
  issues: string[];
  source: PackageCopySource;
}

const CUSTOMER_TITLE_MAX = 34;
const CUSTOMER_CARD_TITLE_MAX = 30;
const INTERNAL_AIRLINE_CODES = [
  'BX',
  'KE',
  'LJ',
  'TW',
  '7C',
  'ZE',
  'OZ',
  'RS',
  'VN',
  'VJ',
  'MU',
  'JL',
  'NH',
];

const TITLE_FORBIDDEN_PATTERN =
  /(?:출발확정|좌석확보|마감임박|긴급\s*특가|스팟\s*특가|스\.?\s*팟\.?\s*특\.?\s*가|얼리버드|최저가|발권|선발권|정산|마진|NET|RMK|P\.?P\.?|PKG|\d+\s*컴|TL\b)/i;

const CUSTOMER_NOISE_PATTERNS: Array<[RegExp, string]> = [
  [/^[0-9a-f]{8,}[-_\s]*/i, ' '],
  [new RegExp(`\\b(?:${INTERNAL_AIRLINE_CODES.join('|')})\\s*[-_]?\\s*\\d{2,5}\\b`, 'gi'), ' '],
  [new RegExp(`^\\s*\\[?\\s*(?:${INTERNAL_AIRLINE_CODES.join('|')})\\s*[-\\]]\\s*`, 'i'), ' '],
  [/\([^)]*(?:발권|선발권|TL|스팟|특가)[^)]*\)/gi, ' '],
  [/\[[^\]]*(?:발권|선발권|TL|스팟|특가)[^\]]*\]/gi, ' '],
  [/\b\d{3,4}\s*발권\b/gi, ' '],
  [/\b\d{1,2}\s*컴\b/gi, ' '],
  [/\bPKG\b/gi, ' '],
  [/\bTL\b/gi, ' '],
  [/[_*★♥]+/g, ' '],
  [/[()[\]{}]/g, ' '],
  [/\s{2,}/g, ' '],
];

function clean(value: string | null | undefined): string {
  return normalizeCustomerVisibleCopy(value).replace(/\s+/g, ' ').trim();
}

function normalizeForCustomer(value: string | null | undefined): string {
  let text = clean(value);
  for (const [pattern, replacement] of CUSTOMER_NOISE_PATTERNS) {
    text = text.replace(pattern, replacement);
  }
  return text
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s*·\s*/g, '·')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function collectSourceText(input: CustomerPackageDisplayCopyInput): string {
  return [
    input.display_title,
    input.product_display_name,
    input.title,
    input.hero_tagline,
    input.product_summary,
    ...(input.product_highlights ?? []),
    ...(input.inclusions ?? []),
    ...(input.excludes ?? []),
    input.customer_notes,
    ...(input.optional_tours ?? []).flatMap(optionalTourCopyParts),
  ]
    .map(normalizeForCustomer)
    .filter(Boolean)
    .join(' ');
}

function collectTitleThemeText(input: CustomerPackageDisplayCopyInput): string {
  return [
    input.display_title,
    input.product_display_name,
    input.title,
    ...(input.product_highlights ?? []),
  ]
    .map(normalizeForCustomer)
    .filter(Boolean)
    .join(' ');
}

function formatDuration(input: CustomerPackageDisplayCopyInput, sourceText = ''): string | null {
  const tripStyle = clean(input.trip_style);
  const tripStyleDuration = tripStyle.match(/\d+\s*박\s*\d+\s*일|\d+\s*일/);
  if (tripStyleDuration) return tripStyleDuration[0].replace(/\s+/g, '');
  if (input.nights && input.duration) return `${input.nights}박${input.duration}일`;
  if (input.duration && input.duration > 1) return `${input.duration - 1}박${input.duration}일`;
  if (input.duration) return `${input.duration}일`;
  const sourceDuration = sourceText.match(/\d+\s*박\s*\d+\s*일|\d+\s*일/);
  if (sourceDuration) return sourceDuration[0].replace(/\s+/g, '');
  return null;
}

function normalizeDestination(input: CustomerPackageDisplayCopyInput, text: string): string {
  let destination = normalizeForCustomer(input.destination)
    .replace(/\s*\/\s*/g, '·')
    .replace(/\s+/g, ' ')
    .trim();

  const has = (pattern: RegExp) => pattern.test(text) || pattern.test(destination);

  if (/나트랑/.test(destination) && has(/달랏/)) destination = '나트랑·달랏';
  if (/다낭/.test(destination) && has(/호이안/)) destination = '다낭·호이안';
  if (/하노이/.test(destination) && has(/하롱|하롱베이/)) destination = '하노이·하롱베이';
  if (/연길/.test(destination) && has(/백두산/)) destination = '연길·백두산';
  if (/대만|타이베이/.test(destination) && has(/예스지|야류|지우펀|스펀/)) destination = '타이베이·예스지';
  if (/북해도|홋카이도/.test(destination)) destination = '북해도';
  if (/대마도|쓰시마/.test(destination)) destination = '대마도';

  return destination || '추천 여행';
}

function detectBestCondition(text: string): string | null {
  const noTip = /(?:노팁|NO\s*팁|팁\s*없)/i.test(text);
  const noOption = /(?:노옵션|NO\s*옵션|선택관광\s*없)/i.test(text);
  const noShopping = /(?:노쇼핑|NO\s*쇼핑|쇼핑\s*없)/i.test(text);

  if (noTip && noOption) return '노팁·노옵션';
  if (noOption) return '노옵션';
  if (noShopping) return '노쇼핑';
  if (/(?:월드체인|5성|오성|전일정\s*5성)/i.test(text)) return '5성';
  if (/(?:특급호텔|특급\s*호텔|품격호텔|품격\s*호텔)/i.test(text)) return '특급호텔';
  return null;
}

function detectTheme(text: string, destination: string): string {
  if (/대마도|쓰시마|쓰시마링크|선박|쾌속선|페리/i.test(`${destination} ${text}`)) return '선박 자유여행';
  if (/골프|CC|라운드|라운딩/i.test(text)) return '골프';
  if (/호핑/i.test(text)) return '호핑';
  if (/바나힐/i.test(text) && /호캉스|리조트|휴양|5성/i.test(text)) return '호캉스·바나힐';
  if (/바나힐/i.test(text)) return '바나힐 관광';
  if (/호캉스/i.test(text)) return '호캉스';
  if (/리조트|휴양|풀빌라/i.test(text)) return '휴양';
  if (/(?:료칸|온천\s*(?:여행|관광|휴양|호텔|리조트|마을)|(?:벳부|유후인|노보리베츠|하코네|아타미|쿠로카와|기노사키).{0,12}온천)/i.test(text)) return '온천';
  if (/자유일정|자유시간|1일자유|오전자유/i.test(text)) return '자유일정';
  if (/비에이|후라노/i.test(text)) return '비에이·후라노';
  if (/예스지|야류|지우펀|스펀/i.test(text)) return '예스지';
  if (/고품격|프리미엄|시그니처|품격/i.test(text)) return '고품격';
  if (/특급호텔|특급\s*호텔/i.test(text)) return '특급호텔';
  return '핵심관광';
}

function collectClaimEvidenceText(input: CustomerPackageDisplayCopyInput): string {
  return [
    input.hero_tagline,
    input.product_summary,
    ...(input.product_highlights ?? []),
    ...(input.inclusions ?? []),
    ...(input.excludes ?? []),
    input.customer_notes,
    ...(input.optional_tours ?? []).flatMap(optionalTourCopyParts),
  ]
    .map(normalizeForCustomer)
    .filter(Boolean)
    .join(' ');
}

function optionalTourCopyParts(
  tour: string | { name?: string | null; displayName?: string | null; note?: string | null },
): Array<string | null | undefined> {
  if (typeof tour === 'string') return [tour];
  return [tour.name, tour.displayName, tour.note];
}

function hasHotelGradeEvidence(text: string): boolean {
  return /(?:호텔|리조트|숙박|동급).{0,16}(?:준\s*5성|정\s*5성|5성|오성|월드체인)|(?:준\s*5성|정\s*5성|5성|오성|월드체인).{0,16}(?:호텔|리조트|숙박|동급)|특급\s*호텔|특급호텔/i.test(text);
}

function hasPremiumHotelEvidence(text: string): boolean {
  return /특급\s*호텔|특급호텔|프리미엄\s*(?:호텔|리조트)|고품격\s*(?:호텔|리조트)/i.test(text);
}

function hasStrongOnsenEvidence(text: string): boolean {
  return /온천(?:호텔|료칸|숙박|마을|지구|대표|테마|리조트|여행|관광)|료칸|(?:쿠로카와|유후인|벳부|노보리베츠|하코네|아타미|기노사키).{0,12}온천/i.test(text);
}

function buildBadges(text: string, input: CustomerPackageDisplayCopyInput): string[] {
  const badges: string[] = [];
  const push = (label: string, pattern: RegExp) => {
    if (pattern.test(text) && !badges.includes(label)) badges.push(label);
  };
  const claimEvidenceText = collectClaimEvidenceText(input);

  push('노팁', /노팁|NO\s*팁/i);
  push('노옵션', /노옵션|NO\s*옵션|선택관광\s*없/i);
  push('노쇼핑', /노쇼핑|NO\s*쇼핑|쇼핑\s*없/i);
  if (hasHotelGradeEvidence(claimEvidenceText)) push('5성호텔', /./);
  if (hasPremiumHotelEvidence(claimEvidenceText)) push('특급호텔', /./);
  push('호핑', /호핑/i);
  push('바나힐', /바나힐/i);
  push('골프', /골프|라운드|라운딩/i);
  if (hasStrongOnsenEvidence(claimEvidenceText)) push('온천', /./);
  push('자유일정', /자유일정|자유시간|1일자유|오전자유/i);

  const airline = clean(input.airline);
  if (airline && !hasCustomerCopyQualityIssues(airline) && !INTERNAL_AIRLINE_CODES.includes(airline.toUpperCase())) {
    badges.push(airline);
  }

  return badges.slice(0, 6);
}

function titleHasCustomerIssue(title: string, duration: string | null): boolean {
  if (!title) return true;
  if (hasCustomerCopyQualityIssues(title)) return true;
  if (TITLE_FORBIDDEN_PATTERN.test(title)) return true;
  if (new RegExp(`\\b(?:${INTERNAL_AIRLINE_CODES.join('|')})\\d*\\b`, 'i').test(title)) return true;
  if (/특가|추천상품|패키지|상품$/i.test(title) && title.length < 12) return true;
  if (duration && !title.includes(duration)) return true;
  return false;
}

function compactTitle(parts: string[], duration: string | null): string {
  const cleanParts = parts
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part, index, arr) => arr.indexOf(part) === index);

  let title = cleanParts.join(' ');
  if (title.length <= CUSTOMER_TITLE_MAX) return title;

  const withoutLowPriority = cleanParts.filter((part) => !/(?:핵심관광|실속관광)$/.test(part));
  title = withoutLowPriority.join(' ');
  if (title.length <= CUSTOMER_TITLE_MAX) return title;

  const withoutCondition = withoutLowPriority.filter((part) => !/(?:노팁·노옵션|노옵션|노쇼핑|5성|특급호텔)/.test(part));
  title = withoutCondition.join(' ');
  if (title.length <= CUSTOMER_TITLE_MAX || !duration) return title;

  const destination = cleanParts[0] ?? '추천 여행';
  return [destination, duration].filter(Boolean).join(' ');
}

function buildTitle(input: CustomerPackageDisplayCopyInput): { title: string; badges: string[]; issues: string[] } {
  const text = collectSourceText(input);
  const titleThemeText = collectTitleThemeText(input);
  const duration = formatDuration(input, text);
  const destination = normalizeDestination(input, text);
  const condition = detectBestCondition(text);
  const theme = detectTheme(titleThemeText, destination);
  const themeForTitle = destination.includes(theme) || (condition ? theme.includes(condition) : false) ? '' : theme;
  const badges = buildBadges(text, input);
  const title = compactTitle([destination, condition ?? '', themeForTitle, duration ?? ''], duration);
  const issues = ['generated_title'];

  if (!duration) issues.push('missing_duration');
  if (titleHasCustomerIssue(title, duration)) issues.push('customer_title_quality_issue');

  return { title, badges, issues };
}

function truncateByChars(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max).trim();
}

function buildSummary(input: CustomerPackageDisplayCopyInput, title: string, badges: string[]): { lead: string; body: string; issues: string[] } {
  const issues: string[] = [];
  const existing = clean(input.product_summary);
  if (
    existing &&
    existing.length >= 24 &&
    existing.length <= 150 &&
    !TITLE_FORBIDDEN_PATTERN.test(existing) &&
    !hasCustomerCopyQualityIssues(existing)
  ) {
    const [leadRaw, ...rest] = existing.split(/\n{2,}|[.!?]\s+/).map((part) => part.trim()).filter(Boolean);
    return {
      lead: truncateByChars(leadRaw || existing, 56),
      body: truncateByChars(rest.join(' ') || existing, 135),
      issues,
    };
  }
  if (existing) issues.push('weak_product_summary');

  const customerBadges = badges.filter((badge) => !/(?:진에어|에어부산|이스타항공|대한항공|아시아나)/.test(badge));
  const lead = `${title} 일정이에요.`;
  const body = customerBadges.length > 0
    ? `${customerBadges.slice(0, 3).join(', ')} 조건을 상담 전 빠르게 확인할 수 있어요.`
    : '일정, 항공, 숙소, 포함 조건을 상담 전 빠르게 확인할 수 있어요.';

  return { lead, body, issues };
}

function buildSubline(title: string, summaryLead: string, badges: string[]): string {
  if (badges.length > 0) return badges.slice(0, 4).join(' · ');
  return summaryLead || title;
}

export function buildCustomerPackageDisplayCopy(input: CustomerPackageDisplayCopyInput): CustomerPackageDisplayCopy {
  const titleResult = buildTitle(input);
  const title = truncateByChars(titleResult.title, CUSTOMER_TITLE_MAX);
  const summary = buildSummary(input, title, titleResult.badges);
  const heroSubline = truncateByChars(buildSubline(title, summary.lead, titleResult.badges), 64);

  return {
    heroHeadline: title,
    heroSubline,
    cardTitle: truncateByChars(title, CUSTOMER_CARD_TITLE_MAX),
    summaryLead: truncateByChars(summary.lead, 56),
    summaryBody: truncateByChars(summary.body, 135),
    seoTitle: title,
    badges: titleResult.badges,
    issues: [...titleResult.issues, ...summary.issues],
    source: 'generated',
  };
}
