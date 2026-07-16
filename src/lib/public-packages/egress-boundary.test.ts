import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { PUBLIC_EGRESS_MANIFEST } from './egress-manifest';

const ROOT = process.cwd();
const PUBLICATION_EGRESS_PREFIXES = [
  'src/app/api/admin/ad-os/',
  'src/app/api/content-gaps/',
  'src/app/api/content-hub/',
  'src/app/api/content-queue/',
  'src/app/api/cron/card-news-seasonal/',
  'src/app/api/cron/trend-topic-miner/',
  'src/app/api/cron/threads-trend-miner/',
  'src/app/api/cron/blog-publisher/',
  'src/app/api/cron/blog-regenerate-zero-click/',
  'src/app/api/cron/blog-lifecycle/',
  'src/app/api/content-analytics/',
  'src/app/admin/blog/',
  'src/lib/social-publishing/',
];

function toPosixPath(value: string): string {
  return value.split(path.sep).join('/');
}

function walkFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) return walkFiles(full);
    return /\.(ts|tsx)$/.test(entry) && !/\.(test|spec)\.(ts|tsx)$/.test(entry)
      ? [full]
      : [];
  });
}

function readsPackageTable(source: string): boolean {
  return [
    ".from('travel_packages')",
    '.from("travel_packages")',
    'travel_packages(',
    'travel_packages!',
    '/rest/v1/travel_packages',
  ].some(pattern => source.includes(pattern));
}

describe('public package egress boundary', () => {
  it('keeps every declared egress path owned and reviewable', () => {
    const files = new Set<string>();
    for (const entry of PUBLIC_EGRESS_MANIFEST) {
      expect(files.has(entry.file), `duplicate manifest entry: ${entry.file}`).toBe(false);
      files.add(entry.file);
      expect(fs.existsSync(path.join(ROOT, entry.file)), `missing file: ${entry.file}`).toBe(true);
      expect(entry.owner.trim()).not.toBe('');
      expect(entry.lastVerifiedCommit.trim()).not.toBe('');
      if (entry.classification) {
        expect(entry.reason?.trim(), `${entry.file} must explain its egress classification`).toBeTruthy();
        expect(entry.reviewBy, `${entry.file} must have a review date`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(entry.allowedFields?.length, `${entry.file} must declare allowed raw/projection fields`).toBeGreaterThan(0);
      }
      if (entry.rawRead === 'internal') {
        expect(entry.audience).toBe('internal');
        expect(entry.canExport).toBe(false);
        expect(entry.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }
  });

  it('requires the central read model for every external projection consumer', () => {
    for (const entry of PUBLIC_EGRESS_MANIFEST.filter(item => item.projection !== 'none')) {
      const source = fs.readFileSync(path.join(ROOT, entry.file), 'utf8');
      expect(source, `${entry.file} must use the central public read model`).toMatch(
        /(?:@\/lib\/public-packages|\.\/public-packages|\.\.\/public-packages|@\/lib\/content-public-package|buildAndSaveSearchAdPackagePlan)/,
      );
      expect(source, `${entry.file} must not fall back from a projection to raw package copy`).not.toMatch(
        /(?:card_projection|marketing_projection|partner_projection|public_api_projection)[^\n]*\?\?[^\n]*(?:travelPackage|travel_packages|rawPackage)/,
      );
      expect(source, `${entry.file} must not bypass the promoted pointer views`).not.toContain(
        ".from('public_package_snapshots')",
      );
      if (entry.rawRead === 'forbidden') {
        expect(source, `${entry.file} must not join raw customer copy`).not.toMatch(
          /travel_packages(?:!inner|:package_id)?\s*\([^)]*(?:title|destination|product_summary|price|price_dates|ticketing_deadline|optional_tours|itinerary_data|status)/s,
        );
        expect(source, `${entry.file} must not read travel_packages`).not.toContain(".from('travel_packages')");
        expect(source, `${entry.file} must not embed travel_packages joins`).not.toContain('travel_packages(');
      }
    }
  });

  it('requires every publication route that touches packages to be declared in the egress manifest', () => {
    const declared = new Set(PUBLIC_EGRESS_MANIFEST.map(entry => entry.file));
    const candidates = PUBLICATION_EGRESS_PREFIXES.flatMap(prefix =>
      walkFiles(path.join(ROOT, prefix)),
    );
    const offenders = candidates
      .map(file => ({
        file: toPosixPath(path.relative(ROOT, file)),
        source: fs.readFileSync(file, 'utf8'),
      }))
      .filter(({ source }) => readsPackageTable(source))
      .filter(({ file }) => !declared.has(file))
      .map(({ file }) => file);

    expect(offenders).toEqual([]);
  });

  it('routes legacy customer Jarvis product requests through the public concierge boundary', () => {
    const source = fs.readFileSync(
      path.join(ROOT, 'src/lib/jarvis/agents/products.ts'),
      'utf8',
    );
    expect(source).toContain("params.ctx?.surface === 'customer'");
    expect(source).toContain('return runConciergeAgent(params)');
    const legacyRoute = fs.readFileSync(path.join(ROOT, 'src/app/api/jarvis/route.ts'), 'utf8');
    const v2Dispatch = fs.readFileSync(path.join(ROOT, 'src/lib/jarvis/v2-dispatch.ts'), 'utf8');
    expect(legacyRoute).toContain("ctx.surface === 'customer' ? 'products'");
    expect(v2Dispatch).toContain("input.ctx.surface === 'customer' ? 'products'");
  });
});
