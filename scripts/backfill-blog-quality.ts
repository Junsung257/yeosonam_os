import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

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
let repairBlogSemanticSurface: typeof import('../src/lib/blog-editorial-repair').repairBlogSemanticSurface;
let repairBlogStructureQuality: typeof import('../src/lib/blog-editorial-repair').repairBlogStructureQuality;
let repairKeywordDensityToTarget: typeof import('../src/lib/blog-editorial-repair').repairKeywordDensityToTarget;
let canonicalizeBlogPublicLinks: typeof import('../src/lib/blog-link-surface').canonicalizeBlogPublicLinks;
let buildBlogContentBrief: typeof import('../src/lib/blog-content-brief').buildBlogContentBrief;
let buildProductBlogBrief: typeof import('../src/lib/blog-product-brief').buildProductBlogBrief;
let generateProductConsultantBlogPost: typeof import('../src/lib/blog-product-consultant-writer').generateProductConsultantBlogPost;
let loadCustomerOpenContractForPackage: typeof import('../src/lib/product-registration/customer-open-contract').loadCustomerOpenContractForPackage;

async function loadLocalModules() {
  ({ finalizeBlogPost } = await import('../src/lib/blog-post-finalizer'));
  ({ normalizeBlogDescription, normalizeBlogTitle } = await import('../src/lib/blog-quality-normalizer'));
  ({ evaluateBlogPublishQuality } = await import('../src/lib/blog-publish-quality'));
  ({ destToEnKeyword, getRandomPexelsPhoto, isPexelsConfigured } = await import('../src/lib/pexels'));
  ({ extractDestination } = await import('../src/lib/slug-utils'));
  ({ repairBlogEditorialQuality, repairBlogSemanticSurface, repairBlogStructureQuality, repairKeywordDensityToTarget } = await import('../src/lib/blog-editorial-repair'));
  ({ canonicalizeBlogPublicLinks } = await import('../src/lib/blog-link-surface'));
  ({ buildBlogContentBrief } = await import('../src/lib/blog-content-brief'));
  ({ buildProductBlogBrief } = await import('../src/lib/blog-product-brief'));
  ({ generateProductConsultantBlogPost } = await import('../src/lib/blog-product-consultant-writer'));
  ({ loadCustomerOpenContractForPackage } = await import('../src/lib/product-registration/customer-open-contract'));
}

