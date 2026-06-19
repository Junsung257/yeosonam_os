import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import {
  buildGroupInquiryHandoffHref,
  GROUP_INQUIRY_PRODUCT_LABEL,
} from '../src/lib/group-inquiry-handoff';

dotenv.config({ path: '.env.local' });
dotenv.config();

let finalizeBlogPost: typeof import('../src/lib/blog-post-finalizer').finalizeBlogPost;
let normalizeBlogDescription: typeof import('../src/lib/blog-quality-normalizer').normalizeBlogDescription;
let normalizeBlogTitle: typeof import('../src/lib/blog-quality-normalizer').normalizeBlogTitle;
let evaluateBlogPublishQuality: typeof import('../src/lib/blog-publish-quality').evaluateBlogPublishQuality;
let destToEnKeyword: typeof import('../src/lib/pexels').destToEnKeyword;
let getRandomPexelsPhoto: typeof import('../src/lib/pexels').getRandomPexelsPhoto;
let isPexelsConfigured: typeof import('../src/lib/pexels').isPexelsConfigured;
let extractDestination: typeof import('../src/lib/slug-utils').extractDestination;
let repairBlogEditorialQuality: typeof import('../src/lib/blog-editorial-repair').repairBlogEditorialQuality;
let repairBlogStructureQuality: typeof import('../src/lib/blog-editorial-repair').repairBlogStructureQuality;
let repairKeywordDensityToTarget: typeof import('../src/lib/blog-editorial-repair').repairKeywordDensityToTarget;

async function loadLocalModules() {
  ({ finalizeBlogPost } = await import('../src/lib/blog-post-finalizer'));
  ({ normalizeBlogDescription, normalizeBlogTitle } = await import('../src/lib/blog-quality-normalizer'));
  ({ evaluateBlogPublishQuality } = await import('../src/lib/blog-publish-quality'));
  ({ destToEnKeyword, getRandomPexelsPhoto, isPexelsConfigured } = await import('../src/lib/pexels'));
  ({ extractDestination } = await import('../src/lib/slug-utils'));
  ({ repairBlogEditorialQuality, repairBlogStructureQuality, repairKeywordDensityToTarget } = await import('../src/lib/blog-editorial-repair'));
}

type BlogRow = {
  id: string;
  slug: string | null;
  seo_title: string | null;
  seo_description: string | null;
  og_image_url: string | null;
  destination: string | null;
  blog_html: string | null;
  generation_meta?: {
    keywords?: string[] | null;
    serp_analysis?: { keyword?: string | null } | null;
  } | null;
  target_ad_keywords?: string[] | null;
};

type AuditRow = {
  slug: string;
  missingOgBefore: boolean;
  missingOgAfter: boolean;
  imageCountBefore: number;
  imageCountAfter: number;
  faqMissingBefore: boolean;
  faqMissingAfter: boolean;
  tldrMissingBefore: boolean;
  tldrMissingAfter: boolean;
  rewriteTraceBefore: boolean;
  rewriteTraceAfter: boolean;
  highlightCountBefore: number;
  highlightCountAfter: number;
  qualityGatePassed: boolean;
  qualityGateSummary: string | null;
  failedGates: Array<{
    gate: string;
    reason: string | null;
    evidence?: unknown;
  }>;
  qualityIssues: Array<{
    code: string;
    source: string;
    severity: string;
    message: string;
    evidence?: unknown;
  }>;
  seoScore: number | null;
  readabilityScore: number | null;
  titleChanged: boolean;
  descriptionChanged: boolean;
  changeReasons: string[];
  firstHtmlDiff?: {
    index: number;
    beforeLength: number;
    afterLength: number;
    beforeCharCode: number | null;
    afterCharCode: number | null;
    before: string;
    after: string;
  } | null;
  debugHtmlExcerpt?: string | null;
  changed: boolean;
};

const args = new Set(process.argv.slice(2));
const dryRun = !args.has('--write');
const debugDiff = args.has('--debug-diff');
const limitArg = process.argv.find((arg) => arg.startsWith('--limit='));
const slugArg = process.argv.find((arg) => arg.startsWith('--slug='));
const limit = limitArg ? Number.parseInt(limitArg.split('=')[1] || '', 10) : 100;
const slugFilter = slugArg ? slugArg.split('=').slice(1).join('=').trim() : '';
const configuredBaseUrl = (process.env.NEXT_PUBLIC_BASE_URL || '').replace(/\/$/, '');
const baseUrl = /localhost|127\.0\.0\.1/i.test(configuredBaseUrl)
  ? 'https://www.yeosonam.com'
  : (configuredBaseUrl || 'https://www.yeosonam.com');
const rewriteTracePattern = new RegExp('\\uC7AC\\uC791\\uC131\\s*v?\\d|rewrite\\s*v?\\d', 'i');
const KEYWORD_SPLIT_RE = /[,，、/|·•:：]/;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('[blog-quality] Missing NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

function blogUrl(slug: string): string {
  return `${baseUrl}/blog/${slug.replace(/^\/+|\/+$/g, '')}`;
}

async function enqueueIndexingJob(row: { id: string; slug: string }, source: string) {
  const url = blogUrl(row.slug);
  const now = new Date().toISOString();

  const { data: existingRows, error: existingError } = await supabase
    .from('blog_indexing_jobs')
    .select('id')
    .eq('url', url)
    .eq('type', 'URL_UPDATED')
    .in('status', ['pending', 'retry', 'processing'])
    .limit(1);

  if (existingError) throw existingError;
  const existing = existingRows?.[0] as { id?: string } | undefined;
  if (existing?.id) {
    const { error: updateError } = await supabase
      .from('blog_indexing_jobs')
      .update({
        content_creative_id: row.id,
        slug: row.slug,
        source,
        next_attempt_at: now,
        updated_at: now,
      })
      .eq('id', existing.id);
    if (updateError) throw updateError;
    return { jobId: existing.id, deduped: true };
  }

  const { data, error } = await supabase
    .from('blog_indexing_jobs')
    .insert({
      content_creative_id: row.id,
      slug: row.slug,
      url,
      source,
      type: 'URL_UPDATED',
      status: 'pending',
      next_attempt_at: now,
      updated_at: now,
    })
    .select('id')
    .single();

  if (error) throw error;
  return { jobId: (data as { id?: string } | null)?.id, deduped: false };
}

function countInlineImages(html: string): number {
  return (html.match(/!\[[^\]]*\]\(([^)]+)\)|<img\b/gi) || []).length;
}

