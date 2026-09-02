import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const manifest = JSON.parse(readFileSync(resolve(root, 'config/openmontage-worker.json'), 'utf8'));
const dockerfile = readFileSync(resolve(root, 'tools/openmontage-worker/Dockerfile'), 'utf8');
const compose = readFileSync(resolve(root, 'tools/openmontage-worker/compose.yaml'), 'utf8');
const gitignore = readFileSync(resolve(root, '.gitignore'), 'utf8');
const failures = [];

function requireValue(condition, message) {
  if (!condition) failures.push(message);
}

const commit = manifest.upstream?.commit;
requireValue(manifest.status === 'prototype_build_pending', 'Unbuilt sandbox must not claim a ready status');
requireValue(/^[a-f0-9]{40}$/u.test(commit ?? ''), 'OpenMontage commit must be a full immutable revision');
requireValue(manifest.upstream.repository === 'https://github.com/calesthio/OpenMontage', 'Only the official OpenMontage repository is allowed');
requireValue(manifest.upstream.license === 'AGPL-3.0-only', 'AGPL license must be explicit');
requireValue(manifest.upstream.vendored === false && manifest.upstream.upstreamModified === false, 'Upstream must stay unvendored and unmodified');
requireValue(manifest.upstream.networkServiceEnabled === false, 'Network service mode is forbidden');
requireValue(manifest.container.runtimeNetwork === 'none' && manifest.container.readOnlyRootFilesystem === true, 'Container must default to isolated read-only runtime');
requireValue(manifest.container.publishedPorts.length === 0, 'Published ports are forbidden');
requireValue(manifest.providers.paidHeroProvidersEnabled === false, 'Paid Hero providers are disabled in v1');
requireValue(manifest.providers.knownKoreanVoice.status === 'license_blocked', 'Known non-commercial Korean voice must remain blocked');
requireValue(manifest.providers.knownKoreanVoice.datasetLicense === 'CC-BY-NC-SA-4.0', 'Known Korean voice license must be recorded');
requireValue(Object.values(manifest.mutations).every((value) => value === false), 'DB, upload, and publishing mutations are forbidden');
requireValue(dockerfile.includes(`ARG OPENMONTAGE_COMMIT=${commit}`), 'Dockerfile revision differs from manifest');
requireValue(dockerfile.includes(manifest.container.baseImage), 'Docker base image must be digest-pinned');
requireValue(!/EXPOSE|OPENAI_API_KEY|KLING|HIGGSFIELD/iu.test(dockerfile), 'Dockerfile exposes a forbidden network or paid-provider surface');
requireValue(!dockerfile.includes(manifest.providers.knownKoreanVoice.path) && !/download_voices/iu.test(dockerfile), 'License-blocked Korean voice must not be downloaded');
requireValue(compose.includes('network_mode: none') && compose.includes('read_only: true'), 'Compose isolation is incomplete');
requireValue(compose.includes('/input:ro') && compose.includes('/output:rw'), 'Input/output mount policy is incomplete');
requireValue(!/^\s*ports:/mu.test(compose), 'Compose must not publish ports');
requireValue(gitignore.includes('/private/video-worker/') && gitignore.includes('/artifacts/'), 'Private video drafts must be ignored');

if (failures.length) {
  for (const failure of failures) console.error(`FAIL ${failure}`);
  process.exit(1);
}
console.log('OpenMontage draft-worker contract passed.');
