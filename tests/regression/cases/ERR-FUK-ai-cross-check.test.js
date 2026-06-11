/**
 * @case ERR-FUK-ai-cross-check
 * @summary optional AI cross-check must compare raw supplier text to rendered customer text with a monthly cost cap.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-FUK-ai-cross-check: AI audit is opt-in and capped', () => {
  const source = read('db/post_register_audit.js');

  assert.match(source, /const \{ aiCrossCheck \} = require\('\.\/ai_audit_helper\.js'\)/);
  assert.match(source, /POST_AUDIT_AI === '1'/);
  assert.match(source, /process\.argv\.includes\('--ai'\)/);
  assert.match(source, /AI_MONTHLY_CAP_KRW/);
  assert.match(source, /shouldCallGemini/);
});

test('ERR-FUK-ai-cross-check: AI findings become audit warnings with missing, distorted, and hallucinated buckets', () => {
  const source = read('db/post_register_audit.js');

  assert.match(source, /aiCrossCheck\(pkg\.raw_text, renderedText, pkg\.title\)/);
  assert.match(source, /result\.ai = ai/);
  assert.match(source, /missing_from_render/);
  assert.match(source, /distorted_in_render/);
  assert.match(source, /hallucinated_in_render/);
});
