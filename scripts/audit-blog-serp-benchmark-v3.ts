import { mkdirSync, writeFileSync } from 'node:fs';
import { loadEnvConfig } from '@next/env';
import * as cheerio from 'cheerio';
import {
  BLOG_SERP_BENCHMARK_QUERIES_V3,
  BLOG_SERP_RESEARCH_VERSION,
  researchSerpNaverFirstV3,
  type SerpEditorialResultV3,
  type SerpResearchPacketV3,
} from '../src/lib/blog-serp-research-v3';

// An isolated git worktree intentionally does not copy ignored .env files.
// Operators may point this read-only audit at the already configured project
// directory without copying or printing any secret values.
loadEnvConfig(process.env.BLOG_AUDIT_ENV_DIR || process.cwd(), false);

const OUTPUT_DATE = '2026-08-14';
const JSON_PATH = `docs/audits/blog-serp-benchmark-${OUTPUT_DATE}.json`;
const CSV_PATH = `docs/audits/blog-serp-benchmark-results-${OUTPUT_DATE}.csv`;
const MD_PATH = `docs/audits/blog-serp-benchmark-${OUTPUT_DATE}.md`;
const apply = process.argv.includes('--apply');

interface PageObservation {
  query: string;
  sampleRank: number;
  providerRank: number;
  source: SerpEditorialResultV3['source'];
  url: string;
  domain: string;
  title: string;
  fetchStatus: 'ok' | 'fetch_blocked' | 'fetch_failed' | 'non_editorial';
  httpStatus: number | null;
  headingTree: string[];
  structureSignature: string;
  openingStrategy: string;
  bodyCharacters: number | null;
  paragraphCount: number | null;
  listCount: number | null;
  tableCount: number | null;
  imageCount: number | null;
  imageObservations: Array<{ alt: string; caption: string; aspect: string | null }>;
  authorPresent: boolean | null;
  reviewerPresent: boolean | null;
  sourceLinkCount: number | null;
  schemaTypes: string[];
  internalLinkCount: number | null;
  ctaTypes: string[];
  evidenceExcerpt: string | null;
  error: string | null;
}

function csvCell(value: unknown): string {
  const text = Array.isArray(value) ? value.join(' | ') : String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function safeExternalUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    const hostname = url.hostname.toLowerCase();
    if (hostname === 'localhost' || hostname.endsWith('.local') || /^(?:127\.|10\.|192\.168\.|169\.254\.)/.test(hostname)) return null;
    return url;
  } catch {
    return null;
  }
}

async function readBoundedText(response: Response, maximumBytes = 1_500_000): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = '';
  while (received < maximumBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    text += decoder.decode(value, { stream: true });
    if (received >= maximumBytes) {
      await reader.cancel();
      break;
    }
  }
  text += decoder.decode();
  return text;
}

function schemaTypesFrom($: cheerio.CheerioAPI): string[] {
  const values = new Set<string>();
  $('script[type="application/ld+json"]').each((_index, element) => {
    try {
      const parsed = JSON.parse($(element).text()) as unknown;
      const visit = (value: unknown): void => {
        if (Array.isArray(value)) {
          value.forEach(visit);
          return;
        }
        if (!value || typeof value !== 'object') return;
        const row = value as Record<string, unknown>;
        const type = row['@type'];
        if (typeof type === 'string') values.add(type);
        if (Array.isArray(type)) type.filter((item): item is string => typeof item === 'string').forEach((item) => values.add(item));
        Object.values(row).forEach(visit);
      };
      visit(parsed);
    } catch {
      // Invalid competitor JSON-LD is an observation, not a benchmark crash.
    }
  });
  return [...values].slice(0, 20);
}

