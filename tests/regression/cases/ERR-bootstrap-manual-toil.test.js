/**
 * @case ERR-bootstrap-manual-toil (2026-04-27)
 * @summary 신규 지역 어셈블러 수기 작성 → 60~120분 토큰 소비 + BLOCKS 누락 위험.
 *
 * 수정: db/auto_bootstrap_assembler.js — 등록 상품 itinerary 에서 ▶... 활동 자동 추출,
 *   이름 정규화 + 키워드 토큰화 + 타입 추정 + slug 생성.
 *
 * 회귀: 추출 헬퍼 함수들을 단위 테스트.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

// auto_bootstrap_assembler.js 의 헬퍼들 (테스트용 추출)

function extractAttractionName(activity) {
  if (!activity || typeof activity !== 'string') return null;
  let s = activity.replace(/^[▶◆●■★]/, '').trim();
  s = s.replace(/[\(（].*?[\)）]/g, '').trim();
  const m = s.match(/(?:는|의|한|된|되는|이는|되어|위치한|꼽히는|불리는|이루어진|구성된|만들어진|남아있는|볼\s*수\s*있는|느껴보는|걸어보는|활기찬|아름다운|역사적인|핵심적인|숨겨진|조성된)\s+([가-힣A-Za-z0-9·\-+]+(?:\s*[가-힣A-Za-z0-9]+){0,3})$/);
  if (m && m[1]) return m[1].trim();
  if (s.length <= 15) return s;
  const tokens = s.split(/\s+/);
  if (tokens.length > 0) return tokens[tokens.length - 1].trim();
  return s;
}

function autoKeywords(name) {
  const out = new Set();
  if (!name) return [];
  out.add(name);
  out.add(name.replace(/\s+/g, ''));
  const firstToken = name.split(/[\s\(]/)[0];
  if (firstToken && firstToken !== name) out.add(firstToken);
  return [...out].filter(k => k && k.length >= 2);
}

function guessBlockType(activity) {
  const a = String(activity || '');
  if (/마사지|발마사지|전신마사지|spa/i.test(a)) return 'massage';
  if (/쇼핑|면세|토산|기념품/.test(a)) return 'shopping';
  if (/야시장|야경|불야성|night/i.test(a)) return 'night';
  if (/식|중식|석식|조식|레스토랑/.test(a)) return 'meal';
  if (/공항|체크인|체크아웃|출발|도착/.test(a)) return 'transfer';
  return 'sightseeing';
}

function slugify(region, destCode) {
  if (destCode) return destCode.toLowerCase();
  return region.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// ── extractAttractionName ──
test('ERR-bootstrap-manual-toil: "▶중국 청도 10경으로 꼽히는 잔교" → "잔교"', () => {
  assert.equal(extractAttractionName('▶중국 청도 10경으로 꼽히는 잔교'), '잔교');
});

test('ERR-bootstrap-manual-toil: "▶100년 청도 맥주의 역사를 볼 수 있는 맥주박물관 (...)" → "맥주박물관"', () => {
  const r = extractAttractionName('▶100년 청도 맥주의 역사를 볼 수 있는 맥주박물관 (칭따오 맥주원액1잔+생맥1잔+땅콩안주 증정)');
  assert.equal(r, '맥주박물관');
});

test('ERR-bootstrap-manual-toil: 짧은 이름 → 그대로', () => {
  assert.equal(extractAttractionName('▶잔교'), '잔교');
});

test('ERR-bootstrap-manual-toil: null/빈 → null', () => {
  assert.equal(extractAttractionName(null), null);
  assert.equal(extractAttractionName(''), null);
});

// ── autoKeywords ──
test('ERR-bootstrap-manual-toil: "맥주박물관" → ["맥주박물관"]', () => {
  const kw = autoKeywords('맥주박물관');
  assert.ok(kw.includes('맥주박물관'));
});

test('ERR-bootstrap-manual-toil: "노산 (양구코스)" → 첫 토큰 + 전체', () => {
  const kw = autoKeywords('노산 (양구코스)');
  assert.ok(kw.includes('노산'));
});

test('ERR-bootstrap-manual-toil: 길이 1 키워드 제거', () => {
  const kw = autoKeywords('가');
  assert.equal(kw.length, 0);
});

// ── guessBlockType ──
test('ERR-bootstrap-manual-toil: "발마사지 60분" → massage', () => {
  assert.equal(guessBlockType('▶여행의 피로를 녹여주는 발마사지 60분'), 'massage');
});

test('ERR-bootstrap-manual-toil: "쇼핑: 라텍스" → shopping', () => {
  assert.equal(guessBlockType('쇼핑: 라텍스, 침향, 찻집, 진주 등'), 'shopping');
});

test('ERR-bootstrap-manual-toil: "청양야시장" → night', () => {
  assert.equal(guessBlockType('▶청도의 핵심 도시 청양의 활발한 시장 청양야시장'), 'night');
});

test('ERR-bootstrap-manual-toil: "잔교" → sightseeing (기본값)', () => {
  assert.equal(guessBlockType('▶중국 청도 10경으로 꼽히는 잔교'), 'sightseeing');
});

test('ERR-bootstrap-manual-toil: "공항 도착" → transfer', () => {
  assert.equal(guessBlockType('청도공항 도착 후 가이드 미팅'), 'transfer');
});

// ── slugify ──
test('ERR-bootstrap-manual-toil: destCode 우선', () => {
  assert.equal(slugify('장가계', 'DYG'), 'dyg');
});

test('ERR-bootstrap-manual-toil: destCode 없으면 region 정규화', () => {
  assert.equal(slugify('Zhang Jia Jie', null), 'zhangjiajie');
});

test('ERR-bootstrap-manual-toil: 한글만 region → 공백 제거', () => {
  assert.equal(slugify('장가계', null), '');  // 한글 제거 후 빈 문자열 (실제로는 destCode 필수)
});
