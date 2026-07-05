import { stripMarkup } from './blog-text-utils';
import { findBlogPromptInstructionResidue } from './blog-prompt-residue';

type BlogGateSeverity = 'critical' | 'warning';

interface BlogGateIssue {
  code:
    | 'missing_topic'
    | 'placeholder_text'
    | 'machine_slug_topic'
    | 'nonsensical_comparison'
    | 'duplicate_destination_prefix'
    | 'destination_intent_mismatch'
    | 'weak_travel_intent'
    | 'unsupported_honeymoon_topic'
    | 'seasonal_intent_mismatch'
    | 'seasonal_lodging_tangent'
    | 'malformed_korean_particle'
    | 'excessive_highlights'
    | 'generic_image_context'
    | 'meaningless_faq'
    | 'repetitive_support_blocks'
    | 'visible_prompt_instruction';
  severity: BlogGateSeverity;
  message: string;
  evidence?: Record<string, unknown>;
}

export interface BlogTopicFitInput {
  topic?: string | null;
  destination?: string | null;
  primaryKeyword?: string | null;
  category?: string | null;
  angleType?: string | null;
  contentType?: string | null;
  source?: string | null;
  productId?: string | null;
}

export interface BlogEditorialQualityInput extends BlogTopicFitInput {
  slug?: string | null;
  blogHtml?: string | null;
}

export interface BlogGateReport {
  passed: boolean;
  score: number;
  issues: BlogGateIssue[];
}

export interface BlogTopicQueueGateInput {
  topic?: string | null;
  destination?: string | null;
  primary_keyword?: string | null;
  category?: string | null;
  angle_type?: string | null;
  content_type?: string | null;
  source?: string | null;
  product_id?: string | null;
  meta?: Record<string, unknown> | null;
}

const MACHINE_SLUG_RE = /(?:^|\s)(?:post|guide)[-_][a-z0-9]{3,}(?:\s|$)|(?:^|\s)\d+[-_](?:post|guide)[-_][a-z0-9]{2,}(?:\s|$)/i;
const CLEAR_TRAVEL_TOPIC_RE = /(?:여행|관광|일정|코스|날씨|옷차림|준비|준비물|체크|비용|예산|경비|항공|호텔|숙소|입국|비자|환전|유심|로밍|eSIM|USIM|패키지|투어|guide|travel|itinerary|weather|budget|visa|hotel|flight|tour)/i;
const KO_MONTH_TOKEN_RE = /\d{1,2}\s*(?:\uC6D4|month)/i;
const KO_SEASONAL_LODGING_TANGENT_RE = /(?:\uC5D0\uC5B4\uCEE8|\uC5D0\uC5B4\uCF58|\uC219\uC18C|\uD638\uD154|\uB9AC\uC870\uD2B8|\uAC1D\uC2E4|air\s*con|aircon|a\/c|accommodation|hotel|resort)/i;
const KO_SEASONAL_CORE_INTENT_RE = /(?:\uB0A0\uC528|\uC637\uCC28\uB9BC|\uC900\uBE44\uBB3C|\uCCB4\uD06C\uB9AC\uC2A4\uD2B8|\uC6B0\uAE30|\uAC74\uAE30|\uAE30\uC628|\uAC15\uC218|\uBC29\uC218|\uBAA8\uAE30|weather|clothing|packing|checklist)/i;
const KO_HONEYMOON_RE = /(?:\uC2E0\uD63C\uC5EC\uD589|\uD5C8\uB2C8\uBB38|honeymoon)/i;
const KO_BAD_HONEYMOON_DESTINATION_RE = /(?:\uC11D\uAC00\uC7A5|shijiazhuang)/i;
const NONSENSE_VS_RE = /(?:^|\s)vs\s+vs(?:\s|$)|\bversus\s+versus\b/i;
const PLACEHOLDER_RE = /관련\s*지역|목적지명|여행지명|undefined|null|\[object\s+object\]|\{\{[^}]+}}|TODO|TBD/i;
const TRAVEL_INTENT_RE = /여행|관광|일정|코스|날씨|월별|옷차림|준비물|체크리스트|비용|예산|항공|공항|호텔|숙소|맛집|교통|입국|비자|환전|패키지|투어|가이드|eSIM|유심|추천|가족|효도|신혼|허니문|honeymoon|itinerary|weather|budget|visa|hotel|flight|airport|travel|tour|guide/i;
const HONEYMOON_RE = /신혼여행|허니문|honeymoon/i;
const KNOWN_HONEYMOON_DESTINATION_RE = /발리|몰디브|하와이|괌|사이판|푸켓|코사무이|세부|보라카이|칸쿤|산토리니|파리|스위스|이탈리아|유럽|제주|bali|maldives|hawaii|guam|saipan|phuket|samui|cebu|boracay|cancun|santorini|paris|switzerland|italy|europe|jeju/i;
const KNOWN_BAD_HONEYMOON_COMBO_RE = /석가장|스자좡|shijiazhuang/i;
const MALFORMED_PARTICLE_RE = /보다\s+는|상품\s+보다\s+는|추천하기\s+보다\s+는|직항\s+보다\s+평균|대비\s+는|에서는\s+는|으로\s+는|상품\s+보다\b/i;
const GENERIC_IMAGE_TEXT_RE = /^(?:여행\s*이미지|핵심\s*요약|이미지\s*\d+|photo\s*\d+|travel\s*image)$/i;
const GENERIC_FAQ_RE = /Q[.:)]\s*(?:관련\s*지역|이\s*글|이\s*여행|무엇인가요|어떻게\s*준비하나요)/i;
const SUPPORT_BLOCK_RE = /함께\s*(?:보면|읽으면)|관련\s*(?:글|상품|지역)|추천\s*상품/g;
const SEASONAL_MONTH_DESTINATION_RE = /[가-힣A-Za-z]{2,}\s*\d{1,2}\s*월|\d{1,2}\s*월\s*[가-힣A-Za-z]{2,}/;
const SEASONAL_LODGING_TANGENT_RE = /에어컨|에어콘|숙소|호텔|리조트|숙박|air\s*con|aircon|a\/c|accommodation|hotel|resort/i;
const SEASONAL_CORE_INTENT_RE = /날씨|옷차림|준비물|체크리스트|우기|건기|기온|강수|방수|모기|weather|clothing|packing|checklist/i;

