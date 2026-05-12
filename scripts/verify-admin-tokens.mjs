#!/usr/bin/env node
/**
 * verify-admin-tokens.mjs
 *
 * tailwind.config.js 와 globals.css 가 디자인 시스템 v2 (Linear/Stripe 톤) 에
 * 필요한 admin-* 토큰을 모두 정의하고 있는지 검증.
 *
 * 다른 세션이 stale-cache 로 tailwind.config 를 덮어쓰면 admin-* 클래스가
 * Tailwind 에 정의되지 않은 상태가 되고 → 사이트 전체가 시각적으로 회귀.
 * TypeScript 는 통과하므로 무음 회귀 — 이 스크립트가 그것을 잡는다.
 *
 * 사용:
 *   node scripts/verify-admin-tokens.mjs
 *   exit code 1 = 토큰 누락 (CI/pre-commit 에서 fail)
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

// ─── 검증 룰 ───
// tailwind.config.js 안에서 발견되어야 하는 키 (객체 키 또는 따옴표 안)
const REQUIRED_TAILWIND_KEYS = [
  // colors.admin
  "'surface-2'",      // bg-admin-surface-2
  "'border-mid'",     // border-admin-border-mid
  "'border-strong'",  // border-admin-border-strong
  "'text-2'",         // text-admin-text-2
  "'muted-2'",        // text-admin-muted-2
  // fontSize
  "'admin-2xs'", "'admin-h1'", "'admin-h2'", "'admin-h3'", "'admin-display'",
  // borderRadius
  "'admin-xs'", "'admin-sm'", "'admin-md'", "'admin-lg'",
  // boxShadow
  "'admin-xs'", "'admin-sm'", "'admin-md'", "'admin-lg'", "'admin-xl'",
  "'admin-focus'", "'admin-focus-danger'",
  // 폰트 패밀리 (mono)
  'fontFamily',
  // darkMode
  "darkMode",
];

// globals.css 안에서 발견되어야 하는 CSS 변수
const REQUIRED_CSS_VARS = [
  '--admin-bg', '--admin-surface', '--admin-surface-2',
  '--admin-border', '--admin-border-mid', '--admin-border-strong',
  '--admin-text', '--admin-text-2', '--admin-muted', '--admin-muted-2',
  '--admin-profit', '--admin-loss',
];

// globals.css 안에서 발견되어야 하는 CSS 클래스
const REQUIRED_CSS_CLASSES = [
  '.admin-scope',
  '.admin-scope table.admin-data-table',
  '.admin-card',
  '.admin-zebra',
];

let failed = false;

function check(label, file, required, content) {
  const missing = required.filter((k) => !content.includes(k));
  if (missing.length === 0) {
    console.log(`✅ ${label} (${required.length}개 모두 정의됨)`);
  } else {
    failed = true;
    console.log(`❌ ${label} — ${missing.length}개 누락:`);
    missing.forEach((k) => console.log(`   • ${k}`));
    console.log(`   👉 ${file} 가 다른 세션에 의해 덮어써졌을 가능성. 즉시 복구 필요.`);
  }
}

console.log('─── admin 토큰 무결성 검증 ───\n');

try {
  const tw = readFileSync(join(ROOT, 'tailwind.config.js'), 'utf-8');
  check('tailwind.config.js admin 토큰', 'tailwind.config.js', REQUIRED_TAILWIND_KEYS, tw);
} catch (e) {
  failed = true;
  console.log(`❌ tailwind.config.js 를 읽을 수 없습니다: ${e.message}`);
}

try {
  const css = readFileSync(join(ROOT, 'src/app/globals.css'), 'utf-8');
  check('globals.css CSS 변수', 'src/app/globals.css', REQUIRED_CSS_VARS, css);
  check('globals.css admin-scope 클래스', 'src/app/globals.css', REQUIRED_CSS_CLASSES, css);
} catch (e) {
  failed = true;
  console.log(`❌ globals.css 를 읽을 수 없습니다: ${e.message}`);
}

console.log('');
if (failed) {
  console.log('🚨 토큰 무결성 깨짐 — 디자인 시스템이 회귀했습니다.');
  console.log('   조치: docs/design-system/tokens.md 의 정의를 참고해 즉시 복구하거나,');
  console.log('         git checkout 으로 마지막 정상 커밋의 tailwind.config.js 를 가져오세요.');
  process.exit(1);
}

console.log('🟢 admin 토큰 무결성 정상.');
process.exit(0);
