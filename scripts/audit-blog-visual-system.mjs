#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const args = process.argv.slice(2);

function argValue(name, fallback = null) {
  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] ?? fallback : fallback;
}

function hasFlag(name) {
  return args.includes(name);
}

const baseUrl = (argValue('--base', process.env.BLOG_AUDIT_BASE_URL || 'https://www.yeosonam.com') || '').replace(/\/$/, '');
const limit = Number(argValue('--limit', '0')) || 0;
const maxPages = Number(argValue('--pages', '20')) || 20;
const outputJson = hasFlag('--json');
const full = hasFlag('--full');
const surfaceLimit = Number(argValue('--surface-limit', full ? '0' : '8')) || 0;
const concurrency = Math.max(1, Math.min(6, Number(argValue('--concurrency', '3')) || 3));
const reportPath = argValue('--report', null);
const screenshotDir = argValue('--screenshots', null);
const strict = hasFlag('--strict');

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 1800 },
  { name: 'mobile', width: 390, height: 1200 },
];

const RAW_MARKDOWN_PATTERNS = [
  { key: 'markdown_image', pattern: /!\[[^\]]*]\(/g },
  { key: 'markdown_heading', pattern: /(^|\n)#{1,6}\s/gm },
  { key: 'markdown_link', pattern: /\[[^\]]+]\((?:https?:\/\/|\/)/g },
  { key: 'markdown_table', pattern: /\|(?:\s*-{3,}\s*\|)+/g },
  { key: 'markdown_bold', pattern: /\*\*[^*]+?\*\*/g },
  { key: 'markdown_strike', pattern: /~~[^~]+~~/g },
];

function toAbsoluteUrl(value) {
  if (/^https?:\/\//i.test(value)) return value;
  return `${baseUrl}${value.startsWith('/') ? '' : '/'}${value}`;
}

function normalizePath(value) {
  try {
    const url = new URL(value, baseUrl);
    return `${url.pathname}${url.search}`.replace(/\/$/, '') || '/';
  } catch {
    return value;
  }
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      accept: 'text/html,application/xhtml+xml,application/json',
      'user-agent': 'yeosonam-blog-visual-system-audit/1.0',
    },
  });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.text();
}

async function collectPostPathsFromApi() {
  const paths = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const response = await fetch(`${baseUrl}/api/blog?page=${page}&limit=50`, {
      headers: { 'user-agent': 'yeosonam-blog-visual-system-audit/1.0' },
    }).catch(() => null);
    if (!response?.ok) break;
    const json = await response.json().catch(() => null);
    const posts = Array.isArray(json?.posts) ? json.posts : [];
    for (const post of posts) {
      if (post?.slug) paths.push(`/blog/${post.slug}`);
    }
    if (posts.length === 0 || (json?.totalPages && page >= json.totalPages)) break;
    if (limit > 0 && paths.length >= limit) break;
  }
  return [...new Set(paths)].slice(0, limit > 0 ? limit : undefined);
}

