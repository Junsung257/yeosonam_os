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
const json = hasFlag('--json');
const browserFallback = hasFlag('--browser-fallback') || hasFlag('--browser');

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      'user-agent': 'yeosonam-blog-render-audit/1.0',
      accept: 'text/html,application/xhtml+xml',
    },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.text();
}

function absolutize(path) {
  if (/^https?:\/\//i.test(path)) return path;
  return `${baseUrl}${path.startsWith('/') ? '' : '/'}${path}`;
}

async function collectBlogLinks() {
  const links = new Set();
  for (let page = 1; page <= maxPages; page += 1) {
    const url = page === 1 ? `${baseUrl}/blog` : `${baseUrl}/blog?page=${page}`;
    let html = '';
    try {
      html = await fetchText(url);
    } catch {
      break;
    }
    const $ = cheerio.load(html);
    const before = links.size;
    $('a[href^="/blog/"]').each((_index, element) => {
      const href = $(element).attr('href') || '';
      if (!href || /\/blog\/(angle|destination)\//.test(href)) return;
      links.add(href.split('#')[0]);
    });
    if (page > 1 && links.size === before) break;
  }
  const all = [...links];
  return limit > 0 ? all.slice(0, limit) : all;
}

function count(text, pattern) {
  return (text.match(pattern) || []).length;
}

function inspectArticle(html, path) {
  const $ = cheerio.load(html);
  const article = $('article').first();
  const root = article.length ? article : $('body');
  const text = root.text();
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
    h2Count < 2;
  return {
    path,
    title: ($('title').text() || '').trim(),
    failed,
    artifactTotal,
    imgCount,
    h2Count,
    tableCount,
    ...artifacts,
  };
}

async function inspectArticleInBrowser(browser, path) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1600 } });
  try {
    await page.goto(absolutize(path), { waitUntil: 'networkidle', timeout: 120000 });
    await page.waitForTimeout(500);
    const result = await page.evaluate(() => {
      const count = (text, pattern) => (text.match(pattern) || []).length;
      const article = document.querySelector('article');
      const root = article || document.body;
      const text = root.textContent || '';
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
        ...artifacts,
      };
    });
    return {
      path,
      ...result,
      checkedBy: 'browser',
      failed: result.artifactTotal > 0 || result.imgCount === 0 || result.h2Count < 2,
    };
  } finally {
    await page.close();
  }
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
  const rows = [];
  for (const path of links) {
    try {
      const html = await fetchText(absolutize(path));
      rows.push(inspectArticle(html, path));
    } catch (error) {
      rows.push({
        path,
        error: error instanceof Error ? error.message : String(error),
        failed: true,
      });
    }
  }
  if (browserFallback && rows.some((row) => row.failed || row.error)) {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: true });
    try {
      for (let index = 0; index < rows.length; index += 1) {
        if (!rows[index].failed && !rows[index].error) continue;
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
    return;
  }
  console.log(`Blog render integrity: ${summary.score}/100 (${summary.passed}/${summary.fetched} passed, errors=${summary.errors})`);
  console.log(`Average artifacts=${summary.avgArtifacts}, average images=${summary.avgImages}`);
  for (const row of output.failedExamples.slice(0, 10)) {
    console.log(`- ${row.path}: artifacts=${row.artifactTotal ?? 'n/a'}, images=${row.imgCount ?? 'n/a'}, h2=${row.h2Count ?? 'n/a'}, error=${row.error ?? ''}`);
  }
  if (summary.failed > 0 || summary.errors > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
