import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const APP_DIR = join(ROOT, 'src', 'app');

const PUBLIC_API_PREFIXES = [
  'src/app/api/affiliate/public/',
  'src/app/api/v1/packages/',
  'src/app/api/rss/',
];

const PUBLIC_API_FILES = new Set([
  'src/app/api/packages/route.ts',
  'src/app/api/packages/search/route.ts',
  'src/app/api/packages/[id]/reviews/route.ts',
  'src/app/api/packages/[id]/terms/route.ts',
]);

const SNAPSHOT_OR_STRIP_MARKERS = [
  'fetchLatestPublicPackageSnapshot',
  'fetchAndMergeCurrentPublicPackageCardSnapshots',
  'sanitizeCustomerPackageForClient',
  'stripRawPackageDataFromBlogListPosts',
];

function toPosixPath(path: string): string {
  return path.split(sep).join('/');
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) return walk(fullPath);
    return /\.(ts|tsx)$/.test(entry) ? [fullPath] : [];
  });
}

function isTestFile(path: string): boolean {
  return /\.(test|spec)\.(ts|tsx)$/.test(path);
}

function isPublicCustomerSurface(path: string): boolean {
  const normalized = toPosixPath(relative(ROOT, path));
  if (isTestFile(normalized)) return false;
  if (normalized.includes('/admin/')) return false;
  if (normalized.startsWith('src/app/api/')) {
    return PUBLIC_API_FILES.has(normalized) ||
      PUBLIC_API_PREFIXES.some(prefix => normalized.startsWith(prefix));
  }
  return normalized.startsWith('src/app/');
}

function readsOrRendersPackageData(source: string): boolean {
  return [
    ".from('travel_packages')",
    '.from("travel_packages")',
    'travel_packages(',
    'travel_packages!',
    'travel_packages?.',
  ].some(pattern => source.includes(pattern));
}

describe('public customer package data boundary', () => {
  it('requires public snapshots or explicit stripping before customer surfaces touch package data', () => {
    const offenders = walk(APP_DIR)
      .filter(isPublicCustomerSurface)
      .map((file) => {
        const source = readFileSync(file, 'utf8');
        const normalized = toPosixPath(relative(ROOT, file));
        return { file: normalized, source };
      })
      .filter(({ source }) => readsOrRendersPackageData(source))
      .filter(({ source }) => !SNAPSHOT_OR_STRIP_MARKERS.some(marker => source.includes(marker)))
      .map(({ file }) => file);

    expect(offenders).toEqual([]);
  });
});
