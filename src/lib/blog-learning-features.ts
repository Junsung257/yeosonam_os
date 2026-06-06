import { checkAiReadability } from './blog-quality-gate';
import { extractFaqItems, extractHowToSteps } from './blog-jsonld';
import { computeReadability } from './blog-readability';
import { stripMarkup } from './blog-text-utils';

const OFFICIAL_DOMAIN_PATTERNS = [
  /\.go\.kr$/i,
  /\.gov$/i,
  /\.gov\.[a-z]{2}$/i,
  /0404\.go\.kr$/i,
  /mofa\.go\.kr$/i,
  /visitkorea\.or\.kr$/i,
  /knto\.or\.kr$/i,
  /airportal\.go\.kr$/i,
  /korea\.kr$/i,
  /travel\.state\.gov$/i,
  /japan\.travel$/i,
];

const SUMMARY_HEADING_RE = /^##\s*(tl;dr|요약|핵심 요약|한눈에 보기|빠른 요약)/im;
const FAQ_HEADING_RE = /^##\s*(faq|자주 묻는 질문|자주 하는 질문|q\s*&\s*a)/im;
const QUESTION_HEADING_RE = /^#{2,3}\s+.+\?\s*$/gm;

export interface LearningPostInput {
  id: string;
  seo_title?: string | null;
  seo_description?: string | null;
  blog_html?: string | null;
  slug?: string | null;
  destination?: string | null;
  angle_type?: string | null;
  prompt_version?: string | null;
  traffic_count?: number | null;
  avg_time_on_page?: number | null;
  avg_scroll_depth?: number | null;
  cta_click_rate?: number | null;
  first_touch_conversions?: number | null;
  avg_search_position?: number | null;
  score?: number | null;
}

export interface BlogLearningFeatures {
  titleLength: number;
  descriptionLength: number;
  bodyChars: number;
  h2Count: number;
  h3Count: number;
  questionHeadingCount: number;
  hasSummarySection: boolean;
  hasFaqSection: boolean;
  faqItemCount: number;
  howToStepCount: number;
  imageCount: number;
  imageAltCoverage: number;
  internalLinkCount: number;
  externalLinkCount: number;
  officialLinkCount: number;
  ctaLinkCount: number;
  highlightCount: number;
  listCount: number;
  tableRowCount: number;
  firstParagraphChars: number;
  yearInTitle: boolean;
  bracketInTitle: boolean;
  readabilityScore: number;
  aiReadable: boolean;
}

export interface LearningPostSample {
  id: string;
  slug: string | null;
  title: string;
  angle: string | null;
  destination: string | null;
  prompt_version: string | null;
  traffic: number | null;
  avg_time: number | null;
  scroll: number | null;
  cta_rate: number | null;
  conversions: number | null;
  search_position: number | null;
  score: number | null;
  features: BlogLearningFeatures;
}

export interface FeatureGroupSummary {
  sampleSize: number;
  avgTitleLength: number;
  avgDescriptionLength: number;
  avgBodyChars: number;
  avgH2Count: number;
  avgH3Count: number;
  avgQuestionHeadingCount: number;
  avgFaqItemCount: number;
  avgHowToStepCount: number;
  avgImageCount: number;
  avgImageAltCoverage: number;
  avgInternalLinks: number;
  avgExternalLinks: number;
  avgOfficialLinks: number;
  avgCtaLinks: number;
  avgHighlightCount: number;
  avgListCount: number;
  avgTableRows: number;
  avgFirstParagraphChars: number;
  avgReadabilityScore: number;
  summaryRate: number;
  faqRate: number;
  aiReadableRate: number;
  yearInTitleRate: number;
  bracketInTitleRate: number;
}

export interface FeatureDelta {
  key: keyof FeatureGroupSummary;
  label: string;
  top: number;
  bottom: number;
  delta: number;
}

function round(value: number, digits = 2): number {
  const base = 10 ** digits;
  return Math.round(value * base) / base;
}

function safeAverage(values: number[]): number {
  if (values.length === 0) return 0;
  return round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function toFlagRate(values: boolean[]): number {
  if (values.length === 0) return 0;
  const hits = values.filter(Boolean).length;
  return round(hits / values.length);
}

function extractMarkdownLinks(markdown: string): string[] {
  const urls: string[] = [];
  const re = /\[([^\]]+)\]\(([^)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(markdown)) !== null) {
    const start = match.index;
    if (start > 0 && markdown[start - 1] === '!') continue;
    urls.push(match[2]);
  }
  return urls;
}

