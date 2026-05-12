#!/usr/bin/env node
/**
 * 어드민 hardcoded 토큰 → admin-* 토큰 일괄 치환
 *
 * 범위:
 *  - src/app/admin/**\/*.{ts,tsx}
 *  - src/app/m/admin/**\/*.{ts,tsx}
 *  - src/components/admin/**\/*.{ts,tsx}
 *  - src/components/AdminLayout.tsx (이미 처리됨)
 *
 * slate-* / gray-* 색상 토큰은 admin-* 와 거의 동일 (slate-500 ↔ admin-muted 등).
 * 시각 변화는 미미하나 어드민 디자인 시스템 SSOT 통일 효과 큼.
 *
 * 사용:
 *   node scripts/migrate-admin-tokens.mjs --dry-run  # 미리보기
 *   node scripts/migrate-admin-tokens.mjs            # 적용
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const DRY_RUN = process.argv.includes('--dry-run');
const ROOT = process.cwd();

// ── 치환 룰 (적용 순서 중요: 더 구체적인 규칙 먼저) ──
// 변경 가능한 토큰만 — bg-white 같은 모호한 케이스는 제외
const RULES = [
  // text — slate
  [/\btext-slate-50\b/g,  'text-admin-bg'],
  [/\btext-slate-100\b/g, 'text-admin-surface-2'],
  [/\btext-slate-200\b/g, 'text-admin-border-mid'],
  [/\btext-slate-300\b/g, 'text-admin-muted-2'],
  [/\btext-slate-400\b/g, 'text-admin-muted-2'],
  [/\btext-slate-500\b/g, 'text-admin-muted'],
  [/\btext-slate-600\b/g, 'text-admin-muted'],
  [/\btext-slate-700\b/g, 'text-admin-text-2'],
  [/\btext-slate-800\b/g, 'text-admin-text-2'],
  [/\btext-slate-900\b/g, 'text-admin-text'],

  // text — gray (slate와 거의 동일 매핑)
  [/\btext-gray-300\b/g, 'text-admin-muted-2'],
  [/\btext-gray-400\b/g, 'text-admin-muted-2'],
  [/\btext-gray-500\b/g, 'text-admin-muted'],
  [/\btext-gray-600\b/g, 'text-admin-muted'],
  [/\btext-gray-700\b/g, 'text-admin-text-2'],
  [/\btext-gray-800\b/g, 'text-admin-text-2'],
  [/\btext-gray-900\b/g, 'text-admin-text'],

  // border — slate
  [/\bborder-slate-100\b/g, 'border-admin-border'],
  [/\bborder-slate-200\b/g, 'border-admin-border-mid'],
  [/\bborder-slate-300\b/g, 'border-admin-border-strong'],

  // border — gray
  [/\bborder-gray-100\b/g, 'border-admin-border'],
  [/\bborder-gray-200\b/g, 'border-admin-border-mid'],
  [/\bborder-gray-300\b/g, 'border-admin-border-strong'],

  // bg — slate (50/100만)
  [/\bbg-slate-50\b/g,  'bg-admin-bg'],
  [/\bbg-slate-100\b/g, 'bg-admin-surface-2'],

  // bg — gray (50/100만)
  [/\bbg-gray-50\b/g,  'bg-admin-bg'],
  [/\bbg-gray-100\b/g, 'bg-admin-surface-2'],

  // hover/focus 변형도 함께 (가장 흔한 패턴만 — 모든 변형 다루면 false positive 위험)
  [/\bhover:text-slate-500\b/g, 'hover:text-admin-muted'],
  [/\bhover:text-slate-700\b/g, 'hover:text-admin-text-2'],
  [/\bhover:text-slate-900\b/g, 'hover:text-admin-text'],
  [/\bhover:text-gray-500\b/g,  'hover:text-admin-muted'],
  [/\bhover:text-gray-700\b/g,  'hover:text-admin-text-2'],
  [/\bhover:text-gray-900\b/g,  'hover:text-admin-text'],
  [/\bhover:bg-slate-50\b/g,  'hover:bg-admin-bg'],
  [/\bhover:bg-slate-100\b/g, 'hover:bg-admin-surface-2'],
  [/\bhover:bg-gray-50\b/g,   'hover:bg-admin-bg'],
  [/\bhover:bg-gray-100\b/g,  'hover:bg-admin-surface-2'],
  [/\bhover:border-slate-200\b/g, 'hover:border-admin-border-mid'],
  [/\bhover:border-slate-300\b/g, 'hover:border-admin-border-strong'],
  [/\bhover:border-gray-200\b/g,  'hover:border-admin-border-mid'],
  [/\bhover:border-gray-300\b/g,  'hover:border-admin-border-strong'],
];

// 2차 sweep — 라디우스 / 쉐도우 (시각 변화 있음, Linear 톤 강제)
// 별도 RULES 로 분리해서 'rounded-radii' 옵션으로만 적용
const RADII_RULES = [
  // rounded — 어드민에선 Linear 톤 (4-10px)
  [/\brounded-xl\b/g,  'rounded-admin-md'],   // 12px → 8px
  [/\brounded-2xl\b/g, 'rounded-admin-lg'],   // 16px → 10px
  // rounded-lg(8px) 는 admin-md(8px) 와 같으므로 의미 변화는 없음
  // rounded-md(6px) 는 admin-sm(6px) 와 같음
  // rounded-sm(2px), rounded(4px) 등 작은 건 그대로 둠

  // shadow — Linear 톤 (subtle hairline + 미세 그림자)
  [/\bshadow-sm\b/g,   'shadow-admin-xs'],
  [/\bshadow-md\b/g,   'shadow-admin-sm'],
  [/\bshadow-lg\b/g,   'shadow-admin-md'],
  [/\bshadow-xl\b/g,   'shadow-admin-lg'],
];

const APPLY_RADII = !process.argv.includes('--no-radii');
if (APPLY_RADII) RULES.push(...RADII_RULES);

// ── 대상 파일 수집 ──
const TARGET_DIRS = [
  'src/app/admin',
  'src/app/m/admin',
  'src/components/admin',
];

const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', '.git']);

function walk(dir, files = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return files; }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) walk(full, files);
    else if (st.isFile()) {
      const ext = extname(full);
      if (ext === '.ts' || ext === '.tsx') files.push(full);
    }
  }
  return files;
}

const targetFiles = TARGET_DIRS.flatMap((d) => walk(join(ROOT, d)));
console.log(`📁 ${targetFiles.length} files in scope`);
if (DRY_RUN) console.log('🧪 DRY RUN — no files written\n');

let totalReplacements = 0;
const fileStats = []; // [{ file, count, byRule: Map }]

for (const file of targetFiles) {
  let src;
  try { src = readFileSync(file, 'utf-8'); } catch { continue; }
  let next = src;
  let count = 0;
  const byRule = new Map();

  for (const [pattern, replacement] of RULES) {
    const matches = next.match(pattern);
    if (matches) {
      next = next.replace(pattern, replacement);
      count += matches.length;
      byRule.set(pattern.source, (byRule.get(pattern.source) || 0) + matches.length);
    }
  }

  if (count > 0) {
    fileStats.push({ file: file.replace(ROOT + '\\', '').replace(ROOT + '/', ''), count, byRule });
    totalReplacements += count;
    if (!DRY_RUN) writeFileSync(file, next, 'utf-8');
  }
}

// ── 보고 ──
console.log(`\n✅ ${fileStats.length} files ${DRY_RUN ? 'would be changed' : 'changed'}, ${totalReplacements} replacements\n`);

// 상위 20개 파일
fileStats
  .sort((a, b) => b.count - a.count)
  .slice(0, 20)
  .forEach((s) => {
    console.log(`  ${String(s.count).padStart(4)}  ${s.file}`);
  });

// 룰별 통계
const ruleTotals = new Map();
for (const s of fileStats) {
  for (const [rule, n] of s.byRule) {
    ruleTotals.set(rule, (ruleTotals.get(rule) || 0) + n);
  }
}
console.log('\n📊 By rule:');
[...ruleTotals.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, 15)
  .forEach(([rule, n]) => {
    console.log(`  ${String(n).padStart(4)}  ${rule}`);
  });

if (DRY_RUN) console.log('\n→ 실행하려면 --dry-run 빼고 다시 실행');
