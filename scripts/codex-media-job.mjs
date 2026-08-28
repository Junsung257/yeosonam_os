#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve } from 'node:path';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 3.5 * 1024 * 1024;
const MIME_BY_EXTENSION = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
]);

function fail(message, exitCode = 1) {
  console.error(JSON.stringify({ ok: false, error: message }));
  process.exit(exitCode);
}

function getOption(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

function requireOption(name) {
  const value = getOption(name)?.trim();
  if (!value) fail(`${name} is required`, 2);
  return value;
}

function baseUrl() {
  const raw = (process.env.MEDIA_CODEX_API_BASE_URL || 'https://www.yeosonam.com').trim();
  let url;
  try {
    url = new URL(raw);
  } catch {
    fail('MEDIA_CODEX_API_BASE_URL must be a valid URL', 2);
  }
  const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    fail('MEDIA_CODEX_API_BASE_URL must use HTTPS except for localhost', 2);
  }
  return url.toString().replace(/\/$/, '');
}

function token() {
  const value = process.env.MEDIA_CODEX_WORKER_TOKEN?.trim() ?? '';
  if (value.length < 32) fail('MEDIA_CODEX_WORKER_TOKEN is missing or too short', 2);
  return value;
}

function workerRunId() {
  const explicit = getOption('--worker-run-id')?.trim();
  const value = explicit || `codex:${randomUUID()}`;
  if (!/^[a-zA-Z0-9:_-]{8,120}$/.test(value)) fail('invalid --worker-run-id', 2);
  return value;
}

async function request(path, init = {}) {
  const response = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token()}`,
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(60_000),
    redirect: 'manual',
  });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    fail(`worker endpoint returned non-JSON HTTP ${response.status}`);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    fail(`worker endpoint returned an invalid JSON body (HTTP ${response.status})`);
  }
  if (!response.ok) {
    const detail = typeof body?.error === 'string' ? body.error : `HTTP ${response.status}`;
    fail(`${response.status}: ${detail}`);
  }
  return body;
}

async function claim() {
  const id = workerRunId();
  const body = await request('/api/internal/media/codex/jobs/claim', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ worker_run_id: id }),
  });
  console.log(JSON.stringify({ ok: true, worker_run_id: id, ...body }));
}

async function complete() {
  const jobId = requireOption('--job-id');
  const id = requireOption('--worker-run-id');
  const filePath = resolve(requireOption('--file'));
  if (!process.argv.includes('--visual-qa-passed')) {
    fail('--visual-qa-passed is required after inspecting the generated image', 2);
  }
  const mime = MIME_BY_EXTENSION.get(extname(filePath).toLowerCase());
  if (!mime) fail('--file must be PNG, JPEG, or WebP', 2);
  const fileStat = await stat(filePath).catch(() => null);
  if (!fileStat?.isFile() || fileStat.size < 1 || fileStat.size > MAX_IMAGE_BYTES) {
    fail('--file must be a non-empty image up to 10MB', 2);
  }
  const bytes = await readFile(filePath);
  const { default: sharp } = await import('sharp');
  const uploadBytes = await sharp(bytes, { failOn: 'warning', limitInputPixels: 40_000_000 })
    .rotate()
    .resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 88, effort: 4 })
    .toBuffer();
  if (uploadBytes.length < 1 || uploadBytes.length > MAX_UPLOAD_BYTES) {
    fail('normalized worker upload must be a non-empty WebP up to 3.5MB', 2);
  }
  const form = new FormData();
  form.set('worker_run_id', id);
  form.set('visual_qa_passed', 'true');
  form.set('image', new Blob([uploadBytes], { type: 'image/webp' }), 'image.webp');
  const body = await request(`/api/internal/media/codex/jobs/${encodeURIComponent(jobId)}/complete`, {
    method: 'POST',
    body: form,
  });
  console.log(JSON.stringify({ ok: true, ...body }));
}

async function markFailed() {
  const jobId = requireOption('--job-id');
  const id = requireOption('--worker-run-id');
  const errorCode = requireOption('--error-code');
  const body = await request(`/api/internal/media/codex/jobs/${encodeURIComponent(jobId)}/fail`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ worker_run_id: id, error_code: errorCode }),
  });
  console.log(JSON.stringify({ ok: true, ...body }));
}

async function verify() {
  const jobId = requireOption('--job-id');
  const body = await request(`/api/internal/media/codex/jobs/${encodeURIComponent(jobId)}`);
  console.log(JSON.stringify({ ok: true, ...body }));
}

function help() {
  console.log(`Codex subscription media worker bridge

Usage:
  node scripts/codex-media-job.mjs claim [--worker-run-id <id>]
  node scripts/codex-media-job.mjs complete --job-id <uuid> --worker-run-id <id> --file <image> --visual-qa-passed
  node scripts/codex-media-job.mjs fail --job-id <uuid> --worker-run-id <id> --error-code <code>
  node scripts/codex-media-job.mjs verify --job-id <uuid>

Environment:
  MEDIA_CODEX_WORKER_TOKEN   required secret (32+ characters)
  MEDIA_CODEX_API_BASE_URL   optional, defaults to https://www.yeosonam.com`);
}

const command = process.argv[2];
try {
  if (command === 'claim') await claim();
  else if (command === 'complete') await complete();
  else if (command === 'fail') await markFailed();
  else if (command === 'verify') await verify();
  else if (command === '--help' || command === '-h' || !command) help();
  else fail(`unknown command: ${command}`, 2);
} catch (error) {
  fail(error instanceof Error ? error.message : 'unexpected worker bridge failure');
}
