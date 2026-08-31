import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { CheerioCrawler, PlaywrightCrawler, log } from 'crawlee';

import {
  assertPublicHostname,
  buildSignal,
  compactText,
  crawlerRequest,
  validateReviewedRequestUrl,
  validateReviewedSource,
  validateSignal,
} from './signal-utils.mjs';

function arg(name, fallback = null) {
  const prefix = `--${name}=`;
  const value = process.argv.find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

if (process.argv.includes('--help')) {
  console.log('Usage: npm run collect -- --manifest=<json> --out=<json> [--no-browser]');
  process.exit(0);
}

const manifestPath = resolve(arg('manifest', 'source-manifest.example.json'));
const outputPath = resolve(arg('out', 'outputs/signals.json'));
const noBrowser = process.argv.includes('--no-browser');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.sources) || manifest.sources.length === 0) {
  throw new Error('manifest must contain at least one reviewed source');
}
if (manifest.sources.length > 20) throw new Error('pilot manifest is limited to 20 sources');

const sources = manifest.sources.map(validateReviewedSource);
const sourceById = new Map(sources.map((source) => [source.id, source]));
const collectedAt = new Date().toISOString();
const collectorVersion = '3.18.1';
const results = new Map();
const browserFallback = new Map();
const publicHostChecks = new Map();

function sourceForRequest(request) {
  const source = sourceById.get(String(request.userData?.sourceId ?? ''));
  if (!source) throw new Error(`unreviewed request reached crawler: ${request.url}`);
  return source;
}

async function ensurePublicHost(hostname) {
  const existing = publicHostChecks.get(hostname);
  if (existing) return existing;
  const pending = assertPublicHostname(hostname);
  publicHostChecks.set(hostname, pending);
  return pending;
}

await Promise.all(sources.map((source) => ensurePublicHost(new URL(source.url).hostname)));

log.setLevel(log.LEVELS.WARNING);

const cheerio = new CheerioCrawler({
  maxConcurrency: 4,
  maxRequestsPerCrawl: sources.length,
  requestHandlerTimeoutSecs: 30,
  preNavigationHooks: [async ({ request }, gotOptions) => {
    const source = sourceForRequest(request);
    const { hostname } = validateReviewedRequestUrl(source, request.url);
    await ensurePublicHost(hostname);
    gotOptions.followRedirect = false;
    gotOptions.maxRedirects = 0;
  }],
  async requestHandler({ request, $, response }) {
    const source = sourceForRequest(request);
    $('script, style, noscript, svg').remove();
    const title = compactText($('title').first().text() || $('h1').first().text());
    const text = compactText($('main, article, [role="main"]').first().text() || $('body').text());
    const signal = buildSignal({
      source,
      title,
      text,
      collectedAt,
      collectorVersion,
      statusCode: response?.statusCode ?? null,
      engine: 'cheerio',
    });
    results.set(source.id, signal);
    if (validateSignal(signal).length > 0) browserFallback.set(source.id, source);
  },
  failedRequestHandler({ request, error }) {
    const source = sourceById.get(String(request.userData?.sourceId ?? ''));
    if (source) browserFallback.set(source.id, source);
    console.warn(`Cheerio failed for ${request.url}: ${error.message}`);
  },
});

await cheerio.run(sources.map((source) => crawlerRequest(source, 'cheerio')));

if (!noBrowser && browserFallback.size > 0) {
  const fallbackSources = [...browserFallback.values()];
  const browser = new PlaywrightCrawler({
    maxConcurrency: 2,
    maxRequestsPerCrawl: fallbackSources.length,
    requestHandlerTimeoutSecs: 45,
    launchContext: { launchOptions: { headless: true }, useIncognitoPages: true },
    browserPoolOptions: {
      prePageCreateHooks: [(_pageId, _browserController, pageOptions) => {
        pageOptions.serviceWorkers = 'block';
      }],
    },
    preNavigationHooks: [async ({ page, request }) => {
      const source = sourceForRequest(request);
      await page.route('**/*', async (route) => {
        const outbound = route.request();
        if (['image', 'media', 'font'].includes(outbound.resourceType())) {
          await route.abort();
          return;
        }
        try {
          const { hostname } = validateReviewedRequestUrl(source, outbound.url());
          // Browser requests are independently resolved so DNS changes cannot
          // inherit the manifest preflight result for the rest of the crawl.
          await assertPublicHostname(hostname);
          await route.continue();
        } catch {
          await route.abort('blockedbyclient');
        }
      });
    }],
    async requestHandler({ request, page, response }) {
      const source = sourceForRequest(request);
      const title = compactText(await page.title());
      const text = compactText(await page.locator('main, article, [role="main"], body').first().innerText());
      const signal = buildSignal({
        source,
        title,
        text,
        collectedAt,
        collectorVersion,
        statusCode: response?.status() ?? null,
        engine: 'playwright',
      });
      results.set(source.id, signal);
    },
  });
  await browser.run(fallbackSources.map((source) => crawlerRequest(source, 'playwright')));
}

const signals = sources.map((source) => results.get(source.id)).filter(Boolean);
const failures = signals.flatMap((signal) => validateSignal(signal).map((code) => `${signal.collectorMeta.sourceId}:${code}`));
for (const source of sources) {
  if (!results.has(source.id)) failures.push(`${source.id}:missing_result`);
}

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify({
  schemaVersion: 1,
  generatedAt: collectedAt,
  collector: `crawlee@${collectorVersion}`,
  sourceCount: sources.length,
  signals,
  failures,
}, null, 2)}\n`, 'utf8');

console.log(`Collected ${signals.length}/${sources.length}; failures=${failures.length}; output=${outputPath}`);
if (failures.length > 0) process.exitCode = 1;