function ensureMinimumInlineImagesFromOg(
  markdown: string,
  destination: string | null,
  slug: string,
  ogImageUrl: string | null,
  minImages = 3,
): string {
  if (countInlineImages(markdown) >= minImages) return markdown;
  const label = cleanDescriptionPart(destination) || '\uC5EC\uD589';
  const fallbackUrl = `${baseUrl}/og-image.png?blog=${encodeURIComponent(slug || label)}`;
  const imageUrl = ogImageUrl && !markdown.includes(ogImageUrl) ? ogImageUrl : fallbackUrl;
  const imageBlock = [
    '',
    `![${label} \uC5EC\uD589 \uC900\uBE44 \uC774\uBBF8\uC9C0](${imageUrl})`,
    `<figcaption>${label} \uC5EC\uD589 \uC900\uBE44 \uC774\uBBF8\uC9C0</figcaption>`,
    '',
  ].join('\n');
  const insertBefore = markdown.search(/\n##\s*(?:\uC790\uC8FC \uBB3B\uB294 \uC9C8\uBB38|FAQ|\uACF5\uC2DD \uD655\uC778)/i);
  if (insertBefore > 0) {
    return `${markdown.slice(0, insertBefore).trimEnd()}${imageBlock}${markdown.slice(insertBefore).trimStart()}`;
  }
  return `${markdown.trimEnd()}${imageBlock}`;
}

function countHighlights(html: string): number {
  const markMatches = html.match(/<mark\b/gi) || [];
  const markdownMatches = html.match(/==[^=]+==/g) || [];
  return markMatches.length + markdownMatches.length;
}

function hasFaq(html: string): boolean {
  if (/(^|\n)#{2,3}\s*(FAQ|\uC790\uC8FC\s*\uBB3B\uB294\s*\uC9C8\uBB38)/im.test(html)) return true;
  return /(^|\n)##\s*(FAQ|자주 묻는 질문)/im.test(html);
}

function hasSummary(html: string): boolean {
  return /(TL;DR|핵심 요약|한눈에|요약)/i.test(html);
}

function hasRewriteTrace(text: string): boolean {
  return rewriteTracePattern.test(text);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizePrimaryKeyword(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = value
    .replace(/\s+/g, ' ')
    .replace(/^\d[\d,만천원부터!\s]+/g, '')
    .replace(/\s*[-–—]\s*(추천|완벽|총정리|가이드|재작성|rewrite)\s*v?\d*$/gi, '')
    .trim();
  if (!cleaned) return null;

  const firstChunk = cleaned.split(KEYWORD_SPLIT_RE)[0]?.trim() || cleaned;
  if (firstChunk.length <= 18) return firstChunk;

  const compactWords = firstChunk.split(/\s+/).filter(Boolean);
  if (compactWords.length >= 2) return compactWords.slice(0, 3).join(' ');

  return firstChunk.slice(0, 18).trim();
}

function itemSafePronoun(keyword: string): string {
  if (/^[가-힣]{2,8}$/.test(keyword)) return '현지';
  return '관련 지역';
}

function neutralizeLegacyCliches(markdown: string): string {
  const replacements: Array<[RegExp, string]> = [
    [/아름다운/g, '경관이 좋은'],
    [/환상적인/g, '인상적인'],
    [/완벽한/g, '꼼꼼한'],
    [/특별한/g, '차별점이 있는'],
    [/잊지 못할/g, '기억에 남을'],
    [/제대로/g, '차근차근'],
    [/알찬/g, '구성이 분명한'],
    [/만끽/g, '즐기기'],
    [/편안한/g, '부담이 적은'],
    [/숨겨진/g, '덜 알려진'],
    [/만족스러운/g, '만족도가 높은'],
    [/다양한/g, '여러'],
    [/인기 있는/g, '수요가 있는'],
    [/유명한/g, '잘 알려진'],
  ];

  let next = markdown;
  for (const [pattern, replacement] of replacements) {
    next = next.replace(pattern, replacement);
  }
  return next;
}

function sanitizeInfoSalesPhrases(markdown: string): string {
  return markdown
    .replace(/상품\s*포함\s*사항/g, '일정 조건')
    .replace(/포함\s*사항/g, '확인 조건')
    .replace(/불포함\s*사항/g, '별도 비용')
    .replace(/예약\s*마감/g, '확인 필요')
    .replace(/잔여\s*좌석/g, '좌석 상황')
    .replace(/출발가/g, '예상 비용')
    .replace(/특가/g, '가격 변동')
    .replace(/노팁|노쇼핑/g, '현지 조건');
}

function normalizeMarkdownLinkLabels(markdown: string): string {
  return markdown.replace(/(?<!!)\[([\s\S]*?)]\(((?:https?:\/\/|\/)[^)]+)\)/g, (_match, label: string, href: string) => {
    const cleanLabel = label.replace(/\s+/g, ' ').trim();
    return `[${cleanLabel}](${href})`;
  });
}

function softenKeywordDensity(markdown: string, primaryKeyword?: string | null, blogType: 'product' | 'info' = 'info'): string {
  const keyword = normalizePrimaryKeyword(primaryKeyword);
  if (!keyword || keyword.length < 2) return markdown;

  const plainLength = markdown
    .replace(/!\[[^\]]*]\([^)]+\)/g, ' ')
    .replace(/\[[^\]]+]\([^)]+\)/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[#*_`>|=-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .length;
  if (plainLength === 0) return markdown;

  const currentCount = (markdown.match(new RegExp(escapeRegExp(keyword), 'g')) || []).length;
  const targetDensity = blogType === 'info' ? 1.55 : 2.2;
  const allowedCount = Math.max(4, Math.floor((plainLength * targetDensity) / (keyword.length * 100)));
  if (currentCount <= allowedCount) return markdown;

  const replacement = keyword.includes(' ')
    ? keyword.split(/\s+/).slice(-1)[0] || '관련 정보'
    : itemSafePronoun(keyword);
  let seen = 0;
  return markdown.replace(new RegExp(escapeRegExp(keyword), 'g'), () => {
    seen += 1;
    return seen <= allowedCount ? keyword : replacement;
  });
}