async function collectBlogSurfacePaths() {
  const surfacePaths = new Set(['/blog']);
  const postPaths = new Set(await collectPostPathsFromApi());

  for (let page = 1; page <= maxPages; page += 1) {
    const listPath = page === 1 ? '/blog' : `/blog?page=${page}`;
    let html = '';
    try {
      html = await fetchText(toAbsoluteUrl(listPath));
    } catch {
      break;
    }

    const beforePosts = postPaths.size;
    const hrefs = [...html.matchAll(/href=["']([^"']+)["']/g)]
      .map((match) => match[1])
      .filter(Boolean)
      .map(normalizePath);

    for (const href of hrefs) {
      if (href === '/blog' || href.startsWith('/blog?')) surfacePaths.add(href);
      if (href.startsWith('/blog/angle/') || href.startsWith('/blog/destination/')) surfacePaths.add(href);
      if (/^\/blog\/(?!angle\/|destination\/|page$)[^/?#]+$/.test(href)) postPaths.add(href);
    }

    surfacePaths.add(listPath);
    if (page > 1 && postPaths.size === beforePosts && !html.includes(`page=${page + 1}`)) break;
    if (limit > 0 && postPaths.size >= limit) break;
  }

  return {
    surfaces: [...surfacePaths].sort(),
    posts: [...postPaths].slice(0, limit > 0 ? limit : undefined).sort(),
  };
}

function countMatches(text, pattern) {
  return (text.match(pattern) || []).length;
}

async function auditOne(page, targetPath, viewport) {
  const url = toAbsoluteUrl(targetPath);
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => undefined);
  await page.evaluate(async () => {
    const step = Math.max(320, Math.floor(window.innerHeight * 0.75));
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((resolve) => window.setTimeout(resolve, 80));
    }
    window.scrollTo(0, 0);
  });
  await page.evaluate(async () => {
    const images = [...document.querySelectorAll('main img, article img')];
    const waitForImage = (img) => {
      if (img.complete && img.naturalWidth > 0 && img.naturalHeight > 0) return Promise.resolve(undefined);
      const timeout = new Promise((resolve) => window.setTimeout(resolve, 1800));
      if (typeof img.decode === 'function') {
        return Promise.race([img.decode().catch(() => undefined), timeout]);
      }
      const loaded = new Promise((resolve) => {
        const done = () => resolve(undefined);
        img.addEventListener('load', done, { once: true });
        img.addEventListener('error', done, { once: true });
      });
      return Promise.race([loaded, timeout]);
    };
    for (const img of images) {
      if (!(img.complete && img.naturalWidth > 0 && img.naturalHeight > 0)) {
        img.scrollIntoView({ block: 'center', inline: 'nearest' });
        await new Promise((resolve) => window.setTimeout(resolve, 120));
      }
      await waitForImage(img);
    }
    window.scrollTo(0, 0);
  });
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => undefined);
  await page.waitForTimeout(300);

  if (screenshotDir) {
    await fs.mkdir(screenshotDir, { recursive: true });
    const safeName = `${viewport.name}-${targetPath.replace(/[^a-z0-9가-힣]+/gi, '-').replace(/^-|-$/g, '') || 'root'}.png`;
    await page.screenshot({
      path: path.join(screenshotDir, safeName),
      fullPage: true,
      animations: 'disabled',
    });
  }

  return page.evaluate(({ auditPath, viewportName, rawPatterns }) => {
    const root = document.querySelector('article') || document.querySelector('main') || document.body;
    const article = document.querySelector('article');
    const text = root.textContent || '';
    const viewportWidth = document.documentElement.clientWidth;
    const scrollWidth = document.documentElement.scrollWidth;

    const markdownArtifacts = Object.fromEntries(
      rawPatterns.map(({ key, source, flags }) => [key, (text.match(new RegExp(source, flags)) || []).length]),
    );
    const artifactTotal = Object.values(markdownArtifacts).reduce((sum, value) => sum + value, 0);

    const images = [...root.querySelectorAll('img')].map((img) => {
      const rect = img.getBoundingClientRect();
      const style = window.getComputedStyle(img);
      const visibleArea = Math.max(0, rect.width) * Math.max(0, rect.height);
      return {
        src: img.currentSrc || img.src || '',
        alt: img.getAttribute('alt') || '',
        naturalWidth: img.naturalWidth || 0,
        naturalHeight: img.naturalHeight || 0,
        rectWidth: Math.round(rect.width),
        rectHeight: Math.round(rect.height),
        visible: style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0 && visibleArea > 100,
        complete: img.complete,
      };
    });

    const tableIssues = [...root.querySelectorAll('table')].map((table) => {
      const rect = table.getBoundingClientRect();
      const container = table.parentElement?.getBoundingClientRect();
      return {
        width: Math.round(rect.width),
        containerWidth: Math.round(container?.width || viewportWidth),
        overflowsViewport: rect.width > viewportWidth + 2,
        overflowsContainer: container ? rect.width > container.width + 2 : false,
      };
    }).filter((issue) => issue.overflowsViewport || issue.overflowsContainer);

    const struckNodes = [...root.querySelectorAll('del, s, strike, [style*="line-through"], .line-through')]
      .map((node) => (node.textContent || '').trim())
      .filter(Boolean)
      .slice(0, 10);

    const visibleBrokenImages = images.filter((image) =>
      image.visible && (image.naturalWidth === 0 || image.naturalHeight === 0 || image.rectWidth < 24 || image.rectHeight < 24)
    );
    const invisibleImages = images.filter((image) =>
      image.naturalWidth > 0 && image.naturalHeight > 0 && !image.visible
    );

    const isPost = /^\/blog\/(?!angle\/|destination\/?$)[^/?#]+/.test(auditPath);
    const isBlogSurface = auditPath === '/blog' || auditPath.startsWith('/blog?') || auditPath.startsWith('/blog/angle/') || auditPath.startsWith('/blog/destination/');
    const postCards = isBlogSurface ? [...root.querySelectorAll('a[href^="/blog/"]')]
      .filter((anchor) => !/\/blog\/(angle|destination)\//.test(anchor.getAttribute('href') || ''))
      .map((anchor) => ({
        href: anchor.getAttribute('href') || '',
        hasImage: Boolean(anchor.querySelector('img')),
        text: (anchor.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 90),
      })) : [];

    const issues = [];
    if (artifactTotal > 0) issues.push('raw_markdown_visible');
    if (struckNodes.length > 0) issues.push('visible_strikethrough_or_deletion');
    if (tableIssues.length > 0) issues.push('table_overflow');
    if (scrollWidth > viewportWidth + 8) issues.push('page_horizontal_overflow');
    if (visibleBrokenImages.length > 0) issues.push('visible_broken_or_tiny_images');
    if (isPost && images.length < 2) issues.push('post_has_too_few_images');
    if (isPost && article && article.querySelectorAll('h2').length < 2) issues.push('post_has_too_few_sections');
    if (isBlogSurface && postCards.some((card) => !card.hasImage)) issues.push('blog_card_missing_image');

    return {
      path: auditPath,
      viewport: viewportName,
      title: document.title,
      url: location.href,
      imageCount: images.length,
      visibleBrokenImageCount: visibleBrokenImages.length,
      invisibleImageCount: invisibleImages.length,
      strikethroughCount: struckNodes.length,
      tableOverflowCount: tableIssues.length,
      horizontalOverflowPx: Math.max(0, scrollWidth - viewportWidth),
      articleH2Count: article?.querySelectorAll('h2').length || 0,
      postCardCount: postCards.length,
      postCardsMissingImages: postCards.filter((card) => !card.hasImage).length,
      markdownArtifacts,
      artifactTotal,
      struckNodes,
      tableIssues,
      issues,
      failed: issues.length > 0,
    };
  }, {
    auditPath: targetPath,
    viewportName: viewport.name,
    rawPatterns: RAW_MARKDOWN_PATTERNS.map(({ key, pattern }) => ({
      key,
      source: pattern.source,
      flags: pattern.flags,
    })),
  });
}

function summarize(rows, inventory) {
  const failedRows = rows.filter((row) => row.failed || row.error);
  const issueCounts = {};
  for (const row of rows) {
    for (const issue of row.issues || []) issueCounts[issue] = (issueCounts[issue] || 0) + 1;
    if (row.error) issueCounts.page_error = (issueCounts.page_error || 0) + 1;
  }
  const score = rows.length === 0 ? 0 : Math.round(((rows.length - failedRows.length) / rows.length) * 100);
  return {
    baseUrl,
    checkedAt: new Date().toISOString(),
    surfaces: inventory.surfaces.length,
    posts: inventory.posts.length,
    viewports: VIEWPORTS.map((viewport) => viewport.name),
    rows: rows.length,
    passed: rows.length - failedRows.length,
    failed: failedRows.length,
    score,
    issueCounts,
  };
}

async function main() {
  if (!baseUrl) throw new Error('--base is required');
  const inventory = await collectBlogSurfacePaths();
  const surfaces = surfaceLimit > 0 ? inventory.surfaces.slice(0, surfaceLimit) : inventory.surfaces;
  const targets = full ? [...inventory.surfaces, ...inventory.posts] : [...surfaces, ...inventory.posts.slice(0, limit || 20)];
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    colorScheme: 'light',
    locale: 'ko-KR',
    ignoreHTTPSErrors: true,
  });
  const rows = [];
  const jobs = [];
  for (const targetPath of targets) {
    for (const viewport of VIEWPORTS) jobs.push({ targetPath, viewport });
  }
  let cursor = 0;

  try {
    async function worker() {
      const page = await context.newPage();
      try {
        while (cursor < jobs.length) {
          const job = jobs[cursor];
          cursor += 1;
          const { targetPath, viewport } = job;
          try {
            rows.push(await auditOne(page, targetPath, viewport));
          } catch (error) {
            rows.push({
              path: targetPath,
              viewport: viewport.name,
              error: error instanceof Error ? error.message : String(error),
              failed: true,
            });
          }
        }
      } finally {
        await page.close().catch(() => undefined);
      }
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, jobs.length)) }, () => worker()));
  } finally {
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }

  const summary = summarize(rows, inventory);
  const output = {
    summary,
    failedExamples: rows.filter((row) => row.failed || row.error).slice(0, 40),
    rows,
  };

  if (reportPath) {
    await fs.mkdir(path.dirname(reportPath), { recursive: true });
    await fs.writeFile(reportPath, JSON.stringify(output, null, 2), 'utf8');
  }

  if (outputJson) {
    console.log(JSON.stringify(output, null, 2));
  } else {
    console.log(`Blog visual system audit: ${summary.score}/100 (${summary.passed}/${summary.rows} viewport checks passed)`);
    console.log(`Surfaces=${summary.surfaces}, posts=${summary.posts}, issues=${JSON.stringify(summary.issueCounts)}`);
    for (const row of output.failedExamples.slice(0, 12)) {
      console.log(`- ${row.viewport} ${row.path}: ${(row.issues || [row.error]).join(', ')}`);
    }
  }

  if (strict && summary.failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
