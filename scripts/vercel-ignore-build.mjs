#!/usr/bin/env node
/**
 * Vercel ignoreCommand: exit 0 skips, exit 1 builds.
 *
 * Compare the deployed head with the last successful deployment (or an
 * explicitly supplied PR base), never only HEAD^..HEAD. Unknown or shallow
 * history fails closed by proceeding with the build.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const DISABLED_VERCEL_PROJECT_IDS = new Set([
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

export function isIgnoredBuildPath(filePath) {
  return IGNORED_PATTERNS.some((pattern) => pattern.test(filePath));
}

function git(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function resolveCommit(revision, cwd) {
  if (!revision || /^0+$/.test(revision)) return null;
  try {
    git(['cat-file', '-e', `${revision}^{commit}`], cwd);
    return git(['rev-parse', `${revision}^{commit}`], cwd);
  } catch {
    return null;
  }
}

function resolveTargetRef(targetRef, cwd) {
  if (!targetRef) return null;
  for (const candidate of [`origin/${targetRef}`, targetRef]) {
    const commit = resolveCommit(candidate, cwd);
    if (commit) return commit;
  }
  return null;
}

export function parseGitNameStatusZ(output) {
  const tokens = output.split('\0').filter(Boolean);
  const paths = [];
  for (let index = 0; index < tokens.length;) {
    const status = tokens[index++];
    if (status.startsWith('R') || status.startsWith('C')) {
      paths.push(tokens[index++], tokens[index++]);
    } else {
      paths.push(tokens[index++]);
    }
  }
  return [...new Set(paths.filter(Boolean))];
}

export function resolveVercelComparisonRange({ env = process.env, cwd = process.cwd() } = {}) {
  const head = resolveCommit(env.VERCEL_GIT_COMMIT_SHA, cwd)
    || resolveCommit('HEAD', cwd);
  if (!head) return { ok: false, reason: 'deployment head commit is unavailable' };

  const explicitBase = env.VERCEL_GIT_BASE_SHA || env.VERCEL_GIT_PREVIOUS_SHA;
  const base = resolveCommit(explicitBase, cwd)
    || (!explicitBase
      ? resolveTargetRef(env.VERCEL_GIT_TARGET_REF || env.GITHUB_BASE_REF, cwd)
      : null);
  if (!base) {
    return {
      ok: false,
      reason: explicitBase
        ? 'comparison base is outside the available shallow history'
        : 'comparison base was not provided',
      head,
    };
  }

  try {
    const mergeBase = git(['merge-base', base, head], cwd);
    if (!mergeBase) return { ok: false, reason: 'merge base is unavailable', base, head };
    return { ok: true, base, head, mergeBase };
  } catch {
    return { ok: false, reason: 'comparison commits do not share available history', base, head };
  }
}

export function evaluateVercelIgnoreBuild({
  env = process.env,
  cwd = process.cwd(),
  logger = console.log,
} = {}) {
  if (DISABLED_VERCEL_PROJECT_IDS.has(env.VERCEL_PROJECT_ID || '')) {
    logger(`[ignore-build] disabled duplicate Vercel project ${env.VERCEL_PROJECT_ID} — skipping build`);
    return 0;
  }

  const range = resolveVercelComparisonRange({ env, cwd });
  if (!range.ok) {
    logger(`[ignore-build] ${range.reason}; proceeding with build`);
    return 1;
  }

  let changedPaths;
  try {
    const manifest = execFileSync('git', [
      'diff', '--name-status', '-z', '--find-renames', range.mergeBase, range.head,
    ], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    changedPaths = parseGitNameStatusZ(manifest);
  } catch {
    logger('[ignore-build] cannot inspect the complete deployment range; proceeding with build');
    return 1;
  }

  if (changedPaths.length === 0) {
    logger(`[ignore-build] no changes in ${range.mergeBase}..${range.head} — skipping build`);
    return 0;
  }
  const significantPaths = changedPaths.filter((filePath) => !isIgnoredBuildPath(filePath));
  if (significantPaths.length === 0) {
    logger(`[ignore-build] all ${changedPaths.length} files in the complete deployment range are ignored — skipping build`);
    return 0;
  }

  logger(`[ignore-build] ${significantPaths.length} significant file(s) changed in the complete deployment range — proceeding with build`);
  for (const filePath of significantPaths.slice(0, 10)) logger(`  + ${filePath}`);
  if (significantPaths.length > 10) logger(`  ... (+${significantPaths.length - 10} more)`);
  return 1;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === path.resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = evaluateVercelIgnoreBuild();
}
