/**
 * @case ERR-date-confusion
 * @summary Bare publication/version dates must not be interpreted as
 * ticketing_deadline unless the source contains booking/ticketing context.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-date-confusion: LLM normalization prompt forbids mapping bare version dates to ticketingDeadline', () => {
  const source = read('src/lib/normalize-with-llm.ts');
  const parser = read('src/lib/parser.ts');

  assert.match(source, /R3\./);
  assert.match(source, /발권\/예약 마감\/티켓팅/);
  assert.match(source, /단순 버전일·배포일/);
  assert.match(source, /ticketingDeadline.*null/);
  assert.match(parser, /ticketing_deadline/);
  assert.match(parser, /연도 추론/);
  assert.match(parser, /발권 마감일/);
});

test('ERR-date-confusion: standard markdown parser does not invent deadline from relative text', () => {
  const unitTest = read('src/lib/standard-product-markdown.test.ts');
  const source = read('src/lib/standard-product-markdown.ts');

  assert.match(source, /ticketing_deadline/);
  assert.match(unitTest, /extractedData\.ticketing_deadline/);
  assert.match(unitTest, /toBeUndefined\(\)/);
});
