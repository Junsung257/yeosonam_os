/**
 * @case ERR-BLOG-prompt-highlight-regression (2026-06-22)
 * @summary Blog generation prompts must not ask the model to create legacy
 * ==highlight== markers after the visual accent policy removed highlights.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

test('ERR-BLOG-prompt-highlight-regression: publisher prompt bans highlight markers and requires stable tables', () => {
  const source = read('src', 'app', 'api', 'cron', 'blog-publisher', 'route.ts');
  const promptStart = source.indexOf('## 공통 출력 규칙');
  assert.notEqual(promptStart, -1);
  const promptBlock = source.slice(promptStart, promptStart + 1200);

  assert.doesNotMatch(promptBlock, /==\.\.\.==\s*로\s*감싸/);
  assert.match(promptBlock, /==\.\.\.==, <mark>, 형광펜식 하이라이트 금지/);
  assert.match(promptBlock, /표는 반드시 GitHub Flavored Markdown 형식/);
  assert.match(promptBlock, /표 행 사이에 빈 줄을 넣지 말 것/);
});
