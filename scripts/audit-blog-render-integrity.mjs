#!/usr/bin/env node
import * as cheerio from 'cheerio';

const DEFAULT_BASE_URL = 'https://www.yeosonam.com';

function argValue(name, fallback = null) {
  const prefix = `${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

const baseUrl = (argValue('--base', DEFAULT_BASE_URL) || DEFAULT_BASE_URL).replace(/\/$/, '');
const maxPages = Number(argValue('--pages', '12'));
const limit = Number(argValue('--limit', '0')) || 0;
const concurrency = Math.max(1, Math.min(10, Number(argValue('--concurrency', '4')) || 4));
const timeoutMs = Math.max(1000, Number(argValue('--timeout-ms', '15000')) || 15000);
const requestedHardTimeoutMs = Number(argValue('--hard-timeout-ms', process.env.BLOG_AUDIT_HARD_TIMEOUT_MS || '0')) || 0;
const hardTimeoutMs = requestedHardTimeoutMs > 0 ? Math.max(timeoutMs + 1000, requestedHardTimeoutMs) : 0;
const json = hasFlag('--json');
const quiet = json || hasFlag('--quiet');
const browserFallback = hasFlag('--browser-fallback') || hasFlag('--browser');
const strict = hasFlag('--strict');
const TABLE_EXPECTED_RE =
  /budget|cost|weather|itinerary|checklist|visa|currency|expense|\uBE44\uC6A9|\uC608\uC0B0|\uB0A0\uC528|\uC6D4\uBCC4|\uC77C\uC815|\uC900\uBE44\uBB3C|\uCCB4\uD06C\uB9AC\uC2A4\uD2B8|\uBE44\uC790|\uD658\uC804/i;
const RELATED_HEADING_RE =
  /\uAD00\uB828\s*(?:\uAE00|\uC0C1\uD488)|\uCD94\uCC9C\s*\uC0C1\uD488|\uAC19\uC774\s*\uBCF4\uBA74|\uD568\uAED8\s*\uBCF4\uBA74/i;

let hardTimer = null;
if (hardTimeoutMs > 0) {
  hardTimer = setTimeout(() => {
    console.error(`[audit-blog-render] hard timeout after ${hardTimeoutMs}ms`);
    process.exit(124);
  }, hardTimeoutMs);
}

async function fetchText(url) {
  let response;
  try {
    response = await fetch(url, {
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        'user-agent': 'yeosonam-blog-render-audit/1.0',
        accept: 'text/html,application/xhtml+xml',
        'cache-control': 'no-cache',
        pragma: 'no-cache',
      },
    });
  } catch (error) {
    if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
      throw new Error(`timeout ${timeoutMs}ms`);
    }
    throw error;
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.text();
}

function logProgress(message) {
  if (!quiet) console.log(message);
}

function absolutize(path) {
  if (/^https?:\/\//i.test(path)) return path;
  return `${baseUrl}${path.startsWith('/') ? '' : '/'}${path}`;
}

async function collectBlogLinks() {
  const links = new Set();
  const errors = [];
  logProgress(`Collecting blog links from ${baseUrl} (pages=${maxPages}, limit=${limit || 'all'})`);
  for (let page = 1; page <= maxPages; page += 1) {
    const url = page === 1 ? `${baseUrl}/blog` : `${baseUrl}/blog?page=${page}`;
    let html = '';
    try {
      html = await fetchText(url);
    } catch (error) {
      errors.push({
        url,
        error: error instanceof Error ? error.message : String(error),
      });
      break;
    }
    const $ = cheerio.load(html);
    const before = links.size;
    $('a[href^="/blog/"]').each((_index, element) => {
      const href = $(element).attr('href') || '';
      if (!href || /\/blog\/(angle|destination)\//.test(href)) return;
      links.add(href.split('#')[0]);
    });
    if (limit > 0 && links.size >= limit) {
      const limited = [...links].slice(0, limit);
      limited.collectionErrors = errors;
      return limited;
    }
    if (page > 1 && links.size === before) break;
  }
  const all = [...links];
  const limited = limit > 0 ? all.slice(0, limit) : all;
  limited.collectionErrors = errors;
  return limited;
}

function count(text, pattern) {
  return (text.match(pattern) || []).length;
}

function inspectArticle(html, path) {
  const $ = cheerio.load(html);
  $('script, style, template, noscript').remove();
  const article = $('article').first();
  const root = article.length ? article : $('body');
  const text = root.text();
  const pageTitle = ($('title').text() || '').trim();
  const tableExpected = TABLE_EXPECTED_RE.test(`${path} ${pageTitle} ${text.slice(0, 1200)}`);
  const relatedHeadingPollution = root
    .find('h2, h3')
    .toArray()
    .filter((element) => RELATED_HEADING_RE.test($(element).text()))
    .length;
  const artifacts = {
    markdownImages: count(text, /!\[[^\]]*]\(/g),
    markdownHeadings: count(text, /(^|\n)#{1,6}\s/gm),
    markdownLinks: count(text, /\[[^\]]+]\((?:https?:\/\/|\/)/g),
    markdownTables: count(text, /\|---|---\|/g),
    markdownBold: count(text, /\*\*[^*]+?\*\*/g),
  };
  const artifactTotal = Object.values(artifacts).reduce((sum, value) => sum + value, 0);
  const imgCount = root.find('img').length;
  const h2Count = root.find('h2').length;
  const tableCount = root.find('table').length;
  const failed =
    artifactTotal > 0 ||
    imgCount === 0 ||
    h2Count < 2 ||
    (tableExpected && tableCount === 0) ||
    relatedHeadingPollution > 0;
  return {
    path,
    title: pageTitle,
    failed,
    artifactTotal,
    imgCount,
    h2Count,
    tableCount,
    tableExpected,
    relatedHeadingPollution,
    ...artifacts,
  };
}

function shouldRetryArticle(row) {
  return !row.error && row.imgCount === 0 && row.h2Count === 0;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function inspectArticleWithRetry(path) {
  const url = absolutize(path);
  let lastRow = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const html = await fetchText(url);
    const row = inspectArticle(html, path);
    if (!shouldRetryArticle(row)) return row;
    lastRow = { ...row, retryReason: 'empty_article_shell', attempts: attempt + 1 };
    await sleep(500 * (attempt + 1));
  }
  return lastRow;
}

async function inspectArticleInBrowser(browser, path) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1600 } });
  try {
    await page.goto(absolutize(path), { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    await page.waitForTimeout(500);
    const result = await page.evaluate(() => {
      const count = (text, pattern) => (text.match(pattern) || []).length;
      const article = document.querySelector('article');
      const root = article || document.body;
      const text = root.textContent || '';
      const tableExpected =
        /budget|cost|weather|itinerary|checklist|visa|currency|expense|\uBE44\uC6A9|\uC608\uC0B0|\uB0A0\uC528|\uC6D4\uBCC4|\uC77C\uC815|\uC900\uBE44\uBB3C|\uCCB4\uD06C\uB9AC\uC2A4\uD2B8|\uBE44\uC790|\uD658\uC804/i.test(
          `${location.pathname} ${document.title} ${text.slice(0, 1200)}`,
        );
      const relatedHeadingPollution = [...root.querySelectorAll('h2, h3')]
        .filter((element) =>
          /\uAD00\uB828\s*(?:\uAE00|\uC0C1\uD488)|\uCD94\uCC9C\s*\uC0C1\uD488|\uAC19\uC774\s*\uBCF4\uBA74|\uD568\uAED8\s*\uBCF4\uBA74/i.test(
            element.textContent || '',
          ),
        )
        .length;
      const artifacts = {
        markdownImages: count(text, /!\[[^\]]*]\(/g),
        markdownHeadings: count(text, /(^|\n)#{1,6}\s/gm),
        markdownLinks: count(text, /\[[^\]]+]\((?:https?:\/\/|\/)/g),
        markdownTables: count(text, /\|---|---\|/g),
        markdownBold: count(text, /\*\*[^*]+?\*\*/g),
      };
      const artifactTotal = Object.values(artifacts).reduce((sum, value) => sum + value, 0);
      const imgCount = root.querySelectorAll('img').length;
      const h2Count = root.querySelectorAll('h2').length;
      const tableCount = root.querySelectorAll('table').length;
      return {
        title: document.title.trim(),
        artifactTotal,
        imgCount,
        h2Count,
        tableCount,
        tableExpected,
        relatedHeadingPollution,
        ...artifacts,
      };
    });
    return {
      path,
      ...result,
      checkedBy: 'browser',
      failed: result.artifactTotal > 0 || result.imgCount === 0 || result.h2Count < 2 || (result.tableExpected && result.tableCount === 0) || result.relatedHeadingPollution > 0,
    };
  } finally {
    await page.close();
  }
}

async function mapWithConcurrency(items, workerCount, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function runWorker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(workerCount, Math.max(1, items.length)) }, runWorker));
  return results;
}

function summarize(rows) {
  const fetched = rows.filter((row) => !row.error);
  const failed = fetched.filter((row) => row.failed);
  const score = fetched.length === 0 ? 0 : Math.round(((fetched.length - failed.length) / fetched.length) * 100);
  return {
    baseUrl,
    totalLinks: rows.length,
    fetched: fetched.length,
    errors: rows.length - fetched.length,
    failed: failed.length,
    passed: fetched.length - failed.length,
    score,
    avgArtifacts: Number((fetched.reduce((sum, row) => sum + row.artifactTotal, 0) / Math.max(1, fetched.length)).toFixed(1)),
    avgImages: Number((fetched.reduce((sum, row) => sum + row.imgCount, 0) / Math.max(1, fetched.length)).toFixed(1)),
  };
}

async function main() {
  const links = await collectBlogLinks();
  const collectionErrors = links.collectionErrors || [];
  if (links.length === 0) {
    logProgress(`No blog links found. Try --base=http://localhost:3001 after starting the app, or pass --limit for a smaller remote audit.`);
  } else {
    logProgress(`Auditing ${links.length} blog page(s) with concurrency=${concurrency}, timeout=${timeoutMs}ms`);
  }
  const rows = await mapWithConcurrency(links, concurrency, async (path, index) => {
    logProgress(`[${index + 1}/${links.length}] ${path}`);
    try {
      return await inspectArticleWithRetry(path);
    } catch (error) {
      return {
        path,
        error: error instanceof Error ? error.message : String(error),
        failed: true,
      };
    }
  });
  for (const issue of collectionErrors) {
    rows.push({
      path: issue.url,
      error: issue.error,
      failed: true,
      collectionError: true,
    });
  }
  if (browserFallback && rows.some((row) => !row.collectionError && (row.failed || row.error))) {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: true });
    try {
      for (let index = 0; index < rows.length; index += 1) {
        if (rows[index].collectionError || (!rows[index].failed && !rows[index].error)) continue;
        try {
          rows[index] = await inspectArticleInBrowser(browser, rows[index].path);
        } catch (error) {
          rows[index] = {
            ...rows[index],
            browserError: error instanceof Error ? error.message : String(error),
          };
        }
      }
    } finally {
      await browser.close();
    }
  }
  const summary = summarize(rows);
  const output = {
    summary,
    failedExamples: rows.filter((row) => row.failed || row.error).slice(0, 20),
    rows,
  };
  if (json) {
    console.log(JSON.stringify(output, null, 2));
    if (summary.failed > 0 || summary.errors > 0) process.exitCode = 1;
    return;
  }
  console.log(`Blog render integrity: ${summary.score}/100 (${summary.passed}/${summary.fetched} passed, errors=${summary.errors})`);
  console.log(`Average artifacts=${summary.avgArtifacts}, average images=${summary.avgImages}`);
  for (const row of output.failedExamples.slice(0, 10)) {
    console.log(`- ${row.path}: artifacts=${row.artifactTotal ?? 'n/a'}, images=${row.imgCount ?? 'n/a'}, h2=${row.h2Count ?? 'n/a'}, error=${row.error ?? ''}`);
  }
  if (summary.failed > 0 || summary.errors > 0) process.exitCode = 1;
}

main()
  .then(() => {
    if (hardTimer) clearTimeout(hardTimer);
    process.exit(process.exitCode ?? 0);
  })
  .catch((error) => {
    if (hardTimer) clearTimeout(hardTimer);
    console.error(error);
    process.exit(1);
  });
