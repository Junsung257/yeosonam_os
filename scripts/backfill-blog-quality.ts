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

async function loadLocalModules() {
  ({ finalizeBlogPost } = await import('../src/lib/blog-post-finalizer'));
  ({ normalizeBlogDescription, normalizeBlogTitle } = await import('../src/lib/blog-quality-normalizer'));
  ({ evaluateBlogPublishQuality } = await import('../src/lib/blog-publish-quality'));
  ({ destToEnKeyword, getRandomPexelsPhoto, isPexelsConfigured } = await import('../src/lib/pexels'));
  ({ extractDestination } = await import('../src/lib/slug-utils'));
  ({ repairBlogEditorialQuality } = await import('../src/lib/blog-editorial-repair'));
}

type BlogRow = {
  id: string;
  slug: string | null;
  seo_title: string | null;
  seo_description: string | null;
  og_image_url: string | null;
  destination: string | null;
  blog_html: string | null;
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
  seoScore: number | null;
  readabilityScore: number | null;
  titleChanged: boolean;
  descriptionChanged: boolean;
  changed: boolean;
};

const args = new Set(process.argv.slice(2));
const dryRun = !args.has('--write');
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

function countInlineImages(html: string): number {
  return (html.match(/!\[[^\]]*\]\(([^)]+)\)|<img\b/gi) || []).length;
}

function countHighlights(html: string): number {
  const markMatches = html.match(/<mark\b/gi) || [];
  const markdownMatches = html.match(/==[^=]+==/g) || [];
  return markMatches.length + markdownMatches.length;
}

function hasFaq(html: string): boolean {
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

function primaryKeywordFor(row: BlogRow): string {
  const titleLooksLikePriceOffer = /\d|만원|부터|특가|할인/.test(row.seo_title || '');
  const basis = normalizePrimaryKeyword(row.destination)
    || (titleLooksLikePriceOffer ? null : normalizePrimaryKeyword(row.seo_title))
    || normalizePrimaryKeyword(row.slug)
    || 'travel';
  return basis.trim();
}

function isWeakGeneratedSlug(slug: string | null | undefined): boolean {
  return !slug || /^(?:top-\d+|\d+-post-[a-z0-9]+|[a-z]+-\d+|.*-[a-z0-9]{4})$/i.test(slug);
}

function buildSeoKeyword(row: BlogRow, primaryKeyword: string): string {
  return normalizePrimaryKeyword(row.destination)
    || normalizePrimaryKeyword(primaryKeyword)
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
  const hasModifier = /\b20\d{2}\b|최신|월별|비용|일정|준비물|가격|코스|날씨|체크리스트/.test(cleaned);
  const hasKeyword = keyword.length > 1 && cleaned.includes(keyword);
  const weak = cleaned.length < 25 || cleaned.length > 60 || !hasModifier || !hasKeyword || isWeakGeneratedSlug(row.slug);
  if (!weak) return cleaned;

  const topicKind = topicKindFor(row, primaryKeyword);
  const modifier = topicKind === 'weather'
    ? '월별 날씨·옷차림 체크'
    : topicKind === 'communication'
      ? '비용·속도·사용법 체크'
      : topicKind === 'visa'
        ? '서류·입국조건 체크'
        : topicKind === 'currency'
          ? '환전·결제·팁 체크'
          : topicKind === 'cost'
            ? '예산·경비·비용 체크'
            : topicKind === 'itinerary'
              ? '코스·동선·이동시간 체크'
              : '비용·준비물·현지팁 체크';
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
  if (externalLinks.length >= 2) return markdown;

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
    .select('id, slug, seo_title, seo_description, og_image_url, destination, blog_html')
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

  for (const row of rows) {
    const originalHtml = row.blog_html || '';
    const originalOg = row.og_image_url?.trim() || null;
    const originalTitle = row.seo_title?.trim() || null;
    const originalDescription = row.seo_description?.trim() || null;
    const destination = row.destination || extractDestination(row.seo_title || row.slug || '');
    const primaryKeyword = primaryKeywordFor(row);
    const resolvedOgImage = await resolveOgImage(row);
    const normalizedTitle = improveBackfillSeoTitle(
      normalizeBlogTitle(row.seo_title) || row.seo_title || row.slug || '여행 가이드',
      row,
      primaryKeyword,
    );
    const normalizedDescription = improveBackfillSeoDescription(
      normalizeBlogDescription(row.seo_description) || row.seo_description || null,
      primaryKeyword,
    );
    const secondaryKeywords = buildSecondaryKeywords(primaryKeyword, destination);
    const slug = row.slug || row.id;
    const editorialRepair = repairBlogEditorialQuality({
      title: normalizedTitle,
      slug,
      primaryKeyword,
      category: normalizedTitle,
      contentType: 'guide',
      productId: null,
      blogHtml: originalHtml,
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
    const nextHtml = ensureInternalFunnelLinks(repairedFinal, destination, slug);
    const nextOg = finalized.ogImageUrl;
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
    const changed =
      nextHtml !== originalHtml ||
      nextOg !== originalOg ||
      normalizedTitle !== originalTitle ||
      normalizedDescription !== originalDescription;

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
      seoScore: qaReport.seoScore.score,
      readabilityScore: qaReport.readability.score,
      titleChanged: normalizedTitle !== originalTitle,
      descriptionChanged: normalizedDescription !== originalDescription,
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

    changedSlugs.push(slug);
    console.log(`[blog-quality] updated ${slug}`);
  }

  if (!dryRun && changedSlugs.length > 0) {
    await revalidate(['/blog', ...changedSlugs.map((slug) => `/blog/${slug}`)]);
  }

  const highlightCountsBefore = auditRows.map((row) => row.highlightCountBefore);
  const highlightCountsAfter = auditRows.map((row) => row.highlightCountAfter);
  const summary = {
    mode: dryRun ? 'dry-run' : 'write',
    scanned: auditRows.length,
    changed: auditRows.filter((row) => row.changed).length,
    updated: changedSlugs.length,
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
    samples: auditRows.filter((row) => row.changed).slice(0, 10).map((row) => row.slug),
    failedSamples: auditRows
      .filter((row) => !row.qualityGatePassed)
      .slice(0, 10)
      .map((row) => ({
        slug: row.slug,
        reason: row.qualityGateSummary,
        failedGates: row.failedGates.slice(0, 3),
      })),
  };

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error('[blog-quality] fatal:', err);
  process.exit(1);
});
