import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_BASE = process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || 'https://www.yeosonam.com';
const DEFAULT_OUT = 'docs/audits/2026-07-06-destinations-full-audit';
const REGION_SLUGS = ['japan', 'china', 'southeast-asia', 'macau-hk', 'taiwan', 'mongolia', 'europe', 'oceania', 'americas'];
const VIEWPORTS = {
  desktop: { width: 1365, height: 900 },
  mobile: { width: 390, height: 844 },
};

function getArg(name, fallback = null) {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function slugify(value) {
  return String(value || 'page')
    .replace(/^https?:\/\//, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 96);
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

async function scanPage(page, url, options = {}) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(500);

  const result = await page.evaluate(() => {
    const text = document.body?.textContent || '';
    const normalizedText = text.replace(/\s+/g, ' ').trim();
    const links = [...document.querySelectorAll('a[href]')].map((a) => ({
      text: (a.textContent || '').replace(/\s+/g, ' ').trim(),
      href: a.href,
      pathname: new URL(a.href).pathname,
    }));
    const images = [...document.images].map((img) => ({
      alt: img.alt || '',
      src: img.currentSrc || img.src || '',
      complete: img.complete,
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
      clientWidth: img.clientWidth,
      clientHeight: img.clientHeight,
    }));

    const placeholderCount =
      (text.match(/\uc0ac\uc9c4 \uc900\ube44\uc911/g) || []).length +
      (text.match(/\uc774\ubbf8\uc9c0 \uc900\ube44 \uc911/g) || []).length +
      (text.match(/\uc900\ube44 \uc911/g) || []).length;

    return {
      url: location.href,
      title: document.title,
      h1: document.querySelector('h1')?.textContent?.replace(/\s+/g, ' ').trim() || '',
      h2: [...document.querySelectorAll('h2')].map((h) => h.textContent?.replace(/\s+/g, ' ').trim()).filter(Boolean),
      destinationLinks: links.filter((link) => link.pathname.startsWith('/destinations/') && !link.pathname.startsWith('/destinations/region/')),
      imageCount: images.length,
      loadedImageCount: images.filter((image) => image.complete && image.naturalWidth > 0).length,
      placeholderCount,
      hasClimate: text.includes('\uc5ec\ud589 \uc2dc\uae30 \uc9c4\ub2e8'),
      hasAttractions: text.includes('\uaf2d \ubd10\uc57c \ud560 \ud544\uc218 \ucf54\uc2a4'),
      hasPackages: text.includes('\ucd94\ucc9c \ud328\ud0a4\uc9c0') || text.includes('\ud328\ud0a4\uc9c0') || text.includes('\uc0c1\ud488 \ubcf4\uae30'),
      hasMagazine: text.includes('\ub9e4\uac70\uc9c4') || text.includes('\uafc0\ud301'),
      textLength: normalizedText.length,
    };
  });

  if (options.screenshotPath) {
    await page.screenshot({ path: options.screenshotPath, fullPage: true });
  }

  return result;
}

async function main() {
  const base = getArg('base', DEFAULT_BASE).replace(/\/+$/, '');
  const outDir = getArg('out', DEFAULT_OUT);
  const limit = Number(getArg('limit', '0')) || 0;
  const noScreenshots = hasFlag('no-screenshots');
  await fs.mkdir(outDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: VIEWPORTS.desktop });

  const index = await scanPage(page, `${base}/destinations`, {
    screenshotPath: noScreenshots ? null : path.join(outDir, '00-index-desktop.png'),
  });

  const uniqueDestinations = [];
  const seen = new Set();
  for (const link of index.destinationLinks) {
    if (seen.has(link.pathname)) continue;
    seen.add(link.pathname);
    uniqueDestinations.push(link);
  }

  const detailLinks = limit > 0 ? uniqueDestinations.slice(0, limit) : uniqueDestinations;
  const rows = [];
  const pagesToScan = [
    { kind: 'index', label: 'destinations', url: `${base}/destinations` },
    ...REGION_SLUGS.map((slug) => ({ kind: 'region', label: slug, url: `${base}/destinations/region/${slug}` })),
    ...detailLinks.map((link) => ({ kind: 'detail', label: decodeURIComponent(link.pathname.replace('/destinations/', '')), url: link.href })),
  ];

  for (const item of pagesToScan) {
    const row = { kind: item.kind, label: item.label, url: item.url };
    for (const [viewportName, viewport] of Object.entries(VIEWPORTS)) {
      await page.setViewportSize(viewport);
      const filename = `${rows.length.toString().padStart(2, '0')}-${item.kind}-${slugify(item.label)}-${viewportName}.png`;
      const scanned = await scanPage(page, item.url, {
        screenshotPath: noScreenshots ? null : path.join(outDir, filename),
      });
      Object.assign(row, {
        [`${viewportName}_title`]: scanned.title,
        [`${viewportName}_h1`]: scanned.h1,
        [`${viewportName}_image_count`]: scanned.imageCount,
        [`${viewportName}_loaded_image_count`]: scanned.loadedImageCount,
        [`${viewportName}_placeholder_count`]: scanned.placeholderCount,
        [`${viewportName}_has_climate`]: scanned.hasClimate,
        [`${viewportName}_has_attractions`]: scanned.hasAttractions,
        [`${viewportName}_has_packages`]: scanned.hasPackages,
        [`${viewportName}_has_magazine`]: scanned.hasMagazine,
        [`${viewportName}_screenshot`]: noScreenshots ? '' : filename,
      });
    }
    rows.push(row);
  }

  await browser.close();

  const columns = [
    'kind',
    'label',
    'url',
    ...Object.keys(VIEWPORTS).flatMap((name) => [
      `${name}_title`,
      `${name}_h1`,
      `${name}_image_count`,
      `${name}_loaded_image_count`,
      `${name}_placeholder_count`,
      `${name}_has_climate`,
      `${name}_has_attractions`,
      `${name}_has_packages`,
      `${name}_has_magazine`,
      `${name}_screenshot`,
    ]),
  ];
  const csv = [columns.join(','), ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(','))].join('\n');
  await fs.writeFile(path.join(outDir, 'matrix.csv'), `${csv}\n`, 'utf8');

  const issueCounts = {
    pages: rows.length,
    placeholders: rows.filter((row) => Number(row.desktop_placeholder_count) > 0 || Number(row.mobile_placeholder_count) > 0).length,
    noLoadedDesktopImage: rows.filter((row) => Number(row.desktop_loaded_image_count) === 0).length,
    noClimate: rows.filter((row) => row.kind === 'detail' && row.desktop_has_climate === false).length,
    noAttractions: rows.filter((row) => row.kind === 'detail' && row.desktop_has_attractions === false).length,
  };

  const audit = `# Destinations Full Audit

- Base: ${base}
- Pages scanned: ${issueCounts.pages}
- Detail links discovered: ${uniqueDestinations.length}
- Placeholder pages: ${issueCounts.placeholders}
- Pages without loaded desktop images: ${issueCounts.noLoadedDesktopImage}
- Detail pages without climate card: ${issueCounts.noClimate}
- Detail pages without attraction section: ${issueCounts.noAttractions}

## Files

- \`matrix.csv\`: per-page desktop/mobile metrics.
- \`*.png\`: screenshots, unless \`--no-screenshots\` was used.

## Acceptance Focus

- Public destination cards should represent real destinations, not product titles or promo labels.
- Core hero/card areas should use approved destination, attraction, product, or blog imagery before falling back to a branded visual.
- Empty regions should show a clear waiting state instead of empty grids.
`;

  await fs.writeFile(path.join(outDir, 'audit.md'), audit, 'utf8');
  console.log(JSON.stringify({ outDir, ...issueCounts }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
