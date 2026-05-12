/**
 * @case ERR-meal-empty-render (2026-04-27)
 * @summary 귀국일 등에서 meals 객체가 모두 false + note 빈 상태로 저장되면
 *   "조식 불포함 / 중식 불포함 / 석식 불포함" 3칸 그대로 노출되어 시각 잡음.
 *
 * 수정: hasAny = breakfast||lunch||dinner||any note → 모두 비면 섹션 숨김.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

function hasAnyMeal(meals) {
  if (!meals || typeof meals !== 'object') return false;
  if (meals.breakfast || meals.lunch || meals.dinner) return true;
  const notes = [meals.breakfast_note, meals.lunch_note, meals.dinner_note];
  return notes.some(n => typeof n === 'string' && n.trim().length > 0);
}

test('ERR-meal-empty-render: 모두 false + note 비어있음 → false', () => {
  assert.equal(hasAnyMeal({ breakfast: false, lunch: false, dinner: false }), false);
});

test('ERR-meal-empty-render: 조식 true → true', () => {
  assert.equal(hasAnyMeal({ breakfast: true, lunch: false, dinner: false }), true);
});

test('ERR-meal-empty-render: note 만 채워짐 → true (특별 식사 안내)', () => {
  assert.equal(hasAnyMeal({ breakfast: false, lunch: false, dinner: false, dinner_note: '클럽식' }), true);
});

test('ERR-meal-empty-render: note 빈 문자열 → false', () => {
  assert.equal(hasAnyMeal({ breakfast: false, lunch: false, dinner: false, lunch_note: '   ' }), false);
});

test('ERR-meal-empty-render: meals 자체 null → false', () => {
  assert.equal(hasAnyMeal(null), false);
  assert.equal(hasAnyMeal(undefined), false);
});

test('ERR-meal-empty-render: 셋 다 true → true', () => {
  assert.equal(hasAnyMeal({ breakfast: true, lunch: true, dinner: true }), true);
});
