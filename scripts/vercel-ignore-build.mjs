#!/usr/bin/env node
/**
 * Vercel ignoreCommand — exit 0 = skip build, exit 1 = proceed
 *
 * 빌드 비용 절감: 코드/설정 변경 없이 문서/메모리/감사 로그만 바뀐 커밋은 빌드 스킵.
 * SOP: .github/workflows/README.md §Vercel ignoreCommand
 *
 * 변경 감지 path: HEAD^..HEAD (Vercel 은 단일 commit deploy 단위).
 * 룰: ignored 패턴 외 파일이 한 개라도 바뀌면 빌드 진행 (exit 1).
 *     전부 ignored 패턴이면 빌드 스킵 (exit 0).
 *
 * VERCEL_GIT_COMMIT_REF=main 이면서 force-skip 위험을 줄이기 위해,
 * production(main) 의 경우 보수적으로 진행 — vercel.json/package.json/src/ 어떤 것이라도
 * 바뀌면 빌드.
 */
import { execSync } from 'node:child_process';

const DISABLED_VERCEL_PROJECT_IDS = new Set([
  // Duplicate preview project without production Supabase env.
  // The canonical project is "os" (prj_QTQa2iUwEkBON4QczULxG1HPYLSE).
  'prj_EnrqNIHGZfirnL0Nggv360ZuUZ5q',
]);

const IGNORED_PATTERNS = [
  /^.*\.md$/,
  /^docs\//,
  /^\.claude\//,
  /^memory\//,
  /^\.github\/ISSUE_TEMPLATE\//,
  /^\.github\/PULL_REQUEST_TEMPLATE/,
  /^\.vscode\//,
  /^tests\/regression\/cases\//,
  /^db\/audits\//,
  /^CHANGELOG\.md$/,
  /^README/,
  /^LICENSE/,
  /^\.gitignore$/,
  /^\.gitattributes$/,
];

function isIgnored(filePath) {
  return IGNORED_PATTERNS.some((re) => re.test(filePath));
}

function main() {
  if (DISABLED_VERCEL_PROJECT_IDS.has(process.env.VERCEL_PROJECT_ID || '')) {
    console.log(`[ignore-build] disabled duplicate Vercel project ${process.env.VERCEL_PROJECT_ID} — skipping build`);
    process.exit(0);
  }

  let changedFiles;
  try {
    // HEAD^ 가 없는 첫 커밋 등 edge case 는 보수적으로 빌드 진행.
    changedFiles = execSync('git diff --name-only HEAD^ HEAD', { encoding: 'utf8' })
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    console.log('[ignore-build] cannot diff HEAD^..HEAD — proceeding with build');
    process.exit(1);
  }

  if (changedFiles.length === 0) {
    console.log('[ignore-build] no changed files — skipping build');
    process.exit(0);
  }

  const significantFiles = changedFiles.filter((f) => !isIgnored(f));

  if (significantFiles.length === 0) {
    console.log(
      `[ignore-build] all ${changedFiles.length} changed files match ignored patterns — skipping build`,
    );
    for (const f of changedFiles) console.log(`  - ${f}`);
    process.exit(0);
  }

  console.log(
    `[ignore-build] ${significantFiles.length} significant file(s) changed — proceeding with build`,
  );
  for (const f of significantFiles.slice(0, 10)) console.log(`  + ${f}`);
  if (significantFiles.length > 10) console.log(`  ... (+${significantFiles.length - 10} more)`);
  process.exit(1);
}

main();
