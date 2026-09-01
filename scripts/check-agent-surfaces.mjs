import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  activeSurfaceMaps,
  collectChangedPaths,
  displayPath,
  resolveSpecDirectory,
  validateAgentChanges,
  validateSurfaceMap,
} from './lib/harness/agent-surfaces.mjs';

const root = resolve(import.meta.dirname, '..');

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function readMap(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch (error) { return { parseFailure: error.message }; }
}

const spec = argument('--spec');
const agent = argument('--agent');
const base = argument('--base') ?? 'origin/main';
const failures = [];

if (spec || agent) {
  if (!spec || !agent) failures.push('--spec and --agent must be provided together');
  else {
    const specDirectory = resolveSpecDirectory(root, spec);
    const mapPath = resolve(specDirectory, 'surface-map.v1.json');
    if (!existsSync(mapPath)) failures.push(`surface map is missing: ${displayPath(root, mapPath)}`);
    else {
      const map = readMap(mapPath);
      if (map.parseFailure) failures.push(`${displayPath(root, mapPath)}: ${map.parseFailure}`);
      else failures.push(...validateAgentChanges(map, agent, collectChangedPaths(root, base)));
    }
  }
} else {
  for (const entry of activeSurfaceMaps(root)) {
    if (entry.missing) {
      failures.push(`${displayPath(root, entry.directory)} declares surface_map_version=1 but has no surface-map.v1.json`);
      continue;
    }
    const map = readMap(entry.mapPath);
    if (map.parseFailure) failures.push(`${displayPath(root, entry.mapPath)}: ${map.parseFailure}`);
    else failures.push(...validateSurfaceMap(map).map((failure) => `${displayPath(root, entry.mapPath)}: ${failure}`));
  }
}

if (failures.length) {
  for (const failure of failures) console.error(`FAIL ${failure}`);
  process.exit(1);
}
console.log(spec ? `Agent surface check passed for ${agent}.` : 'Active agent surface maps passed.');