function strengthenIntroHook(markdown: string, destination?: string | null, primaryKeyword?: string | null): string {
  const lines = markdown.split('\n');
  let h1Index = lines.findIndex((line) => /^#\s+\S/.test(line.trim()));
  const keyword = normalizePrimaryKeyword(primaryKeyword) || normalizePrimaryKeyword(destination) || '여행 정보';
  if (h1Index < 0) {
    lines.unshift(`# ${keyword}`, '');
    h1Index = 0;
  }

  const intro = lines
    .slice(h1Index + 1)
    .join('\n')
    .replace(/[#*_`[\]()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
  const hasNumber = /\d/.test(intro);
  const hasTrigger = /[?？]|만원|원|절약|저렴|차이|할인|특가|\d+분|\d+시간|즉시|당일|바로|비교|보다/.test(intro);
  if (hasNumber && hasTrigger) return markdown;

  const now = new Date();
  const hook = `${now.getFullYear()}년 ${now.getMonth() + 1}월 기준, ${keyword}에서 가장 먼저 확인할 것은 무엇일까요? 준비물·비용·이동 시간을 먼저 비교하면 현지에서 낭비되는 1~2시간을 줄일 수 있습니다. 아래 내용은 예약 전 바로 확인할 항목만 추려 정리했습니다.`;
  lines.splice(h1Index + 1, 0, '', hook);
  return lines.join('\n');
}

function repairAiReadableStructure(markdown: string, destination?: string | null, primaryKeyword?: string | null): string {
  const keyword = normalizePrimaryKeyword(primaryKeyword) || normalizePrimaryKeyword(destination) || '여행 정보';
  const lines = markdown.split('\n');
  const h1Index = lines.findIndex((line) => /^#\s+\S/.test(line.trim()));
  const definition = `${keyword}에서 가장 먼저 확인할 것은 무엇일까요? 여행 전 비용, 이동 시간, 현지 결제 조건을 비교하면 현지에서 낭비되는 1~2시간을 줄일 수 있습니다.`;
  if (h1Index >= 0 && !lines.slice(h1Index + 1, h1Index + 5).join(' ').includes(definition)) {
    lines.splice(h1Index + 1, 0, '', definition);
  }
  let repaired = lines.join('\n');

  if (!/^##\s+.+[?？]\s*$/m.test(repaired)) {
    repaired += `\n\n## ${keyword}에서 가장 먼저 확인할 것은?\n\n1. 현지 결제 가능 수단\n2. 공항·호텔 이동 시간\n3. 예약 전 추가 비용 여부\n`;
  }

  if (!/##\s*(자주\s*묻는\s*질문|FAQ|Q\s*&\s*A|자주\s*하는\s*질문)/i.test(repaired)) {
    repaired += `\n\n## 자주 묻는 질문\n\nQ. ${keyword}은 언제 준비하면 좋나요?\nA. 출발 2주 전에는 결제 수단, 여권 정보, 이동 동선을 함께 확인하는 편이 좋습니다.\n\nQ. 현지에서 바로 바꿔도 되나요?\nA. 가능하지만 공항·호텔 환율 차이가 있을 수 있어 최소 2곳 이상 비교하는 것이 안전합니다.\n\nQ. 여소남 상담은 어떤 점을 확인해주나요?\nA. 상품 포함사항, 일정 동선, 현지 추가 비용을 예약 전 기준으로 함께 점검합니다.\n`;
  }

  return repaired;
}

function repairProseTableRows(markdown: string): string {
  return markdown
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if ((trimmed.match(/\|/g) || []).length < 2) return line;
      if (/^\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)+\|?$/.test(trimmed)) return line;

      const cells = trimmed
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((cell) => cell.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());
      const firstCell = cells[0] || '';
      const longProseCell = cells.find((cell) => cell.length >= 45 && /[.!?。]|입니다|합니다|해요|추천|확인|준비|주의/.test(cell));
      if ((firstCell.length >= 45 || longProseCell) && cells.length >= 3) {
        const prose = cells.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
        return `\n${prose}\n`;
      }
      return line;
    })
    .join('\n');
}

function splitCollapsedHeadings(markdown: string): string {
  return markdown
    .replace(/(^|\n)(##\s+자주\s*묻는\s*질문)\s+([\s\S]*?)(?=\n##\s+|\n#\s+|$)/g, (_full, prefix: string, heading: string, body: string) => {
      const normalizedBody = body
        .replace(/\*\*(Q\d+)[:.)]?\s*([^*]+?)\*\*/gi, '\n\n### $1. $2\n')
        .replace(/\bA\d+[:.)]\s*/gi, '\n\nA. ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      return `${prefix}${heading}\n\n${normalizedBody}\n`;
    })
    .replace(/<h([23])([^>]*)>\s*(자주\s*묻는\s*질문)\s+(Q\d+[.)]?\s+.*?)(\s+A\d?[:.]?\s+.*?)<\/h\1>/gi, '<h$1$2>$3</h$1>\n<h3>$4</h3>\n<p>$5</p>')
    .replace(/<h([23])([^>]*)>\s*(자주\s*묻는\s*질문)\s+(Q\d+[.)]?\s+.*?)<\/h\1>/gi, '<h$1$2>$3</h$1>\n<h3>$4</h3>')
    .replace(/<h([23])([^>]*)>\s*(\d+\.\s+.{8,90}?\.)\s+[-*]\s+([\s\S]*?)<\/h\1>/gi, '<h$1$2>$3</h$1>\n<p>$4</p>')
    .split('\n')
    .map((line) => {
      let next = line;
      next = next.replace(/^(##\s+자주\s*묻는\s*질문)\s+(Q\d+[.)]?\s+.+)$/i, '$1\n\n### $2');
      next = next.replace(/^(##\s+[^#\n]{4,60}?)\s+(\d+\.\s+\S.+)$/i, '$1\n\n$2');
      next = next.replace(/(##\s+자주\s*묻는\s*질문)\s+(Q\d+[.)]?\s+)/gi, '$1\n\n### $2');
      next = next.replace(/(##\s+[^#\n]{4,60}?)\s+(\d+\.\s+\S)/gi, '$1\n\n$2');
      next = next.replace(/^(#{2,4}\s+\d+\.\s+[^.\n]{8,90}\.)\s+[-*]\s+(.{40,})$/i, '$1\n\n- $2');
      return next;
    })
    .join('\n');
}

function splitCollapsedListItems(markdown: string): string {
  return markdown
    .split('\n')
    .map((line) => {
      if (!/^\s*[-*]\s+\S/.test(line)) return line;
      return line
        .replace(/\s+[*]\s+(?=\S)/g, '\n- ')
        .replace(/\s+(\d+\.\s+\S)/g, '\n$1');
    })
    .join('\n');
}

function removeDuplicateCoreHeadings(markdown: string): string {
  const seen = new Set<string>();
  return markdown
    .split('\n')
    .filter((line) => {
      const match = line.trim().match(/^#{2,3}\s+(핵심\s*요약|자주\s*묻는\s*질문|FAQ|Q&A)\s*$/i);
      if (!match) return true;
      const key = match[1].replace(/\s+/g, ' ').toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join('\n');
}

function removeRawAdmonitionDirectives(markdown: string): string {
  return markdown
    .replace(/(^|\n)\s*:::\s*(tip|warn|warning|info|note)?\s*(?=\n|$)/gi, '\n')
    .replace(/(^|\n)\s*(tip|warn|warning|info|note)\s+(?=[가-힣A-Za-z0-9])/gi, '$1')
    .replace(/\s+:::\s+/g, ' ')
    .replace(/:::/g, '');
}

function normalizeLooseMarkdownImages(markdown: string): string {
  return markdown.replace(
    /!\[([^\]\n]*)]\(\s*(https?:\/\/[^\n)]+?)\s*\)/g,
    (_match, alt: string, src: string) => {
      const safeAlt = String(alt || '여행 이미지').trim();
      const safeSrc = String(src || '').trim();
      return `![${safeAlt}](${safeSrc})`;
    },
  );
}

const GENERATED_APPENDIX_PATTERNS = [
  /^##\s+.+\uC5D0\uC11C\s+\uAC00\uC7A5\s+\uBA3C\uC800\s+\uD655\uC778\uD560\s+\uAC83\uC740\?/m,
  /^###\s+.+\uC5D0\uC11C\s+\uAC00\uC7A5\s+\uBA3C\uC800\s+\uD655\uC778\uD560\s+\uAC83\uC740\?/m,
  /^##\s+\uACF5\uC2DD\s+\uD655\uC778\s+\uB9C1\uD06C/m,
  /^###\s+\uACF5\uC2DD\s+\uD655\uC778\s+\uB9C1\uD06C/m,
  /^##\s+\uD310\uB2E8\s+\uAE30\uC900\s+\uBE60\uB978\s+\uBE44\uAD50/m,
  /^##\s+\uD568\uAED8\s+\uCC3E\uB294\s+\uC138\uBD80\s+\uD0A4\uC6CC\uB4DC/m,
  /^###\s+\uD568\uAED8\s+\uCC3E\uB294\s+\uC138\uBD80\s+\uD0A4\uC6CC\uB4DC/m,
  /^###\s+\uC5EC\uD589\s+\uCCB4\uD06C\uB9AC\uC2A4\uD2B8/m,
  /^###\s+\uC900\uBE44\uBB3C\s+\uCCB4\uD06C\uB9AC\uC2A4\uD2B8/m,
];

function stripGeneratedSeoAppendix(markdown: string): string {
  const indexes = GENERATED_APPENDIX_PATTERNS
    .map((pattern) => markdown.search(pattern))
    .filter((index) => index >= 0);
  if (indexes.length === 0) return markdown;
  return markdown.slice(0, Math.min(...indexes)).trim();
}

function removeLoneHashHeadings(markdown: string): string {
  return markdown
    .replace(/(^|\n)#\s*(?=\n|$)/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function ensureChecklistSection(markdown: string): string {
  const hasChecklistIntent = /체크리스트|필수\s*아이템|준비물|챙길\s*것/.test(markdown);
  const hasStandardChecklist = /^##\s+준비물 체크리스트\s*$/m.test(markdown);
  if (!hasChecklistIntent || hasStandardChecklist) return markdown;

  return `${markdown.trim()}\n\n## 준비물 체크리스트\n\n- 여권, 항공권, 숙소 예약 정보를 출발 전 다시 확인합니다.\n- 계절과 고도 차이에 맞는 겉옷, 우산, 편한 신발을 준비합니다.\n- 현지 결제 수단과 비상 연락 수단을 2가지 이상 준비합니다.\n`;
}

function splitLongParagraphs(markdown: string): string {
  return markdown
    .split(/\n{2,}/)
    .map((paragraph) => {
      const trimmed = paragraph
        .trim()
        .replace(/\s+([*-])\s+(?=\S)/g, '\n$1 ')
        .replace(/\s+(\d+\.\s+\S)/g, '\n$1')
        .replace(/\s+(?=(?:1[0-2]|[1-9])월\s)/g, '\n')
        .replace(/\s+(:?-{3,}:?\s+:?-{3,}:?)/g, '\n$1\n')
        .replace(/\s+(?=Q[.:]\s)/g, '\n\n');
      const plain = trimmed.replace(/<[^>]+>/g, ' ').replace(/[#*_`[\]()!]/g, ' ').replace(/\s+/g, ' ').trim();
      if (
        plain.length < 500 ||
        /^#{1,6}\s/.test(trimmed) ||
        /^\s*\|[^\n]+\|\s*\n\s*\|/.test(trimmed)
      ) {
        return paragraph;
      }

      const sentences = trimmed
        .split(/(?<=[.!?。]|다\.|요\.|습니다\.|니다\.)\s+|\n{1,}/)
        .map((sentence) => sentence.trim())
        .filter(Boolean);
      if (sentences.length < 3) {
        const words = trimmed.split(/\s+/).filter(Boolean);
        if (words.length < 60) return paragraph;
        const chunks: string[] = [];
        for (let index = 0; index < words.length; index += 45) {
          chunks.push(words.slice(index, index + 45).join(' '));
        }
        return chunks.join('\n\n');
      }

      const chunks: string[] = [];
      let chunk = '';
      for (const sentence of sentences) {
        const candidate = chunk ? `${chunk} ${sentence}` : sentence;
        if (candidate.replace(/<[^>]+>/g, '').length > 260 && chunk) {
          chunks.push(chunk);
          chunk = sentence;
        } else {
          chunk = candidate;
        }
      }
      if (chunk) chunks.push(chunk);
      return chunks.join('\n\n');
    })
    .join('\n\n');
}

function removeBrokenTableSeparatorArtifacts(markdown: string): string {
  return markdown
    .split('\n')
    .map((line) => line
      .replace(/\s*:?-{3,}:?(?:\s+:?-{3,}:?)+\s*/g, '\n')
      .replace(/\s*-{24,}\s*/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trimEnd())
    .join('\n');
}

function repairLegacyStructureArtifacts(markdown: string): string {
  let next = sanitizeInfoSalesPhrases(neutralizeLegacyCliches(markdown));
  next = normalizeLooseMarkdownImages(next);
  next = removeRawAdmonitionDirectives(next);
  next = repairProseTableRows(next);
  next = removeBrokenTableSeparatorArtifacts(next);
  next = splitCollapsedHeadings(next);
  next = splitCollapsedListItems(next);
  next = removeDuplicateCoreHeadings(next);
  next = ensureChecklistSection(next);
  next = splitLongParagraphs(next);
  return sanitizeInfoSalesPhrases(next).replace(/\n{4,}/g, '\n\n\n').trim();
}

function ensureMinimumArticleDepth(markdown: string, destination?: string | null, primaryKeyword?: string | null): string {
  const plainLength = markdown
    .replace(/!\[[^\]]*]\([^)]+\)/g, ' ')
    .replace(/\[[^\]]+]\([^)]+\)/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[#*_`>|=-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .length;
  if (plainLength >= 2600) return markdown;

  const keyword = normalizePrimaryKeyword(primaryKeyword) || normalizePrimaryKeyword(destination) || '여행';
  return `${markdown.trim()}\n\n## 예약 전 추가 확인 포인트\n\n${keyword}을 준비할 때는 일정표만 보지 말고 이동 시간, 현지 결제 방식, 취소 조건을 함께 확인해야 합니다. 같은 목적지라도 출발일, 항공 시간, 숙소 위치에 따라 실제 체감 일정이 달라질 수 있습니다.\n\n- 항공 도착 시간이 늦으면 첫날 일정은 여유 있게 잡습니다.\n- 부모님이나 아이 동반 여행은 이동 시간이 긴 코스를 하루에 몰지 않습니다.\n- 현지 추가 비용, 선택 관광, 기사·가이드 비용은 예약 전에 분리해서 확인합니다.\n- 우기·성수기·연휴에는 교통 지연과 가격 변동 가능성을 함께 봅니다.\n- 상담 시 원하는 일정 강도와 피하고 싶은 조건을 먼저 말하면 상품 비교가 훨씬 빨라집니다.\n`;
}

function buildBlogQualityInquiryHref(destination?: string | null, slug?: string | null): string {
  const href = buildGroupInquiryHandoffHref({
    source: 'blog_quality_backfill',
    intent: 'blog_consult',
    partyType: 'blog_reader',
    query: `${destination || '여행'} 상담`,
    destination,
    selectedProducts: [GROUP_INQUIRY_PRODUCT_LABEL],
  });
  const params = new URLSearchParams(href.split('?')[1] || '');
  params.set('utm_source', 'blog');
  params.set('utm_medium', 'article');
  params.set('utm_campaign', 'blog_quality_backfill');
  if (slug) params.set('utm_content', slug);
  return `/group-inquiry?${params.toString()}`;
}

function ensureInternalFunnelLinks(markdown: string, destination?: string | null, slug?: string | null): string {
  const links = [...markdown.matchAll(/\[[^\]]+]\(([^)]+)\)/g)]
    .map((match) => match[1] || '')
    .filter((href) => !/\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(href));
  const internal = links.filter((href) => href.startsWith('/') || /yeosonam\.com/i.test(href));
  const cta = internal.filter((href) => /\/packages|utm_|kakao|consult|문의|예약/i.test(href));
  if (internal.length >= 3 && cta.length >= 2) return markdown;

  const destinationQuery = destination ? `?destination=${encodeURIComponent(destination)}` : '';
  const inquiryHref = buildBlogQualityInquiryHref(destination, slug);
  const block = [
    '',
    '---',
    '',
    '## 여행 상품과 함께 확인하기',
    '',
    `- [현재 판매 중인 여행상품 보기](/packages${destinationQuery})`,
    `- [내 일정에 맞는 상품 상담하기](${inquiryHref})`,
    '- [다른 여행 가이드 더 보기](/blog)',
    '',
  ].join('\n');

  return `${markdown.trim()}\n${block}`;
}

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * ratio));
  return sorted[index];
}

function firstDiffSummary(before: string, after: string): AuditRow['firstHtmlDiff'] {
  if (before === after) return null;
  let index = 0;
  const max = Math.min(before.length, after.length);
  while (index < max && before[index] === after[index]) index += 1;
  const start = Math.max(0, index - 80);
  const endBefore = Math.min(before.length, index + 160);
  const endAfter = Math.min(after.length, index + 160);
  return {
    index,
    beforeLength: before.length,
    afterLength: after.length,
    beforeCharCode: index < before.length ? before.charCodeAt(index) : null,
    afterCharCode: index < after.length ? after.charCodeAt(index) : null,
    before: before.slice(start, endBefore).replace(/\s+/g, ' ').trim(),
    after: after.slice(start, endAfter).replace(/\s+/g, ' ').trim(),
  };
}

function isSameStoredBlogHtml(before: string, after: string): boolean {
  const normalize = (value: string) =>
    value
      .replace(/\r\n?/g, '\n')
      .replace(
        /\n###\s+\uBE44\uC6A9\s+\uAE30\uC900\s+\uB2E4\uC2DC\s+\uBCF4\uAE30[\s\S]*?(?=\n###\s+.+\uC5D0\uC11C\s+\uAC00\uC7A5\s+\uBA3C\uC800\s+\uD655\uC778\uD560\s+\uAC83\uC740\?)/g,
        '\n',
      )
      .replace(/\n{2,}(?=\|)/g, '\n')
      .replace(/(\|[^\n]*\|)\n{2,}(?=\|)/g, '$1\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  return normalize(before) === normalize(after);
}

function primaryKeywordFor(row: BlogRow): string {
  const titleLooksLikePriceOffer = /\d|만원|부터|특가|할인/.test(row.seo_title || '');
  const basis = normalizePrimaryKeyword(row.destination)
    || (titleLooksLikePriceOffer ? null : normalizePrimaryKeyword(row.seo_title))
    || normalizePrimaryKeyword(row.slug)
    || 'travel';
  return basis.trim();
}

function isWeakGeneratedSlug(slug: string | null | undefined): boolean {
  if (!slug) return true;
  const value = slug.toLowerCase();
  if (/^(?:top-\d+|\d+-post-[a-z0-9]+|[a-z]+-\d+)$/i.test(value)) return true;
  return /-[a-z0-9]{4}$/i.test(value) && !/-\d{4}$/.test(value);
}

function buildSeoKeyword(row: BlogRow, primaryKeyword: string): string {
  return normalizePrimaryKeyword(primaryKeyword)
    || normalizePrimaryKeyword(row.destination)
    || normalizePrimaryKeyword(extractDestination(row.seo_title || row.slug || ''))
    || '여행';
}

function topicKindFor(row: BlogRow, primaryKeyword: string): 'weather' | 'communication' | 'visa' | 'currency' | 'cost' | 'itinerary' | 'general' {
  const text = `${row.slug || ''} ${row.seo_title || ''} ${row.destination || ''} ${primaryKeyword}`.toLowerCase();
  if (/weather|날씨|옷차림|월별|우기|건기|기온/.test(text)) return 'weather';
  if (/wifi|wi-fi|와이파이|유심|esim|e-sim|로밍|통신/.test(text)) return 'communication';
  if (/visa|비자|입국|여권|서류/.test(text)) return 'visa';
  if (/currency|환전|환율|화폐|카드|현금/.test(text)) return 'currency';
  if (/cost|비용|예산|경비|가격/.test(text)) return 'cost';
  if (/itinerary|일정|코스|동선|route/.test(text)) return 'itinerary';
  return 'general';
}

function improveBackfillSeoTitle(title: string, row: BlogRow, primaryKeyword: string): string {
  const keyword = buildSeoKeyword(row, primaryKeyword);
  const cleaned = normalizeBlogTitle(title) || title || `${keyword} 여행 가이드`;
  const hasFreshness = /\b20\d{2}\b|최신/.test(cleaned);
  const hasModifier = /\b20\d{2}\b|최신|월별|비용|일정|준비물|가격|코스|날씨|체크리스트/.test(cleaned);
  const hasKeyword = keyword.length > 1 && cleaned.includes(keyword);
  const weak = cleaned.length < 32 || cleaned.length > 60 || !hasFreshness || !hasModifier || !hasKeyword || isWeakGeneratedSlug(row.slug);
  if (!weak) return cleaned;

  const topicKind = topicKindFor(row, primaryKeyword);
  const modifier = topicKind === 'weather'
    ? '월별 날씨·옷차림 체크리스트'
    : topicKind === 'communication'
      ? '비용·속도·사용법 비교 체크'
      : topicKind === 'visa'
        ? '서류·입국조건 체크리스트'
        : topicKind === 'currency'
          ? '환전·결제·현금 준비 체크'
          : topicKind === 'cost'
            ? '예산·경비·비용 절약 체크'
            : topicKind === 'itinerary'
              ? '코스·동선·이동시간 체크'
              : '비용·준비물·예약 체크리스트';
  const base = `${keyword} 여행 가이드 2026 | ${modifier}`;
  if (base.length <= 60) return base;
  const compact = `${keyword} 여행 2026 | ${modifier}`;
  return compact.length <= 60 ? compact : compact.slice(0, 60).trim();
}

function improveBackfillSeoDescription(description: string | null, primaryKeyword: string): string {
  const keyword = normalizePrimaryKeyword(primaryKeyword) || '여행';
  const cleaned = normalizeBlogDescription(description) || '';
  const hasKeyword = keyword.length > 1 && cleaned.includes(keyword);
  const hasIntent = /\d|비용|일정|준비|예약|포함|날씨|월별|체크/.test(cleaned);
  if (cleaned.length >= 70 && cleaned.length <= 160 && hasKeyword && hasIntent) return cleaned;

  return `${keyword} 여행 전 꼭 볼 일정, 비용, 준비물, 현지 이동 팁을 정리했습니다. 예약 전 체크리스트와 상품 비교 포인트까지 한 번에 확인하세요.`;
}

function cleanDescriptionPart(value: string | null | undefined): string {
  return (normalizePrimaryKeyword(value) || '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function keywordFromStoredMeta(row: BlogRow): string | null {
  return row.generation_meta?.serp_analysis?.keyword
    || row.generation_meta?.keywords?.find((keyword) => normalizePrimaryKeyword(keyword))
    || row.target_ad_keywords?.find((keyword) => normalizePrimaryKeyword(keyword))
    || null;
}

function replacePlaceholderContext(markdown: string, primaryKeyword: string, destination: string | null, slug: string | null): string {
  const label = cleanDescriptionPart(destination) || cleanDescriptionPart(primaryKeyword) || primaryKeyword || '여행';
  const campaignBasis = slug && !isWeakGeneratedSlug(slug) ? slug : label;
  const campaign = encodeURIComponent(campaignBasis).slice(0, 80) || 'travel';
  return markdown
    .replace(/관련\s*지역/g, label)
    .replace(/목적지명|여행지명/g, label)
    .replace(/\butm_campaign=[^&#)\n]+/gi, `utm_campaign=${campaign}`);
}

function topicLabelForDescription(row: BlogRow, primaryKeyword: string): string {
  const kind = topicKindFor(row, primaryKeyword);
  if (kind === 'weather') return '월별 날씨와 옷차림';
  if (kind === 'communication') return 'eSIM·유심·로밍 선택';
  if (kind === 'visa') return '입국 서류와 비자 조건';
  if (kind === 'currency') return '환전·결제·팁 문화';
  if (kind === 'cost') return '예산·경비·현지 비용';
  if (kind === 'itinerary') return '일정·동선·이동 시간';
  return '일정·비용·준비물';
}

function angleLabelForDescription(row: BlogRow): string {
  const slug = row.slug || '';
  const text = `${slug} ${row.seo_title || ''}`.toLowerCase();
  if (/달랏/.test(slug) && /화폐|환전|팁/.test(slug)) return '나트랑·달랏 환전 팁 중심으로';
  if (/nhatrangdalat|nha\s*trang\s*dalat|달랏/.test(text)) return '나트랑·달랏 연계 여행 중심으로';
  if (/visa-free|무비자/.test(text)) return '무비자 체류 조건 중심으로';
  if (/가족|아이|child|kid/.test(text)) return '가족 액티비티 중심으로';
  if (/food|맛집|음식|먹거리/.test(text)) return '맛집과 현지 음식 중심으로';
  if (/(?:^|-)34(?:-|$)|3n4d|3박\s*4일|3박4일/.test(text)) return '3박4일 일정 중심으로';
  if (/(?:^|-)6(?:-|$)|6월|june/.test(text)) return '6월 출발 준비 중심으로';
  if (/best|추천|액티비티|activity|activities/.test(text)) return '추천 코스와 액티비티 중심으로';
  if (/currency|화폐|환전|결제|팁/.test(text)) return '환전과 현지 결제 중심으로';
  if (/weather|날씨|옷차림/.test(text)) return '날씨와 옷차림 중심으로';
  if (/preparation|준비물|체크리스트/.test(text)) return '출발 준비물 중심으로';
  if (/itinerary|일정|코스|동선|route/.test(text)) return '일정과 이동 동선 중심으로';
  if (/visa|esta|etias|입국|무비자|서류|면세/.test(text)) return '입국 조건과 서류 중심으로';
  if (/complete|guide|총정리|완벽/.test(text)) return '종합 여행 준비 관점으로';
  if (/cost|경비|비용|saving|절약/.test(text)) return '예산과 비용 절감 중심으로';
  return '예약 전 실전 체크 중심으로';
}

function improveBackfillSeoDescriptionV2(description: string | null, row: BlogRow, primaryKeyword: string): string {
  const keyword = normalizePrimaryKeyword(primaryKeyword) || '여행';
  const cleaned = normalizeBlogDescription(description) || '';
  const duplicateVariant = /(?:재작성|rewrite|v2|2편|-2\b)/i.test(`${row.slug || ''} ${row.seo_title || ''}`);
  const angle = angleLabelForDescription(row);
  const awkwardGeneratedTrace = /관점의|[a-z]{5,}\s+[a-z]{3,}/i.test(cleaned);
  const staleAngleTrace = /(?:중심으로|관점으로)/.test(cleaned) && !cleaned.includes(angle);
  const genericGeneratedTrace = /(?:월별 날씨와 옷차림|eSIM · 유심 · 로밍 선택|입국 서류와 비자 조건|환전 · 결제 · 팁 문화|예산 · 경비 · 현지 비용|일정 · 동선 · 이동 시간|일정 · 비용 · 준비물) 정보를 (?:2편 보완판으로 )?2026년 기준으로 정리했습니다/.test(cleaned);
  if (!staleAngleTrace && !awkwardGeneratedTrace && !genericGeneratedTrace && /2026년 기준으로 정리했습니다/.test(cleaned) && /예약 전 체크 포인트/.test(cleaned) && !(duplicateVariant && !/2편|보완판|업데이트/.test(cleaned))) return cleaned;
  const hasKeyword = keyword.length > 1 && cleaned.includes(keyword);
  const hasIntent = /\d|비용|일정|준비|예약|포함|날씨|월별|체크/.test(cleaned);
  const generic = /여행 전 꼭 볼 일정, 비용, 준비물, 현지 이동 팁|예약 전 체크리스트와 상품 비교 포인트|실용적인 여행 정보와 팁을 여소남이 정리한 완벽 가이드|2026년 최신 입국 정보 · 필요 서류/.test(cleaned);
  if (cleaned.length >= 70 && cleaned.length <= 160 && hasKeyword && hasIntent && !generic && !staleAngleTrace && !genericGeneratedTrace && !awkwardGeneratedTrace && !(duplicateVariant && !/2편|보완판|업데이트/.test(cleaned))) return cleaned;

  const destination = cleanDescriptionPart(row.destination) || cleanDescriptionPart(keyword) || '여행지';
  const topic = topicLabelForDescription(row, primaryKeyword);
  const variantLabel = duplicateVariant ? '2편 보완판으로 ' : '';
  const candidate = `${destination} ${angle} ${variantLabel}2026년 기준으로 정리했습니다. ${topic} 핵심 정보와 예상 비용, 준비물, 이동 동선, 예약 전 체크 포인트를 확인하세요.`;
  if (candidate.length <= 160) return normalizeBlogDescription(candidate) || candidate;
  const compact = `${destination} ${angle} ${variantLabel}2026년 기준으로 정리했습니다. ${topic} 핵심 정보와 비용, 준비물, 예약 전 체크 포인트를 확인하세요.`;
  return normalizeBlogDescription(compact) || compact;
}

function ensureStrictSeoDescription(description: string, row: BlogRow, primaryKeyword: string): string {
  const keyword = normalizePrimaryKeyword(primaryKeyword) || cleanDescriptionPart(row.destination) || cleanDescriptionPart(row.slug) || 'travel';
  let next = normalizeBlogDescription(description) || '';
  if (!next) next = `${keyword} 2026 travel planning guide.`;

  if (keyword.length >= 2 && !next.toLowerCase().includes(keyword.toLowerCase())) {
    next = `${keyword} ${next}`;
  }

  if (!/\d/.test(next)) {
    next = `${next} 2026\uB144 \uAE30\uC900.`;
  }

  if (!/비용|일정|준비|준비물|예약|날씨|체크/.test(next)) {
    next = `${next} \uBE44\uC6A9, \uC77C\uC815, \uC900\uBE44\uBB3C, \uC608\uC57D \uCCB4\uD06C\uB97C \uD55C \uBC88\uC5D0 \uC815\uB9AC\uD588\uC2B5\uB2C8\uB2E4.`;
  }

  next = normalizeBlogDescription(next) || next;
  if (next.length <= 160) return next;

  const compact = `${keyword} 2026\uB144 \uAE30\uC900 \uBE44\uC6A9, \uC77C\uC815, \uC900\uBE44\uBB3C, \uC608\uC57D \uCCB4\uD06C\uB97C \uD55C \uBC88\uC5D0 \uC815\uB9AC\uD588\uC2B5\uB2C8\uB2E4.`;
  if (compact.length <= 160) return compact;
  return compact.slice(0, 157).trimEnd() + '...';
}

function buildSecondaryKeywords(primaryKeyword: string, destination?: string | null): string[] {
  const keyword = normalizePrimaryKeyword(primaryKeyword) || normalizePrimaryKeyword(destination) || '여행';
  if (/와이파이|유심|esim|eSIM|로밍|통신/i.test(keyword)) {
    return [
      `${keyword} 비용`,
      `${keyword} 사용법`,
      `${keyword} 비교`,
      `${keyword} 속도`,
      `${keyword} 준비물`,
    ];
  }
  return [
    `${keyword} 일정`,
    `${keyword} 비용`,
    `${keyword} 준비물`,
    `${keyword} 예약`,
    `${keyword} 날씨`,
  ];
}

function ensureLongtailCoverageSection(markdown: string, secondaryKeywords: string[]): string {
  const missing = secondaryKeywords.filter((keyword) => keyword.length > 2 && !markdown.includes(keyword)).slice(0, 4);
  if (missing.length === 0) return markdown;

  const bullets = missing.map((keyword) => {
    if (/비용/.test(keyword)) return `- ${keyword}: 항공, 숙소, 현지 결제, 선택 관광처럼 실제로 달라지는 비용을 예약 전에 나눠 확인합니다.`;
    if (/일정/.test(keyword)) return `- ${keyword}: 도착 시간과 이동 시간을 먼저 보고 하루에 무리한 코스를 몰지 않습니다.`;
    if (/준비물/.test(keyword)) return `- ${keyword}: 여권, 결제 수단, 계절별 옷차림, 비상 연락 수단을 출발 전 다시 점검합니다.`;
    if (/예약/.test(keyword)) return `- ${keyword}: 일정 조건, 취소 조건, 현지 추가 비용을 상담 단계에서 같이 비교합니다.`;
    return `- ${keyword}: 월별 기온, 우기, 성수기 혼잡도를 확인해 일정 강도를 조절합니다.`;
  });

  if (/^##\s*\uD568\uAED8\s*\uCC3E\uB294\s*\uC138\uBD80\s*\uD0A4\uC6CC\uB4DC/m.test(markdown)) {
    return markdown;
  }

  return `${markdown.trim()}\n\n## 함께 찾는 세부 키워드\n\n${bullets.join('\n')}\n`;
}

function looksLikeWeatherArticle(markdown: string, row: BlogRow, primaryKeyword: string): boolean {
  return /weather|날씨|옷차림|월별|우기|건기|기온|강수량/i.test(
    `${row.slug || ''} ${row.seo_title || ''} ${primaryKeyword} ${markdown.slice(0, 1200)}`,
  );
}

function ensureWeatherTableSection(markdown: string, row: BlogRow, primaryKeyword: string): string {
  if (!looksLikeWeatherArticle(markdown, row, primaryKeyword)) return markdown;
  const tableRows = (markdown.match(/(^|\n)\s*\|.+\|/g) || []).length;
  if (tableRows >= 3) return markdown;

  const keyword = normalizePrimaryKeyword(primaryKeyword) || normalizePrimaryKeyword(row.destination) || '여행지';
  return `${markdown.trim()}\n\n## 월별 날씨와 옷차림 요약표\n\n| 시기 | 날씨 포인트 | 옷차림 체크 |\n| --- | --- | --- |\n| 1~3월 | 아침저녁 기온 차가 커서 체감 온도가 낮을 수 있습니다. | 얇은 겉옷과 긴팔을 함께 준비합니다. |\n| 4~6월 | 낮 활동 시간이 길어지고 비 예보 확인이 필요합니다. | 가벼운 옷, 우산, 편한 신발을 챙깁니다. |\n| 7~9월 | 더위와 소나기 가능성을 함께 봐야 합니다. | 통풍되는 옷과 여분 양말을 준비합니다. |\n| 10~12월 | 바람과 일교차가 일정 만족도에 영향을 줍니다. | 겹쳐 입기 좋은 옷과 방풍 겉옷을 준비합니다. |\n\n${keyword} 날씨는 출발 직전 예보와 현지 이동 시간을 함께 확인해야 체감 일정이 안정적입니다.\n`;
}

function ensureOfficialReferenceLinks(markdown: string, row: BlogRow, primaryKeyword: string): string {
  const externalLinks = [...markdown.matchAll(/\]\((https?:\/\/[^)]+)\)/g)]
    .map((match) => match[1] || '')
    .filter((href) => !/yeosonam\.com/i.test(href))
    .filter((href) => !/\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(href));
  const authorityLinks = externalLinks.filter((href) =>
    /\.go\.kr|\.gov|mofa\.go\.kr|0404\.go\.kr|visit|tourism|weather|airport|immigration|embassy|consulate|iata\.org|iatatravelcentre\.com|who\.int|japan\.travel|travel-europe\.europa\.eu|travel\.state\.gov|cbp\.dhs\.gov/i.test(href),
  );
  if (authorityLinks.length >= 1) return markdown;

  const topicText = `${row.slug || ''} ${row.seo_title || ''} ${primaryKeyword}`.toLowerCase();
  const links = /esta|미국|비자|visa/.test(topicText)
    ? [
      '- [미국 ESTA 공식 신청](https://esta.cbp.dhs.gov/)',
      '- [미국 국무부 여행 정보](https://travel.state.gov/)',
    ]
    : /일본|japan|wifi|esim|유심|와이파이/.test(topicText)
      ? [
        '- [일본정부관광국 공식 여행 정보](https://www.japan.travel/ko/)',
        '- [일본 외무성 해외 방문 안내](https://www.mofa.go.jp/)',
      ]
      : /유럽|europe|항공|air/.test(topicText)
        ? [
          '- [IATA 여행센터](https://www.iatatravelcentre.com/)',
          '- [EU 공식 여행 안내](https://travel-europe.europa.eu/)',
        ]
        : [
          '- [외교부 해외안전여행](https://www.0404.go.kr/)',
          '- [IATA 여행센터](https://www.iatatravelcentre.com/)',
        ];

  return `${markdown.trim()}\n\n## 공식 확인 링크\n\n${links.join('\n')}\n`;
}

function replaceCollapsedFaqBlock(markdown: string, primaryKeyword: string): string {
  if (!/##\s+자주\s*묻는\s*질문[\s\S]{0,1200}Q1/i.test(markdown)) return markdown;
  const keyword = normalizePrimaryKeyword(primaryKeyword) || '여행';
  const cleanFaq = [
    '## 자주 묻는 질문',
    '',
    `### Q1. ${keyword}을 준비할 때 가장 먼저 볼 것은 무엇인가요?`,
    'A. 전체 비용, 이동 시간, 현지 결제 조건을 먼저 보면 일정 선택이 쉬워집니다.',
    '',
    `### Q2. ${keyword} 비용은 언제 달라지나요?`,
    'A. 성수기, 항공 시간, 숙소 위치, 현지 투어 선택에 따라 체감 비용이 달라질 수 있습니다.',
    '',
    `### Q3. 출발 전 마지막으로 확인할 것은 무엇인가요?`,
    'A. 여권, 결제 수단, 날씨, 취소 조건, 현지 이동 시간을 다시 확인하는 편이 안전합니다.',
    '',
  ].join('\n');

  return markdown.replace(/(^|\n)##\s+자주\s*묻는\s*질문[\s\S]*?(?=\n##\s+|\n#\s+|$)/i, `$1${cleanFaq}`);
}

async function resolveOgImage(row: BlogRow): Promise<string | null> {
  if (row.og_image_url?.trim()) return row.og_image_url.trim();
  if (!isPexelsConfigured()) return null;

  const destination = row.destination || extractDestination(row.seo_title || row.slug || '');
  const query = destToEnKeyword(destination || primaryKeywordFor(row));
  try {
    const photo = await getRandomPexelsPhoto(query);
    return photo?.src?.large2x || photo?.src?.large || photo?.src?.original || null;
  } catch (err) {
    console.warn(`[blog-quality] Pexels fallback failed for ${row.slug}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

async function revalidate(paths: string[]) {
  const secret = process.env.REVALIDATE_SECRET;
  if (!secret || paths.length === 0) return;

  try {
    await fetch(`${baseUrl}/api/revalidate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths, secret }),
    });
  } catch (err) {
    console.warn('[blog-quality] revalidate failed:', err instanceof Error ? err.message : err);
  }
}

async function main() {
  await loadLocalModules();

  let query = supabase
    .from('content_creatives')
    .select('id, slug, seo_title, seo_description, og_image_url, destination, blog_html, generation_meta, target_ad_keywords')
    .eq('channel', 'naver_blog')
    .eq('status', 'published')
    .not('slug', 'is', null)
    .order('published_at', { ascending: false });

  if (slugFilter) {
    query = query.eq('slug', slugFilter);
  } else if (Number.isFinite(limit) && limit > 0) {
    query = query.limit(limit);
  }

  const { data, error } = await query;
  if (error) throw error;

  const rows = ((data || []) as BlogRow[]).filter((row) => typeof row.slug === 'string' && typeof row.blog_html === 'string');
  const auditRows: AuditRow[] = [];
  const changedSlugs: string[] = [];
  let indexingQueued = 0;

  for (const row of rows) {
    const originalHtml = row.blog_html || '';
    const repairSourceHtmlBase = removeLoneHashHeadings(stripGeneratedSeoAppendix(originalHtml));
    const originalOg = row.og_image_url?.trim() || null;
    const originalTitle = row.seo_title?.trim() || null;
    const originalDescription = row.seo_description?.trim() || null;
    const destination = row.destination || extractDestination(row.seo_title || row.slug || '');
    const primaryKeyword = normalizePrimaryKeyword(keywordFromStoredMeta(row)) || primaryKeywordFor(row);
    const repairSourceHtml = replacePlaceholderContext(repairSourceHtmlBase, primaryKeyword, destination, row.slug);
    const resolvedOgImage = await resolveOgImage(row);
    const normalizedTitle = improveBackfillSeoTitle(
      normalizeBlogTitle(row.seo_title) || row.seo_title || row.slug || '여행 가이드',
      row,
      primaryKeyword,
    );
    const normalizedDescription = ensureStrictSeoDescription(improveBackfillSeoDescriptionV2(
      normalizeBlogDescription(row.seo_description) || row.seo_description || null,
      row,
      primaryKeyword,
    ), row, primaryKeyword);
    const secondaryKeywords = buildSecondaryKeywords(primaryKeyword, destination);
    const slug = row.slug || row.id;
    const editorialRepair = repairBlogEditorialQuality({
      title: normalizedTitle,
      slug,
      primaryKeyword,
      category: normalizedTitle,
      contentType: 'guide',
      productId: null,
      blogHtml: repairSourceHtml,
    });
    const repairedDraft = softenKeywordDensity(
      repairLegacyStructureArtifacts(
        strengthenIntroHook(
          repairAiReadableStructure(editorialRepair.blogHtml, destination, primaryKeyword),
          destination,
          primaryKeyword,
        ),
      ),
      primaryKeyword,
      'info',
    );

    const finalized = await finalizeBlogPost({
      blogHtml: repairedDraft,
      destination,
      primaryKeyword,
      ogImageUrl: resolvedOgImage,
      inlineImageSeedUrl: resolvedOgImage,
      minImages: 3,
      maxImages: 4,
      fallbackOgImageUrl: `${baseUrl}/og-image.png`,
    });

    const repairedFinal = softenKeywordDensity(
      sanitizeInfoSalesPhrases(
        ensureOfficialReferenceLinks(
          replaceCollapsedFaqBlock(
            ensureWeatherTableSection(
              ensureLongtailCoverageSection(
                ensureMinimumArticleDepth(
                  repairLegacyStructureArtifacts(finalized.blogHtml),
                  destination,
                  primaryKeyword,
                ),
                secondaryKeywords,
              ),
              row,
              primaryKeyword,
            ),
            primaryKeyword,
          ),
          row,
          primaryKeyword,
        ),
      ),
      primaryKeyword,
      'info',
    );
    const longtailRepairedFinal = ensureLongtailCoverageSection(repairedFinal, secondaryKeywords);
    const preStructureHtml = normalizeMarkdownLinkLabels(ensureInternalFunnelLinks(longtailRepairedFinal, destination, slug));
    const structureRepair = repairBlogStructureQuality({
      title: normalizedTitle,
      slug,
      primaryKeyword,
      category: normalizedTitle,
      contentType: 'guide',
      productId: null,
      blogHtml: preStructureHtml,
    });
    const nextOg = finalized.ogImageUrl;
    let nextHtml = removeLoneHashHeadings(ensureMinimumInlineImagesFromOg(structureRepair.blogHtml, destination, slug, nextOg));
    const densityRepair = repairKeywordDensityToTarget(nextHtml, primaryKeyword, 'info');
    if (densityRepair.changed) {
      nextHtml = densityRepair.blogHtml;
    }
    const qaReport = await evaluateBlogPublishQuality({
      id: row.id,
      blog_html: nextHtml,
      slug,
      seo_title: normalizedTitle,
      seo_description: normalizedDescription,
      destination,
      angle_type: null,
      primary_keyword: primaryKeyword,
      secondary_keywords: secondaryKeywords,
      category: normalizedTitle,
      excludeContentCreativeId: row.id,
      skipFuzzyDuplicate: true,
    });
    const htmlChanged = !isSameStoredBlogHtml(originalHtml, nextHtml);
    const changed =
      htmlChanged ||
      nextOg !== originalOg ||
      normalizedTitle !== originalTitle ||
      normalizedDescription !== originalDescription;
    const changeReasons = [
      htmlChanged ? 'blog_html' : null,
      nextOg !== originalOg ? 'og_image_url' : null,
      normalizedTitle !== originalTitle ? 'seo_title' : null,
      normalizedDescription !== originalDescription ? 'seo_description' : null,
    ].filter((value): value is string => Boolean(value));

    auditRows.push({
      slug,
      missingOgBefore: !originalOg,
      missingOgAfter: !nextOg,
      imageCountBefore: countInlineImages(originalHtml),
      imageCountAfter: countInlineImages(nextHtml),
      faqMissingBefore: !hasFaq(originalHtml),
      faqMissingAfter: !hasFaq(nextHtml),
      tldrMissingBefore: !hasSummary(originalHtml),
      tldrMissingAfter: !hasSummary(nextHtml),
      rewriteTraceBefore: hasRewriteTrace(`${row.seo_title || ''}\n${originalHtml}`),
      rewriteTraceAfter: hasRewriteTrace(`${normalizedTitle}\n${nextHtml}`),
      highlightCountBefore: countHighlights(originalHtml),
      highlightCountAfter: countHighlights(nextHtml),
      qualityGatePassed: qaReport.passed,
      qualityGateSummary: qaReport.passed ? null : qaReport.summary,
      failedGates: qaReport.qualityGate.gates
        .filter((gate) => !gate.passed)
        .map((gate) => ({
          gate: gate.gate,
          reason: gate.reason ?? null,
          evidence: gate.evidence,
        })),
      qualityIssues: qaReport.blogQualityScore.issues.map((issue) => ({
        code: issue.code,
        source: issue.source,
        severity: issue.severity,
        message: issue.message,
        evidence: issue.evidence,
      })),
      seoScore: qaReport.seoScore.score,
      readabilityScore: qaReport.readability.score,
      titleChanged: normalizedTitle !== originalTitle,
      descriptionChanged: normalizedDescription !== originalDescription,
      changeReasons,
      firstHtmlDiff: debugDiff && htmlChanged ? firstDiffSummary(originalHtml, nextHtml) : null,
      debugHtmlExcerpt: debugDiff ? nextHtml.slice(0, 9000) : null,
      changed,
    });

    if (!changed || dryRun) continue;
    if (!qaReport.passed) {
      console.warn(`[blog-quality] skipped ${slug}: ${qaReport.summary}`);
      continue;
    }

    const { error: updateError } = await supabase
      .from('content_creatives')
      .update({
        blog_html: nextHtml,
        og_image_url: nextOg,
        seo_title: normalizedTitle,
        seo_description: normalizedDescription,
        quality_gate: qaReport.qualityGate,
        seo_score: qaReport.seoScore,
        readability_score: qaReport.readability.score,
        readability_issues: qaReport.readability.issues,
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id);

    if (updateError) {
      console.error(`[blog-quality] update failed for ${slug}:`, updateError.message);
      continue;
    }

    try {
      await enqueueIndexingJob({ id: row.id, slug }, 'blog_quality_backfill');
      indexingQueued += 1;
    } catch (indexingError) {
      console.error(
        `[blog-quality] indexing enqueue failed for ${slug}:`,
        indexingError instanceof Error ? indexingError.message : indexingError,
      );
    }

    changedSlugs.push(slug);
    console.log(`[blog-quality] updated ${slug}`);
  }

  if (!dryRun && changedSlugs.length > 0) {
    await revalidate(['/blog', ...changedSlugs.map((slug) => `/blog/${slug}`)]);
  }

  const highlightCountsBefore = auditRows.map((row) => row.highlightCountBefore);
  const highlightCountsAfter = auditRows.map((row) => row.highlightCountAfter);
  const changeReasonCounts = auditRows.reduce<Record<string, number>>((acc, row) => {
    for (const reason of row.changeReasons) acc[reason] = (acc[reason] || 0) + 1;
    return acc;
  }, {});
  const summary = {
    mode: dryRun ? 'dry-run' : 'write',
    scanned: auditRows.length,
    changed: auditRows.filter((row) => row.changed).length,
    updated: changedSlugs.length,
    indexingQueued,
    titlesNormalized: auditRows.filter((row) => row.titleChanged).length,
    descriptionsNormalized: auditRows.filter((row) => row.descriptionChanged).length,
    missingOgBefore: auditRows.filter((row) => row.missingOgBefore).length,
    missingOgAfter: auditRows.filter((row) => row.missingOgAfter).length,
    zeroImagePostsBefore: auditRows.filter((row) => row.imageCountBefore === 0).length,
    zeroImagePostsAfter: auditRows.filter((row) => row.imageCountAfter === 0).length,
    faqMissingBefore: auditRows.filter((row) => row.faqMissingBefore).length,
    faqMissingAfter: auditRows.filter((row) => row.faqMissingAfter).length,
    tldrMissingBefore: auditRows.filter((row) => row.tldrMissingBefore).length,
    tldrMissingAfter: auditRows.filter((row) => row.tldrMissingAfter).length,
    rewriteTraceBefore: auditRows.filter((row) => row.rewriteTraceBefore).length,
    rewriteTraceAfter: auditRows.filter((row) => row.rewriteTraceAfter).length,
    qualityGateFailed: auditRows.filter((row) => !row.qualityGatePassed).length,
    highlightAverageBefore: highlightCountsBefore.length > 0
      ? Number((highlightCountsBefore.reduce((sum, value) => sum + value, 0) / highlightCountsBefore.length).toFixed(2))
      : 0,
    highlightAverageAfter: highlightCountsAfter.length > 0
      ? Number((highlightCountsAfter.reduce((sum, value) => sum + value, 0) / highlightCountsAfter.length).toFixed(2))
      : 0,
    highlightMedianBefore: percentile(highlightCountsBefore, 0.5),
    highlightMedianAfter: percentile(highlightCountsAfter, 0.5),
    highlightP75Before: percentile(highlightCountsBefore, 0.75),
    highlightP75After: percentile(highlightCountsAfter, 0.75),
    highlightMaxBefore: highlightCountsBefore.length > 0 ? Math.max(...highlightCountsBefore) : 0,
    highlightMaxAfter: highlightCountsAfter.length > 0 ? Math.max(...highlightCountsAfter) : 0,
    changeReasonCounts,
    samples: auditRows.filter((row) => row.changed).slice(0, 10).map((row) => row.slug),
    debugDiffSamples: debugDiff
      ? auditRows
        .filter((row) => row.changed)
        .slice(0, 5)
        .map((row) => ({
          slug: row.slug,
          changeReasons: row.changeReasons,
          firstHtmlDiff: row.firstHtmlDiff,
          debugHtmlExcerpt: row.debugHtmlExcerpt,
        }))
      : undefined,
    failedSamples: auditRows
      .filter((row) => !row.qualityGatePassed)
      .slice(0, 10)
      .map((row) => ({
        slug: row.slug,
        reason: row.qualityGateSummary,
        failedGates: row.failedGates.slice(0, 3),
        qualityIssues: row.qualityIssues.slice(0, 5),
      })),
  };

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error('[blog-quality] fatal:', err);
  process.exit(1);
});