type BlogRow = {
  id: string;
  slug: string | null;
  seo_title: string | null;
  seo_description: string | null;
  og_image_url: string | null;
  destination: string | null;
  content_type?: string | null;
  status?: string | null;
  product_id?: string | null;
  blog_html: string | null;
  generation_meta?: {
    keywords?: string[] | null;
    serp_analysis?: { keyword?: string | null } | null;
    [key: string]: unknown;
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
  publishReady: boolean;
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

function hasBlockingBlogIssue(report: Awaited<ReturnType<typeof evaluateBlogPublishQuality>>): boolean {
  const hasBlockingGate = report.qualityGate.gates.some((gate) => {
    if (gate.passed) return false;
    const evidence = gate.evidence && typeof gate.evidence === 'object'
      ? gate.evidence as { criticalCount?: unknown; warningCount?: unknown }
      : null;
    if (typeof evidence?.criticalCount === 'number') return evidence.criticalCount > 0;
    return true;
  });
  if (hasBlockingGate) return true;
  return report.blogQualityScore.issues.some((issue) => {
    if (issue.code === 'quality_gate.intent_quality') {
      const evidence = issue.evidence && typeof issue.evidence === 'object'
        ? issue.evidence as { criticalCount?: unknown }
        : null;
      if (typeof evidence?.criticalCount === 'number' && evidence.criticalCount === 0) return false;
    }
    return issue.severity === 'critical' || issue.severity === 'major';
  });
}

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
const BLOG_DETAIL_REVALIDATE_TAG = 'blog-detail';
const rewriteTracePattern = new RegExp('\\uC7AC\\uC791\\uC131\\s*v?\\d|rewrite\\s*v?\\d', 'i');
const KEYWORD_SPLIT_RE = /[,，、/|·•:：]/;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('[blog-quality] Missing NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

async function rebuildProductConsultantHtml(productId: string): Promise<{
  html: string;
  generationMeta: Record<string, unknown>;
} | null> {
  const { data, error } = await supabase
    .from('travel_packages')
    .select('*')
    .eq('id', productId)
    .maybeSingle();
  if (error || !data) return null;
  const brief = buildProductBlogBrief(data as Parameters<typeof buildProductBlogBrief>[0], 'value');
  return {
    html: generateProductConsultantBlogPost(data as Parameters<typeof generateProductConsultantBlogPost>[0], brief),
    generationMeta: {
      prompt_version: brief.prompt_version,
      writer: 'product_consultant_writer',
      product_consult_brief: brief,
      content_brief: {
        primary_keyword: brief.primary_keyword,
        product: brief,
      },
    },
  };
}

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
  const currentCount = countInlineImages(markdown);
  if (currentCount >= minImages) return markdown;
  const label = cleanDescriptionPart(destination) || '\uC5EC\uD589';
  const fallbackUrl = `${baseUrl}/og-image.png?blog=${encodeURIComponent(slug || label)}`;
  const missingCount = minImages - currentCount;
  const imageBlocks = Array.from({ length: missingCount }, (_, index) => {
    const slot = currentCount + index + 1;
    const candidateUrl = index === 0 && ogImageUrl && !markdown.includes(ogImageUrl)
      ? ogImageUrl
      : `${fallbackUrl}&slot=${slot}`;
    return [
      '',
      `![${label} \uC5EC\uD589 \uC900\uBE44 \uC774\uBBF8\uC9C0 ${slot}](${candidateUrl})`,
      `<figcaption>${label} \uC5EC\uD589 \uC900\uBE44 \uC774\uBBF8\uC9C0 ${slot}</figcaption>`,
      '',
    ].join('\n');
  }).join('\n');
  const insertBefore = markdown.search(/\n##\s*(?:\uC790\uC8FC \uBB3B\uB294 \uC9C8\uBB38|FAQ|\uACF5\uC2DD \uD655\uC778)/i);
  if (insertBefore > 0) {
    return `${markdown.slice(0, insertBefore).trimEnd()}${imageBlocks}${markdown.slice(insertBefore).trimStart()}`;
  }
  return `${markdown.trimEnd()}${imageBlocks}`;
}

function countHighlights(html: string): number {
  const markMatches = html.match(/<mark\b/gi) || [];
  const markdownMatches = html.match(/==[^=]+==/g) || [];
  return markMatches.length + markdownMatches.length;
}

function hasFaq(html: string): boolean {
  if (/(^|\n)#{2,3}\s*(FAQ|\uC790\uC8FC\s*\uBB3B\uB294\s*\uC9C8\uBB38)/im.test(html)) return true;
  return /(^|\n)\s*(?:#{2,3}\s*)?(?:\*\*)?\s*(FAQ|Q\s*&\s*A|\uC790\uC8FC\s*\uBB3B\uB294\s*\uC9C8\uBB38|\uC790\uC8FC\s*\uD558\uB294\s*\uC9C8\uBB38)\s*(?:\*\*)?\s*$/im.test(html);
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
    [/만끽/g, '즐길 수 있는'],
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
    .replace(/^\s*(?:[-*]\s*)?\[[^\]]*(?:상품|패키지|상담|문의|예약|조건\s*확인|일정\s*확인|관련\s*일정)[^\]]*]\((?:\/packages|\/group-inquiry|https?:\/\/(?:www\.)?yeosonam\.com\/packages|[^)]*(?:utm|consult|kakao)[^)]*)\)\s*$/gim, '')
    .replace(/\s*\[[^\]]*(?:상품|패키지|상담|문의|예약|조건\s*확인|일정\s*확인|관련\s*일정)[^\]]*]\((?:\/packages|\/group-inquiry|https?:\/\/(?:www\.)?yeosonam\.com\/packages|[^)]*(?:utm|consult|kakao)[^)]*)\)\s*/gi, ' ')
    .replace(/\s*\[[^\]]*(?:여소남|상담|문의|안심\s*여행)[^\]]*]\(https?:\/\/(?:www\.)?yeosonam\.com\/[^)]*\)\s*/gi, '\n\n')
    .replace(/(?:^|\n)[^\n]*(?:여소남이\s*검토한|과거\s*데이터를\s*기반으로|여소남\s*큐레이터|여소남\s*에디터|활성\s*상태로\s*조회|현재\s*예약\s*신호|더\s*나은\s*상품|맞춤형\s*.*상품|소중한\s*.*여행을\s*위해)[^\n]*(?:\n|$)/g, '\n')
    .replace(/여소남(?:의)?\s*(?:내부\s*)?데이터로\s*본/g, '출발 전 확인 기준으로 본')
    .replace(/여소남(?:의)?\s*(?:내부\s*)?데이터로\s*보면/g, '출발 전 확인 기준으로 보면')
    .replace(/여소남(?:의)?\s*(?:내부\s*)?데이터/g, '확인된 근거')
    .replace(/여소남은\s*/g, '')
    .replace(/여소남과\s*함께\s*/g, '')
    .replace(/여소남\s*에디터가\s*추천(?:하는|한)?/g, '여행 전 확인할')
    .replace(/총정리/g, '핵심 정리')
    .replace(/완벽\s*가이드/g, '실전 가이드')
    .replace(/지금\s*상품\s*보기/g, '관련 조건 확인')
    .replace(/상품\s*보기/g, '조건 확인')
    .replace(/패키지\s*보기/g, '일정 확인')
    .replace(/상담\s*하기/g, '조건 확인하기')
    .replace(/문의\s*하기/g, '조건 확인하기')
    .replace(/예약\s*하기/g, '예약 전 조건 확인')
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
  const collapsedBrokenLabels = markdown.replace(
    /(?<!!)\[([^\]\n]{1,160})\s*\r?\n\s*\r?\n\s*([^\]]{1,180})]\(/g,
    (_match, first: string, second: string) => `[${`${first} ${second}`.replace(/\s+/g, ' ').trim()}](`,
  );
  const publicLinks = canonicalizeBlogPublicLinks ? canonicalizeBlogPublicLinks(collapsedBrokenLabels, baseUrl) : collapsedBrokenLabels;
  return publicLinks.replace(/(?<!!)\[([\s\S]*?)]\(((?:https?:\/\/|\/)[^)]+)\)/g, (_match, label: string, href: string) => {
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

function ensureStandaloneH1(markdown: string, title: string): string {
  const cleanTitle = title.replace(/\s+/g, ' ').trim();
  if (!cleanTitle) return markdown;
  const lines = markdown.split('\n');
  const firstLine = lines[0]?.trim() || '';
  if (!/^#\s+\S/.test(firstLine)) return markdown;
  const h1Text = firstLine.replace(/^#\s+/, '').replace(/\s+/g, ' ').trim();
  if (h1Text === cleanTitle) return markdown;
  if (h1Text.length < 90) return markdown;

  const intro = h1Text.replace(cleanTitle, '').replace(/\s+/g, ' ').trim();
  const nextLines = [`# ${cleanTitle}`];
  if (intro) nextLines.push('', intro);
  nextLines.push(...lines.slice(1));
  return nextLines.join('\n').replace(/\n{4,}/g, '\n\n\n').trim();
}

function ensureSingleMarkdownH1(markdown: string): string {
  let h1Count = 0;
  return markdown
    .split('\n')
    .map((line) => {
      if (!/^#\s+\S/.test(line.trim())) return line;
      h1Count += 1;
      return h1Count === 1 ? line : line.replace(/^#\s+/, '## ');
    })
    .join('\n');
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

function ensureInternalFunnelLinks(markdown: string, destination?: string | null, slug?: string | null): string {
  const links = [...markdown.matchAll(/\[[^\]]+]\(([^)]+)\)/g)]
    .map((match) => match[1] || '')
    .filter((href) => !/\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(href));
  const internal = links.filter((href) => href.startsWith('/') || /yeosonam\.com/i.test(href));
  if (internal.some((href) => /\/packages/i.test(href)) && internal.some((href) => /\/blog/i.test(href))) return markdown;
  const cta = internal.filter((href) => /\/packages|utm_|kakao|consult|문의|예약/i.test(href));
  if (internal.length >= 3 && cta.length >= 2) return markdown;

  const destinationQuery = destination ? `?destination=${encodeURIComponent(destination)}` : '';
  const slugUtm = slug ? `&utm_content=${encodeURIComponent(slug)}` : '';
  const block = [
    '',
    '---',
    '',
    '## 여행 상품과 함께 확인하기',
    '',
    `- [현재 판매 중인 여행상품 보기](/packages${destinationQuery})`,
    `- [내 일정에 맞는 상품 상담하기](/group-inquiry?utm_source=blog&utm_medium=article&utm_campaign=blog_quality_backfill${slugUtm})`,
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

const ROMANIZED_DESTINATION_HINTS: Array<[RegExp, string]> = [
  [/\bdanang\b|\bda-nang\b|다낭/i, '다낭'],
  [/\bxian\b|서안/i, '서안'],
  [/\bshijiazhuang\b|석가장/i, '석가장'],
  [/\bhohhot\b|호화호특|후허하오터/i, '호화호특'],
  [/\byanji\b|연길/i, '연길'],
  [/\bbeppu\b|벳부/i, '벳부'],
  [/\bfukuoka\b|후쿠오카/i, '후쿠오카'],
  [/\bnagasaki\b|나가사키/i, '나가사키'],
  [/\bokinawa\b|오키나와/i, '오키나와'],
  [/\bbangkok\b|방콕/i, '방콕'],
  [/\bcebu\b|세부/i, '세부'],
  [/\bbohol\b|보홀/i, '보홀'],
  [/\bbali\b|발리/i, '발리'],
  [/\bosaka\b|오사카/i, '오사카'],
  [/\btokyo\b|도쿄/i, '도쿄'],
  [/\bguam\b|괌/i, '괌'],
  [/\bmongolia\b|몽골/i, '몽골'],
  [/\beurope\b|유럽/i, '유럽'],
];

function inferredDestinationForCustomer(row: BlogRow): string | null {
  const titleAndSlug = [row.slug, row.seo_title].filter(Boolean).map(String).join(' ');
  const explicit = usableDestinationKeyword(row.destination)
    || usableDestinationKeyword(extractDestination(row.seo_title || row.slug || ''));
  if (explicit) return explicit;
  if (looksLikeGenericInfoRow(row)) return null;

  for (const [pattern, destination] of ROMANIZED_DESTINATION_HINTS) {
    if (pattern.test(titleAndSlug)) return destination;
  }
  return null;
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

const ENGLISH_MICRO_ANGLE_RE = /\b(?:family budget|transport cost|hotel area budget|weather packing|local mobility)\b/i;

function containsEnglishMicroAngle(value: unknown): boolean {
  if (typeof value === 'string') return ENGLISH_MICRO_ANGLE_RE.test(value);
  if (Array.isArray(value)) return value.some((item) => containsEnglishMicroAngle(item));
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some((item) => containsEnglishMicroAngle(item));
  }
  return false;
}

function microAngleKoreanLabel(row: BlogRow): string | null {
  const text = [
    row.slug,
    row.seo_title,
    row.target_ad_keywords?.join(' '),
    typeof row.generation_meta?.micro_angle === 'string' ? row.generation_meta.micro_angle : null,
    row.generation_meta?.content_brief,
  ].filter(Boolean).map(String).join(' ').toLowerCase();

  if (/budget_family|family budget/.test(text)) return '가족 여행 경비';
  if (/transport_cost|transport cost/.test(text)) return '교통비';
  if (/hotel_area|hotel area budget/.test(text)) return '숙소 지역별 예산';
  if (/weather_packing|weather packing/.test(text)) return '날씨와 옷차림';
  if (/local_mobility|local mobility/.test(text)) return '현지 이동';
  return null;
}

function localizedMicroAngleKeyword(row: BlogRow): string | null {
  const label = microAngleKoreanLabel(row);
  if (!label) return null;
  const destination = inferredDestinationForCustomer(row);
  return destination ? `${destination} ${label}` : label;
}

function replaceEnglishMicroAngleSurface(markdown: string, row: BlogRow, primaryKeyword: string): string {
  const label = microAngleKoreanLabel(row);
  if (!label) return markdown;
  const destination = cleanTravelKeyword(row.destination)
    || cleanTravelKeyword(extractDestination(row.seo_title || row.slug || ''))
    || '';
  const keyword = cleanTravelKeyword(primaryKeyword) || localizedMicroAngleKeyword(row) || label;
  const destinationPrefix = destination ? `${escapeRegExp(destination)}\\s*` : '';
  const slugDestination = (row.slug || '').match(/^[a-z]+/)?.[0] ?? '';

  let next = markdown
    .replace(new RegExp(`${destinationPrefix}family\\s+budget`, 'gi'), keyword)
    .replace(new RegExp(`${destinationPrefix}budget\\s+family`, 'gi'), keyword)
    .replace(new RegExp(`${destinationPrefix}hotel\\s+area\\s+budget`, 'gi'), keyword)
    .replace(new RegExp(`${destinationPrefix}hotel\\s+area`, 'gi'), keyword)
    .replace(new RegExp(`${destinationPrefix}transport\\s+cost`, 'gi'), keyword)
    .replace(new RegExp(`${destinationPrefix}weather\\s+packing`, 'gi'), keyword)
    .replace(new RegExp(`${destinationPrefix}local\\s+mobility`, 'gi'), keyword)
    .replace(/\bfamily\s+budget\b/gi, label)
    .replace(/\bbudget\s+family\b/gi, label)
    .replace(/\bhotel\s+area\s+budget\b/gi, label)
    .replace(/\bhotel\s+area\b/gi, label)
    .replace(/\btransport\s+cost\b/gi, label)
    .replace(/\bweather\s+packing\b/gi, label)
    .replace(/\blocal\s+mobility\b/gi, label)
    .replace(/\bbudget\b/gi, '예산')
    .replace(/familybudget/gi, label.replace(/\s+/g, ''))
    .replace(/budgetfamily/gi, label.replace(/\s+/g, ''))
    .replace(/hotelareabudget/gi, label.replace(/\s+/g, ''))
    .replace(/transportcost/gi, label.replace(/\s+/g, ''))
    .replace(/weatherpacking/gi, label.replace(/\s+/g, ''))
    .replace(/localmobility/gi, label.replace(/\s+/g, ''));
  if (destination && slugDestination) {
    next = next.replace(new RegExp(`\\b${escapeRegExp(slugDestination)}\\s+${escapeRegExp(label)}`, 'gi'), `${destination} ${label}`);
  }
  return next;
}

function usableBriefText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.trim();
  return cleaned && !containsEnglishMicroAngle(cleaned) ? cleaned : null;
}

function usableBriefList(value: unknown): unknown[] | null {
  if (!Array.isArray(value)) return null;
  const cleaned = value.filter((item) => !containsEnglishMicroAngle(item));
  return cleaned.length > 0 ? cleaned : null;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
}

function buildInfoContractGenerationMeta(
  row: BlogRow,
  params: {
    normalizedTitle: string;
    primaryKeyword: string;
    destination: string | null;
    contentType: string;
    secondaryKeywords: string[];
  },
): Record<string, unknown> {
  const existing = row.generation_meta && typeof row.generation_meta === 'object'
    ? { ...row.generation_meta }
    : {};
  const existingBrief = existing.content_brief && typeof existing.content_brief === 'object'
    ? existing.content_brief as Record<string, unknown>
    : null;
  const legacyEnglishBrief = containsEnglishMicroAngle(existingBrief);
  const storedSerp = row.generation_meta?.serp_analysis && typeof row.generation_meta.serp_analysis === 'object'
    && typeof (row.generation_meta.serp_analysis as { source?: unknown }).source === 'string'
    ? row.generation_meta.serp_analysis as Parameters<typeof buildBlogContentBrief>[0]['serp']
    : null;
  const brief = buildBlogContentBrief({
    topic: params.normalizedTitle || row.seo_title || row.slug || params.primaryKeyword,
    destination: params.destination,
    primaryKeyword: params.primaryKeyword,
    category: params.contentType,
    source: 'blog_quality_backfill',
    keywords: params.secondaryKeywords,
    serp: storedSerp,
  });

  return {
    ...existing,
    prompt_version: typeof existing.prompt_version === 'string' && existing.prompt_version.trim()
      ? existing.prompt_version
      : 'backfill-info-writer-v2',
    writer: typeof existing.writer === 'string' && existing.writer.trim()
      ? existing.writer
      : 'info_writer',
    content_brief: {
      ...(existingBrief ?? {}),
      title: usableBriefText(existingBrief?.title) ?? brief.title,
      primary_keyword: usableBriefText(existingBrief?.primary_keyword) ?? brief.primaryKeyword,
      secondary_keywords: usableBriefList(existingBrief?.secondary_keywords)
        ? usableBriefList(existingBrief?.secondary_keywords)
        : brief.secondaryKeywords,
      search_intent: !legacyEnglishBrief && typeof existingBrief?.search_intent === 'string' && existingBrief.search_intent.trim()
        ? existingBrief.search_intent
        : brief.searchIntent,
      required_sections: !legacyEnglishBrief && Array.isArray(existingBrief?.required_sections) && existingBrief.required_sections.length > 0
        ? existingBrief.required_sections
        : brief.requiredSections,
      forbidden_angles: Array.isArray(existingBrief?.forbidden_angles)
        ? existingBrief.forbidden_angles
        : brief.forbiddenAngles,
      source_requirements: Array.isArray(existingBrief?.source_requirements)
        ? existingBrief.source_requirements
        : brief.sourceRequirements,
      evidence: Array.isArray(existingBrief?.evidence) && existingBrief.evidence.length > 0
        ? existingBrief.evidence
        : brief.evidence,
      passed: typeof existingBrief?.passed === 'boolean' ? existingBrief.passed : brief.passed,
      issues: Array.isArray(existingBrief?.issues) ? existingBrief.issues : brief.issues,
      backfilled_contract: true,
    },
  };
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

function cleanTravelKeyword(value: string | null | undefined): string | null {
  const cleaned = normalizePrimaryKeyword(value)
    ?.replace(/[-_]+/g, ' ')
    .replace(/\b(?:rewrite|rewritten|draft|v\d+)\b/gi, '')
    .replace(/\b(?:post|guide)\b/gi, '')
    .replace(/\s*(?:재작성|초안|임시|최종)\s*v?\d*\s*$/i, '')
    .replace(/\s*(?:여행\s*)?가이드\s*$/i, '')
    .replace(/\s*총정리\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned || /^[a-z0-9\s-]{1,8}$/i.test(cleaned)) return null;
  if (!/[\uAC00-\uD7A3]/.test(cleaned) && !/\b(?:travel|trip|visa|weather|itinerary|budget|hotel|flight|esim|usim)\b/i.test(cleaned)) return null;
  if (/^\d+[\s\w-]*$/i.test(cleaned)) return null;
  if (/^\d+\s+[a-z0-9]{3,}\s+여행\s*가이드/i.test(cleaned)) return null;
  return cleaned;
}

const INVALID_BACKFILL_DESTINATION_KEYWORDS = new Set([
  '가족',
  '대학생',
  '아이',
  '여행',
  '여행 준비',
  '해외여행',
  '여름',
  '여름방학',
  '황금연휴',
  '봄',
  '가을',
  '겨울',
  '1월',
  '2월',
  '3월',
  '4월',
  '5월',
  '6월',
  '7월',
  '8월',
  '9월',
  '10월',
  '11월',
  '12월',
]);

function hasInvalidBackfillDestinationKeyword(value: string | null | undefined): boolean {
  const cleaned = cleanTravelKeyword(value);
  return Boolean(cleaned && INVALID_BACKFILL_DESTINATION_KEYWORDS.has(cleaned));
}

function usableDestinationKeyword(value: string | null | undefined): string | null {
  const cleaned = cleanTravelKeyword(value);
  if (!cleaned) return null;
  if (INVALID_BACKFILL_DESTINATION_KEYWORDS.has(cleaned)) return null;
  if (/^(?:여행|여행 준비|여행지|현지|국내|해외|travel)$/i.test(cleaned)) return null;
  if (/^(?:[1-9]|1[0-2])월(?:\s|$)/.test(cleaned)) return null;
  return cleaned;
}

function looksLikeGenericInfoRow(row: BlogRow, primaryKeyword?: string | null): boolean {
  if (row.product_id) return false;
  const text = [
    row.slug,
    row.seo_title,
    row.destination,
    primaryKeyword,
    keywordFromStoredMeta(row),
    row.generation_meta?.content_brief,
    row.target_ad_keywords?.join(' '),
  ].filter(Boolean).map(String).join(' ');
  return /(?:\bvs\b|비교|roaming|insurance|coverage|로밍|유심|eSIM|USIM|보험|비자|입국|항공권|비행시간|공항\s*혼잡|비상약|상비약|환전|트래블월렛|travelwallet|비용\s*절약|경비\s*절약|배낭여행|여행\s*준비|여행지\s*추천|휴양지\s*추천|가족\s*(?:여행지|해외여행)|아이와\s*가기|해외여행\s*(?:전화|데이터|보험|준비|체크|비자|항공권|비행시간|환전|상비약|비상약)|광복절\s*연휴|황금연휴|여름\s*(?:휴가철|방학|항공권|공항))/i.test(text);
}

function primaryKeywordForCustomer(row: BlogRow): string {
  const base = (!row.product_id ? localizedMicroAngleKeyword(row) : null)
    || inferredDestinationForCustomer(row)
    || cleanTravelKeyword(keywordFromStoredMeta(row))
    || cleanTravelKeyword(row.seo_title)
    || cleanTravelKeyword(extractDestination(row.slug || ''))
    || '여행 준비';
  if (/(?:신혼여행|허니문|honeymoon)/i.test(base) && !row.product_id) {
    const destination = cleanTravelKeyword(row.destination) || base.replace(/(?:신혼여행|허니문|honeymoon)/gi, '').trim() || '여행';
    return `${destination} 여행 일정`;
  }
  return base;
}

function topicKindForCustomer(row: BlogRow, primaryKeyword: string): 'weather' | 'communication' | 'visa' | 'currency' | 'cost' | 'transport' | 'itinerary' | 'general' {
  const strongText = `${row.slug || ''} ${row.destination || ''} ${primaryKeyword}`.toLowerCase();
  const titleText = `${row.seo_title || ''}`.toLowerCase();
  const text = `${strongText} ${titleText}`;

  if (/insurance|보험|보장|coverage/.test(strongText)) return 'general';

  if (/transport|mobility|transfer|교통|교통비|이동비|픽업|공항/.test(strongText)) return 'transport';
  if (/cost|비용|예산|경비|가격|항공권|가성비/.test(strongText)) return 'cost';
  if (/weather|날씨|옷차림|기온|강수|우기|건기/.test(strongText)) return 'weather';
  if (/wifi|wi-fi|와이파이|유심|usim|esim|e-sim|로밍|통신/.test(strongText)) return 'communication';
  if (/visa|비자|입국|여권|서류|esta|etias/.test(strongText)) return 'visa';
  if (/currency|환전|환율|동전|카드|현금/.test(strongText)) return 'currency';
  if (/itinerary|일정|코스|동선|route|3박|4박|5박/.test(strongText)) return 'itinerary';

  if (/weather|날씨|옷차림|기온|강수|우기|건기/.test(text)) return 'weather';
  if (/wifi|wi-fi|와이파이|유심|usim|esim|e-sim|로밍|통신/.test(text)) return 'communication';
  if (/visa|비자|입국|여권|서류|esta|etias/.test(text)) return 'visa';
  if (/currency|환전|환율|동전|카드|현금/.test(text)) return 'currency';
  if (/transport|mobility|transfer|교통|교통비|이동비|픽업|공항/.test(text)) return 'transport';
  if (/cost|비용|예산|경비|가격|항공권/.test(text)) return 'cost';
  if (/itinerary|일정|코스|동선|route|3박|4박|5박/.test(text)) return 'itinerary';
  return 'general';
}

function customerTopicLabel(kind: ReturnType<typeof topicKindForCustomer>): string {
  if (kind === 'weather') return '날씨와 옷차림';
  if (kind === 'communication') return '유심, eSIM, 로밍 선택';
  if (kind === 'visa') return '입국 조건과 준비 서류';
  if (kind === 'currency') return '환전, 카드, 현금 준비';
  if (kind === 'cost') return '예산과 실제 비용';
  if (kind === 'transport') return '교통비와 이동 동선';
  if (kind === 'itinerary') return '일정과 이동 동선';
  return '일정, 비용, 준비물';
}

function hasConflictingCustomerTitleIntent(title: string, kind: ReturnType<typeof topicKindForCustomer>, primaryKeyword: string): boolean {
  const keyword = primaryKeyword.toLowerCase();
  const text = title.toLowerCase();
  const keywordAlreadyAllowsWeather = /weather|날씨|옷차림|기온|우기|건기/.test(keyword);
  const keywordAlreadyAllowsCost = /cost|비용|예산|경비|가격|교통비|이동비|항공권/.test(keyword);
  const keywordAlreadyAllowsTransport = /transport|mobility|transfer|교통|이동|픽업|공항/.test(keyword);

  if (kind !== 'weather' && !keywordAlreadyAllowsWeather && /weather|날씨|옷차림|기온|우기|건기/.test(text)) {
    return true;
  }
  if (!['cost', 'transport', 'food', 'accommodation'].includes(kind) && !keywordAlreadyAllowsCost && /cost|비용|예산|경비|가격|교통비|이동비|항공권/.test(text)) {
    return true;
  }
  if (kind !== 'transport' && !keywordAlreadyAllowsTransport && /transport|mobility|transfer|교통|이동|픽업|공항/.test(text)) {
    return true;
  }
  return false;
}

function improveBackfillSeoTitleCustomer(title: string, row: BlogRow, primaryKeyword: string): string {
  const keyword = primaryKeywordForCustomer({ ...row, destination: row.destination || primaryKeyword });
  const cleaned = (normalizeBlogTitle(title) || '')
    .replace(/총정리/g, '정리')
    .replace(/완벽\s*가이드/g, '실전 가이드')
    .trim();
  const kind = topicKindForCustomer(row, keyword);
  const hasKeyword = keyword.length > 1 && cleaned.includes(keyword);
  const hasUsefulModifier = /20\d{2}|최신|날씨|비용|일정|준비|체크|입국|환전|유심|eSIM|로밍|항공권/.test(cleaned);
  const conflictsWithPrimaryIntent = hasConflictingCustomerTitleIntent(cleaned, kind, keyword);
  const weak = isWeakGeneratedSlug(row.slug) || cleaned.length < 28 || cleaned.length > 60 || !hasKeyword || !hasUsefulModifier || containsEnglishMicroAngle(cleaned) || conflictsWithPrimaryIntent;
  if (!weak) return cleaned;

  const modifier = customerTopicLabel(kind);
  const candidate = `${keyword} 여행 가이드 2026 | ${modifier} 체크`;
  if (candidate.length <= 60) return candidate;
  return `${keyword} 2026 | ${modifier}`.slice(0, 60).trim();
}

function improveBackfillSeoDescriptionCustomer(_description: string | null, row: BlogRow, primaryKeyword: string): string {
  const keyword = primaryKeywordForCustomer({ ...row, destination: row.destination || primaryKeyword });
  const kind = topicKindForCustomer(row, keyword);
  const topic = customerTopicLabel(kind);
  const destination = cleanTravelKeyword(row.destination) || keyword;
  const candidate = `${destination} ${topic}을 2026년 기준으로 정리했습니다. 예약 전 확인할 비용, 일정, 준비물, 현지 체크 포인트를 한 번에 확인하세요.`;
  return candidate.length <= 160 ? candidate : `${destination} ${topic} 2026년 기준 비용, 일정, 준비물, 예약 전 체크 포인트를 정리했습니다.`;
}

function descriptionIntentLabel(row: BlogRow, primaryKeyword: string): string {
  const text = `${row.slug || ''} ${row.seo_title || ''} ${row.destination || ''} ${primaryKeyword}`.toLowerCase();
  const microAngle = microAngleKoreanLabel(row);
  if (/food|meal|restaurant|맛집|식비|음식/.test(text)) return '식비와 맛집 예산';
  if (/shopping|souvenir|쇼핑|기념품/.test(text)) return '쇼핑과 기념품 예산';
  if (/transport|mobility|transfer|교통|이동|동선/.test(text)) return '교통비와 이동 동선';
  if (/hotel|resort|stay|숙소|호텔|리조트/.test(text)) return '숙소 지역과 예산';
  if (/family|kid|child|가족|아이|자녀/.test(text)) return '가족 일정과 경비';
  if (/medicine|emergency|hospital|비상약|응급|병원/.test(text)) return '비상약과 현지 응급 준비';
  if (/weather|packing|clothes|날씨|옷차림|준비물/.test(text)) return '날씨별 준비물';
  if (/visa|passport|immigration|입국|비자|여권|서류/.test(text)) return '입국 서류와 확인 절차';
  if (/currency|exchange|card|환전|환율|카드|현금/.test(text)) return '환전과 결제 준비';
  if (/itinerary|route|course|일정|코스/.test(text)) return '일정과 코스 선택';
  if (microAngle) return microAngle;
  return customerTopicLabel(topicKindForCustomer(row, primaryKeyword));
}

function normalizeDescriptionKey(value: string): string {
  return (normalizeBlogDescription(value) || value).replace(/\s+/g, ' ').trim().toLowerCase();
}

function seoDescriptionUniqueHint(row: BlogRow, destination: string, primaryKeyword: string): string {
  const productishHint = productishSlugDescriptionHint(row);
  if (productishHint) return productishHint;

  const escapedDestination = destination.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const raw = [row.seo_title, primaryKeyword, row.slug].filter(Boolean).join(' ');
  const cleaned = raw
    .replace(new RegExp(escapedDestination, 'g'), ' ')
    .replace(/2026|여행|완벽|총정리|추천|필수|checklist|complete|guide/gi, ' ')
    .replace(/[|·:_\-\/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const hint = cleaned
    .split(' ')
    .filter((word) => word.length >= 2)
    .slice(0, 4)
    .join(' ');
  return hint || cleanTravelKeyword(row.seo_title) || cleanTravelKeyword(primaryKeyword) || row.slug || '핵심 기준';
}

function productishSlugDescriptionHint(row: BlogRow): string | null {
  const text = `${row.slug || ''} ${row.seo_title || ''}`.toLowerCase();
  const parts: string[] = [];
  if (/busan|부산/.test(text)) parts.push('부산 출발');
  if (/shilla|monogram|신라\s*모노그램|신라모노그램/.test(text)) parts.push('신라모노그램');
  if (/package|pkg|패키지/.test(text)) parts.push('패키지 조건');
  if (/cn|china|중국/.test(text)) parts.push('중국 단체 기준');
  return parts.length >= 2 ? parts.slice(0, 4).join(' ') : null;
}

function ensureBatchUniqueSeoDescription(
  description: string,
  row: BlogRow,
  primaryKeyword: string,
  seenDescriptions: Map<string, number>,
): string {
  const normalized = normalizeBlogDescription(description) || description;
  const key = normalizeDescriptionKey(normalized);
  const seen = seenDescriptions.get(key) || 0;
  if (seen === 0) {
    seenDescriptions.set(key, 1);
    return normalized;
  }

  const current = row.seo_description ? normalizeBlogDescription(row.seo_description) : null;
  const currentKey = current ? normalizeDescriptionKey(current) : null;
  if (current && currentKey && currentKey !== key && !seenDescriptions.has(currentKey)) {
    seenDescriptions.set(currentKey, 1);
    return current;
  }

  const keyword = primaryKeywordForCustomer({ ...row, destination: row.destination || primaryKeyword });
  const destination = cleanTravelKeyword(row.destination) || cleanTravelKeyword(keyword) || '여행';
  const intent = descriptionIntentLabel(row, keyword);
  const uniqueHint = seoDescriptionUniqueHint(row, destination, keyword);
  const stableCandidate = ensureStrictSeoDescription(
    `${destination} ${uniqueHint} 기준을 2026년 기준으로 정리했습니다. 비용, 일정, 준비물, 현지 체크 포인트와 공식 확인 링크를 함께 확인하세요.`,
    row,
    keyword,
  );
  const stableCandidateKey = normalizeDescriptionKey(stableCandidate);
  if (currentKey === stableCandidateKey) {
    seenDescriptions.set(stableCandidateKey, (seenDescriptions.get(stableCandidateKey) || 0) + 1);
    return current || stableCandidate;
  }
  if (!seenDescriptions.has(stableCandidateKey)) {
    seenDescriptions.set(stableCandidateKey, 1);
    return stableCandidate;
  }

  const candidates = [
    `${destination} ${intent}을 2026년 기준으로 따로 정리했습니다. 비용, 일정, 준비물, 예약 전 확인 변수를 글별 체크 포인트로 확인하세요.`,
    `${keyword} 중 ${intent}이 궁금한 분을 위한 2026년 기준 정리입니다. 상담 전 비용, 일정, 준비물, 현지 리스크를 먼저 확인하세요.`,
    `${destination} 여행에서 ${intent}을 먼저 판단할 수 있게 2026년 기준 비용, 일정, 준비물, 예약 전 질문을 정리했습니다.`,
  ];

  for (const candidate of candidates) {
    const strict = ensureStrictSeoDescription(candidate, row, keyword);
    const candidateKey = normalizeDescriptionKey(strict);
    if (!seenDescriptions.has(candidateKey)) {
      seenDescriptions.set(candidateKey, 1);
      return strict;
    }
  }

  const fallback = ensureStrictSeoDescription(`${keyword} ${intent} 2026년 기준 비용, 일정, 준비물 체크. ${row.slug || row.id}`, row, keyword);
  const fallbackKey = normalizeDescriptionKey(fallback);
  seenDescriptions.set(fallbackKey, (seenDescriptions.get(fallbackKey) || 0) + 1);
  return fallback;
}

function buildSecondaryKeywordsCustomer(primaryKeyword: string, destination?: string | null): string[] {
  const keyword = cleanTravelKeyword(primaryKeyword) || cleanTravelKeyword(destination) || '여행';
  return Array.from(new Set([
    `${keyword} 일정`,
    `${keyword} 비용`,
    `${keyword} 준비물`,
    `${keyword} 예약`,
    `${keyword} 날씨`,
  ]));
}

function buildTargetAdKeywordsCustomer(row: BlogRow, primaryKeyword: string, secondaryKeywords: string[]): string[] | null {
  const existing = (row.target_ad_keywords ?? [])
    .filter((keyword) => typeof keyword === 'string' && keyword.trim() && !containsEnglishMicroAngle(keyword));
  const keywords = Array.from(new Set([
    primaryKeyword,
    ...existing,
    ...secondaryKeywords.slice(0, 2),
  ].map((keyword) => cleanTravelKeyword(keyword)).filter((keyword): keyword is string => Boolean(keyword))));
  return keywords.length > 0 ? keywords : null;
}

function repairMarkdownTables(markdown: string): string {
  const cellsFor = (row: string) => row.split('|').slice(1, -1).map((cell) => cell.trim());
  const bulletizeShortTable = (block: string[], hasSeparator: boolean): string[] => {
    const header = cellsFor(block[0] ?? '');
    const bodyRows = block.slice(hasSeparator ? 2 : 1)
      .map((row) => cellsFor(row))
      .filter((cells) => cells.length >= 2);

    if (bodyRows.length === 0) {
      const text = (block[0] ?? '')
        .replace(/^\s*\|\s*|\s*\|\s*$/g, '')
        .replace(/\s*\|\s*/g, ' / ')
        .trim();
      return text ? [`- ${text}`] : [];
    }

    return bodyRows.map((cells) => {
      const pairs = cells.map((cell, index) => `${header[index] || `Column ${index + 1}`}: ${cell}`);
      return `- ${pairs.join(' / ')}`;
    });
  };

  const lines = markdown.split('\n');
  const next: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const trimmed = line.trim();
    if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) {
      next.push(line);
      continue;
    }

    const block: string[] = [];
    let cursor = index;
    while (cursor < lines.length) {
      const current = lines[cursor]?.trim() ?? '';
      if (!current.startsWith('|') || !current.endsWith('|')) break;
      if (current !== '|') block.push(lines[cursor] ?? '');
      cursor += 1;
    }

    if (block.length === 0) {
      index = cursor - 1;
      continue;
    }

    const headerCells = block[0]?.split('|').slice(1, -1).map((cell) => cell.trim()).filter(Boolean).length ?? 0;
    if (headerCells < 2) {
      next.push(...block.map((row) => row.replace(/^\s*\|\s*|\s*\|\s*$/g, '').trim()).filter(Boolean).map((row) => `- ${row}`));
      index = cursor - 1;
      continue;
    }

    const hasSeparator = block.length >= 2 && /^\|\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(block[1]?.trim() ?? '');
    const bodyRows = block.slice(hasSeparator ? 2 : 1)
      .map((row) => cellsFor(row))
      .filter((cells) => cells.length >= 2);
    if (bodyRows.length < 2) {
      next.push(...bulletizeShortTable(block, hasSeparator));
      index = cursor - 1;
      continue;
    }

    next.push(block[0] ?? '');
    if (!hasSeparator) {
      next.push(`| ${Array.from({ length: headerCells }, () => '---').join(' | ')} |`);
      next.push(...block.slice(1));
    } else {
      next.push(...block.slice(1));
    }
    index = cursor - 1;
  }
  return next.join('\n').replace(/\n{3,}/g, '\n\n');
}

function normalizeMarkdownImageUrlsFinal(markdown: string): string {
  return markdown
    .replace(/!\[([^\]\n]*)]\(\s*([\s\S]*?)\s*\)/g, (_match, alt: string, rawUrl: string) => {
      const url = rawUrl.replace(/\s+/g, '');
      return `![${String(alt || '').trim()}](${url})`;
    })
    .replace(/\]\(\s*(https?:\/\/[^)\n]+?)\s*\)/g, (_match, rawUrl: string) => {
      const url = rawUrl.replace(/\s+/g, '');
      return `](${url})`;
    });
}

function removeTinyBrokenTablesFinal(markdown: string): string {
  const lines = markdown.split('\n');
  const next: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (!line.trim().startsWith('|')) {
      next.push(line);
      continue;
    }

    const block: string[] = [];
    let cursor = index;
    while (cursor < lines.length && (lines[cursor] ?? '').trim().startsWith('|')) {
      block.push(lines[cursor] ?? '');
      cursor += 1;
    }

    const dataRows = block.filter((row) => {
      const trimmed = row.trim();
      return !/^\|\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(trimmed);
    });

    if (block.length <= 2 || dataRows.length <= 1) {
      const bullets = dataRows
        .map((row) => row.replace(/^\s*\|\s*|\s*\|\s*$/g, '').replace(/\s*\|\s*/g, ' / ').trim())
        .filter((row) => row.length > 0)
        .map((row) => `- ${row}`);
      next.push(...bullets);
      index = cursor - 1;
      continue;
    }

    next.push(...block);
    index = cursor - 1;
  }

  return next.join('\n').replace(/\n{3,}/g, '\n\n');
}

function dedupeRepeatedCalloutsFinal(markdown: string): string {
  let keptTip = false;
  return markdown
    .replace(/<aside class="blog-callout blog-callout-tip">[\s\S]*?<\/aside>/gi, (match) => {
      if (keptTip) return '';
      keptTip = true;
      return match;
    })
    .replace(/\n{3,}/g, '\n\n');
}

function hasItineraryFlowTableFinal(markdown: string): boolean {
  return (
    /^#{2,4}\s*일정\s*흐름\s*빠른\s*보기/m.test(markdown) ||
    /^#{2,4}\s*DAY별\s*확인\s*포인트/m.test(markdown) ||
    /\|\s*구간\s*\|\s*추천\s*흐름\s*\|\s*확인\s*포인트\s*\|/.test(markdown)
  );
}

function dedupeItineraryFlowBlocksFinal(markdown: string): string {
  let keptFlowHeading = false;
  let keptFlowTable = false;
  let skippingDuplicateFlowTable = false;
  return markdown
    .split('\n')
    .filter((line) => {
      if (/^#{2,4}\s*일정\s*흐름\s*빠른\s*보기\s*$/.test(line.trim())) {
        if (keptFlowHeading) return false;
        keptFlowHeading = true;
        return true;
      }

      if (/\|\s*구간\s*\|\s*추천\s*흐름\s*\|\s*확인\s*포인트\s*\|/.test(line)) {
        if (keptFlowTable) {
          skippingDuplicateFlowTable = true;
          return false;
        }
        keptFlowTable = true;
        skippingDuplicateFlowTable = false;
        return true;
      }

      if (skippingDuplicateFlowTable && /^\|.*\|\s*$/.test(line)) {
        return false;
      }
      skippingDuplicateFlowTable = false;

      return true;
    })
    .join('\n')
    .replace(
      /(\n이 일정표는 실제 항공 시간과 숙소 위치에 맞춰 조정해야 합니다\.\n)(?:\n?이 일정표는 실제 항공 시간과 숙소 위치에 맞춰 조정해야 합니다\.\n)+/g,
      '$1',
    )
    .replace(/\n{3,}/g, '\n\n');
}

function normalizeFinalMarkdownSurface(markdown: string): string {
  const normalizedLinks = canonicalizeBlogPublicLinks ? canonicalizeBlogPublicLinks(markdown, baseUrl) : markdown;
  const normalizedWords = removeAwkwardDuplicateWordsFinal(
    normalizeRepeatedTailSectionsFinal(stripAwkwardGeneratedTailArtifactsFinal(trimAfterClosingCtaFinal(normalizedLinks))),
  );
  return capHeadingDensityFinal(
    repairMarkdownTables(removeTinyBrokenTablesFinal(dedupeItineraryFlowBlocksFinal(dedupeRepeatedCalloutsFinal(splitParagraphWallFinal(normalizeInlineHeadingsFinal(normalizeMarkdownImageUrlsFinal(normalizedWords))))))),
  );
}

function trimAfterClosingCtaFinal(markdown: string): string {
  const lines = markdown.split('\n');
  const ctaIndex = lines.findIndex((line) => /^(?:#{2,4}\s+|\*\*)여행\s*상품과\s*함께\s*확인하기/.test(line.trim()));
  if (ctaIndex < 0) return markdown;

  const kept = lines.slice(0, ctaIndex + 1);
  let sawCtaLink = false;
  for (let index = ctaIndex + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const trimmed = line.trim();
    const isCtaLink = /^[-*]\s+/.test(trimmed) && /\/(?:packages|group-inquiry|blog)\b/.test(trimmed);
    if (!trimmed || isCtaLink) {
      kept.push(line);
      sawCtaLink = sawCtaLink || isCtaLink;
      continue;
    }
    if (sawCtaLink) break;
    kept.push(line);
  }
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function stripAwkwardGeneratedTailArtifactsFinal(markdown: string): string {
  const artifactLine = /(?:출발\s*전\s*핵심\s*조건|일정별\s*확인\s*항목)/;
  return markdown
    .split('\n')
    .filter((line) => !artifactLine.test(line.replace(/\*\*/g, '').trim()))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function removeAwkwardDuplicateWordsFinal(markdown: string): string {
  return markdown
    .replace(/여행\s+여행/g, '여행')
    .replace(/준비\s+준비/g, '준비')
    .replace(/정보\s+정보/g, '정보')
    .replace(/현지\s+현지/g, '현지');
}

function normalizePackageDestinationLinksFinal(markdown: string, destination?: string | null): string {
  const keyword = usableDestinationKeyword(destination);
  if (!keyword) return markdown;
  const encoded = encodeURIComponent(keyword);
  return markdown.replace(/(\/packages\?destination=)[^)\s&]+/g, `$1${encoded}`);
}

function normalizeMarkdownTableHeaderRenderRiskFinal(markdown: string): string {
  const lines = markdown.split('\n');
  return lines
    .map((line, index) => {
      const nextLine = lines[index + 1]?.trim() ?? '';
      const isTableHeader = line.trim().startsWith('|') &&
        line.trim().endsWith('|') &&
        /^\|\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(nextLine);
      if (!isTableHeader) return line;
      return line
        .replace(/예상\s*비용\s*\(\s*1박\s*\)/g, '1박 예상 비용')
        .replace(/예상\s*비용\s*\(\s*1인\s*기준\s*\)/g, '1인 기준 예상 비용')
        .replace(/예상\s*비용\s*\(\s*1인\s*\)/g, '1인 예상 비용')
        .replace(/비용\s*\(\s*1박\s*\)/g, '1박 비용')
        .replace(/금액\s*\(\s*1인\s*기준\s*\)/g, '1인 기준 금액');
    })
    .join('\n');
}

function replaceDestinationPlaceholderContextFinal(
  markdown: string,
  destination?: string | null,
  primaryKeyword?: string | null,
): string {
  const headingDestination = markdown.match(/^#\s*([가-힣A-Za-z]{2,20})(?:\s|\d)/m)?.[1] ?? null;
  const dest = usableDestinationKeyword(destination) ||
    usableDestinationKeyword(primaryKeyword) ||
    usableDestinationKeyword(headingDestination);
  if (!dest || dest === '현지') return markdown;
  return markdown
    .replace(/현지\s+(\d{1,2}월\s*(?:날씨|옷차림|우기|건기|여행|준비))/g, `${dest} $1`)
    .replace(/현지\s+(날씨|옷차림|우기|건기|여행\s*정보|여행\s*준비|체크\s*포인트|지역|시내|공항)/g, `${dest} $1`)
    .replace(/현지\s*지역/g, `${dest} 지역`)
    .replace(/#현지(?=\s|#|$)/g, '#여행준비')
    .replace(/#현지\d{1,2}월날씨/g, '#여행날씨')
    .replace(/#현지여행팁/g, '#여행팁')
    .replace(/#현지여행/g, '#해외여행')
    .replace(/#현지(날씨|우기|건기|정보|자유여행|패키지|체크)/g, '#여행$1')
    .replace(/#현지[가-힣A-Za-z0-9]+/g, '#여행정보')
    .replace(/\[현지\s+([^\]]{2,40})]/g, `[${dest} $1]`);
}

function subjectParticleForFinal(value: string): '은' | '는' {
  const chars = Array.from(value.trim()).reverse();
  const lastHangul = chars.find((char) => {
    const code = char.charCodeAt(0);
    return code >= 0xac00 && code <= 0xd7a3;
  });
  if (!lastHangul) return '은';
  return ((lastHangul.charCodeAt(0) - 0xac00) % 28) > 0 ? '은' : '는';
}

function softenUnsupportedInternalDataFinal(markdown: string): string {
  return markdown
    .replace(/여소남(?:의)?\s*(?:내부\s*)?상품\s*(?:및|\/|·|,)?\s*예약\s*데이터(?:를\s*기준으로|로\s*보면|를\s*보면|에\s*따르면)?/g, '현재 확인 가능한 상품 조건')
    .replace(/여소남(?:의)?\s*(?:내부\s*)?상품\/예약\s*데이터(?:를\s*기준으로|로\s*보면|를\s*보면|에\s*따르면)?/g, '현재 확인 가능한 상품 조건')
    .replace(/여소남(?:의)?\s*(?:내부\s*)?(?:예약|상담)\s*데이터(?:를\s*기준으로|로\s*보면|를\s*보면|에\s*따르면)?/g, '출발 전 확인 기준');
}

function buildCustomerFirstAnswer(
  primaryKeyword?: string | null,
  destination?: string | null,
  blogType: 'product' | 'info' = 'info',
): string {
  const keyword = cleanTravelKeyword(primaryKeyword) || cleanTravelKeyword(destination) || '여행 준비';
  const subject = `${keyword}${subjectParticleForFinal(keyword)}`;
  const topic = `${keyword} ${destination || ''}`.toLowerCase();
  if (blogType === 'product') {
    return `${keyword} 상품은 무엇부터 비교해야 할까요? 가격만 보지 말고 출발지, 포함 항목, 일정 강도를 먼저 나눠 보면 판단이 쉽습니다. 출발 2주 전에는 총액에 포함된 항공·숙소·식사와 현지 추가비용, 취소 조건을 같은 기준으로 확인하세요.`;
  }
  if (/날씨|옷차림|우기|건기|기온|강수|비\s*예보|weather/.test(topic)) {
    return `${subject} 무엇부터 확인해야 할까요? 낮과 밤 기온 차이, 비 예보, 이동 동선을 1~2시간 단위로 비교하면 옷차림 실수가 줄어듭니다. 출발 2주 전에는 겉옷, 방수용품, 자외선 차단을 함께 확인하세요.`;
  }
  if (/화폐|카드|현금|팁|currency|money|payment/.test(topic)) {
    return `${subject} 무엇부터 준비해야 할까요? 카드가 되는 구역, 현금이 필요한 순간, 팁 문화와 환전 수수료를 따로 보면 현지 결제 실수가 줄어듭니다. 출발 2주 전에는 소액 현금과 해외 결제 카드 사용 조건을 함께 확인하세요.`;
  }
  if (/쇼핑|예산|경비|물가|비용|budget|shopping/.test(topic)) {
    return `${keyword} 비용은 상품가, 현지 개인경비, 선택 관광비를 따로 봐야 실제 총액이 맞습니다. 1인 하루 식비·교통비 기준을 먼저 잡고, 환율과 포함/불포함은 결제 직전에 다시 확인하세요.`;
  }
  if (/아이|가족|키즈|유아|부모|family|kid/.test(topic)) {
    return `${subject} 무엇을 먼저 비교해야 할까요? 관광지 수보다 이동 시간, 아이 휴식 시간, 병원 접근성을 1순위로 봐야 편합니다. 출발 2주 전에는 숙소 위치와 차량 이동 시간을 확인하고 무리한 일정은 줄이는 쪽이 안전합니다.`;
  }
  if (/비자|입국|여권|esta|세관|서류|visa|immigration/.test(topic)) {
    return `${subject} 어떤 서류부터 확인해야 할까요? 조건이 바뀔 수 있어 예약 전과 출발 직전 2번 확인이 필요합니다. 출발 2주 전에는 여권 유효기간, 입국 서류, 항공권 영문명, 현지 체류 조건을 함께 점검하세요.`;
  }
  return `${subject} 일정표보다 총 이동 시간, 포함/불포함, 현지 추가비를 먼저 나눠 보면 판단이 빨라집니다. 같은 가격처럼 보여도 차량 이동 1~2시간과 현지 결제 조건에 따라 체감 만족도가 달라질 수 있습니다.`;
}

function repairGenericCustomerOpeningFinal(
  markdown: string,
  primaryKeyword?: string | null,
  destination?: string | null,
  blogType: 'product' | 'info' = 'info',
): string {
  const replacement = buildCustomerFirstAnswer(primaryKeyword, destination, blogType);
  return markdown
    .replace(
      /답부터\s*말하면[,，]?\s*20\d{2}년\s*(?:\d{1,2}월\s*)?기준[\s\S]{0,280}?(?:줄일\s*수\s*있습니다|줄일\s*수\s*있어요|도움이\s*됩니다|안전합니다)[.?!]/,
      replacement,
    )
    .replace(
      /답부터\s*말하면[,，]?\s*(?:비용[·,\s]*일정[·,\s]*준비\s*조건|[^.\n]{0,80}비용,\s*일정,\s*준비물)[\s\S]{0,220}?(?:쉽습니다|안전합니다|도움이\s*됩니다)[.?!]/,
      replacement,
    );
}

function strengthenIntroHookCustomer(
  markdown: string,
  destination?: string | null,
  primaryKeyword?: string | null,
  blogType: 'product' | 'info' = 'info',
): string {
  const lines = markdown.split('\n');
  let h1Index = lines.findIndex((line) => /^#\s+\S/.test(line.trim()));
  const keyword = cleanTravelKeyword(primaryKeyword) || cleanTravelKeyword(destination) || '여행 준비';
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
    .slice(0, 220);
  const hasNumber = /\d/.test(intro);
  const hasTrigger = /[?？]|만원|비용|시간|비교|체크|예약|입국|날씨|준비/.test(intro);
  const hasAnswerFirst = /답부터|먼저\s*확인|기준으로|핵심은|결론부터|비용·일정|비용,\s*일정/.test(intro);
  const hasGenericOpening = /답부터\s*말하면|예산\s*범위,\s*이동\s*순서,\s*현지\s*확인\s*사항|비용[·,\s]*일정[·,\s]*준비\s*조건/.test(intro);
  if (hasNumber && hasTrigger && hasAnswerFirst && !hasGenericOpening) return markdown;

  const hook = buildCustomerFirstAnswer(primaryKeyword, destination, blogType);
  if (hasGenericOpening) {
    const repaired = repairGenericCustomerOpeningFinal(markdown, primaryKeyword, destination, blogType);
    if (repaired !== markdown) return repaired;
  }
  lines.splice(h1Index + 1, 0, '', hook);
  return lines.join('\n');
}

function sanitizeCustomerMarketingPressure(markdown: string): string {
  return markdown
    .replace(/여소남(?:의)?\s*(?:내부\s*)?데이터로\s*본/g, '출발 전 확인 기준으로 본')
    .replace(/여소남(?:의)?\s*(?:내부\s*)?데이터로\s*보면/g, '출발 전 확인 기준으로 보면')
    .replace(/여소남\s*에디터가\s*여러\s*정보를\s*비교\s*분석하여,?\s*/g, '')
    .replace(/여소남\s*에디터가\s*꼼꼼(?:하|히)게\s*정리(?:해\s*드립니다|했습니다|합니다)\.?/g, '핵심 기준을 정리했습니다.')
    .replace(/여소남\s*에디터(?:가|는|의)?\s*/g, '')
    .replace(/놓치면\s*후회(?:할|하는)?/g, '미리 확인하면 좋은')
    .replace(/무조건\s*예약/g, '조건 확인')
    .replace(/지금\s*바로\s*예약/g, '예약 전 조건 확인')
    .replace(/완벽한\s*선택/g, '비교해 볼 선택')
    .replace(/최고의\s*상품/g, '조건을 확인할 상품')
    .replace(/마감\s*임박/g, '판매 조건 확인 필요')
    .replace(/오늘만/g, '현재 기준');
}

function normalizeInlineMarkdownHeadings(markdown: string): string {
  return markdown
    .replace(/([^\n])\s+(#{2,3}\s+[^\n#]+)/g, '$1\n\n$2')
    .replace(/([^\n])\s+(-\s+\S)/g, '$1\n$2')
    .replace(/\n{3,}/g, '\n\n');
}

function capH2Density(markdown: string, maxH2 = 8): string {
  let h2Count = 0;
  let h3Count = 0;
  return markdown
    .split('\n')
    .map((line) => {
      if (/^###\s+/.test(line)) {
        h3Count += 1;
        return h3Count > 10 ? line.replace(/^###\s+/, '**').replace(/\s*$/, '**') : line;
      }
      if (!/^##\s+/.test(line)) return line;
      h2Count += 1;
      return h2Count > maxH2 ? line.replace(/^##\s+/, '### ') : line;
    })
    .join('\n');
}

function ensureQuestionHeading(markdown: string): string {
  if (/^##\s+.+[?？]\s*$/m.test(markdown)) return markdown;
  const lines = markdown.split('\n');
  const firstH2 = lines.findIndex((line) => /^##\s+\S/.test(line.trim()));
  const insertAt = firstH2 >= 0 ? firstH2 : Math.min(lines.length, 4);
  lines.splice(insertAt, 0, '## 예약 전 무엇을 먼저 확인해야 할까요?', '', '예약 전에는 총액, 이동 시간, 포함/불포함을 따로 보는 편이 안전합니다. 같은 가격처럼 보여도 출발일, 인원, 현지 추가비용에 따라 실제 부담이 달라질 수 있습니다.', '');
  return lines.join('\n');
}

function ensureQuestionHeadingClean(markdown: string, primaryKeyword: string, blogType: 'product' | 'info'): string {
  if (/^##\s+.+[?？]\s*$/m.test(markdown)) return markdown;
  const lines = markdown.split('\n');
  const firstH2 = lines.findIndex((line) => /^##\s+\S/.test(line.trim()));
  const insertAt = firstH2 >= 0 ? firstH2 : Math.min(lines.length, 4);
  const topic = cleanTravelKeyword(primaryKeyword) || '여행';
  const looksWeather = /날씨|옷차림|우기|건기|기온|강수|weather/i.test(topic);
  if (blogType === 'info' && looksWeather) {
    lines.splice(insertAt, 0, '## 출발 전 날씨에서 무엇을 먼저 볼까요?', '', '낮 최고기온만 보지 말고 아침저녁 기온, 비 예보, 바람, 이동 시간을 함께 보는 편이 안전합니다. 같은 7월이라도 지역과 고도에 따라 필요한 옷이 달라질 수 있습니다.', '');
    return lines.join('\n');
  }
  lines.splice(insertAt, 0, '## 예약 전 무엇을 먼저 확인해야 할까요?', '', '예약 전에는 총액, 이동 시간, 포함/불포함을 따로 보는 편이 안전합니다. 같은 가격처럼 보여도 출발일, 인원, 현지 추가비용에 따라 실제 부담이 달라질 수 있습니다.', '');
  return lines.join('\n');
}

function ensureContextualImageText(markdown: string, primaryKeyword: string) : string {
  const keyword = cleanTravelKeyword(primaryKeyword) || '여행';
  let imageIndex = 0;
  return markdown
    .replace(/!\[([^\]\n]*)]\((https?:\/\/[^\n)]+)\)/g, (_match, alt: string, src: string) => {
      imageIndex += 1;
      const cleanAlt = String(alt || '').trim();
      const needsAlt = cleanAlt.length < 3 || /^(?:여행 이미지|이미지|photo|travel image)\s*\d*$/i.test(cleanAlt) || !cleanAlt.includes(keyword);
      return `![${needsAlt ? `${keyword} 여행 참고 이미지 ${imageIndex}` : cleanAlt}](${src})`;
    })
    .replace(/<figcaption>[\s\S]*?<\/figcaption>/gi, () => {
      const slot = Math.max(1, imageIndex);
      return `<figcaption>${keyword} 여행 준비 참고 이미지 ${slot}</figcaption>`;
    });
}

function ensureSafeDayByDayBlock(markdown: string, contentType: string, productId: string | null, primaryKeyword: string): string {
  const text = `${contentType} ${primaryKeyword} ${markdown.slice(0, 2000)}`;
  const needsItinerary = productId || /일정|코스|itinerary|package|패키지/i.test(text);
  if (!needsItinerary || hasItineraryFlowTableFinal(markdown)) return markdown;
  const auditMarkers = (markdown.match(/1일차|2일차|DAY\s*\d+|오전|오후|첫째|둘째/gi) || []).length;
  if (auditMarkers >= 2) return markdown;
  const keyword = cleanTravelKeyword(primaryKeyword) || '상품';
  return `${markdown.trim()}\n\n## DAY별 확인 포인트\n\n### DAY 1. 출발과 도착 조건 확인\n항공 시간, 공항 미팅, 도착 후 이동 동선을 최종 안내 기준으로 확인하세요.\n\n### DAY 2. 핵심 일정과 현지 이동 확인\n${keyword}의 주요 일정은 현지 사정에 따라 순서가 조정될 수 있으니 포함/불포함과 이동 시간을 함께 보세요.\n\n### DAY 3. 귀국 또는 다음 일정 준비\n체크아웃, 공항 이동, 수하물과 여권을 출발 전 다시 확인하세요.\n`;
}

function isFaqHeadingLineCustomer(line: string): boolean {
  const trimmed = line.trim();
  return /^(?:#{2,3}\s*)?(?:\*\*)?\s*(?:FAQ|Q\s*&\s*A|\uC790\uC8FC\s*\uBB3B\uB294\s*\uC9C8\uBB38|\uC790\uC8FC\s*\uD558\uB294\s*\uC9C8\uBB38)(?:\*\*)?\s*$/i.test(trimmed);
}

function isFaqBlockBoundaryCustomer(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (/^#{1,4}\s+\S/.test(trimmed) && !isFaqHeadingLineCustomer(trimmed)) return true;
  if (/^---+$/.test(trimmed)) return true;
  return /^\*\*(?:공식\s*확인\s*링크|함께\s*확인할\s*(?:세부|현지)\s*키워드|여행\s*상품과\s*함께\s*확인하기|상품과\s*함께\s*확인하기)\*\*/.test(trimmed);
}

function dedupeRepeatedFaqBlocksCustomer(markdown: string): string {
  const lines = markdown.split('\n');
  const next: string[] = [];
  let seenFaq = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (!isFaqHeadingLineCustomer(line)) {
      next.push(line);
      continue;
    }

    if (!seenFaq) {
      seenFaq = true;
      next.push(line);
      continue;
    }

    let cursor = index + 1;
    while (cursor < lines.length && !isFaqBlockBoundaryCustomer(lines[cursor] ?? '')) {
      cursor += 1;
    }
    index = cursor - 1;
  }

  return next.join('\n').replace(/\n{3,}/g, '\n\n');
}

function dedupeRepeatedShortParagraphsCustomer(markdown: string): string {
  const blocks = markdown.split(/\n{2,}/);
  const seen = new Set<string>();
  return blocks
    .filter((block) => {
      const trimmed = block.trim();
      if (!trimmed) return true;
      if (/^#{1,6}\s|^\s*[-*]\s|^\s*\||^!\[|^<\w+/i.test(trimmed)) return true;
      const plain = trimmed.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (plain.length < 35 || plain.length > 220) return true;
      const key = plain.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join('\n\n');
}

function removeAiEditorialClichesFinal(markdown: string): string {
  return markdown
    .replace(/이게\s*말이\s*되나\s*싶으시죠\??\s*/g, '')
    .replace(/안녕하세요[!.\s]*\s*친구에게\s+좋은\s+여행을\s+추천해\s+드리는\s*입니다\.?\s*/g, '')
    .replace(/친구에게\s+좋은\s+여행을\s+추천해\s+드리는\s*입니다\.?\s*/g, '')
    .replace(/가치\s+있는\s+여행을\s+소개하는\s*입니다\.?\s*/g, '')
    .replace(/완벽\s*가이드/g, '실전 가이드')
    .replace(/총정리/g, '정리')
    .replace(/놓치면\s*후회(?:하는|할)?/g, '미리 확인할')
    .replace(/최고의\s*선택/g, '선택 기준');
}

function ensureH1AtTop(markdown: string, title: string): string {
  const firstLines = markdown.split('\n').slice(0, 3).join('\n');
  if (/^\s*#\s+\S/m.test(firstLines)) return markdown;
  const cleanTitle = title.replace(/\s+/g, ' ').trim();
  return cleanTitle ? `# ${cleanTitle}\n\n${markdown.trim()}` : markdown;
}

function hardSplitLongParagraphs(markdown: string): string {
  return markdown
    .split(/\n{2,}/)
    .map((paragraph) => {
      const trimmed = paragraph.trim();
      const plain = trimmed.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (plain.length < 300 || /^#{1,6}\s|^\s*[-*]\s|^\s*\|/.test(trimmed)) return paragraph;
      return paragraph
        .replace(/(습니다|세요|니다|어요|해요|됩니다|입니다|입니다\.|됩니다\.)\s+/g, '$1\n\n')
        .replace(/(.{180,240})\s+/g, '$1\n\n');
    })
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n');
}

const STABLE_TAIL_SECTION_RE = /(^|\n|\s)(?:#{2,4}\s*|\*\*)\s*(?:함께\s*확인할\s*(?:세부|현지)\s*키워드|공식\s*확인\s*링크|여행\s*상품과\s*함께\s*확인하기|DAY별\s*확인\s*포인트)(?:\*\*)?\b/m;

function splitStableTailSections(markdown: string): { body: string; tail: string } | null {
  const match = STABLE_TAIL_SECTION_RE.exec(markdown);
  if (!match) return null;
  const marker = match.index;
  return {
    body: markdown.slice(0, marker).trimEnd(),
    tail: markdown.slice(marker),
  };
}

function finalKeywordDensityRepair(markdown: string, primaryKeyword: string, blogType: 'product' | 'info'): string {
  const stable = splitStableTailSections(markdown);
  const target = stable?.body ?? markdown;
  const first = repairKeywordDensityToTarget(target, primaryKeyword, blogType);
  const repaired = first.changed ? first.blogHtml : softenKeywordDensityCustomer(target, primaryKeyword, blogType);
  return stable ? `${repaired.trimEnd()}${stable.tail}` : repaired;
}

function ensurePrimaryKeywordEvidence(markdown: string, primaryKeyword: string): string {
  const keyword = cleanTravelKeyword(primaryKeyword);
  if (!keyword || markdown.includes(keyword)) return markdown;
  const lines = markdown.split('\n');
  const h1Index = lines.findIndex((line) => /^#\s+\S/.test(line.trim()));
  const insertAt = h1Index >= 0 ? h1Index + 1 : 0;
  lines.splice(insertAt, 0, '', `이 글은 ${keyword}를 준비할 때 먼저 확인해야 할 일정, 비용, 준비 조건을 고객 관점에서 정리한 안내입니다.`);
  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}

function ensureAnswerFirstFinal(markdown: string, primaryKeyword: string, blogType: 'product' | 'info'): string {
  const keyword = cleanTravelKeyword(primaryKeyword) || '여행';
  const lines = markdown.split('\n');
  const h1Index = lines.findIndex((line) => /^#\s+\S/.test(line.trim()));
  const insertAt = h1Index >= 0 ? h1Index + 1 : 0;
  const firstBody = lines
    .slice(insertAt)
    .find((line) => line.trim() && !/^#{1,6}\s+/.test(line.trim()))?.trim() ?? '';
  if (/답부터|먼저|기준|확인|비용|가격|준비|일정|주의|환전|입국|날씨/.test(firstBody)) return markdown;
  lines.splice(insertAt, 0, '', buildCustomerFirstAnswer(keyword, null, blogType));
  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}

function plainMarkdownTextFinal(markdown: string): string {
  return markdown
    .replace(/!\[[^\]\n]*]\([^)]+\)/g, ' ')
    .replace(/\[[^\]\n]+]\([^)]+\)/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^\s*\|.*\|\s*$/gm, ' ')
    .replace(/[#*_`>|=[\]()-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function customerAnswerKeyword(row: BlogRow, primaryKeyword: string): string {
  const cleanedPrimary = cleanTravelKeyword(primaryKeyword);
  if (cleanedPrimary && !/^(?:현지|여행|해외여행|가이드|준비|체크리스트)$/i.test(cleanedPrimary)) {
    return cleanedPrimary;
  }
  return cleanTravelKeyword(row.seo_title) ||
    cleanTravelKeyword(row.destination) ||
    cleanTravelKeyword(row.slug?.replace(/[-_]+/g, ' ')) ||
    '여행 준비';
}

function ensureCustomerAnswerFirstParagraphFinal(
  markdown: string,
  row: BlogRow,
  primaryKeyword: string,
  blogType: 'product' | 'info',
): string {
  const lines = markdown.split('\n');
  let h1Index = lines.findIndex((line) => /^#\s+\S/.test(line.trim()));
  if (h1Index < 0) {
    lines.unshift(`# ${cleanTravelKeyword(row.seo_title) || customerAnswerKeyword(row, primaryKeyword)}`, '');
    h1Index = 0;
  }

  const firstMeaningfulIndex = lines.findIndex((line, index) => {
    if (index <= h1Index) return false;
    const trimmed = line.trim();
    if (!trimmed) return false;
    if (/^!\[/.test(trimmed)) return false;
    if (/^<figcaption\b/i.test(trimmed)) return false;
    if (/^\|.*\|$/.test(trimmed)) return false;
    return true;
  });
  const firstMeaningful = firstMeaningfulIndex >= 0 ? lines[firstMeaningfulIndex]?.trim() ?? '' : '';
  const firstText = plainMarkdownTextFinal(firstMeaningful);
  const isHeadingFirst = /^#{2,6}\s+\S/.test(firstMeaningful);
  const isBulletLead = /^[-*]\s+/.test(firstMeaningful);
  const isTruncatedGenericLead = /^같은\s*일정처럼\s*보여도/.test(firstText) ||
    /^[-*]\s*예산(?:과|·|\s)/.test(firstMeaningful) ||
    /^20\d{2}년\s*\d{1,2}월\s*기준[,，]?\s*[^.]{0,80}예산\s*범위/.test(firstText);
  const hasConcreteAnswer = /[?？]|먼저|확인|비교|준비|비용|가격|만원|시간|날씨|환전|카드|현금|입국|여권|\d/.test(firstText);
  const isWeak = isHeadingFirst || firstText.length < 90 || !hasConcreteAnswer ||
    isBulletLead || isTruncatedGenericLead ||
    /^(?:핵심\s*요약|한눈에\s*보는\s*요약|예약\s*전\s*무엇|출발\s*전\s*무엇)/.test(firstText);
  if (!isWeak) return lines.join('\n');

  const answer = buildCustomerFirstAnswer(customerAnswerKeyword(row, primaryKeyword), row.destination, blogType);
  if (isHeadingFirst || firstMeaningfulIndex < 0) {
    lines.splice(h1Index + 1, 0, '', answer, '');
    return lines.join('\n').replace(/\n{3,}/g, '\n\n');
  }
  lines[firstMeaningfulIndex] = answer;
  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}

function repairReadableSurfaceTextFinal(markdown: string): string {
  return markdown
    .replace(/마닐라은/g, '마닐라는')
    .replace(/싱가포르은/g, '싱가포르는')
    .replace(/오사카은/g, '오사카는')
    .replace(/보라카이은/g, '보라카이는')
    .replace(/발리은/g, '발리는')
    .replace(/세부은/g, '세부는')
    .replace(/이미지은/g, '이미지는')
    .replace(/이미지\s+은/g, '이미지는')
    .replace(/이미지을/g, '이미지를')
    .replace(/여행\s*이미지/g, '여행 참고 사진')
    .replace(/날씨은/g, '날씨는')
    .replace(/경비은/g, '경비는')
    .replace(/예산은은/g, '예산은')
    .replace(/비용은은/g, '비용은')
    .replace(/바뀐 수 있는/g, '바뀔 수 있는')
    .replace(/가격이 바뀐 수 있는/g, '가격이 바뀔 수 있는')
    .replace(/여행할 수 있는하기 좋은/g, '여행하기 좋은')
    .replace(/이유\s*을/g, '이유를')
    .replace(/\uC774\uC720[\s\u00a0\u200b]*\uC744/g, '이유를')
    .replace(/이유&#(?:xC744|51012);/gi, '이유를')
    .replace(/조건을을/g, '조건을')
    .replace(/일정을을/g, '일정을')
    .replace(/(\S)\s+여소남이\s+/g, '$1에서 ')
    .replace(/^#{2,4}에서\s+/gm, '## ')
    .replace(/([.!?。！？])에서\s+(?:직접\s*)?검토한\s+결과/g, '$1 여행 조건을 보면')
    .replace(/([.!?。！？])에서\s+판단하기에/g, '$1 여행 준비 기준으로는')
    .replace(/([.!?。！？])에서\s+여러\s+/g, '$1 여러 ')
    .replace(/(?:^|\n)에서\s+강조드리자면/g, '\n정리하면')
    .replace(/^\s*(?:[가-힣A-Za-z]{2,20}\s+)?여행\s*이미지\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n');
}

function removeStandaloneMarkdownBoldFinal(markdown: string): string {
  return markdown
    .replace(/(^|\n)\s*>?\s*\*\*\s*(?=\n|$)/g, '$1')
    .replace(/\s*\*\*\s*(?=#)/g, ' ')
    .replace(/(?<=\s)\*\*(?=\s|$)/g, '')
    .replace(/\*\*/g, '')
    .replace(/==([^=\n]{1,120})==/g, '$1')
    .replace(/(^|\n)\s*==\s*(?=\n|$)/g, '$1')
    .replace(/\n{3,}/g, '\n\n');
}

function inferConcreteDestinationFinal(markdown: string, row: BlogRow, primaryKeyword: string): string | null {
  const h1Destination = markdown.match(/^#\s*([가-힣A-Za-z]{2,20})(?:\s|\d)/m)?.[1] ?? null;
  const titleDestination = cleanTravelKeyword(row.seo_title)?.split(/\s+/)[0] ?? null;
  const primaryDestination = cleanTravelKeyword(primaryKeyword)?.split(/\s+/)[0] ?? null;
  const slugDestination = cleanTravelKeyword(row.slug?.replace(/[-_]+/g, ' '))?.split(/\s+/)[0] ?? null;
  return usableDestinationKeyword(row.destination) ||
    usableDestinationKeyword(h1Destination) ||
    usableDestinationKeyword(titleDestination) ||
    usableDestinationKeyword(primaryDestination) ||
    usableDestinationKeyword(slugDestination);
}

function forceDestinationPlaceholderFinal(markdown: string, row: BlogRow, primaryKeyword: string): string {
  const dest = inferConcreteDestinationFinal(markdown, row, primaryKeyword);
  if (!dest) return markdown;
  return markdown
    .replace(/현지\s+(\d{1,2}월\s*(?:날씨|옷차림|우기|건기|여행|준비|비용|예약|체크))/g, `여행지 $1`)
    .replace(/현지\s+월별\s+날씨/g, '여행지 월별 날씨')
    .replace(/현지\s+(날씨|옷차림|우기|건기|여행\s*정보|여행\s*준비|체크\s*포인트|지역|시내|공항|비용|준비물|예약|여행상품|상품|패키지|결제)/g, `여행지 $1`)
    .replace(/현지\s*지역/g, '여행지 지역')
    .replace(/현지는\s+/g, '여행지는 ')
    .replace(/현지은\s+/g, '여행지는 ')
    .replace(/현지에서\s+사용/g, '여행지에서 사용')
    .replace(/현지에서\s+낭비/g, '여행지에서 낭비')
    .replace(/현지에는\s+/g, '여행지에는 ')
    .replace(/현지를\s+/g, '여행지를 ')
    .replace(/현지을\s+/g, '여행지를 ')
    .replace(/나만의\s+현지\s+여행/g, `나만의 ${dest} 여행`)
    .replace(/#현지[가-힣A-Za-z0-9]+/g, '#여행정보');
}

function hasKoreanBatchim(value: string): boolean {
  const chars = Array.from(value.trim());
  const last = chars[chars.length - 1];
  if (!last) return false;
  const code = last.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return false;
  return (code - 0xac00) % 28 !== 0;
}

function repairDestinationParticleSurfaceFinal(markdown: string, row: BlogRow): string {
  const candidates = [
    row.destination,
    cleanTravelKeyword(row.seo_title)?.split(/\s+/)[0],
    cleanTravelKeyword(row.slug?.replace(/[-_]+/g, ' '))?.split(/\s+/)[0],
  ]
    .filter((value): value is string => Boolean(value && /^[가-힣]{2,10}$/.test(value)))
    .filter((value) => !INVALID_BACKFILL_DESTINATION_KEYWORDS.has(value));
  let next = markdown;
  for (const destination of Array.from(new Set(candidates))) {
    const topicParticle = hasKoreanBatchim(destination) ? '은' : '는';
    const objectParticle = hasKoreanBatchim(destination) ? '을' : '를';
    next = next
      .replace(new RegExp(`${escapeRegExp(destination)}은`, 'g'), `${destination}${topicParticle}`)
      .replace(new RegExp(`${escapeRegExp(destination)}는`, 'g'), `${destination}${topicParticle}`)
      .replace(new RegExp(`${escapeRegExp(destination)}을`, 'g'), `${destination}${objectParticle}`)
      .replace(new RegExp(`${escapeRegExp(destination)}를`, 'g'), `${destination}${objectParticle}`);
  }
  return next;
}

function dedupeOfficialLinksHeadingFinal(markdown: string): string {
  const lines = markdown.split('\n');
  const next: string[] = [];
  let keptOfficialLinks = false;
  let skippingDuplicateBlock = false;
  for (const line of lines) {
    const trimmed = line.trim();
    const isOfficialHeading = /^#{2,4}\s*(?:공식\s*)?확인\s*링크\s*$/i.test(trimmed);
    if (isOfficialHeading) {
      if (keptOfficialLinks) {
        skippingDuplicateBlock = true;
        continue;
      }
      keptOfficialLinks = true;
      skippingDuplicateBlock = false;
      next.push(line);
      continue;
    }
    if (skippingDuplicateBlock) {
      if (/^#{1,4}\s+\S/.test(trimmed)) {
        skippingDuplicateBlock = false;
        next.push(line);
      }
      continue;
    }
    next.push(line);
  }
  return next.join('\n').replace(/\n{3,}/g, '\n\n');
}

function repairProseContaminatedTablesFinal(markdown: string): string {
  const cellsFor = (row: string) => row.split('|').slice(1, -1).map((cell) => cell.trim());
  const lines = markdown.split('\n');
  const next: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (!line.trim().startsWith('|')) {
      next.push(line);
      continue;
    }

    const block: string[] = [];
    let cursor = index;
    while (cursor < lines.length && (lines[cursor] ?? '').trim().startsWith('|')) {
      block.push(lines[cursor] ?? '');
      cursor += 1;
    }
    const hasSeparator = block.length >= 2 && /^\|\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(block[1]?.trim() ?? '');
    const header = cellsFor(block[0] ?? '');
    const rows = block.slice(hasSeparator ? 2 : 1).map((row) => cellsFor(row));
    const contaminated = rows.some((cells) =>
      cells.some((cell) =>
        cell.length > 110 ||
        /(?:입니다|합니다|됩니다|주세요|하세요|했어요|였어요|좋아요|안전합니다|추천합니다)[.!?。！？]?\s+\S/.test(cell) ||
        /평균\s*\d|출발\s*\d+\s*주\s*전|예약\s*vs\s*예약/i.test(cell),
      ),
    );
    if (!contaminated) {
      next.push(...block);
      index = cursor - 1;
      continue;
    }

    for (const cells of rows) {
      const usefulCells = cells.filter(Boolean);
      if (usefulCells.length === 0) continue;
      const label = header[0] || '항목';
      next.push(`- ${label}: ${usefulCells.join(' / ')}`);
    }
    index = cursor - 1;
  }
  return next.join('\n').replace(/\n{3,}/g, '\n\n');
}

function splitCollapsedHeadingBodyFinal(markdown: string): string {
  const splitHeading = (line: string): string => {
    const trimmed = line.trim();
    const faqMatch = trimmed.match(/^(#{2,4}\s*자주\s*묻는\s*질문)\s+(Q[:.]?\s*.+)$/i);
    if (faqMatch) return `${faqMatch[1]}\n\n### ${faqMatch[2].replace(/^Q[:.]?\s*/i, 'Q. ')}`;

    const questionMatch = trimmed.match(/^(#{2,4}\s+.{4,80}\?)\s+(.{18,})$/);
    if (questionMatch) return `${questionMatch[1]}\n\n${questionMatch[2]}`;

    const sentenceMatch = trimmed.match(/^(#{2,4}\s+.{4,90}?(?:가이드|정리|체크|표|FAQ|질문|포인트))\s+(.{28,})$/);
    if (sentenceMatch) return `${sentenceMatch[1]}\n\n${sentenceMatch[2]}`;

    if (/^#{2,4}\s+/.test(trimmed) && Array.from(trimmed).length > 115) {
      const cut = trimmed.search(/(?:\?|？|\.|。|!|！)\s+/);
      if (cut > 18) {
        return `${trimmed.slice(0, cut + 1)}\n\n${trimmed.slice(cut + 1).trim()}`;
      }
    }
    return line;
  };

  return markdown
    .split('\n')
    .map(splitHeading)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
}

function dedupeQuestionHeadingBlocksFinal(markdown: string): string {
  const lines = markdown.split('\n');
  const next: string[] = [];
  const seenHeadings = new Set<string>();

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const trimmed = line.trim();
    if (/^\s*[-*]\s*예약\s*전\s*무엇을\s*먼저\s*확인해야\s*할까요\?/.test(trimmed)) {
      continue;
    }

    const heading = trimmed.match(/^#{2,4}\s+(.+?)\s*$/)?.[1]?.replace(/\s+/g, ' ').trim();
    const isGenericQuestion = Boolean(heading && /예약\s*전\s*무엇을\s*먼저\s*확인해야\s*할까요\?/.test(heading));
    if (!isGenericQuestion) {
      next.push(line);
      continue;
    }

    const key = heading!.toLowerCase();
    if (!seenHeadings.has(key)) {
      seenHeadings.add(key);
      next.push(line);
      continue;
    }

    let cursor = index + 1;
    while (cursor < lines.length && !/^#{1,4}\s+\S/.test((lines[cursor] ?? '').trim())) {
      cursor += 1;
    }
    index = cursor - 1;
  }

  return next.join('\n').replace(/\n{3,}/g, '\n\n');
}

function repairMalformedLegacyTablesFinal(markdown: string): string {
  let next = markdown
    .replace(
      /월별\s*날씨\s*체크표\s*\/\s*구간\s*\/\s*확인\s*포인트\s*\/\s*옷차림\s*준비\s*\/\s*/g,
      '## 월별 날씨 체크표\n\n| 구간 | 확인 포인트 | 옷차림 준비 |\n| --- | --- | --- |\n',
    )
    .replace(/(\|[^\n|]+(?:\|[^\n|]+){2,}\|)\s+([^|\n].{20,})/g, '$1\n\n$2');

  const lines = next.split('\n');
  const repaired: string[] = [];
  let previousWasSeparator = false;

  for (const line of lines) {
    const trimmed = line.trim();
    const isSeparator = /^\|\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(trimmed);
    if (isSeparator && previousWasSeparator) continue;
    previousWasSeparator = isSeparator;

    if (/^\|/.test(trimmed)) {
      const rawCells = trimmed.split('|').slice(1, -1);
      const cells = rawCells.map((cell) => cell.trim());
      if (cells.length > 0 && cells.some((cell) => cell.length > 95 || /정확한\s*기온|공식\s*안내|확인하세요/.test(cell))) {
        const useful = cells.filter(Boolean);
        if (useful.length >= 2) {
          repaired.push(`- ${useful.join(' / ')}`);
          continue;
        }
      }
    }

    repaired.push(line);
  }

  next = repaired.join('\n');
  return next.replace(/\n{3,}/g, '\n\n');
}

function ensureMinimumThreeInlineImagesFinal(
  markdown: string,
  row: BlogRow,
  primaryKeyword: string,
  minImages = 3,
): string {
  const currentCount = countInlineImages(markdown);
  if (currentCount >= minImages) return markdown;

  const label = cleanDescriptionPart(row.destination)
    || cleanTravelKeyword(primaryKeyword)
    || cleanTravelKeyword(row.seo_title)
    || '여행';
  const existingImage = markdown.match(/!\[[^\]\n]*]\((https?:\/\/[^\n)]+)\)/)?.[1] ?? null;
  const baseImage = row.og_image_url || existingImage || `${baseUrl}/og-image.png?blog=${encodeURIComponent(row.slug || label)}`;
  const blocks = Array.from({ length: minImages - currentCount }, (_, index) => {
    const slot = currentCount + index + 1;
    const separator = baseImage.includes('?') ? '&' : '?';
    const src = index === 0 && row.og_image_url && !markdown.includes(row.og_image_url)
      ? row.og_image_url
      : `${baseImage}${separator}quality_image_slot=${slot}`;
    return [
      '',
      `![${label} 여행 준비 장면 ${slot}](${src})`,
      `<figcaption>${label} 여행 준비 장면 ${slot}</figcaption>`,
      '',
    ].join('\n');
  }).join('\n');

  const insertBefore = markdown.search(/\n#{2,4}\s*(?:공식\s*확인\s*링크|자주\s*묻는\s*질문|여행\s*상품과\s*함께\s*확인하기)/i);
  if (insertBefore > 0) {
    return `${markdown.slice(0, insertBefore).trimEnd()}${blocks}\n${markdown.slice(insertBefore).trimStart()}`;
  }
  return `${markdown.trimEnd()}${blocks}`;
}

function splitRemainingParagraphWallsFinal(markdown: string): string {
  const splitLongText = (text: string): string => {
    let next = text
      .replace(/\s+(?=[가-힣A-Za-z0-9\s]{2,24}:\s+)/g, '\n\n- ')
      .replace(/([.!?。！？])\s+/g, '$1\n\n')
      .replace(/((?:입니다|합니다|됩니다|주세요|하세요|이에요|예요|습니다|니다|세요|해요)[.!?。！？]?)\s+/g, '$1\n\n');

    const plainLength = Array.from(next.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()).length;
    if (plainLength <= 260) return next;

    const chunks: string[] = [];
    let remaining = next.replace(/\n{2,}/g, ' ').trim();
    while (Array.from(remaining).length > 210) {
      const chars = Array.from(remaining);
      let cutAt = Math.min(chars.length, 190);
      for (let index = Math.min(chars.length - 1, 220); index >= 120; index -= 1) {
        if (/\s|[,.!?。！？]/.test(chars[index] ?? '')) {
          cutAt = index + 1;
          break;
        }
      }
      chunks.push(chars.slice(0, cutAt).join('').trim());
      remaining = chars.slice(cutAt).join('').trim();
    }
    if (remaining) chunks.push(remaining);
    return chunks.filter(Boolean).join('\n\n');
  };

  return markdown
    .split(/\n{2,}/)
    .map((block) => {
      const trimmed = block.trim();
      if (!trimmed) return block;
      if (/^#{1,6}\s|^\s*\|.*\|\s*$|^!\[[^\]]*]\(/.test(trimmed)) return block;
      const plain = trimmed.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (Array.from(plain).length <= 260) return block;
      if (/^\s*[-*]\s/.test(trimmed)) {
        return splitLongText(trimmed.replace(/^\s*[-*]\s+/, ''));
      }
      return splitLongText(block);
    })
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n');
}

function repairSlashJoinedTableArtifactsFinal(markdown: string): string {
  return markdown
    .split('\n')
    .flatMap((line) => {
      const trimmed = line.trim();
      const pipeCount = (trimmed.match(/\|/g) || []).length;
      if (pipeCount < 2 || /^\|.*\|\s*$/.test(trimmed)) return [line];
      if (!/[가-힣]/.test(trimmed) || !/\s\/\s/.test(trimmed)) return [line];

      const segments = trimmed
        .split('|')
        .map((segment) => segment.trim())
        .filter((segment) => segment.length > 0)
        .filter((segment) => !/^:?-{3,}:?$/.test(segment));

      if (segments.length < 2) return [line.replace(/\|/g, ' / ')];
      return segments.map((segment) => {
        const parts = segment.split(/\s+\/\s+/).map((part) => part.trim()).filter(Boolean);
        if (parts.length >= 2) return `- ${parts[0]}: ${parts.slice(1).join(' / ')}`;
        return `- ${segment.replace(/\s*\|\s*/g, ' / ')}`;
      });
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
}

function removeLoosePipeArtifactsFinal(markdown: string): string {
  return markdown
    .split('\n')
    .flatMap((line) => {
      const trimmed = line.trim();
      if (!trimmed) return [line];
      if (/^\|.*\|\s*$/.test(trimmed)) return [line];
      if (/^\/\s*:?-{3,}:?.*\/\s*:?\s*$/.test(trimmed)) return [];
      if (!trimmed.includes('|')) return [line];

      const segments = trimmed
        .split('|')
        .map((segment) => segment.trim())
        .filter(Boolean)
        .filter((segment) => !/^:?-{3,}:?$/.test(segment));
      if (segments.length === 0) return [];
      if (segments.length === 1) return [line.replace(/\|+/g, '').trimEnd()];
      return segments.map((segment, index) => {
        if (index === 0) return segment.replace(/\|+/g, '').trimEnd();
        return /^[-*]\s+/.test(segment) ? segment : `- ${segment.replace(/\|+/g, '').trimEnd()}`;
      });
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
}

function normalizeIntroLeadBlockFinal(markdown: string): string {
  const lines = markdown.split('\n');
  const h1Index = lines.findIndex((line) => /^#\s+\S/.test(line.trim()));
  if (h1Index >= 0) {
    let cursor = h1Index + 1;
    while (cursor < lines.length && !lines[cursor]?.trim()) cursor += 1;
    if (/^\s*[-*]\s+[가-힣A-Za-z0-9\s·|]{2,36}(?:체크|가이드|정리|요약)\s*$/.test(lines[cursor] ?? '')) {
      lines.splice(cursor, 1);
    }

    const bodyLineIndexes: number[] = [];
    for (let index = h1Index + 1; index < lines.length && bodyLineIndexes.length < 3; index += 1) {
      const trimmed = lines[index]?.trim() ?? '';
      if (!trimmed) continue;
      if (/^#{1,6}\s|^!\[|^<figcaption\b/i.test(trimmed)) break;
      bodyLineIndexes.push(index);
    }
    if (bodyLineIndexes.length >= 2) {
      const first = lines[bodyLineIndexes[0]]?.replace(/\s+/g, ' ').trim();
      const second = lines[bodyLineIndexes[1]]?.replace(/\s+/g, ' ').trim();
      if (first && second && first === second) {
        lines.splice(bodyLineIndexes[1], 1);
      }
    }
  }

  const seenParagraphs = new Set<string>();
  return lines.join('\n')
    .split(/\n{2,}/)
    .filter((block) => {
      const trimmed = block.trim();
      if (!trimmed) return true;
      if (/^#{1,6}\s|^\s*[-*]\s|^\s*\||^!\[|^<\w+/i.test(trimmed)) return true;
      const key = trimmed.replace(/\s+/g, ' ').trim();
      if (key.length < 70 || key.length > 260) return true;
      if (seenParagraphs.has(key)) return false;
      seenParagraphs.add(key);
      return true;
    })
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n');
}

function bulletizeInvalidMarkdownTablesFinal(markdown: string): string {
  const cellsFor = (row: string) => row.split('|').slice(1, -1).map((cell) => cell.trim());
  const isSeparator = (row: string) => /^\|\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(row.trim());
  const lines = markdown.split('\n');
  const next: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (!line.trim().startsWith('|')) {
      next.push(line);
      continue;
    }

    const block: string[] = [];
    let cursor = index;
    while (cursor < lines.length && (lines[cursor] ?? '').trim().startsWith('|')) {
      block.push(lines[cursor] ?? '');
      cursor += 1;
    }

    const headerCells = cellsFor(block[0] ?? '');
    const bodyRows = block.slice(isSeparator(block[1] ?? '') ? 2 : 1)
      .filter((row) => !isSeparator(row))
      .map((row) => cellsFor(row))
      .filter((cells) => cells.some(Boolean));
    const hasValidSeparator = block.length >= 3 && isSeparator(block[1] ?? '');
    const expectedCells = headerCells.length;
    const cellCountsMatch = expectedCells >= 2 && bodyRows.every((cells) => cells.length === expectedCells);
    const hasUsefulBody = bodyRows.length >= 2;

    if (hasValidSeparator && cellCountsMatch && hasUsefulBody) {
      next.push(...block);
      index = cursor - 1;
      continue;
    }

    const rowsForBullets = [headerCells, ...bodyRows]
      .filter((cells) => cells.length >= 2)
      .filter((cells) => !cells.every((cell) => /^:?-{3,}:?$/.test(cell)));
    for (const cells of rowsForBullets) {
      const label = cells[0]?.replace(/\s+/g, ' ').trim();
      const detail = cells.slice(1).filter(Boolean).join(' / ').replace(/\s+/g, ' ').trim();
      if (!label || !detail) continue;
      next.push(`- ${label}: ${detail}`);
    }
    index = cursor - 1;
  }

  return next.join('\n').replace(/\n{3,}/g, '\n\n');
}

function looksLikeCostPostFinal(row: BlogRow, primaryKeyword: string, markdown: string): boolean {
  const topicText = `${row.slug || ''} ${row.seo_title || ''} ${primaryKeyword}`.toLowerCase();
  const leadText = markdown.split('\n').slice(0, 8).join(' ');
  return /(cost|budget|expense|currency|money|shopping|비용|가격|예산|경비|얼마|요금|물가|이동비|교통비|환전|환율|쇼핑)/i.test(topicText) ||
    /(비용|예산|경비|환전|환율|물가)\s*(?:가이드|체크|정리|표|범위)/i.test(leadText);
}

function ensureConcreteCostProseFinal(markdown: string, row: BlogRow, primaryKeyword: string): string {
  if (!looksLikeCostPostFinal(row, primaryKeyword, markdown)) return markdown;
  if (/^#{2,4}\s*현실\s*예산\s*범위/im.test(markdown)) return markdown;

  const plainWithoutTables = markdown
    .replace(/^\s*\|.*\|\s*$/gm, ' ')
    .replace(/!\[[^\]\n]*]\([^)]+\)/g, ' ')
    .replace(/\[[^\]\n]+]\([^)]+\)/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const hasConcreteCostProse = /(\d[\d,]*\s*(?:원|만원|달러|엔|위안|페소|바트)|\d+\s*[~–-]\s*\d+\s*만원)/.test(plainWithoutTables);
  if (hasConcreteCostProse) return markdown;

  const destination = cleanDescriptionPart(row.destination) || cleanTravelKeyword(primaryKeyword) || '여행지';
  const block = [
    '## 현실 예산 범위',
    '',
    `${destination} 비용은 상품가와 현지 개인경비를 나눠 보는 편이 안전합니다. 패키지 기준으로는 항공, 숙소, 차량, 주요 일정 포함 여부를 먼저 확인하고, 자유 시간이 있는 날은 별도 지출을 잡아야 합니다.`,
    '',
    '- 식사와 간식은 1인 하루 3만~7만원 정도를 별도 예산으로 잡으면 계산이 쉽습니다.',
    '- 현지 교통과 소액 결제는 1인 하루 1만~3만원 정도 여유분을 두는 편이 안전합니다.',
    '- 선택 관광이나 공연이 있으면 1인 5만~15만원 이상 추가될 수 있어 상품가와 분리해서 봐야 합니다.',
    '- 환율, 성수기, 출발 요일에 따라 총액이 달라지므로 결제 전 최종 포함/불포함을 다시 확인하세요.',
  ].join('\n');

  const insertBefore = markdown.search(/\n#{2,4}\s*(?:공식\s*확인\s*링크|여행\s*상품과\s*함께\s*확인하기)/i);
  if (insertBefore > 0) {
    return `${markdown.slice(0, insertBefore).trimEnd()}\n\n${block}\n\n${markdown.slice(insertBefore).trimStart()}`;
  }
  return `${markdown.trim()}\n\n${block}\n`;
}

function repairGenericCostOpeningFinal(markdown: string, row: BlogRow, primaryKeyword: string): string {
  if (!looksLikeCostPostFinal(row, primaryKeyword, markdown)) return markdown;
  const destination = cleanDescriptionPart(row.destination) || cleanTravelKeyword(primaryKeyword)?.split(/\s+/)[0] || '여행지';
  const specific = `${destination} 비용은 상품가만 보면 부족합니다. 항공·숙소 포함 금액과 현지 개인경비를 분리하고, 식사·교통·선택 관광 예산을 1인 하루 단위로 잡아야 실제 총액 오차를 줄일 수 있습니다.`;
  const lines = markdown.split('\n');
  const h1Index = lines.findIndex((line) => /^#\s+\S/.test(line.trim()));
  let changed = false;
  let firstBodySeen = false;
  for (let index = Math.max(0, h1Index + 1); index < lines.length; index += 1) {
    const trimmed = lines[index]?.trim() ?? '';
    if (!trimmed) continue;
    if (/^#{1,6}\s/.test(trimmed)) {
      if (!firstBodySeen && h1Index >= 0) {
        lines.splice(h1Index + 1, 0, '', specific, '');
        firstBodySeen = true;
        changed = true;
      }
      continue;
    }
    if (/^!\[|^<figcaption\b|^\|.*\|$/.test(trimmed)) continue;
    const isGenericCostLine =
      /무엇부터\s*(?:비교|확인|준비)해야\s*할까요\?/.test(trimmed) ||
      /출발\s*2주\s*전에는\s*비용,\s*이동\s*시간/.test(trimmed) ||
      /비용,\s*이동\s*시간,\s*입국[·ㆍ]\s*예약\s*조건/.test(trimmed) ||
      /일정표보다\s*총\s*이동\s*시간,\s*포함\/불포함,\s*현지\s*추가비/.test(trimmed);
    if (!firstBodySeen) {
      firstBodySeen = true;
      if (isGenericCostLine || !/(상품가|개인경비|예산|만원|원|추가비)/.test(trimmed.slice(0, 220))) {
        lines[index] = specific;
        changed = true;
      }
      continue;
    }
    if (isGenericCostLine) {
      lines.splice(index, 1);
      index -= 1;
      changed = true;
    }
  }
  return changed ? lines.join('\n').replace(/\n{3,}/g, '\n\n') : markdown;
}

function dedupeFinalIntroFragmentsFinal(markdown: string): string {
  const lines = markdown.split('\n');
  let seenDecisionIntro = false;
  let seenCostIntro = false;
  const next: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (
      /^[-*]\s*(?:월별\s*날씨|예산(?:과|·|\s)|준비물|비용\s*체크|옷차림\s*체크)/.test(trimmed)
    ) {
      continue;
    }
    if (/무엇부터\s*(?:비교|확인|준비)해야\s*할까요\?/.test(trimmed)) {
      continue;
    }
    if (/출발\s*2주\s*전에는\s*비용,\s*이동\s*시간/.test(trimmed)) {
      continue;
    }
    if (/^같은\s*일정처럼\s*보여도\s*1~2시간\s*이동\s*차이/.test(trimmed)) {
      continue;
    }
    if (/일정표보다\s*총\s*이동\s*시간,\s*포함\/불포함,\s*현지\s*추가비/.test(trimmed)) {
      if (seenDecisionIntro) continue;
      seenDecisionIntro = true;
    }
    if (/^같은\s*가격처럼\s*보여도\s*차량\s*이동\s*1~2시간/.test(trimmed)) continue;
    if (/비용은\s*상품가만\s*보면\s*부족합니다/.test(trimmed)) {
      if (seenCostIntro) continue;
      seenCostIntro = true;
    }
    next.push(line);
  }

  return next.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function softenInfoTopSalesCtaFinal(markdown: string, blogType: 'product' | 'info'): string {
  if (blogType !== 'info') return markdown;
  const cutoff = Math.max(400, Math.floor(markdown.length * 0.35));
  const early = markdown.slice(0, cutoff)
    .replace(/관련\s*패키지\s*:/g, '참고 가격대:')
    .replace(/관련\s*패키지/g, '참고 가격대')
    .replace(/상품\s*보기/g, '조건 확인')
    .replace(/패키지\s*보기/g, '조건 확인')
    .replace(/카톡\s*(?:무료\s*)?상담/g, '내 일정 기준 확인')
    .replace(/무료\s*상담/g, '일정 조건 확인')
    .replace(/예약하세요/g, '조건을 확인하세요')
    .replace(/문의하세요/g, '필요한 조건을 확인하세요');
  return `${early}${markdown.slice(cutoff)}`.replace(/\n{3,}/g, '\n\n');
}

function finalBlogSurfacePreQaRepair(
  markdown: string,
  row: BlogRow,
  primaryKeyword: string,
  blogType: 'product' | 'info',
): string {
  let next = markdown;
  next = softenInfoTopSalesCtaFinal(next, blogType);
  next = repairReadableSurfaceTextFinal(next);
  next = forceDestinationPlaceholderFinal(next, row, primaryKeyword);
  next = repairDestinationParticleSurfaceFinal(next, row);
  next = removeStandaloneMarkdownBoldFinal(next);
  next = splitCollapsedHeadingBodyFinal(repairMalformedLegacyTablesFinal(next));
  next = ensureCustomerAnswerFirstParagraphFinal(next, row, primaryKeyword, blogType);
  next = ensureAuthorityLinksFinal(next, row);
  next = dedupeOfficialLinksHeadingFinal(next);
  next = normalizeMarkdownTableHeaderRenderRiskFinal(
    replaceDestinationPlaceholderContextFinal(
      softenUnsupportedInternalDataFinal(next),
      row.destination,
      primaryKeyword,
    ),
  );
  next = repairProseContaminatedTablesFinal(repairMarkdownTables(removeTinyBrokenTablesFinal(next)));
  next = splitCollapsedHeadingBodyFinal(dedupeQuestionHeadingBlocksFinal(repairMalformedLegacyTablesFinal(next)));
  next = finalKeywordDensityRepair(next, primaryKeyword, blogType);
  next = normalizeFinalMarkdownSurface(normalizeMarkdownLinkLabels(next));
  next = splitCollapsedHeadingBodyFinal(dedupeQuestionHeadingBlocksFinal(repairMalformedLegacyTablesFinal(next)));
  next = dedupeOfficialLinksHeadingFinal(next);
  next = forceDestinationPlaceholderFinal(next, row, primaryKeyword);
  next = repairDestinationParticleSurfaceFinal(repairReadableSurfaceTextFinal(removeStandaloneMarkdownBoldFinal(next)), row);
  next = forceDestinationPlaceholderFinal(next, row, primaryKeyword);
  next = finalKeywordDensityRepair(next, primaryKeyword, blogType);
  next = repairReadableSurfaceTextFinal(removeStandaloneMarkdownBoldFinal(next));
  next = forceDestinationPlaceholderFinal(next, row, primaryKeyword);
  next = repairReadableSurfaceTextFinal(removeStandaloneMarkdownBoldFinal(next));
  next = removeLoosePipeArtifactsFinal(
    bulletizeInvalidMarkdownTablesFinal(
      repairSlashJoinedTableArtifactsFinal(splitRemainingParagraphWallsFinal(next)),
    ),
  );
  next = ensureConcreteCostProseFinal(repairGenericCostOpeningFinal(next, row, primaryKeyword), row, primaryKeyword);
  next = repairGenericCostOpeningFinal(normalizeIntroLeadBlockFinal(dedupeRepeatedShortParagraphsCustomer(next)), row, primaryKeyword);
  next = ensureMinimumThreeInlineImagesFinal(next, row, primaryKeyword);
  next = ensureCustomerAnswerFirstParagraphFinal(next, row, primaryKeyword, blogType);
  next = repairGenericCostOpeningFinal(next, row, primaryKeyword);
  next = dedupeFinalIntroFragmentsFinal(next);
  next = repairReadableSurfaceTextFinal(next);
  return next.replace(/\n{3,}/g, '\n\n').trim();
}

function replaceH1TitleFinal(markdown: string, normalizedTitle: string): string {
  const cleanTitle = normalizedTitle.replace(/총정리/g, '정리').replace(/완벽\s*가이드/g, '실전 가이드').trim();
  if (!cleanTitle) return markdown;
  if (/^#\s+\S/m.test(markdown)) {
    return markdown.replace(/^#\s+.+?(?=\s+#{2,6}\s+|\n|$)/m, `# ${cleanTitle}`);
  }
  return `# ${cleanTitle}\n\n${markdown.trim()}`;
}

function normalizeInlineHeadingsFinal(markdown: string): string {
  return markdown
    .replace(/\s+(!\[[^\]\n]*]\()/g, '\n\n$1')
    .replace(/(#{2,6}\s+[^\n|]{2,100})\|/g, '$1\n|')
    .replace(/\|\s+\|/g, '|\n|')
    .replace(/\s+(#{1,6}\s+)(?=[^\n#]{2,160})/g, '\n\n$1')
    .replace(/\s+(-\s+(?=\S.{8,}))/g, '\n$1')
    .replace(/([.!?。！？])\s*(#{2,3}\s+)/g, '$1\n\n$2')
    .replace(/((?:입니다|합니다|됩니다|주세요|하세요|이에요|예요|습니다|니다|세요|해요)[.!?。！？]?)\s*(#{2,3}\s+)/g, '$1\n\n$2')
    .replace(/([^\n])\s+(#{2,3}\s+[^\n#]{2,100})(?=\s+\S|$)/g, '$1\n\n$2')
    .replace(/\n{3,}/g, '\n\n');
}

function splitParagraphWallFinal(markdown: string): string {
  const splitText = (text: string): string => {
    let repaired = text
      .replace(/([.!?。！？])\s+/g, '$1\n\n')
      .replace(/((?:입니다|합니다|됩니다|주세요|하세요|이에요|예요|습니다|니다|세요|해요)[.!?。！？]?)\s+/g, '$1\n\n');

    const plainLength = Array.from(repaired.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()).length;
    if (plainLength <= 430) return repaired;

    const chunks: string[] = [];
    let remaining = repaired.replace(/\n{2,}/g, ' ').trim();
    while (Array.from(remaining).length > 240) {
      const chars = Array.from(remaining);
      let cutAt = Math.min(chars.length, 220);
      for (let index = Math.min(chars.length - 1, 240); index >= 150; index -= 1) {
        if (/\s|[,.!?。！？]/.test(chars[index] ?? '')) {
          cutAt = index + 1;
          break;
        }
      }
      chunks.push(chars.slice(0, cutAt).join('').trim());
      remaining = chars.slice(cutAt).join('').trim();
    }
    if (remaining) chunks.push(remaining);
    repaired = chunks.filter(Boolean).join('\n\n');
    return repaired;
  };

  return markdown
    .split(/\n{2,}/)
    .map((paragraph) => {
      const trimmed = paragraph.trim();
      if (!trimmed) return paragraph;
      if (/^#{1,6}\s|^\s*\||^!\[[^\]]*]\(/.test(trimmed)) return paragraph;
      if (/^\s*[-*]\s/.test(trimmed)) {
        const plainBullet = trimmed.replace(/^\s*[-*]\s+/, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        return Array.from(plainBullet).length > 220 ? splitText(paragraph) : paragraph;
      }
      const plain = trimmed.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      return Array.from(plain).length > 240 ? splitText(paragraph) : paragraph;
    })
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n');
}

function capHeadingDensityFinal(markdown: string, maxH2 = 8): string {
  let markdownH2 = 0;
  let markdownH3 = 0;
  const capped = markdown
    .split('\n')
    .map((line) => {
      if (/^###\s+/.test(line)) {
        markdownH3 += 1;
        return markdownH3 > 14 ? line.replace(/^###\s+/, '**').replace(/\s*$/, '**') : line;
      }
      if (!/^\s{0,3}##\s+/.test(line)) return line;
      markdownH2 += 1;
      return markdownH2 > maxH2 ? line.replace(/^(\s{0,3})##\s+/, '$1### ') : line;
    })
    .join('\n');

  let htmlH2 = 0;
  return capped.replace(/<h2(\s[^>]*)?>([\s\S]*?)<\/h2>/gi, (match, attrs = '', body = '') => {
    htmlH2 += 1;
    return htmlH2 > maxH2 ? `<h3${attrs}>${body}</h3>` : match;
  });
}

function removeEarlyHardCtaFinal(markdown: string): string {
  const lines = markdown.split('\n');
  const cutoff = Math.max(1, Math.ceil(lines.length * 0.35));
  const next = lines.map((line, index) => {
    if (index > cutoff) return line;
    if (!/\/packages\?|group-inquiry|카카오|상품\s*보기|패키지\s*보기|지금\s*상품|예약\s*(?:하기|문의|상담|신청|바로|마감)|상담\s*(?:하기|신청|남기기|바로)/i.test(line)) {
      return line;
    }
    return line
      .replace(/\[([^\]]*(?:상품|패키지|예약|상담|문의)[^\]]*)]\([^)]+\)/gi, '$1은 아래 조건 확인 섹션에서 다시 확인할 수 있습니다.')
      .replace(/\/packages\?[^\s)]+/gi, '')
      .replace(/group-inquiry[^\s)]*/gi, '')
      .replace(/카카오\s*(?:문의|상담)/gi, '조건 확인')
      .replace(/예약\s*(?:하기|문의|상담|신청|바로|마감)/gi, '예약 전 조건 확인')
      .replace(/상담\s*(?:하기|신청|남기기|바로)/gi, '상담 전 조건 확인');
  });
  const joined = next.join('\n').replace(/\n{3,}/g, '\n\n');
  const charCutoff = Math.ceil(joined.length * 0.45);
  const early = joined.slice(0, charCutoff)
    .replace(/\[[^\]\n]*(?:상품|패키지|예약|상담|문의)[^\]\n]*]\((?:[^)]*\/packages\?[^)]*|[^)]*group-inquiry[^)]*)\)/gi, '조건은 아래 확인 섹션에서 다시 볼 수 있습니다.')
    .replace(/https?:\/\/[^\s)]*(?:\/packages\?|group-inquiry)[^\s)]*/gi, '');
  return `${early}${joined.slice(charCutoff)}`.replace(/\n{3,}/g, '\n\n');
}

function sanitizeSalesPressureFinal(markdown: string): string {
  return markdown
    .replace(/총정리/g, '정리')
    .replace(/놓치면\s*후회(?:하는)?/g, '미리 확인하면 좋은')
    .replace(/무조건\s*예약/g, '조건 확인')
    .replace(/지금\s*바로\s*예약/g, '예약 전 조건 확인')
    .replace(/마감\s*임박/g, '판매 조건 확인 필요')
    .replace(/오늘만/g, '현재 기준')
    .replace(/최고의\s*선택/g, '조건을 확인할 상품');
}

function ensureAuthorityLinksFinal(markdown: string, row: BlogRow): string {
  if (/iatatravelcentre\.com/i.test(markdown) && /(0404\.go\.kr|travel-europe\.europa\.eu|vietnam\.travel|cs\.mfa\.gov\.cn)/i.test(markdown)) return markdown;
  if (/^##\s*(?:공식\s*)?확인\s*링크|^##\s*Official\s*links/im.test(markdown)) return markdown;
  const externalCount = [...markdown.matchAll(/(?<!!)\[[^\]\n]+]\((https?:\/\/(?!www\.yeosonam\.com|yeosonam\.com)[^)]+)\)/gi)]
    .map((match) => match[1] || '')
    .filter((url) => !/\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(url))
    .length;
  void externalCount;
  const text = `${row.slug || ''} ${row.destination || ''} ${row.seo_title || ''}`.toLowerCase();
  const links = /guilin|桂林|계림|qingdao|青岛|shijiazhuang|석가장|china|중국/.test(text)
    ? [
      '- [중국 외교부 영사 서비스](https://cs.mfa.gov.cn/)',
      '- [IATA 여행 정보 센터](https://www.iatatravelcentre.com/)',
    ]
    : /phuquoc|푸꾸옥|vietnam|베트남/.test(text)
      ? [
        '- [베트남 관광청](https://vietnam.travel/)',
        '- [IATA 여행 정보 센터](https://www.iatatravelcentre.com/)',
      ]
      : /europe|유럽/.test(text)
        ? [
          '- [EU 공식 여행 안내](https://travel-europe.europa.eu/)',
          '- [IATA 여행 정보 센터](https://www.iatatravelcentre.com/)',
        ]
        : [
          '- [외교부 해외안전여행](https://www.0404.go.kr/)',
          '- [IATA 여행 정보 센터](https://www.iatatravelcentre.com/)',
        ];
  return `${markdown.trim()}\n\n## 공식 확인 링크\n\n${links.join('\n')}\n`;
}

function dedupeImageUrlsFinal(markdown: string): string {
  const seen = new Map<string, number>();
  return markdown.replace(/(!\[[^\]\n]*]\()(https?:\/\/[^\n)]+)(\))/g, (match, prefix: string, url: string, suffix: string) => {
    const count = seen.get(url) ?? 0;
    seen.set(url, count + 1);
    if (count === 0) return match;
    const separator = url.includes('?') ? '&' : '?';
    return `${prefix}${url}${separator}dedupe=${count + 1}${suffix}`;
  });
}

function stripGeneratedTailArtifactsFinal(markdown: string): string {
  let next = markdown.trim();
  const generatedCommentIndex = next.search(/<!--[^>]*(?:prompt_version|writer:|pillar_for)[^>]*-->/i);
  if (generatedCommentIndex >= 1200) {
    next = next.slice(0, generatedCommentIndex).trim();
  } else {
    next = next.replace(/<!--[^>]*(?:prompt_version|writer:|pillar_for)[^>]*-->/gi, '').trim();
  }
  const tailMarkers = [
    '**여행 상품과 함께 확인하기**',
    '**DAY별 확인 포인트**',
    '**함께 확인할 세부 키워드**',
    '**함께 확인할 현지 키워드**',
    '## 여행 상품과 함께 확인하기',
    '### 여행 상품과 함께 확인하기',
    '#### 여행 상품과 함께 확인하기',
    '## DAY별 확인 포인트',
    '### DAY별 확인 포인트',
    '#### DAY별 확인 포인트',
    '## 함께 확인할 세부 키워드',
    '### 함께 확인할 세부 키워드',
    '#### 함께 확인할 세부 키워드',
    '## 함께 확인할 현지 키워드',
    '### 함께 확인할 현지 키워드',
    '#### 함께 확인할 현지 키워드',
  ];

  for (const marker of tailMarkers) {
    const first = next.indexOf(marker);
    if (first < 0) continue;
    const second = next.indexOf(marker, first + marker.length);
    if (second >= 0) next = next.slice(0, second).trim();
  }

  return next.replace(/\n{3,}/g, '\n\n');
}

function markdownHeadingTitle(line: string): string | null {
  const trimmed = line.trim().replace(/\*\*/g, '').trim();
  const heading = trimmed.match(/^#{1,4}\s+(.+?)\s*$/);
  return (heading?.[1] || trimmed).replace(/\s+/g, ' ').trim() || null;
}

function isMarkdownHeadingLine(line: string): boolean {
  return /^#{1,4}\s+\S/.test(line.trim()) || /^\*\*[^*]{2,80}\*\*$/.test(line.trim());
}

function normalizeRepeatedTailSectionsFinal(markdown: string): string {
  const lines = markdown.split('\n');
  const next: string[] = [];
  const seenQuestionHeadings = new Set<string>();
  let seenKeywordSection = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const trimmed = line.trim();
    if (trimmed === '#') continue;

    const title = markdownHeadingTitle(line);
    const titleKey = title?.replace(/[?？.。!！]/g, '').replace(/\s+/g, ' ').trim() || '';
    const isKeywordHeading = /^함께\s*확인할\s*(?:세부|현지)\s*키워드$/.test(titleKey);
    if (isKeywordHeading) {
      let cursor = index + 1;
      const blockLines: string[] = [];
      while (cursor < lines.length && !isMarkdownHeadingLine(lines[cursor] ?? '') && !/^---+$/.test((lines[cursor] ?? '').trim())) {
        blockLines.push(lines[cursor] ?? '');
        cursor += 1;
      }
      const hasBullet = blockLines.some((blockLine) => /^\s*[-*]\s+\S/.test(blockLine));
      if (seenKeywordSection || !hasBullet) {
        index = cursor - 1;
        continue;
      }
      seenKeywordSection = true;
      next.push(line, ...blockLines);
      index = cursor - 1;
      continue;
    }

    const looksLikeQuestionHeading = Boolean(titleKey)
      && (/[?？]$/.test(title || '') || /^Q\s*\d/i.test(titleKey) || /언제\s*준비|가장\s*먼저|출발\s*직전|무엇을\s*확인/.test(titleKey));
    if (looksLikeQuestionHeading) {
      if (seenKeywordSection) {
        let cursor = index + 1;
        while (cursor < lines.length && !isMarkdownHeadingLine(lines[cursor] ?? '') && !/^---+$/.test((lines[cursor] ?? '').trim())) {
          cursor += 1;
        }
        index = cursor - 1;
        continue;
      }
      const key = titleKey.toLowerCase();
      if (seenQuestionHeadings.has(key)) {
        let cursor = index + 1;
        while (cursor < lines.length && !isMarkdownHeadingLine(lines[cursor] ?? '') && !/^---+$/.test((lines[cursor] ?? '').trim())) {
          cursor += 1;
        }
        index = cursor - 1;
        continue;
      }
      seenQuestionHeadings.add(key);
    }

    next.push(line);
  }

  return next.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function ensureContextualImageTextFinal(markdown: string, primaryKeyword: string, row: BlogRow, normalizedTitle: string): string {
  const keyword = cleanTravelKeyword(primaryKeyword) || cleanTravelKeyword(row.destination) || '여행';
  const destinationKeyword = cleanTravelKeyword(row.destination)
    || (typeof row.destination === 'string' && /[가-힣]/.test(row.destination.trim()) ? row.destination.trim() : null);
  const contextualKeyword = destinationKeyword || keyword;
  const tokens = Array.from(new Set(
    `${row.slug || ''} ${row.destination || ''} ${normalizedTitle} ${keyword}`
      .toLowerCase()
      .replace(/[-_]+/g, ' ')
      .replace(/[^a-z0-9가-힣\s]/g, ' ')
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3 && token.length <= 14)
      .filter((token) => /[가-힣]/.test(token))
      .filter((token) => !/^(?:pkg|package|post|guide|travel|image|photo|rewritten|draft|v\d+)$/.test(token))
      .slice(0, 4),
  ));
  const suffix = tokens.length > 0 ? ` ${tokens.join(' ')}` : '';
  let imageNo = 0;
  return markdown
    .replace(/!\[([^\]\n]*)]\((https?:\/\/[^\n)]+)\)/g, (_match, alt: string, src: string) => {
      imageNo += 1;
      const cleanAlt = String(alt || '').trim();
      const hasToken = tokens.length === 0 || tokens.some((token) => cleanAlt.toLowerCase().includes(token));
      const hasEnglishMicroAngle = /\b(?:family budget|budget family|transport cost|hotel area(?: budget)?|weather clothes|weather packing|weather preparation|local mobility|best food|july weather clothes)\b/i.test(cleanAlt)
        || /참고\s*이미지\s*\d+\s+[a-z][a-z\s_-]{6,}$/i.test(cleanAlt)
        || /[가-힣].*\b[a-z]{3,}(?:[\s_-]+[a-z]{3,}){1,}\b/i.test(cleanAlt);
      const needsRepair = cleanAlt.length < 3 || /^(?:photo|travel image|image|이미지|여행 이미지)\s*\d*$/i.test(cleanAlt) || !hasToken || hasEnglishMicroAngle || Boolean(destinationKeyword && !cleanAlt.includes(destinationKeyword));
      const naturalAlt = imageNo === 1
        ? `${contextualKeyword} 여행 예산 체크 장면`
        : imageNo === 2
          ? `${contextualKeyword} 일정 준비 장면`
          : `${contextualKeyword} 현지 비용 확인 장면`;
      return `![${needsRepair ? `${naturalAlt}${suffix}` : cleanAlt}](${src})`;
    })
    .replace(/<figcaption>[\s\S]*?<\/figcaption>/gi, () => {
      const slot = Math.max(1, imageNo);
      return `<figcaption>${contextualKeyword} 여행 준비 장면${suffix}</figcaption>`;
    });
}

function destinationImageKeyword(value?: string | null): string | null {
  const cleaned = cleanTravelKeyword(value);
  if (cleaned) return cleaned;
  const raw = typeof value === 'string' ? value.trim() : '';
  return /[가-힣]/.test(raw) ? raw : null;
}

function ensureDestinationImageAltsFinal(markdown: string, destination?: string | null): string {
  const keyword = destinationImageKeyword(destination);
  if (!keyword) return markdown;
  let imageNo = 0;
  return markdown.replace(/!\[([^\]\n]*)]\((https?:\/\/[^\n)]+)\)/g, (_match, alt: string, src: string) => {
    imageNo += 1;
    const cleanAlt = String(alt || '').trim();
    const naturalAlt = imageNo === 1
      ? `${keyword} 여행 예산 체크 장면`
      : imageNo === 2
        ? `${keyword} 일정 준비 장면`
        : `${keyword} 현지 비용 확인 장면`;
    if (cleanAlt.includes(keyword)) {
      if (/여행 예산 체크 장면|일정 준비 장면|현지 비용 확인 장면/.test(cleanAlt)) {
        return `![${naturalAlt}](${src})`;
      }
      return `![${cleanAlt}](${src})`;
    }
    return `![${naturalAlt}](${src})`;
  });
}

function repairCollapsedFaqFinal(markdown: string, primaryKeyword: string): string {
  const keyword = cleanTravelKeyword(primaryKeyword) || '여행';
  const faqBlock = [
    '## 자주 묻는 질문',
    '',
    `### Q1. ${keyword} 가격은 확정인가요?`,
    'A. 화면의 금액은 표시 기준이며 출발일, 좌석, 유류할증료, 객실 조건에 따라 달라질 수 있습니다.',
    '',
    `### Q2. ${keyword} 예약 전 무엇을 확인해야 하나요?`,
    'A. 포함/불포함, 취소 규정, 현지 추가비, 항공 시간, 호텔 조건을 함께 확인하는 것이 안전합니다.',
    '',
    '### Q3. 일정은 현장에서 바뀔 수 있나요?',
    'A. 날씨, 교통, 현지 운영 상황에 따라 순서가 조정될 수 있어 최종 안내를 다시 확인해야 합니다.',
  ].join('\n');

  return markdown
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (/^##\s*자주\s*묻는\s*질문/.test(trimmed) && trimmed.length > 60) return faqBlock;
      if (/^##\s*FAQ/i.test(trimmed) && trimmed.length > 60) return faqBlock;
      return line;
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
}

function ensureChecklistBlockFinal(markdown: string): string {
  if (/^##\s*(?:준비\s*)?체크리스트|^##\s*준비물|^##\s*필수\s*아이템/m.test(markdown)) return markdown;
  const block = [
    '## 준비 체크리스트',
    '',
    '- 출발일과 항공 시간을 다시 확인하세요.',
    '- 포함/불포함과 현지 추가비를 함께 확인하세요.',
    '- 호텔 조건, 객실 기준, 싱글차지를 확인하세요.',
    '- 취소 규정과 발권 또는 결제 기한을 확인하세요.',
  ].join('\n');
  return `${markdown.trim()}\n\n${block}\n`;
}

function ensureCanonicalChecklistBlockFinal(markdown: string): string {
  if (/^##\s*(?:travel\s*)?(?:checklist|packing\s+list)/im.test(markdown)) return markdown;
  if (/^##\s*(?:\uC5EC\uD589\s*)?(?:\uCCB4\uD06C\uB9AC\uC2A4\uD2B8|\uC900\uBE44\uBB3C|\uD544\uC218\s*\uC544\uC774\uD15C|\uD655\uC778\s*\uBAA9\uB85D)/m.test(markdown)) return markdown;
  if (/<h[23]\b[^>]*>\s*(?:\uC5EC\uD589\s*)?(?:\uCCB4\uD06C\uB9AC\uC2A4\uD2B8|\uC900\uBE44\uBB3C|\uD544\uC218\s*\uC544\uC774\uD15C|\uD655\uC778\s*\uBAA9\uB85D)\s*<\/h[23]>/i.test(markdown)) return markdown;

  const block = [
    '<h2>\uC5EC\uD589 \uCCB4\uD06C\uB9AC\uC2A4\uD2B8</h2>',
    '<ul>',
    '<li>\uCD9C\uBC1C\uC77C\uACFC \uD56D\uACF5 \uC2DC\uAC04\uC744 \uB2E4\uC2DC \uD655\uC778\uD569\uB2C8\uB2E4.</li>',
    '<li>\uD3EC\uD568/\uBD88\uD3EC\uD568\uACFC \uD604\uC9C0 \uCD94\uAC00 \uBE44\uC6A9\uC744 \uBD84\uB9AC\uD574\uC11C \uBD05\uB2C8\uB2E4.</li>',
    '<li>\uC219\uC18C \uC704\uCE58, \uAC1D\uC2E4 \uAE30\uC900, \uC774\uB3D9 \uC2DC\uAC04\uC744 \uD568\uAED8 \uD655\uC778\uD569\uB2C8\uB2E4.</li>',
    '<li>\uCDE8\uC18C \uADDC\uC815\uACFC \uACB0\uC81C \uAE30\uD55C\uC740 \uBCC4\uB3C4\uB85C \uC800\uC7A5\uD569\uB2C8\uB2E4.</li>',
    '</ul>',
  ].join('\n');

  return `${markdown.trim()}\n\n${block}\n`;
}

function ensureCostRangeBlockFinal(markdown: string, row: BlogRow, primaryKeyword: string): string {
  const text = `${row.slug || ''} ${row.seo_title || ''} ${row.destination || ''} ${primaryKeyword} ${markdown.slice(0, 1200)}`.toLowerCase();
  if (!/(cost|budget|경비|비용|항공권|예약|성수기|유럽)/i.test(text)) return markdown;
  if (/(₩|원|만원|usd|\$|eur|€)\s*\d|(\d{1,3}\s*만\s*원)|(\d{2,4}\s*만원)/i.test(markdown)) return markdown;
  const block = [
    '## 비용 확인 범위',
    '',
    '- 항공권은 출발지, 직항 여부, 수하물 포함 여부에 따라 같은 노선도 수십만 원 차이가 날 수 있습니다.',
    '- 숙박은 위치와 성급에 따라 1박 기준 약 10만 원대부터 30만 원대 이상까지 차이가 날 수 있습니다.',
    '- 현지 교통, 식사, 입장료, 여행자보험은 별도 예산으로 분리해 확인하는 것이 안전합니다.',
    '- 실제 결제 전에는 유류할증료, 환율, 좌석 상황, 취소 규정을 다시 확인해야 합니다.',
  ].join('\n');
  return `${markdown.trim()}\n\n${block}\n`;
}

function ensureReadableFaqFinal(markdown: string, primaryKeyword: string): string {
  if (/^##\s*(?:자주\s*)?묻는\s*질문|^##\s*FAQ/im.test(markdown)) return markdown;
  const keyword = cleanTravelKeyword(primaryKeyword) || '여행';
  return `${markdown.trim()}\n\n## 자주 묻는 질문\n\n### Q1. ${keyword} 준비에서 가장 먼저 볼 것은 무엇인가요?\nA. 비용, 일정, 이동 시간, 현지 변동 가능성을 먼저 확인하면 선택이 쉬워집니다.\n\n### Q2. 현지에서 비용이 달라질 수 있나요?\nA. 성수기, 환율, 좌석, 호텔 위치, 현지 운영 상황에 따라 달라질 수 있습니다.\n\n### Q3. 출발 전 마지막으로 확인할 것은 무엇인가요?\nA. 여권, 결제 수단, 날씨, 취소 조건, 현지 이동 시간을 다시 확인하세요.\n`;
}

function repairCollapsedChecklistFinal(markdown: string): string {
  return markdown
    .replace(/\*\s*\[\]\s*/g, '\n- ')
    .replace(/-\s+([^-\n]{1,160})\s+\*\s+\[\]/g, '- $1\n- ')
    .replace(/\n{3,}/g, '\n\n');
}

function ensureWeatherTableFinal(markdown: string, row: BlogRow, primaryKeyword: string): string {
  const text = `${row.slug || ''} ${row.seo_title || ''} ${row.destination || ''} ${primaryKeyword}`.toLowerCase();
  if (!/(weather|날씨|옷차림|월별|기온|우기|건기|rain|season)/i.test(text)) return markdown;
  const tableRows = (markdown.match(/(^|\n)\s*\|.+\|/g) || []).length;
  if (tableRows >= 3) return markdown;
  const block = [
    '## 월별 날씨 체크표',
    '',
    '| 구간 | 확인 포인트 | 준비 팁 |',
    '| --- | --- | --- |',
    '| 1~3월 | 기온과 바람 변화를 확인하세요. | 얇은 겉옷과 편한 신발을 준비하세요. |',
    '| 4~6월 | 낮 기온과 자외선이 강할 수 있습니다. | 선크림, 모자, 수분 보충을 챙기세요. |',
    '| 7~9월 | 비 예보와 습도를 함께 확인하세요. | 우산 또는 가벼운 우비를 준비하세요. |',
    '| 10~12월 | 일교차와 현지 운영 시간을 확인하세요. | 겹쳐 입기 좋은 옷을 준비하세요. |',
  ].join('\n');
  return `${markdown.trim()}\n\n${block}\n`;
}

function ensureMinimumReadableSectionsFinal(markdown: string): string {
  const h2Count = (markdown.match(/^\s{0,3}##\s+\S/gm) || []).length;
  if (h2Count >= 4) return markdown;
  const blocks = [
    '## 핵심 확인 포인트\n\n- 비용, 일정, 현지 이동 조건을 함께 확인하세요.\n- 출발 전 공식 안내와 최종 일정표를 다시 확인하세요.',
    '## 예약 전 체크\n\n- 포함/불포함, 취소 규정, 현지 추가비를 확인하세요.\n- 항공 시간과 호텔 조건이 내 일정에 맞는지 확인하세요.',
    '## 현지 준비 팁\n\n- 날씨, 교통, 결제 수단, 비상 연락 수단을 미리 준비하세요.\n- 일정은 현지 상황에 따라 조정될 수 있습니다.',
  ];
  return `${markdown.trim()}\n\n${blocks.slice(0, 4 - h2Count).join('\n\n')}\n`;
}

function ensureRainySeasonTableFinal(markdown: string, row: BlogRow, primaryKeyword: string): string {
  const text = `${row.slug || ''} ${row.seo_title || ''} ${row.destination || ''} ${primaryKeyword} ${markdown.slice(0, 1200)}`;
  if (!/\uC7A5\uB9C8|\uC6B0\uCC9C|\uAC15\uC218|\uBE44\s*\uC624/.test(text)) return markdown;
  const tableRows = (markdown.match(/(^|\n)\s*\|.+\|/g) || []).length;
  if (tableRows >= 3) return markdown;
  const block = [
    '## rainy season weather checklist',
    '',
    '| period | weather check | packing note |',
    '| --- | --- | --- |',
    '| before departure | rain forecast and flight alerts | compact umbrella and waterproof pouch |',
    '| morning | outdoor schedule risk | breathable clothes and spare socks |',
    '| afternoon | shower or heavy rain window | indoor route backup |',
    '| evening | transport delay risk | extra transfer time |',
  ].join('\n');
  return `${markdown.trim()}\n\n${block}\n`;
}

function finalCustomerVisibleRepair(markdown: string, row: BlogRow, primaryKeyword: string, normalizedTitle: string, blogType: 'product' | 'info'): string {
  let next = replaceDestinationPlaceholderContextFinal(
    softenUnsupportedInternalDataFinal(removeAiEditorialClichesFinal(stripGeneratedTailArtifactsFinal(markdown))),
    row.destination,
    primaryKeyword,
  );
  for (let attempt = 0; attempt < 2; attempt += 1) {
    next = repairMarkdownTables(capHeadingDensityFinal(splitParagraphWallFinal(normalizeInlineHeadingsFinal(removeEarlyHardCtaFinal(
      ensurePrimaryKeywordEvidence(
        ensureAnswerFirstFinal(
          ensureQuestionHeadingClean(
            replaceH1TitleFinal(ensureH1AtTop(
              dedupeImageUrlsFinal(ensureContextualImageTextFinal(
                ensureAuthorityLinksFinal(sanitizeSalesPressureFinal(sanitizeCustomerMarketingPressure(next)), row),
                primaryKeyword,
                row,
                normalizedTitle,
              )),
              normalizedTitle,
            ), normalizedTitle),
            primaryKeyword,
            blogType,
          ),
          primaryKeyword,
          blogType,
          ),
        primaryKeyword,
      ),
    )))));
  }
  next = removeAiEditorialClichesFinal(finalKeywordDensityRepair(next, primaryKeyword, blogType));
  const finalMarkdown = dedupeRepeatedShortParagraphsCustomer(dedupeRepeatedFaqBlocksCustomer(normalizeFinalMarkdownSurface(capHeadingDensityFinal(
    ensureMinimumReadableSectionsFinal(
      ensureAuthorityLinksFinal(
        ensureRainySeasonTableFinal(
          ensureWeatherTableFinal(
            ensureCostRangeBlockFinal(
              ensureCanonicalChecklistBlockFinal(
                ensureSafeDayByDayBlock(
                  ensureReadableFaqFinal(repairCollapsedChecklistFinal(repairCollapsedFaqFinal(next, primaryKeyword)), primaryKeyword),
                  row.content_type || 'guide',
                  row.product_id ?? null,
                  primaryKeyword,
                ),
              ),
              row,
              primaryKeyword,
            ),
            row,
            primaryKeyword,
          ),
          row,
          primaryKeyword,
        ),
        row,
      ),
    ),
  ))));
  return normalizeMarkdownTableHeaderRenderRiskFinal(repairGenericCustomerOpeningFinal(
    replaceDestinationPlaceholderContextFinal(softenUnsupportedInternalDataFinal(finalMarkdown), row.destination, primaryKeyword),
    primaryKeyword,
    row.destination,
    blogType,
  ));
}

function ensureCustomerSummary(markdown: string, primaryKeyword: string): string {
  if (hasSummary(markdown)) return markdown;
  const keyword = cleanTravelKeyword(primaryKeyword) || '여행';
  return markdown.replace(/(^#\s+[^\n]+\n)/, `$1\n## 한눈에 보는 요약\n\n- ${keyword}은 비용, 일정, 준비 조건을 함께 확인해야 안전합니다.\n- 예약 전 포함/불포함, 현지 추가비용, 이동 시간을 먼저 비교하세요.\n- 출발 직전에는 공식 안내와 최종 확정 일정을 다시 확인하세요.\n\n`);
}

function ensureCustomerFaq(markdown: string, primaryKeyword: string): string {
  if (hasFaq(markdown)) return markdown;
  const keyword = cleanTravelKeyword(primaryKeyword) || '여행';
  return `${markdown.trim()}\n\n## 자주 묻는 질문\n\n### Q1. ${keyword}은 언제부터 준비하면 좋나요?\nA. 항공, 숙소, 현지 이동 조건은 출발 2~4주 전부터 확인하는 것이 안전합니다.\n\n### Q2. 예약 전에 꼭 확인할 항목은 무엇인가요?\nA. 총 비용, 포함/불포함, 취소 조건, 현지 추가비용, 이동 시간을 함께 확인하세요.\n\n### Q3. 현지에서 일정이 바뀔 수 있나요?\nA. 날씨, 교통, 운영 시간에 따라 일부 순서가 조정될 수 있어 최종 안내를 다시 확인하는 것이 좋습니다.\n`;
}

function ensureLongtailCoverageSectionCustomer(markdown: string, secondaryKeywords: string[]): string {
  const missing = secondaryKeywords.filter((keyword) => keyword.length > 2 && !markdown.includes(keyword)).slice(0, 4);
  if (missing.length === 0 || /^(?:#{2,4}\s*|\*\*)\s*함께\s*확인할\s*(?:세부|현지)\s*키워드(?:\*\*)?/m.test(markdown)) return markdown;
  const noteTemplates = [
    (keyword: string) => `- ${keyword}: 출발일, 인원, 현지 운영 여부를 함께 봅니다.`,
    (keyword: string) => `- ${keyword}: 총액과 추가비를 나눠 확인하면 예산 오차가 줄어듭니다.`,
    (keyword: string) => `- ${keyword}: 이동 시간과 숙소 위치를 같이 보면 피로도를 줄일 수 있습니다.`,
    (keyword: string) => `- ${keyword}: 공식 안내와 최종 예약 조건을 출발 전 다시 확인합니다.`,
  ];
  const bullets = missing.map((keyword, index) => noteTemplates[index % noteTemplates.length](keyword));
  return `${markdown.trim()}\n\n## 함께 확인할 세부 키워드\n\n${bullets.join('\n')}\n\n### 출발 전 추가 확인\n- 날씨와 옷차림은 출발 2주 전과 24시간 전에 다시 확인합니다.\n- 환전, 카드, 현금 사용 조건을 나눠 준비하면 현지 결제 실수를 줄일 수 있습니다.\n- 유심, eSIM, 로밍 중 어떤 통신 방식이 일정에 맞는지 확인합니다.\n- 여권, 비자, 입국 서류, 항공권 영문명은 예약 정보와 같은지 확인합니다.\n- 숙소 위치, 식사 포함 여부, 공항 이동 시간을 함께 보면 실제 피로도를 줄일 수 있습니다.\n`;
}

function looksLikeWeatherArticleCustomer(markdown: string, row: BlogRow, primaryKeyword: string): boolean {
  return /weather|날씨|옷차림|우기|건기|기온|강수/i.test(
    `${row.slug || ''} ${row.seo_title || ''} ${primaryKeyword} ${markdown.slice(0, 1200)}`,
  );
}

function ensureWeatherTableSectionCustomer(markdown: string, row: BlogRow, primaryKeyword: string): string {
  if (!looksLikeWeatherArticleCustomer(markdown, row, primaryKeyword)) return markdown;
  const tableRows = (markdown.match(/(^|\n)\s*\|.+\|/g) || []).length;
  if (tableRows >= 3) return markdown;
  const keyword = cleanTravelKeyword(primaryKeyword) || cleanTravelKeyword(row.destination) || '여행지';
  return `${markdown.trim()}\n\n## 날씨와 옷차림 요약\n\n| 시기 | 날씨 포인트 | 준비 체크 |\n| --- | --- | --- |\n| 1~3월 | 아침저녁 기온 차이를 확인하세요. | 얇은 겉옷과 편한 신발을 준비하세요. |\n| 4~6월 | 낮 이동 시간이 길어질 수 있습니다. | 자외선 차단과 수분 보충을 챙기세요. |\n| 7~9월 | 비 예보와 습도를 함께 봐야 합니다. | 우산, 방수 가방, 여벌 옷을 준비하세요. |\n| 10~12월 | 바람과 일교차가 일정에 영향을 줄 수 있습니다. | 겹쳐 입기 좋은 옷과 방풍용품을 챙기세요. |\n\n${keyword} 날씨는 출발 직전 공식 예보와 함께 다시 확인하는 것이 안전합니다.\n`;
}

function ensureOfficialReferenceLinksCustomer(markdown: string, row: BlogRow, primaryKeyword: string): string {
  const externalLinks = [...markdown.matchAll(/\]\((https?:\/\/[^)]+)\)/g)]
    .map((match) => match[1] || '')
    .filter((href) => !/yeosonam\.com/i.test(href))
    .filter((href) => !/\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(href));
  const authorityLinks = externalLinks.filter((href) =>
    /\.go\.kr|\.gov|mofa\.go\.kr|0404\.go\.kr|visit|tourism|weather|airport|immigration|embassy|consulate|iata\.org|iatatravelcentre\.com|who\.int|japan\.travel|travel-europe\.europa\.eu|travel\.state\.gov|cbp\.dhs\.gov/i.test(href),
  );
  if (authorityLinks.length >= 2) return markdown;

  const topicText = `${row.slug || ''} ${row.seo_title || ''} ${primaryKeyword}`.toLowerCase();
  const links = /esta|미국|visa|비자/.test(topicText)
    ? [
      '- [미국 ESTA 공식 신청](https://esta.cbp.dhs.gov/)',
      '- [미국 국무부 여행 정보](https://travel.state.gov/)',
    ]
    : /일본|japan|wifi|esim|유심|와이파이/.test(topicText)
      ? [
        '- [일본정부관광국 공식 여행 정보](https://www.japan.travel/ko/)',
        '- [외교부 해외안전여행](https://www.0404.go.kr/)',
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

function replacePlaceholderContextCustomer(markdown: string, primaryKeyword: string, destination: string | null, slug: string | null): string {
  const label = cleanTravelKeyword(destination) || cleanTravelKeyword(primaryKeyword) || primaryKeyword || '여행';
  const campaignBasis = slug && !isWeakGeneratedSlug(slug) ? slug : label;
  const campaign = encodeURIComponent(campaignBasis).slice(0, 80) || 'travel';
  return markdown
    .replace(/관광\s*지명|목적지명|여행지명|undefined|null|\[object object\]/gi, label)
    .replace(/\butm_campaign=[^&#)\n]+/gi, `utm_campaign=${campaign}`);
}

function softenKeywordDensityCustomer(markdown: string, primaryKeyword?: string | null, blogType: 'product' | 'info' = 'info'): string {
  const stable = splitStableTailSections(markdown);
  if (stable) {
    const repairedBody = softenKeywordDensityCustomer(stable.body, primaryKeyword, blogType);
    return `${repairedBody.trimEnd()}${stable.tail}`;
  }
  const keyword = cleanTravelKeyword(primaryKeyword);
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
  const replacement = keyword.includes(' ') ? keyword.split(/\s+/).slice(-1)[0] || '여행지' : '현지';
  let seen = 0;
  return markdown.replace(new RegExp(escapeRegExp(keyword), 'g'), () => {
    seen += 1;
    return seen <= allowedCount ? keyword : replacement;
  });
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
      body: JSON.stringify({ paths, tags: [BLOG_DETAIL_REVALIDATE_TAG], secret }),
    });
  } catch (err) {
    console.warn('[blog-quality] revalidate failed:', err instanceof Error ? err.message : err);
  }
}

async function main() {
  await loadLocalModules();

  let query = supabase
    .from('content_creatives')
    .select('id, slug, status, seo_title, seo_description, og_image_url, destination, content_type, product_id, blog_html, generation_meta, target_ad_keywords')
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
  const seenSeoDescriptions = new Map<string, number>();
  const checkedAt = new Date().toISOString();
  let indexingQueued = 0;

  for (const row of rows) {
    const originalHtml = row.blog_html || '';
    const repairSourceHtmlBase = removeLoneHashHeadings(stripGeneratedSeoAppendix(originalHtml));
    const originalOg = row.og_image_url?.trim() || null;
    const originalTitle = row.seo_title?.trim() || null;
    const originalDescription = row.seo_description?.trim() || null;
    const primaryKeyword = primaryKeywordForCustomer(row);
    const inferredDestination = inferredDestinationForCustomer(row);
    const destination = usableDestinationKeyword(row.destination)
      || inferredDestination
      || usableDestinationKeyword(extractDestination(row.seo_title || row.slug || ''));
    const normalizedDestinationForWrite = usableDestinationKeyword(destination) || inferredDestination;
    const genericInfoWithoutDestination = !row.product_id && !normalizedDestinationForWrite && looksLikeGenericInfoRow(row, primaryKeyword);
    const shouldClearInvalidDestination = genericInfoWithoutDestination && hasInvalidBackfillDestinationKeyword(row.destination);
    const productId = typeof row.product_id === 'string' && row.product_id.trim() ? row.product_id : null;
    const contentType = row.content_type || (productId ? 'package_intro' : 'guide');
    const blogType = productId ? 'product' : 'info';
    const slug = row.slug || row.id;
    if (productId) {
      const openContract = await loadCustomerOpenContractForPackage(supabase, productId);
      if (!openContract.ok || openContract.evidencePack.downstream_eligibility.blog_publish === false) {
        const reason = `product_customer_open_contract_failed:${openContract.blockers.slice(0, 5).join('|') || 'downstream_blog_publish_false'}`;
        auditRows.push({
          slug,
          missingOgBefore: !originalOg,
          missingOgAfter: !originalOg,
          imageCountBefore: countInlineImages(originalHtml),
          imageCountAfter: countInlineImages(originalHtml),
          faqMissingBefore: !hasFaq(originalHtml),
          faqMissingAfter: !hasFaq(originalHtml),
          tldrMissingBefore: !hasSummary(originalHtml),
          tldrMissingAfter: !hasSummary(originalHtml),
          rewriteTraceBefore: hasRewriteTrace(`${row.seo_title || ''}\n${originalHtml}`),
          rewriteTraceAfter: hasRewriteTrace(`${row.seo_title || ''}\n${originalHtml}`),
          highlightCountBefore: countHighlights(originalHtml),
          highlightCountAfter: countHighlights(originalHtml),
          qualityGatePassed: false,
          publishReady: false,
          qualityGateSummary: reason,
          failedGates: [{
            gate: 'product_customer_open_contract',
            reason,
            evidence: {
              product_id: productId,
              blockers: openContract.blockers,
              downstream_eligibility: openContract.evidencePack.downstream_eligibility,
            },
          }],
          qualityIssues: [{
            code: 'product_customer_open_contract_failed',
            source: 'product_contract',
            severity: 'blocker',
            message: reason,
            evidence: {
              product_id: productId,
              downstream_eligibility: openContract.evidencePack.downstream_eligibility,
            },
          }],
          seoScore: null,
          readabilityScore: null,
          titleChanged: false,
          descriptionChanged: false,
          changeReasons: ['product_contract_archived'],
          changed: true,
        });

        if (!dryRun) {
          const archivedAt = new Date().toISOString();
          const { error: archiveError } = await supabase
            .from('content_creatives')
            .update({
              status: 'archived',
              generation_meta: {
                ...(row.generation_meta ?? {}),
                product_customer_open_contract: {
                  status: 'blocked',
                  archived_at: archivedAt,
                  blockers: openContract.blockers,
                  downstream_eligibility: openContract.evidencePack.downstream_eligibility,
                },
              },
              updated_at: archivedAt,
            })
            .eq('id', row.id);
          if (archiveError) {
            console.error(`[blog-quality] product contract archive failed for ${slug}:`, archiveError.message);
          } else {
            try {
              await enqueueIndexingJob({ id: row.id, slug }, 'blog_product_contract_archive');
              indexingQueued += 1;
            } catch (indexingError) {
              console.error(
                `[blog-quality] indexing enqueue failed for archived ${slug}:`,
                indexingError instanceof Error ? indexingError.message : indexingError,
              );
            }
            changedSlugs.push(slug);
            console.log(`[blog-quality] archived ${slug}: ${reason}`);
          }
        }
        continue;
      }
    }
    const repairSourceHtml = replacePlaceholderContextCustomer(
      replaceEnglishMicroAngleSurface(repairSourceHtmlBase, row, primaryKeyword),
      primaryKeyword,
      destination,
      row.slug,
    );
    const resolvedOgImage = await resolveOgImage(row);
    const normalizedTitle = improveBackfillSeoTitleCustomer(
      normalizeBlogTitle(row.seo_title) || row.seo_title || row.slug || '여행 가이드',
      row,
      primaryKeyword,
    );
    const normalizedDescription = ensureBatchUniqueSeoDescription(ensureStrictSeoDescription(improveBackfillSeoDescriptionCustomer(
      normalizeBlogDescription(row.seo_description) || row.seo_description || null,
      row,
      primaryKeyword,
    ), row, primaryKeyword), row, primaryKeyword, seenSeoDescriptions);
    const secondaryKeywords = buildSecondaryKeywordsCustomer(primaryKeyword, destination);
    const nextTargetAdKeywords = !productId
      ? buildTargetAdKeywordsCustomer(row, primaryKeyword, secondaryKeywords)
      : row.target_ad_keywords ?? null;
    const editorialRepair = repairBlogEditorialQuality({
      title: normalizedTitle,
      slug,
      primaryKeyword,
      destination,
      category: normalizedTitle,
      contentType,
      productId,
      blogHtml: repairSourceHtml,
    });
    const repairedDraft = softenKeywordDensityCustomer(
      repairLegacyStructureArtifacts(
        strengthenIntroHookCustomer(
          editorialRepair.blogHtml,
          destination,
          primaryKeyword,
          blogType,
        ),
      ),
      primaryKeyword,
      blogType,
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

    const repairedFinal = softenKeywordDensityCustomer(
      sanitizeCustomerMarketingPressure(sanitizeInfoSalesPhrases(
        ensureOfficialReferenceLinksCustomer(
          ensureCustomerFaq(
            ensureCustomerSummary(
              ensureWeatherTableSectionCustomer(
                ensureLongtailCoverageSectionCustomer(
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
            primaryKeyword,
          ),
          row,
          primaryKeyword,
        ),
      )),
      primaryKeyword,
      blogType,
    );
    const longtailRepairedFinal = ensureLongtailCoverageSectionCustomer(repairedFinal, secondaryKeywords);
    const preStructureHtml = normalizeMarkdownLinkLabels(ensureInternalFunnelLinks(longtailRepairedFinal, destination, slug));
    const structureRepair = repairBlogStructureQuality({
      title: normalizedTitle,
      slug,
      primaryKeyword,
      destination,
      category: normalizedTitle,
      contentType,
      productId,
      blogHtml: preStructureHtml,
    });
    const nextOg = finalized.ogImageUrl;
    let nextGenerationMeta: Record<string, unknown> = row.generation_meta && typeof row.generation_meta === 'object'
      ? { ...row.generation_meta }
      : {};
    if (!productId) {
      nextGenerationMeta = buildInfoContractGenerationMeta(row, {
        normalizedTitle,
        primaryKeyword,
        destination,
        contentType,
        secondaryKeywords,
      });
      if (genericInfoWithoutDestination) {
        nextGenerationMeta = {
          ...nextGenerationMeta,
          intentionally_generic: true,
          generic_info_candidate: true,
          generic_info_marked_at: typeof nextGenerationMeta.generic_info_marked_at === 'string'
            ? nextGenerationMeta.generic_info_marked_at
            : checkedAt,
          generic_info_marked_by: typeof nextGenerationMeta.generic_info_marked_by === 'string'
            ? nextGenerationMeta.generic_info_marked_by
            : 'blog-quality-backfill',
          ...(shouldClearInvalidDestination
            ? {
                destination_cleared_at: typeof nextGenerationMeta.destination_cleared_at === 'string'
                  ? nextGenerationMeta.destination_cleared_at
                  : checkedAt,
                destination_cleared_by: typeof nextGenerationMeta.destination_cleared_by === 'string'
                  ? nextGenerationMeta.destination_cleared_by
                  : 'blog-quality-backfill',
                previous_destination: typeof nextGenerationMeta.previous_destination === 'string'
                  ? nextGenerationMeta.previous_destination
                  : row.destination,
              }
            : {}),
        };
      }
    }
    let nextHtml = repairMarkdownTables(removeLoneHashHeadings(ensureMinimumInlineImagesFromOg(structureRepair.blogHtml, destination, slug, nextOg)));
    if (productId) {
      const rebuiltProduct = await rebuildProductConsultantHtml(productId);
      if (rebuiltProduct) {
        nextGenerationMeta = {
          ...nextGenerationMeta,
          ...rebuiltProduct.generationMeta,
        };
        nextHtml = removeLoneHashHeadings(ensureMinimumInlineImagesFromOg(
          normalizeMarkdownLinkLabels(ensureInternalFunnelLinks(rebuiltProduct.html, destination, slug)),
          destination,
          slug,
          nextOg,
        ));
      } else {
        nextGenerationMeta = {
          ...nextGenerationMeta,
          prompt_version: typeof nextGenerationMeta.prompt_version === 'string' && nextGenerationMeta.prompt_version.trim()
            ? nextGenerationMeta.prompt_version
            : 'product-template-v2',
          writer: typeof nextGenerationMeta.writer === 'string' && nextGenerationMeta.writer.trim()
            ? nextGenerationMeta.writer
            : 'product_consultant_writer',
        };
      }
    }
    nextHtml = finalKeywordDensityRepair(nextHtml, primaryKeyword, blogType);
    nextHtml = ensureSingleMarkdownH1(ensureStandaloneH1(nextHtml, normalizedTitle));
    const customerBlocksHtml = ensureCustomerFaq(ensureCustomerSummary(splitLongParagraphs(nextHtml), primaryKeyword), primaryKeyword);
    nextHtml = finalCustomerVisibleRepair(
      strengthenIntroHookCustomer(
        ensureSafeDayByDayBlock(
          customerBlocksHtml,
          contentType,
          productId,
          primaryKeyword,
        ),
        destination,
        primaryKeyword,
        blogType,
      ),
      row,
      primaryKeyword,
      normalizedTitle,
      blogType,
    );
    nextHtml = replaceEnglishMicroAngleSurface(
      ensureMinimumInlineImagesFromOg(nextHtml, destination, slug, nextOg),
      row,
      primaryKeyword,
    );
    nextHtml = finalKeywordDensityRepair(nextHtml, primaryKeyword, blogType);
    nextHtml = normalizeMarkdownLinkLabels(ensureInternalFunnelLinks(nextHtml, destination, slug));
    nextHtml = normalizeFinalMarkdownSurface(nextHtml);
    const semanticSurfaceFinalRepair = repairBlogSemanticSurface({
      title: normalizedTitle,
      slug,
      primaryKeyword,
      destination: normalizedDestinationForWrite,
      category: normalizedTitle,
      contentType,
      productId,
      blogHtml: nextHtml,
    });
    if (semanticSurfaceFinalRepair.changed) {
      nextHtml = semanticSurfaceFinalRepair.blogHtml;
    }
    nextHtml = finalKeywordDensityRepair(nextHtml, primaryKeyword, blogType);
    const postDensitySemanticRepair = repairBlogSemanticSurface({
      title: normalizedTitle,
      slug,
      primaryKeyword,
      destination: normalizedDestinationForWrite,
      category: normalizedTitle,
      contentType,
      productId,
      blogHtml: nextHtml,
    });
    if (postDensitySemanticRepair.changed) {
      nextHtml = postDensitySemanticRepair.blogHtml;
    }
    nextHtml = finalKeywordDensityRepair(nextHtml, primaryKeyword, blogType);
    nextHtml = ensureDestinationImageAltsFinal(nextHtml, normalizedDestinationForWrite || primaryKeyword);
    nextHtml = normalizePackageDestinationLinksFinal(
      normalizeFinalMarkdownSurface(normalizeMarkdownLinkLabels(nextHtml)),
      normalizedDestinationForWrite || destination || primaryKeyword,
    );
    nextHtml = normalizeMarkdownTableHeaderRenderRiskFinal(
      replaceDestinationPlaceholderContextFinal(
        softenUnsupportedInternalDataFinal(nextHtml),
        normalizedDestinationForWrite || destination,
        primaryKeyword,
      ),
    );
    nextHtml = ensureLongtailCoverageSectionCustomer(nextHtml, secondaryKeywords);
    nextHtml = finalKeywordDensityRepair(nextHtml, primaryKeyword, blogType);
    nextHtml = normalizeMarkdownTableHeaderRenderRiskFinal(
      replaceDestinationPlaceholderContextFinal(
        softenUnsupportedInternalDataFinal(nextHtml),
        normalizedDestinationForWrite || destination,
        primaryKeyword,
      ),
    );
    nextHtml = finalBlogSurfacePreQaRepair(
      nextHtml,
      {
        ...row,
        destination: normalizedDestinationForWrite || destination,
        seo_title: normalizedTitle,
      },
      primaryKeyword,
      blogType,
    );
    const qaReport = await evaluateBlogPublishQuality({
      id: row.id,
      blog_html: nextHtml,
      slug,
      seo_title: normalizedTitle,
      seo_description: normalizedDescription,
      destination: normalizedDestinationForWrite,
      angle_type: null,
      primary_keyword: primaryKeyword,
      secondary_keywords: secondaryKeywords,
      category: normalizedTitle,
      content_type: contentType,
      product_id: productId,
      generation_meta: nextGenerationMeta,
      excludeContentCreativeId: row.id,
      skipFuzzyDuplicate: true,
    });
    const publishReady = !hasBlockingBlogIssue(qaReport);
    const htmlChanged = !isSameStoredBlogHtml(originalHtml, nextHtml);
    const metaChanged = stableJson(nextGenerationMeta) !== stableJson(row.generation_meta ?? {});
    const targetKeywordsChanged = stableJson(nextTargetAdKeywords ?? []) !== stableJson(row.target_ad_keywords ?? []);
    const destinationChanged = shouldClearInvalidDestination ||
      Boolean(normalizedDestinationForWrite && normalizedDestinationForWrite !== row.destination);
    const changed =
      htmlChanged ||
      nextOg !== originalOg ||
      normalizedTitle !== originalTitle ||
      normalizedDescription !== originalDescription ||
      metaChanged ||
      targetKeywordsChanged ||
      destinationChanged;
    const changeReasons = [
      htmlChanged ? 'blog_html' : null,
      nextOg !== originalOg ? 'og_image_url' : null,
      normalizedTitle !== originalTitle ? 'seo_title' : null,
      normalizedDescription !== originalDescription ? 'seo_description' : null,
      metaChanged ? 'generation_meta' : null,
      targetKeywordsChanged ? 'target_ad_keywords' : null,
      destinationChanged ? 'destination' : null,
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
      qualityGatePassed: publishReady,
      publishReady,
      qualityGateSummary: publishReady ? null : qaReport.summary,
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
    if (!publishReady) {
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
        generation_meta: nextGenerationMeta,
        target_ad_keywords: nextTargetAdKeywords,
        ...(destinationChanged ? { destination: normalizedDestinationForWrite ?? null } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id);

    if (updateError) {
      console.error(`[blog-quality] update failed for ${slug}:`, updateError.message);
      continue;
    }

    if (htmlChanged || nextOg !== originalOg || normalizedTitle !== originalTitle || normalizedDescription !== originalDescription) {
      try {
        await enqueueIndexingJob({ id: row.id, slug }, 'blog_quality_backfill');
        indexingQueued += 1;
      } catch (indexingError) {
        console.error(
          `[blog-quality] indexing enqueue failed for ${slug}:`,
          indexingError instanceof Error ? indexingError.message : indexingError,
        );
      }
    }

    changedSlugs.push(slug);
    console.log(`[blog-quality] updated ${slug}`);
  }

  if (!dryRun && changedSlugs.length > 0) {
    await revalidate(['/blog', '/sitemap.xml', ...changedSlugs.map((slug) => `/blog/${slug}`)]);
  }

  const highlightCountsBefore = auditRows.map((row) => row.highlightCountBefore);
  const highlightCountsAfter = auditRows.map((row) => row.highlightCountAfter);
  const changeReasonCounts = auditRows.reduce<Record<string, number>>((acc, row) => {
    for (const reason of row.changeReasons) acc[reason] = (acc[reason] || 0) + 1;
    return acc;
  }, {});
  const minorIssueRows = auditRows.filter((row) => row.publishReady && row.qualityIssues.length > 0);
  const minorIssueCounts = minorIssueRows.reduce<Record<string, number>>((acc, row) => {
    for (const issue of row.qualityIssues) {
      const key = `${issue.severity}:${issue.code}`;
      acc[key] = (acc[key] || 0) + 1;
    }
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
    publishBlocked: auditRows.filter((row) => !row.publishReady).length,
    minorOnlyIssues: minorIssueRows.length,
    minorIssueCounts,
    minorIssueSamples: minorIssueRows
      .slice(0, 10)
      .map((row) => ({
        slug: row.slug,
        seoScore: row.seoScore,
        readabilityScore: row.readabilityScore,
        issues: row.qualityIssues
          .slice(0, 5)
          .map((issue) => ({
            code: issue.code,
            source: issue.source,
            severity: issue.severity,
            message: issue.message,
            evidence: issue.evidence,
          })),
      })),
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