function compact(values: Array<string | null | undefined>): string {
  return values
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function compactUnique(values: Array<string | null | undefined>): string {
  const seen = new Set<string>();
  return values
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => value.replace(/\s+/g, ' ').trim())
    .filter((value) => {
      const key = value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join(' ')
    .trim();
}

function addIssue(
  issues: BlogGateIssue[],
  code: BlogGateIssue['code'],
  severity: BlogGateSeverity,
  message: string,
  evidence?: Record<string, unknown>,
) {
  issues.push({ code, severity, message, evidence });
}

function scoreFromIssues(issues: BlogGateIssue[]): number {
  const critical = issues.filter((issue) => issue.severity === 'critical').length;
  const warning = issues.filter((issue) => issue.severity === 'warning').length;
  return Math.max(0, 100 - critical * 30 - warning * 8);
}

function escapeGateRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasDuplicateDestinationPrefix(topic: string, destination: string | null | undefined): boolean {
  const cleanDestination = typeof destination === 'string' ? destination.replace(/\s+/g, ' ').trim() : '';
  if (!cleanDestination) return false;
  const cleanTopic = topic.replace(/\s+/g, ' ').trim();
  const pattern = new RegExp(`^${escapeGateRegExp(cleanDestination)}\\s+${escapeGateRegExp(cleanDestination)}(?:\\s|\\(|\\[|$)`, 'i');
  return pattern.test(cleanTopic);
}

function meaningfulContextTokens(input: BlogEditorialQualityInput): string[] {
  return compact([input.destination, input.primaryKeyword, input.topic])
    .split(/[\s,/|.-]+/g)
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length >= 2 && !/^(?:여행|가이드|추천|비용|일정|날씨|준비|체크|이미지|guide|travel|post)$/i.test(token))
    .slice(0, 8);
}

function imageTexts(markdownOrHtml: string): string[] {
  const texts: string[] = [];
  const mdImageRe = /!\[([^\]]*)]\([^)]+\)/g;
  let mdMatch: RegExpExecArray | null;
  while ((mdMatch = mdImageRe.exec(markdownOrHtml)) !== null) {
    texts.push((mdMatch[1] || '').replace(/\s+/g, ' ').trim());
  }

  const figcaptionRe = /<figcaption[^>]*>([\s\S]*?)<\/figcaption>/gi;
  let figMatch: RegExpExecArray | null;
  while ((figMatch = figcaptionRe.exec(markdownOrHtml)) !== null) {
    texts.push((figMatch[1] || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
  }

  return texts.filter(Boolean);
}

function countGenericImageContext(input: BlogEditorialQualityInput): number {
  const tokens = meaningfulContextTokens(input);
  return imageTexts(input.blogHtml ?? '').filter((text) => {
    const normalized = text.toLowerCase();
    if (!GENERIC_IMAGE_TEXT_RE.test(normalized)) return false;
    return tokens.length === 0 || !tokens.some((token) => normalized.includes(token));
  }).length;
}

export function evaluateBlogTopicFit(input: BlogTopicFitInput): BlogGateReport {
  const issues: BlogGateIssue[] = [];
  const topicText = compactUnique([input.topic, input.primaryKeyword]);
  const allText = compactUnique([
    input.topic,
    input.destination,
    input.primaryKeyword,
    input.category,
    input.angleType,
    input.contentType,
    input.source,
  ]);

  const hasClearShortDestinationContext = topicText.length >= 1
    && /[\uAC00-\uD7A3]/.test(topicText)
    && CLEAR_TRAVEL_TOPIC_RE.test(allText);
  if (topicText.length < 4 && !hasClearShortDestinationContext) {
    addIssue(issues, 'missing_topic', 'critical', 'Topic or primary keyword is too short for autonomous publishing.', {
      topic: input.topic,
      primaryKeyword: input.primaryKeyword,
    });
  }

  if (PLACEHOLDER_RE.test(allText)) {
    addIssue(issues, 'placeholder_text', 'critical', 'Topic contains placeholder or template text.', {
      sample: allText.match(PLACEHOLDER_RE)?.[0],
    });
  }

  if (MACHINE_SLUG_RE.test(topicText)) {
    addIssue(issues, 'machine_slug_topic', 'critical', 'Topic looks like a generated slug instead of a reader-facing travel topic.', {
      topic: topicText,
    });
  }

  if (NONSENSE_VS_RE.test(topicText)) {
    addIssue(issues, 'nonsensical_comparison', 'critical', 'Topic contains a nonsensical comparison pattern.', {
      topic: topicText,
    });
  }

  if (hasDuplicateDestinationPrefix(topicText, input.destination)) {
    addIssue(issues, 'duplicate_destination_prefix', 'critical', 'Topic repeats the destination name at the start and should be rewritten before publishing.', {
      topic: topicText,
      destination: input.destination,
    });
  }

  if (!TRAVEL_INTENT_RE.test(allText) && !input.productId) {
    addIssue(issues, 'weak_travel_intent', 'critical', 'Topic has no clear travel, destination, or booking intent.', {
      topic: topicText,
    });
  }

  if (HONEYMOON_RE.test(allText)) {
    const destinationText = compact([input.destination, input.topic, input.primaryKeyword]);
    if (KNOWN_BAD_HONEYMOON_COMBO_RE.test(destinationText)) {
      addIssue(issues, 'destination_intent_mismatch', 'critical', 'Destination and honeymoon intent are not compatible for automated publishing.', {
        destination: input.destination,
        topic: topicText,
      });
    } else if (!KNOWN_HONEYMOON_DESTINATION_RE.test(destinationText) && !input.productId) {
      addIssue(issues, 'unsupported_honeymoon_topic', 'critical', 'Honeymoon topic requires a known honeymoon destination or a real product context.', {
        destination: input.destination,
        topic: topicText,
      });
    }
  }

  if (KO_HONEYMOON_RE.test(allText) && KO_BAD_HONEYMOON_DESTINATION_RE.test(allText)) {
    addIssue(issues, 'destination_intent_mismatch', 'critical', 'Destination and honeymoon intent are not compatible for automated publishing.', {
      destination: input.destination,
      topic: topicText,
    });
  }

  if (
    input.source === 'seasonal' &&
    SEASONAL_MONTH_DESTINATION_RE.test(compact([input.destination, input.primaryKeyword, input.topic])) &&
    SEASONAL_LODGING_TANGENT_RE.test(topicText) &&
    !SEASONAL_CORE_INTENT_RE.test(topicText)
  ) {
    addIssue(
      issues,
      'seasonal_intent_mismatch',
      'critical',
      'Seasonal destination-month keywords must target weather, clothing, and preparation instead of lodging micro-topics.',
      {
        topic: topicText,
        destination: input.destination,
        primaryKeyword: input.primaryKeyword,
      },
    );
  }

  if (
    KO_MONTH_TOKEN_RE.test(allText) &&
    KO_SEASONAL_LODGING_TANGENT_RE.test(topicText) &&
    !KO_SEASONAL_CORE_INTENT_RE.test(topicText)
  ) {
    addIssue(
      issues,
      'seasonal_lodging_tangent',
      'critical',
      'Monthly destination articles must focus on weather, clothing, and preparation instead of lodging micro-topics.',
      {
        topic: topicText,
        destination: input.destination,
        primaryKeyword: input.primaryKeyword,
      },
    );
  }

  const score = scoreFromIssues(issues);
  return {
    passed: issues.every((issue) => issue.severity !== 'critical'),
    score,
    issues,
  };
}

export function evaluateBlogEditorialQuality(input: BlogEditorialQualityInput): BlogGateReport {
  const topicReport = evaluateBlogTopicFit(input);
  const issues = [...topicReport.issues];
  const source = input.blogHtml ?? '';
  const plain = stripMarkup(source).replace(/\s+/g, ' ').trim();
  const combined = compact([input.slug, input.topic, input.primaryKeyword, plain.slice(0, 6000)]);

  if (PLACEHOLDER_RE.test(combined)) {
    addIssue(issues, 'placeholder_text', 'critical', 'Article contains visible placeholder or template text.', {
      sample: combined.match(PLACEHOLDER_RE)?.[0],
    });
  }

  const promptResidue = findBlogPromptInstructionResidue(source);
  if (promptResidue.length > 0) {
    addIssue(issues, 'visible_prompt_instruction', 'critical', 'Article contains visible internal prompt or writing-rule residue.', {
      samples: promptResidue,
    });
  }

  const readerFacingTopic = compactUnique([input.topic, input.primaryKeyword]);
  const machineSlug = MACHINE_SLUG_RE.test(input.slug ?? '');
  const machineTopic = MACHINE_SLUG_RE.test(readerFacingTopic)
    || PLACEHOLDER_RE.test(readerFacingTopic)
    || readerFacingTopic.length < 4;
  if (MACHINE_SLUG_RE.test(compact([input.slug, input.topic, input.primaryKeyword])) && (!machineSlug || machineTopic)) {
    addIssue(issues, 'machine_slug_topic', 'critical', 'Slug or title still looks machine-generated.', {
      slug: input.slug,
      topic: input.topic,
    });
  }

  if (MALFORMED_PARTICLE_RE.test(combined)) {
    addIssue(issues, 'malformed_korean_particle', 'critical', 'Article contains malformed Korean comparison particles caused by automated highlighting or rewriting.', {
      sample: combined.match(MALFORMED_PARTICLE_RE)?.[0],
    });
  }

  const markCount = (source.match(/<mark\b|==[^=\n]{2,120}==/gi) || []).length;
  if (markCount > 8) {
    addIssue(issues, 'excessive_highlights', 'critical', 'Article uses too many highlight marks for an editorial article.', {
      markCount,
      max: 8,
    });
  }

  const genericImageContext = countGenericImageContext(input);
  if (genericImageContext >= 2) {
    addIssue(issues, 'generic_image_context', 'critical', 'Article image alt/caption text is generic instead of destination-specific.', {
      genericImageContext,
    });
  }

  if (GENERIC_FAQ_RE.test(combined)) {
    addIssue(issues, 'meaningless_faq', 'warning', 'Article includes generic FAQ wording that is not tied to the search intent.', {
      sample: combined.match(GENERIC_FAQ_RE)?.[0],
    });
  }

  const supportBlocks = combined.match(SUPPORT_BLOCK_RE) || [];
  if (supportBlocks.length >= 4) {
    addIssue(issues, 'repetitive_support_blocks', 'warning', 'Article contains repeated support/recommendation blocks that can dilute the main article.', {
      supportBlocks: supportBlocks.length,
    });
  }

  const score = scoreFromIssues(issues);
  return {
    passed: issues.every((issue) => issue.severity !== 'critical'),
    score,
    issues,
  };
}

export function attachTopicFitMeta<T extends BlogTopicQueueGateInput>(
  row: T,
): T & { meta: Record<string, unknown> } {
  const report = evaluateBlogTopicFit({
    topic: row.topic,
    destination: row.destination,
    primaryKeyword: row.primary_keyword,
    category: row.category,
    angleType: row.angle_type,
    contentType: row.content_type,
    source: row.source,
    productId: row.product_id,
  });

  return {
    ...row,
    meta: {
      ...(row.meta ?? {}),
      topic_fit_gate: {
        passed: report.passed,
        score: report.score,
        issues: report.issues,
      },
    },
  };
}

export function filterTopicFitPassed<T extends BlogTopicQueueGateInput>(
  rows: T[],
): {
  rows: Array<T & { meta: Record<string, unknown> }>;
  rejected: Array<{ row: T & { meta: Record<string, unknown> }; report: BlogGateReport }>;
} {
  const accepted: Array<T & { meta: Record<string, unknown> }> = [];
  const rejected: Array<{ row: T & { meta: Record<string, unknown> }; report: BlogGateReport }> = [];

  for (const row of rows) {
    const withMeta = attachTopicFitMeta(row);
    const report = (withMeta.meta?.topic_fit_gate ?? null) as BlogGateReport | null;
    if (report?.passed) accepted.push(withMeta);
    else rejected.push({ row: withMeta, report: report ?? evaluateBlogTopicFit({ topic: row.topic }) });
  }

  return { rows: accepted, rejected };
}