async function observePage(query: string, result: SerpEditorialResultV3): Promise<PageObservation> {
  const base: PageObservation = {
    query,
    sampleRank: result.sampleRank,
    providerRank: result.providerRank,
    source: result.source,
    url: result.url,
    domain: result.domain,
    title: result.title,
    fetchStatus: 'fetch_failed',
    httpStatus: null,
    headingTree: [],
    structureSignature: '',
    openingStrategy: '',
    bodyCharacters: null,
    paragraphCount: null,
    listCount: null,
    tableCount: null,
    imageCount: null,
    imageObservations: [],
    authorPresent: null,
    reviewerPresent: null,
    sourceLinkCount: null,
    schemaTypes: [],
    internalLinkCount: null,
    ctaTypes: [],
    evidenceExcerpt: null,
    error: null,
  };
  const url = safeExternalUrl(result.url);
  if (!url) return { ...base, fetchStatus: 'non_editorial', error: 'unsafe_or_invalid_url' };
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; YeosonamEditorialResearch/3.1; +https://www.yeosonam.com/blog)',
        Accept: 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(12_000),
    });
    if ([401, 403, 407, 429].includes(response.status)) {
      return { ...base, fetchStatus: 'fetch_blocked', httpStatus: response.status, error: `http_${response.status}` };
    }
    if (!response.ok) return { ...base, httpStatus: response.status, error: `http_${response.status}` };
    const contentType = response.headers.get('content-type') || '';
    if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) {
      return { ...base, httpStatus: response.status, error: `unsupported_content_type:${contentType.slice(0, 80)}` };
    }
    const html = await readBoundedText(response);
    const $ = cheerio.load(html);
    $('script,style,noscript,svg,nav,footer').remove();
    const main = $('article').first().length ? $('article').first() : ($('main').first().length ? $('main').first() : $('body').first());
    const headingTree = main.find('h1,h2,h3').map((_index, element) => {
      const tag = element.tagName.toUpperCase();
      return `${tag}:${$(element).text().replace(/\s+/g, ' ').trim().slice(0, 120)}`;
    }).get().filter((heading) => !heading.endsWith(':')).slice(0, 60);
    const paragraphs = main.find('p').map((_index, element) => $(element).text().replace(/\s+/g, ' ').trim()).get().filter(Boolean);
    const opening = paragraphs[0] || '';
    const links = main.find('a[href]').map((_index, element) => $(element).attr('href') || '').get();
    const internalLinks = links.filter((href) => {
      try { return new URL(href, url).hostname === url.hostname; } catch { return false; }
    });
    const externalLinks = links.filter((href) => {
      try { return new URL(href, url).hostname !== url.hostname; } catch { return false; }
    });
    const images = main.find('img');
    const imageObservations = images.slice(0, 12).map((_index, element) => {
      const image = $(element);
      const figure = image.closest('figure');
      const width = Number(image.attr('width'));
      const height = Number(image.attr('height'));
      return {
        alt: (image.attr('alt') || '').replace(/\s+/g, ' ').trim().slice(0, 160),
        caption: figure.find('figcaption').first().text().replace(/\s+/g, ' ').trim().slice(0, 200),
        aspect: width > 0 && height > 0 ? `${width}:${height}` : null,
      };
    }).get();
    const bodyText = main.text().replace(/\s+/g, ' ').trim();
    const ctaText = main.find('a,button').map((_index, element) => $(element).text().replace(/\s+/g, ' ').trim()).get().join(' ');
    const ctaTypes = [
      /예약|구매|상품/.test(ctaText) ? 'product_or_booking' : null,
      /상담|문의/.test(ctaText) ? 'consultation' : null,
      /관련|더\s*보기|다음\s*글/.test(ctaText) ? 'related_content' : null,
    ].filter((value): value is string => Boolean(value));
    return {
      ...base,
      fetchStatus: 'ok',
      httpStatus: response.status,
      headingTree,
      structureSignature: headingTree.map((heading) => heading.replace(/:.+$/, '')).join('>'),
      openingStrategy: /\?|가능|괜찮|결론|먼저/.test(opening) ? 'answer_or_question_first' : 'context_first',
      bodyCharacters: bodyText.length,
      paragraphCount: paragraphs.length,
      listCount: main.find('ul,ol').length,
      tableCount: main.find('table').length,
      imageCount: images.length,
      imageObservations,
      authorPresent: /작성|에디터|기자|author/i.test(main.text()),
      reviewerPresent: /검수|reviewed\s*by|fact\s*check/i.test(main.text()),
      sourceLinkCount: externalLinks.length,
      schemaTypes: schemaTypesFrom($),
      internalLinkCount: internalLinks.length,
      ctaTypes,
      evidenceExcerpt: opening.slice(0, 280) || null,
      error: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ...base,
      fetchStatus: /abort|timeout/i.test(message) ? 'fetch_blocked' : 'fetch_failed',
      error: message.slice(0, 240),
    };
  }
}

async function mapConcurrent<T, R>(values: T[], concurrency: number, worker: (value: T, index: number) => Promise<R>): Promise<R[]> {
  const output = new Array<R>(values.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await worker(values[index], index);
    }
  });
  await Promise.all(runners);
  return output;
}

