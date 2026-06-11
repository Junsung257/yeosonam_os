/**
 * @case ERR-20260418-02
 * @summary Long supplier notice examples must not be collapsed into short
 * generic notices. Registration guards compare raw notice length to
 * notices_parsed length and keep retry/CoVe paths aware of the issue.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-20260418-02: business rules detect notices_parsed compression', () => {
  const source = read('src/lib/validators/package-rules.ts');

  assert.match(source, /W14/);
  assert.match(source, /ERR-20260418-02/);
  assert.match(source, /notices_parsed\.reduce/);
  assert.match(source, /parsedLen < rawLen \* 0\.5/);
  assert.match(source, /warnings\.push\(`\[W14 ERR-20260418-02\]/);
});

test('ERR-20260418-02: insert template keeps the same W14 guard for generated loaders', () => {
  const source = read('db/templates/insert-template.js');

  assert.match(source, /W14/);
  assert.match(source, /ERR-20260418-02/);
  assert.match(source, /notices_parsed\.reduce/);
  assert.match(source, /parsedLen < rawLen \* 0\.5/);
});

test('ERR-20260418-02: validation retry context documents the notice compression failure', () => {
  const source = read('src/lib/llm-validate-retry.ts');

  assert.match(source, /ERR-20260418-02/);
  assert.match(source, /callWithZodValidation/);
  assert.match(source, /ZodValidationRetryError/);
  assert.match(source, /criticOnSuccess/);
});
