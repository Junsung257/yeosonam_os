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
    .split('\n')
    .map((line) => {
      let next = line;
      next = next.replace(/^(##\s+자주\s*묻는\s*질문)\s+(Q\d+[.)]\s+.+)$/i, '$1\n\n### $2');
      next = next.replace(/^(##\s+[^#\n]{4,60}?)\s+(\d+\.\s+\S.+)$/i, '$1\n\n$2');
      next = next.replace(/(##\s+자주\s*묻는\s*질문)\s+(Q\d+[.)]\s+)/gi, '$1\n\n### $2');
      next = next.replace(/(##\s+[^#\n]{4,60}?)\s+(\d+\.\s+\S)/gi, '$1\n\n$2');
      return next;
    })
    .join('\n');
}

function splitCollapsedListItems(markdown: string): string {
  return markdown
    .split('\n')
    .map((line) => {
      if (!/^\s*[-*]\s+\S/.test(line)) return line;
      return line.replace(/\s+(\d+\.\s+\S)/g, '\n$1');
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

function ensureChecklistSection(markdown: string): string {
  const hasChecklistIntent = /체크리스트|필수\s*아이템|준비물|챙길\s*것/.test(markdown);
  const hasChecklistHeading = /^#{2,3}\s+.*(체크리스트|필수\s*아이템|준비물|챙길\s*것)/m.test(markdown);
  const listItems = (markdown.match(/(^|\n)\s*(?:[-*]|\d+\.)\s+\S/g) || []).length;
  if (!hasChecklistIntent || (hasChecklistHeading && listItems >= 3)) return markdown;

  return `${markdown.trim()}\n\n## 준비물 체크리스트\n\n- 여권, 항공권, 숙소 예약 정보를 출발 전 다시 확인합니다.\n- 계절과 고도 차이에 맞는 겉옷, 우산, 편한 신발을 준비합니다.\n- 현지 결제 수단과 비상 연락 수단을 2가지 이상 준비합니다.\n`;
}

function splitLongParagraphs(markdown: string): string {
  return markdown
    .split(/\n{2,}/)
    .map((paragraph) => {
      const trimmed = paragraph.trim();
      const plain = trimmed.replace(/<[^>]+>/g, ' ').replace(/[#*_`[\]()!]/g, ' ').replace(/\s+/g, ' ').trim();
      if (
        plain.length < 500 ||
        /^#{1,6}\s/.test(trimmed) ||
        /^\s*(?:[-*]|\d+\.)\s+\S/.test(trimmed) ||
        /^\s*\|/.test(trimmed)
      ) {
        return paragraph;
      }

      const sentences = trimmed
        .split(/(?<=[.!?。]|다\.|요\.)\s+/)
        .map((sentence) => sentence.trim())
        .filter(Boolean);
      if (sentences.length < 3) return paragraph;

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

function repairLegacyStructureArtifacts(markdown: string): string {
  let next = markdown;
  next = removeRawAdmonitionDirectives(next);
  next = repairProseTableRows(next);
  next = splitCollapsedHeadings(next);
  next = splitCollapsedListItems(next);
  next = removeDuplicateCoreHeadings(next);
  next = ensureChecklistSection(next);
  next = splitLongParagraphs(next);
  return next.replace(/\n{4,}/g, '\n\n\n').trim();
}

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * ratio));
  return sorted[index];
}

function primaryKeywordFor(row: BlogRow): string {
  const basis = normalizePrimaryKeyword(row.destination)
    || normalizePrimaryKeyword(row.seo_title)
    || normalizePrimaryKeyword(row.slug)
    || 'travel';
  return basis.trim();
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
    const normalizedTitle = normalizeBlogTitle(row.seo_title) || row.seo_title || row.slug || '여행 가이드';
    const normalizedDescription = normalizeBlogDescription(row.seo_description) || row.seo_description || null;
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

    const nextHtml = softenKeywordDensity(
      repairLegacyStructureArtifacts(finalized.blogHtml),
      primaryKeyword,
      'info',
    );
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
      category: normalizedTitle,
      excludeContentCreativeId: row.id,
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
