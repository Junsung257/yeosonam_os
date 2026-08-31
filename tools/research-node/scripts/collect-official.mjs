import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { CheerioCrawler, PlaywrightCrawler, log } from 'crawlee';

import {
  buildSignal,
  compactText,
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
const sourceByUrl = new Map(sources.map((source) => [source.url, source]));
const collectedAt = new Date().toISOString();
const collectorVersion = '3.18.1';
const results = new Map();
const browserFallback = [];

log.setLevel(log.LEVELS.WARNING);

const cheerio = new CheerioCrawler({
  maxConcurrency: 4,
  maxRequestsPerCrawl: sources.length,
  requestHandlerTimeoutSecs: 30,
  async requestHandler({ request, $, response }) {
    const source = sourceByUrl.get(request.url);
    if (!source) throw new Error(`unreviewed URL reached handler: ${request.url}`);
    $('script, style, noscript, svg').remove();
    const title = compactText($('title').first().text() || $('h1').first().text());
    const text = compactText($('main, article, [role="main"]').first().text() || $('body').text());
    const signal = buildSignal({ source, title, text, collectedAt, collectorVersion });
    results.set(source.id, { ...signal, collectorMeta: { ...signal.collectorMeta, statusCode: response?.statusCode ?? null, engine: 'cheerio' } });
    if (validateSignal(signal).length > 0) browserFallback.push(source);
  },
  failedRequestHandler({ request, error }) {
    const source = sourceByUrl.get(request.url);
    if (source) browserFallback.push(source);
    console.warn(`Cheerio failed for ${request.url}: ${error.message}`);
  },
});

await cheerio.run(sources.map((source) => source.url));

if (!noBrowser && browserFallback.length > 0) {
  const fallbackByUrl = new Map(browserFallback.map((source) => [source.url, source]));
  const browser = new PlaywrightCrawler({
    maxConcurrency: 2,
    maxRequestsPerCrawl: browserFallback.length,
    requestHandlerTimeoutSecs: 45,
    launchContext: { launchOptions: { headless: true } },
    preNavigationHooks: [async ({ page }) => {
      await page.route('**/*', async (route) => {
        const resourceType = route.request().resourceType();
        if (['image', 'media', 'font'].includes(resourceType)) await route.abort();
        else await route.continue();
      });
    }],
    async requestHandler({ request, page, response }) {
      const source = fallbackByUrl.get(request.url);
      if (!source) throw new Error(`unreviewed URL reached browser handler: ${request.url}`);
      const title = compactText(await page.title());
      const text = compactText(await page.locator('main, article, [role="main"], body').first().innerText());
      const signal = buildSignal({ source, title, text, collectedAt, collectorVersion });
      results.set(source.id, { ...signal, collectorMeta: { ...signal.collectorMeta, statusCode: response?.status() ?? null, engine: 'playwright' } });
    },
  });
  await browser.run(browserFallback.map((source) => source.url));
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
  signals,
  failures,
}, null, 2)}\n`, 'utf8');

console.log(`Collected ${signals.length}/${sources.length}; failures=${failures.length}; output=${outputPath}`);
if (failures.length > 0) process.exitCode = 1;
