/**
 * @case ERR-DESTINATION-active-view-drift (2026-06-29)
 * @summary Public destination URLs must not 404/500 just because
 * active_destinations lags behind approved travel_packages inventory.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

test('ERR-DESTINATION-active-view-drift: destination page metadata falls back to package inventory', () => {
  const source = read('src', 'app', 'destinations', '[city]', 'page.tsx');

  assert.match(source, /async function destinationHasPublicInventory/);
  assert.match(source, /destinationExistsForMetadata\(city\)/);
  assert.match(source, /\.from\('travel_packages'\)/);
  assert.match(source, /\.in\('status', \['approved', 'active'\]\)/);
  assert.match(source, /const packageMatch = \(\(packageRows \?\? \[\]\) as Array<\{ destination: string \| null \}>\)/);
  assert.match(source, /destinationSlugMatches\(destination, decoded\)/);
  assert.match(source, /const destinationExists = await destinationHasPublicInventory\(decoded\)/);
});

test('ERR-DESTINATION-active-view-drift: destination page renders package-backed cities even without active stats', () => {
  const source = read('src', 'app', 'destinations', '[city]', 'page.tsx');
  const alivePackagesIndex = source.indexOf('const alivePkgs = ((packages');
  const nullGateIndex = source.indexOf('if (!stat && alivePkgs.length === 0) return null;');

  assert.ok(alivePackagesIndex > 0, 'package fallback list should be computed');
  assert.ok(nullGateIndex > alivePackagesIndex, 'null gate should wait for package fallback evidence');
  assert.match(source, /Math\.trunc\(getFiniteNumber\(\(stat as Record<string, unknown> \| null\)\?\.package_count\) \?\? alivePkgs\.length\)/);
  assert.match(source, /const prices = alivePkgs/);
  assert.match(source, /const fallbackMinPrice = prices\.length > 0 \? Math\.min\(\.\.\.prices\) : null/);
  assert.match(source, /minPrice: getFiniteNumber\(\(stat as Record<string, unknown> \| null\)\?\.min_price\) \?\? fallbackMinPrice/);
});

test('ERR-DESTINATION-active-view-drift: middleware public destination guard uses the same package fallback', () => {
  const source = read('src', 'middleware.ts');

  assert.match(source, /async function packageDestinationExists/);
  assert.match(source, /\.from\('travel_packages'\)|\/rest\/v1\/travel_packages/);
  assert.match(source, /endpoint\.searchParams\.set\('status', 'in\.\(approved,active\)'\)/);
  assert.match(source, /endpoint\.searchParams\.set\('select', 'destination'\)/);
  assert.match(source, /const targetSlug = destinationSlugFromRouteValue\(destinationOrSlug\)/);
  assert.match(source, /destinationSlugFromRouteValue\(destination\) === targetSlug/);
  assert.match(source, /async function publicDestinationExists/);
  assert.match(source, /const active = await activeDestinationExists\(destinationOrSlug\)/);
  assert.match(source, /return packageDestinationExists\(destinationOrSlug\)/);
});

test('ERR-DESTINATION-active-view-drift: destination metadata API is public for GET only', () => {
  const source = read('src', 'middleware.ts');

  assert.match(source, /pathname\.startsWith\('\/api\/destinations\/'\)/);
  assert.match(source, /return request\.method === 'GET'/);
  assert.match(source, /segments\.length === 3/);
  assert.match(source, /!\['hero-photo', 'meta-list'\]\.includes\(routeName\)/);
});

test('ERR-DESTINATION-active-view-drift: sitemap excludes destinations without public package count evidence', () => {
  const source = read('src', 'app', 'sitemap.ts');

  assert.match(source, /select\('destination, package_count'\)/);
  assert.match(source, /function getSafeSitemapDestination/);
  assert.match(source, /row\.package_count == null \? null : Number\(row\.package_count\)/);
  assert.match(source, /packageCount <= 0/);
});