async function main(): Promise<void> {
  const packets: SerpResearchPacketV3[] = [];
  for (const query of BLOG_SERP_BENCHMARK_QUERIES_V3) {
    const packet = await researchSerpNaverFirstV3({ primaryQuery: query, persist: apply }, {
      readCached: async () => null,
    });
    packets.push(packet);
  }
  const targets = packets.flatMap((packet) => packet.results.map((result) => ({
    query: packet.queryCluster.primaryQuery,
    result,
  })));
  const observations = await mapConcurrent(targets, 6, ({ query, result }) => observePage(query, result));
  const resultCount = packets.reduce((sum, packet) => sum + packet.results.length, 0);
  const queriesWithTen = packets.filter((packet) => packet.results.length === 10).length;
  const fetched = observations.filter((observation) => observation.fetchStatus === 'ok').length;
  const blocked = observations.filter((observation) => observation.fetchStatus === 'fetch_blocked').length;
  const unavailable = packets.filter((packet) => packet.mode === 'unavailable').length;
  const summary = {
    generatedAt: new Date().toISOString(),
    researchVersion: BLOG_SERP_RESEARCH_VERSION,
    mode: apply ? 'apply_requested' : 'dry_run_read_only',
    providerContract: 'Naver Search API editorial sample; not Google rank parity and not Naver unified-search rank',
    queryCount: packets.length,
    targetEditorialResults: BLOG_SERP_BENCHMARK_QUERIES_V3.length * 10,
    observedEditorialResults: resultCount,
    queriesWithTenResults: queriesWithTen,
    unavailableQueries: unavailable,
    detailFetchOk: fetched,
    detailFetchBlocked: blocked,
    detailFetchFailed: observations.length - fetched - blocked,
    detailFetchSuccessRate: observations.length ? Number((fetched / observations.length).toFixed(4)) : 0,
    queriesWithVerifiedDemand: packets.filter((packet) => packet.verifiedDemand).length,
    naverAdsConfigured: packets.some((packet) => packet.provenance.some((entry) => entry.provider === 'naver_search_ads' && entry.status !== 'unconfigured')),
    passCriteria: {
      queryCount24: packets.length === 24,
      resultCount240: resultCount === 240,
      detailFetch85Percent: observations.length > 0 && fetched / observations.length >= 0.85,
      minimumSixPerQuery: packets.every((packet) => packet.results.length >= 6),
      unavailableIsNotSuccess: unavailable === 0,
    },
  };
  const report = { summary, packets, observations };
  mkdirSync('docs/audits', { recursive: true });
  writeFileSync(JSON_PATH, `${JSON.stringify(report, null, 2)}\n`);
  const csvHeaders = [
    'query', 'sample_rank', 'provider_rank', 'source', 'url', 'domain', 'title', 'fetch_status', 'http_status',
    'heading_count', 'structure_signature', 'opening_strategy', 'body_characters', 'paragraph_count', 'list_count',
    'table_count', 'image_count', 'author_present', 'reviewer_present', 'source_link_count', 'schema_types',
    'internal_link_count', 'cta_types', 'error',
  ];
  const csvRows = observations.map((row) => [
    row.query, row.sampleRank, row.providerRank, row.source, row.url, row.domain, row.title, row.fetchStatus, row.httpStatus,
    row.headingTree.length, row.structureSignature, row.openingStrategy, row.bodyCharacters, row.paragraphCount, row.listCount,
    row.tableCount, row.imageCount, row.authorPresent, row.reviewerPresent, row.sourceLinkCount, row.schemaTypes,
    row.internalLinkCount, row.ctaTypes, row.error,
  ].map(csvCell).join(','));
  writeFileSync(CSV_PATH, `${csvHeaders.join(',')}\n${csvRows.join('\n')}\n`);
  writeFileSync(MD_PATH, `# Blog SERP benchmark — ${OUTPUT_DATE}\n\n`
    + `이 감사는 Google 순위 대체값이 아니라 **네이버 블로그·웹문서 API의 editorial 표본**입니다. 통합검색 실제 순위와 동일하다고 해석하면 안 됩니다. 경쟁사 본문 전체는 저장하지 않았고 구조 측정값과 첫 문단의 짧은 excerpt만 보관했습니다.\n\n`
    + `| 항목 | 결과 | 기준 |\n|---|---:|---:|\n`
    + `| 키워드 | ${summary.queryCount} | 24 |\n`
    + `| 목표 editorial 결과 | ${summary.targetEditorialResults} | 240 |\n`
    + `| 수집 editorial 결과 | ${summary.observedEditorialResults} | 240 |\n`
    + `| 결과 10개 확보 query | ${summary.queriesWithTenResults} | 24 |\n`
    + `| 상세 구조 fetch 성공 | ${summary.detailFetchOk}/${observations.length} (${(summary.detailFetchSuccessRate * 100).toFixed(1)}%) | >= 85% |\n`
    + `| fetch_blocked | ${summary.detailFetchBlocked} | 별도 기록 |\n`
    + `| verified demand 보유 query | ${summary.queriesWithVerifiedDemand} | 관측값만 인정 |\n`
    + `| unavailable query | ${summary.unavailableQueries} | 0 |\n\n`
    + `## 데이터 품질 판정\n\n`
    + `- 24개 query: ${summary.passCriteria.queryCount24 ? 'PASS' : 'FAIL'}\n`
    + `- 240개 editorial 표본: ${summary.passCriteria.resultCount240 ? 'PASS' : 'FAIL'}\n`
    + `- query당 최소 6개: ${summary.passCriteria.minimumSixPerQuery ? 'PASS' : 'FAIL'}\n`
    + `- 상세 구조 fetch 85%: ${summary.passCriteria.detailFetch85Percent ? 'PASS' : 'FAIL'}\n`
    + `- 빈 provider 응답을 성공으로 오판하지 않음: ${summary.passCriteria.unavailableIsNotSuccess ? 'PASS' : 'FAIL'}\n\n`
    + `네이버 검색광고 API 키가 없으면 월간 검색량은 null로 남습니다. DataLab 상대지수는 검색량으로 환산하지 않습니다. 상세 행과 실패 원인은 JSON/CSV에 저장했습니다.\n`);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
