/**
 * @case ERR-BLOG-card-news-dead-image-url (2026-06-12)
 * @summary Card-news generated blog posts must filter dead slide image URLs
 * before using or persisting them.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

test('ERR-BLOG-card-news-dead-image-url: from-card-news route filters incoming slide URLs', () => {
  const route = read('src', 'app', 'api', 'blog', 'from-card-news', 'route.ts');

  assert.match(route, /filterReachableImageUrls/);
  assert.match(route, /requestedCardNewsImages/);
  assert.match(route, /const cardNewsImages = await filterReachableImageUrls\(requestedCardNewsImages\)/);
  assert.match(route, /slide_image_urls: cardNewsImages\.length > 0 \? cardNewsImages : undefined/);
  assert.match(route, /slide_image_urls: cardNewsImages/);
});

test('ERR-BLOG-card-news-dead-image-url: URL helper HEAD-probes and falls back to ranged GET', () => {
  const helper = read('src', 'lib', 'card-news-slide-urls.ts');

  assert.match(helper, /async function isReachableImageUrl/);
  assert.match(helper, /method: ['"]HEAD['"]/);
  assert.match(helper, /\[405, 501\]\.includes\(head\.status\)/);
  assert.match(helper, /method: ['"]GET['"]/);
  assert.match(helper, /Range: ['"]bytes=0-0['"]/);
  assert.match(helper, /export async function filterReachableImageUrls/);
});
