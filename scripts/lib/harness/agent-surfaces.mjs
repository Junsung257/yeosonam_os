import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const GLOB_TOKEN = /[*?[]/u;

export function normalizeRepoPath(value) {
  return String(value).replaceAll('\\', '/').replace(/^\.\//u, '');
}

function validatePattern(pattern, label, failures) {
  if (typeof pattern !== 'string' || !pattern.trim()) {
    failures.push(`${label} must contain non-empty strings`);
    return;
  }
  const normalized = normalizeRepoPath(pattern);
  if (normalized.startsWith('/') || /^[A-Za-z]:\//u.test(normalized) || normalized.split('/').includes('..')) {
    failures.push(`${label} must be repository-relative: ${pattern}`);
  }
}

function literalPrefix(pattern) {
  const normalized = normalizeRepoPath(pattern);
  const match = normalized.match(GLOB_TOKEN);
  const prefix = (match ? normalized.slice(0, match.index) : normalized).replace(/\/+$/u, '');
  return prefix;
}

function prefixContains(left, right) {
  return left === right || (left && right.startsWith(`${left}/`));
}

export function writePatternsOverlap(left, right) {
  const leftNormalized = normalizeRepoPath(left);
  const rightNormalized = normalizeRepoPath(right);
  if (leftNormalized === rightNormalized) return true;
  const leftPrefix = literalPrefix(leftNormalized);
  const rightPrefix = literalPrefix(rightNormalized);
  if (!leftPrefix || !rightPrefix) return true;
  return prefixContains(leftPrefix, rightPrefix) || prefixContains(rightPrefix, leftPrefix);
}

function globToRegExp(pattern) {
  const normalized = normalizeRepoPath(pattern);
  let output = '^';
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];
    if (character === '*') {
      if (normalized[index + 1] === '*') {
        index += 1;
        output += normalized[index + 1] === '/' ? '(?:.*/)?' : '.*';
        if (normalized[index + 1] === '/') index += 1;
      } else {
        output += '[^/]*';
      }
    } else if (character === '?') {
      output += '[^/]';
    } else {
      output += character.replace(/[|\\{}()[\]^$+?.]/gu, '\\$&');
    }
  }
  return new RegExp(`${output}$`, 'u');
}

export function matchesSurfacePattern(path, pattern) {
  return globToRegExp(pattern).test(normalizeRepoPath(path));
}

export function validateSurfaceMap(map) {
  const failures = [];
  if (!map || typeof map !== 'object' || Array.isArray(map)) return ['surface map must be an object'];
  if (map.schemaVersion !== 1) failures.push('schemaVersion must be 1');
  if (typeof map.taskId !== 'string' || !map.taskId.trim()) failures.push('taskId is required');
  if (!Array.isArray(map.agents) || map.agents.length === 0) return [...failures, 'agents must be a non-empty array'];

  const ids = new Set();
  const writes = [];
  for (const [index, agent] of map.agents.entries()) {
    const label = `agents[${index}]`;
    if (!agent || typeof agent !== 'object' || Array.isArray(agent)) {
      failures.push(`${label} must be an object`);
      continue;
    }
    if (typeof agent.id !== 'string' || !agent.id.trim()) failures.push(`${label}.id is required`);
    else if (ids.has(agent.id)) failures.push(`duplicate agent id: ${agent.id}`);
    else ids.add(agent.id);
    if (typeof agent.role !== 'string' || !agent.role.trim()) failures.push(`${label}.role is required`);
    for (const field of ['write', 'readOnly', 'forbidden']) {
      if (!Array.isArray(agent[field])) {
        failures.push(`${label}.${field} must be an array`);
        continue;
      }
      for (const pattern of agent[field]) validatePattern(pattern, `${label}.${field}`, failures);
    }
    if (/review|audit|qa/i.test(agent.role ?? '') && agent.write?.length) {
      failures.push(`${label} has a review-only role and cannot declare write patterns`);
    }
    for (const pattern of agent.write ?? []) writes.push({ agent: agent.id, pattern });
  }

  for (let left = 0; left < writes.length; left += 1) {
    for (let right = left + 1; right < writes.length; right += 1) {
      if (writes[left].agent === writes[right].agent) continue;
      if (writePatternsOverlap(writes[left].pattern, writes[right].pattern)) {
        failures.push(`write surfaces overlap: ${writes[left].agent}:${writes[left].pattern} and ${writes[right].agent}:${writes[right].pattern}`);
      }
    }
  }
  return failures;
}

export function validateAgentChanges(map, agentId, paths) {
  const failures = validateSurfaceMap(map);
  const agent = map?.agents?.find((candidate) => candidate.id === agentId);
  if (!agent) return [...failures, `agent is not declared: ${agentId}`];
  for (const rawPath of paths) {
    const path = normalizeRepoPath(rawPath);
    if ((agent.forbidden ?? []).some((pattern) => matchesSurfacePattern(path, pattern))) {
      failures.push(`${path}: forbidden for ${agentId}`);
    } else if ((agent.readOnly ?? []).some((pattern) => matchesSurfacePattern(path, pattern))) {
      failures.push(`${path}: read-only for ${agentId}`);
    } else if (!(agent.write ?? []).some((pattern) => matchesSurfacePattern(path, pattern))) {
      failures.push(`${path}: outside write surface for ${agentId}`);
    }
  }
  return failures;
}

function gitLines(root, args) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8' })
      .split(/\r?\n/u)
      .map((line) => normalizeRepoPath(line.trim()))
      .filter(Boolean);
  } catch (error) {
    throw new Error(`git ${args.join(' ')} failed: ${error.message}`);
  }
}

export function collectChangedPaths(root, base = 'origin/main') {
  return [...new Set([
    ...gitLines(root, ['diff', '--name-only', '--diff-filter=ACMRTUXB', `${base}...HEAD`]),
    ...gitLines(root, ['diff', '--name-only', '--diff-filter=ACMRTUXB']),
    ...gitLines(root, ['diff', '--cached', '--name-only', '--diff-filter=ACMRTUXB']),
    ...gitLines(root, ['ls-files', '--others', '--exclude-standard']),
  ])].sort();
}

export function resolveSpecDirectory(root, spec) {
  const direct = resolve(root, spec);
  if (existsSync(direct)) return direct;
  return resolve(root, 'docs', 'specs', spec);
}

export function activeSurfaceMaps(root) {
  const specRoot = resolve(root, 'docs', 'specs');
  if (!existsSync(specRoot)) return [];
  const maps = [];
  for (const entry of readdirSync(specRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === '_template') continue;
    const directory = resolve(specRoot, entry.name);
    const metaPath = resolve(directory, 'meta.yml');
    if (!existsSync(metaPath)) continue;
    let meta;
    try { meta = JSON.parse(readFileSync(metaPath, 'utf8')); } catch { continue; }
    if (!['active', 'blocked'].includes(meta.status) || meta.tier < 2) continue;
    const mapPath = resolve(directory, 'surface-map.v1.json');
    if (meta.surface_map_version === 1 && !existsSync(mapPath)) {
      maps.push({ directory, mapPath, missing: true });
    } else if (existsSync(mapPath)) {
      maps.push({ directory, mapPath, missing: false });
    }
  }
  return maps;
}

export function displayPath(root, path) {
  return normalizeRepoPath(relative(root, path));
}
