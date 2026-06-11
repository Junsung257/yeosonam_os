/**
 * @case ERR-20260418-08
 * @summary Optional tours must not be duplicated across page 1 and the final
 * A4/print page.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function count(source, needle) {
  return source.split(needle).length - 1;
}

test('ERR-20260418-08: public print page renders optional tours in only one page branch', () => {
  const source = read('src/app/itinerary/[id]/print/page.tsx');

  assert.match(source, /const page1Days = days\.slice\(0, page1DayCount\)/);
  assert.match(source, /const page2Days = days\.slice\(page1DayCount\)/);
  assert.match(source, /const optTours = itineraryForRender\.optional_tours \?\? \[\]/);

  assert.match(source, /page2Days\.length === 0 && optTours\.length > 0 && \(/);
  assert.match(source, /page2Days\.length > 0 && \(/);

  const page2Start = source.indexOf('{page2Days.length > 0 && (');
  assert.notEqual(page2Start, -1, 'page 2 branch should be explicit');
  const page2Branch = source.slice(page2Start);
  assert.match(page2Branch, /optTours\.length > 0 && \(/);

  assert.equal(
    count(source, 'optTours.map((t, i) => ('),
    2,
    'print page should have exactly one optional-tour renderer per mutually exclusive branch',
  );
});

test('ERR-20260418-08: admin A4 template keeps optional tours off the last notice page', () => {
  const source = read('src/components/admin/YeosonamA4Template.tsx');

  assert.equal(
    count(source, '<OptionalTours tours={view.optionalTours.flat} />'),
    1,
    'admin A4 should render the shared optional tour block only once',
  );
  assert.match(source, /view\.optionalTours\.count > 0 && <OptionalTours tours=\{view\.optionalTours\.flat\} \/>/);
  assert.match(source, /ERR-20260418-08/);

  const lastPageStart = source.indexOf('{hasLastPage && (');
  assert.notEqual(lastPageStart, -1, 'last page branch should be explicit');
  const lastPageBranch = source.slice(lastPageStart, source.indexOf('function PriceTable', lastPageStart));
  assert.doesNotMatch(lastPageBranch, /<OptionalTours tours=\{view\.optionalTours\.flat\} \/>/);
});