function extractFirstParagraph(markdown: string): string {
  const blocks = markdown
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);

  for (const block of blocks) {
    if (/^#/.test(block)) continue;
    if (/^!\[/.test(block)) continue;
    if (/^(?:[-*]|\d+\.)\s/.test(block)) continue;
    const text = stripMarkup(block);
    if (text.length >= 20) return text;
  }

  return '';
}

function isOfficialUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return OFFICIAL_DOMAIN_PATTERNS.some((pattern) => pattern.test(parsed.hostname));
  } catch {
    return false;
  }
}

function isInternalUrl(url: string, baseHost: string): boolean {
  if (url.startsWith('/')) return true;
  try {
    const parsed = new URL(url);
    return parsed.hostname === baseHost || parsed.hostname.endsWith(`.${baseHost}`);
  } catch {
    return false;
  }
}

function isCtaUrl(url: string): boolean {
  return /utm=blog_(top|mid|bottom)|\/packages\/|\/contact|\/inquiry|\/booking|\/quote|kakao|mrt|myrealtrip/i.test(url);
}

export function extractBlogLearningFeatures(
  title: string,
  description: string,
  blogHtml: string,
  baseUrl = 'https://yeosonam.com',
): BlogLearningFeatures {
  const bodyText = stripMarkup(blogHtml);
  const lines = blogHtml.split('\n');
  const links = extractMarkdownLinks(blogHtml);
  const baseHost = (() => {
    try {
      return new URL(baseUrl).hostname;
    } catch {
      return 'yeosonam.com';
    }
  })();

  const imageMatches = blogHtml.match(/!\[[^\]]*\]\(([^)]+)\)/g) || [];
  const imageWithAltMatches = blogHtml.match(/!\[[^\]\s][^\]]*\]\(([^)]+)\)/g) || [];
  const h2Count = lines.filter((line) => /^##\s+\S/.test(line.trim())).length;
  const h3Count = lines.filter((line) => /^###\s+\S/.test(line.trim())).length;
  const faqItems = extractFaqItems(blogHtml);
  const howToSteps = extractHowToSteps(blogHtml);
  const readability = computeReadability(blogHtml);
  const aiReadability = checkAiReadability(blogHtml, 'info');
  const firstParagraph = extractFirstParagraph(blogHtml);
  const internalLinkCount = links.filter((url) => isInternalUrl(url, baseHost)).length;
  const externalLinkCount = links.filter((url) => /^https?:\/\//i.test(url) && !isInternalUrl(url, baseHost)).length;
  const officialLinkCount = links.filter((url) => isOfficialUrl(url)).length;
  const ctaLinkCount = links.filter((url) => isCtaUrl(url)).length;
  const listCount =
    (blogHtml.match(/(^|\n)\s*[-*]\s+\S/g) || []).length +
    (blogHtml.match(/(^|\n)\s*\d+\.\s+\S/g) || []).length;
  const tableRowCount = (blogHtml.match(/(^|\n)\s*\|.+\|/g) || []).length;

  return {
    titleLength: title.trim().length,
    descriptionLength: description.trim().length,
    bodyChars: bodyText.length,
    h2Count,
    h3Count,
    questionHeadingCount: (blogHtml.match(QUESTION_HEADING_RE) || []).length,
    hasSummarySection: SUMMARY_HEADING_RE.test(blogHtml),
    hasFaqSection: FAQ_HEADING_RE.test(blogHtml) || faqItems.length > 0,
    faqItemCount: faqItems.length,
    howToStepCount: howToSteps.length,
    imageCount: imageMatches.length,
    imageAltCoverage: imageMatches.length === 0 ? 0 : round(imageWithAltMatches.length / imageMatches.length),
    internalLinkCount,
    externalLinkCount,
    officialLinkCount,
    ctaLinkCount,
    highlightCount: (blogHtml.match(/==[^=]+==|<mark>[\s\S]*?<\/mark>/g) || []).length,
    listCount,
    tableRowCount,
    firstParagraphChars: firstParagraph.length,
    yearInTitle: /(20\d{2})/.test(title),
    bracketInTitle: /[\[\(【]/.test(title),
    readabilityScore: readability.score,
    aiReadable: aiReadability.passed,
  };
}

export function buildLearningPostSample(
  post: LearningPostInput,
  baseUrl = 'https://yeosonam.com',
): LearningPostSample {
  const title = post.seo_title || '';
  const description = post.seo_description || '';
  const blogHtml = post.blog_html || '';

  return {
    id: post.id,
    slug: post.slug || null,
    title,
    angle: post.angle_type || null,
    destination: post.destination || null,
    prompt_version: post.prompt_version || null,
    traffic: post.traffic_count ?? null,
    avg_time: post.avg_time_on_page ?? null,
    scroll: post.avg_scroll_depth ?? null,
    cta_rate: post.cta_click_rate ?? null,
    conversions: post.first_touch_conversions ?? null,
    search_position: post.avg_search_position ?? null,
    score: post.score ?? null,
    features: extractBlogLearningFeatures(title, description, blogHtml, baseUrl),
  };
}

export function summarizeFeatureGroup(posts: LearningPostSample[]): FeatureGroupSummary {
  return {
    sampleSize: posts.length,
    avgTitleLength: safeAverage(posts.map((post) => post.features.titleLength)),
    avgDescriptionLength: safeAverage(posts.map((post) => post.features.descriptionLength)),
    avgBodyChars: safeAverage(posts.map((post) => post.features.bodyChars)),
    avgH2Count: safeAverage(posts.map((post) => post.features.h2Count)),
    avgH3Count: safeAverage(posts.map((post) => post.features.h3Count)),
    avgQuestionHeadingCount: safeAverage(posts.map((post) => post.features.questionHeadingCount)),
    avgFaqItemCount: safeAverage(posts.map((post) => post.features.faqItemCount)),
    avgHowToStepCount: safeAverage(posts.map((post) => post.features.howToStepCount)),
    avgImageCount: safeAverage(posts.map((post) => post.features.imageCount)),
    avgImageAltCoverage: safeAverage(posts.map((post) => post.features.imageAltCoverage)),
    avgInternalLinks: safeAverage(posts.map((post) => post.features.internalLinkCount)),
    avgExternalLinks: safeAverage(posts.map((post) => post.features.externalLinkCount)),
    avgOfficialLinks: safeAverage(posts.map((post) => post.features.officialLinkCount)),
    avgCtaLinks: safeAverage(posts.map((post) => post.features.ctaLinkCount)),
    avgHighlightCount: safeAverage(posts.map((post) => post.features.highlightCount)),
    avgListCount: safeAverage(posts.map((post) => post.features.listCount)),
    avgTableRows: safeAverage(posts.map((post) => post.features.tableRowCount)),
    avgFirstParagraphChars: safeAverage(posts.map((post) => post.features.firstParagraphChars)),
    avgReadabilityScore: safeAverage(posts.map((post) => post.features.readabilityScore)),
    summaryRate: toFlagRate(posts.map((post) => post.features.hasSummarySection)),
    faqRate: toFlagRate(posts.map((post) => post.features.hasFaqSection)),
    aiReadableRate: toFlagRate(posts.map((post) => post.features.aiReadable)),
    yearInTitleRate: toFlagRate(posts.map((post) => post.features.yearInTitle)),
    bracketInTitleRate: toFlagRate(posts.map((post) => post.features.bracketInTitle)),
  };
}

const DELTA_FIELDS: Array<{ key: keyof FeatureGroupSummary; label: string }> = [
  { key: 'avgBodyChars', label: '본문 길이' },
  { key: 'avgTitleLength', label: '제목 길이' },
  { key: 'avgDescriptionLength', label: '메타 설명 길이' },
  { key: 'avgH2Count', label: 'H2 개수' },
  { key: 'avgQuestionHeadingCount', label: '질문형 소제목' },
  { key: 'avgFaqItemCount', label: 'FAQ 개수' },
  { key: 'avgHowToStepCount', label: 'HowTo 단계 수' },
  { key: 'avgImageCount', label: '본문 이미지 수' },
  { key: 'avgOfficialLinks', label: '공식 출처 링크 수' },
  { key: 'avgInternalLinks', label: '내부 링크 수' },
  { key: 'avgCtaLinks', label: 'CTA 링크 수' },
  { key: 'avgHighlightCount', label: '형광펜 수' },
  { key: 'avgFirstParagraphChars', label: '첫 문단 길이' },
  { key: 'avgReadabilityScore', label: '가독성 점수' },
  { key: 'summaryRate', label: '요약 섹션 비율' },
  { key: 'faqRate', label: 'FAQ 포함 비율' },
  { key: 'aiReadableRate', label: 'AI 인용 친화 구조 비율' },
  { key: 'yearInTitleRate', label: '제목 연도 포함 비율' },
  { key: 'bracketInTitleRate', label: '제목 괄호 사용 비율' },
];

export function compareFeatureGroups(
  top: FeatureGroupSummary,
  bottom: FeatureGroupSummary,
): FeatureDelta[] {
  return DELTA_FIELDS.map(({ key, label }) => {
    const topValue = top[key];
    const bottomValue = bottom[key];
    return {
      key,
      label,
      top: topValue,
      bottom: bottomValue,
      delta: round(topValue - bottomValue),
    };
  }).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

export function formatFeatureDeltaNarratives(deltas: FeatureDelta[], limit = 8): string[] {
  return deltas.slice(0, limit).map((delta) => {
    const direction = delta.delta > 0 ? '높고' : delta.delta < 0 ? '낮고' : '같고';
    return `${delta.label}: 상위 글 ${delta.top}, 하위 글 ${delta.bottom} (${Math.abs(delta.delta)} 차이, 상위가 더 ${direction})`;
  });
}
