import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline';

const root = resolve(import.meta.dirname, '..');

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function gitStatus() {
  return execFileSync('git', ['status', '--porcelain=v1'], { cwd: root, encoding: 'utf8' });
}

async function createMcpClient(command, { cwd, env }) {
  const child = spawn(command, ['--ui=false', '--tool-profile=analysis'], {
    cwd,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const pending = new Map();
  let nextId = 1;
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-8_000); });
  const lines = createInterface({ input: child.stdout });
  lines.on('line', (line) => {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    if (message.id === undefined || !pending.has(message.id)) return;
    const { resolve: resolveRequest, reject, timeout } = pending.get(message.id);
    clearTimeout(timeout);
    pending.delete(message.id);
    if (message.error) reject(new Error(`MCP ${message.error.code}: ${message.error.message}`));
    else resolveRequest(message.result);
  });
  child.on('exit', (code) => {
    for (const { reject, timeout } of pending.values()) {
      clearTimeout(timeout);
      reject(new Error(`Codebase Memory MCP exited with ${code}: ${stderr}`));
    }
    pending.clear();
  });

  function request(method, params) {
    const id = nextId++;
    return new Promise((resolveRequest, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Codebase Memory MCP timed out during ${method}: ${stderr}`));
      }, 120_000);
      pending.set(id, { resolve: resolveRequest, reject, timeout });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  await request('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'yeosonam-cbm-benchmark', version: '1.0.0' },
  });
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  return {
    callTool: (name, args) => request('tools/call', { name, arguments: args }),
    close: async () => {
      child.stdin.end();
      await new Promise((done) => {
        const timeout = setTimeout(() => {
          if (!child.killed) child.kill();
          done();
        }, 2_000);
        child.once('exit', () => { clearTimeout(timeout); done(); });
      });
    },
  };
}

const manifest = JSON.parse(readFileSync(resolve(root, 'config/codebase-memory-pilot.json'), 'utf8'));
const corpus = JSON.parse(readFileSync(resolve(root, 'evals/codebase-memory/questions.json'), 'utf8'));
const binary = argument('--binary', process.env.CBM_BINARY ?? resolve(homedir(), '.codex/tools/codebase-memory-mcp/v0.10.8/codebase-memory-mcp.exe'));
const project = argument('--project', 'yeosonam-os-cbm-pilot');
const cacheDir = argument('--cache-dir', process.env.CBM_CACHE_DIR ?? resolve(homedir(), '.codex/cache/codebase-memory/yeosonam-pilot-v0.10.8'));
const outputPath = resolve(root, argument('--output', 'artifacts/codebase-memory-benchmark.json'));
const baselinePath = argument('--baseline');
if (!binary || !existsSync(binary)) throw new Error('Pass --binary or CBM_BINARY with the pinned executable path.');
if (!cacheDir) throw new Error('Pass --cache-dir or CBM_CACHE_DIR outside the repository.');

const env = {
  ...process.env,
  CBM_ALLOWED_ROOT: root,
  CBM_CACHE_DIR: cacheDir,
  CBM_DIAGNOSTICS: 'false',
  CBM_LOG_LEVEL: 'warn',
};
const before = gitStatus();
const results = [];
let coverage = null;

const client = await createMcpClient(binary, { cwd: root, env });
try {
  for (const question of corpus.questions) {
    const started = performance.now();
    const response = await client.callTool('search_graph', {
      project,
      query: question.searchQuery,
      limit: 30,
      format: 'json',
    });
    const structured = response.structuredContent ?? {};
    const fileIndex = Array.isArray(structured.cols) ? structured.cols.indexOf('file') : -1;
    const files = fileIndex >= 0
      ? [...new Set((structured.rows ?? []).map((row) => row[fileIndex]).filter((value) => typeof value === 'string'))]
      : [];
    const matchedAnchors = question.expectedAnchors.filter((anchor) => files.includes(anchor));
    const sensitiveFiles = files.filter((file) => /(?:^|\/)(?:\.env|private\/|data\/product-registration\/hwp-inbox\/|.*credentials.*\.json)/iu.test(file));
    const contextChars = JSON.stringify(structured).length;
    results.push({
      id: question.id,
      category: question.category,
      correct: matchedAnchors.length > 0,
      expectedAnchorsExist: question.expectedAnchors.every((anchor) => existsSync(resolve(root, anchor))),
      matchedAnchors,
      returnedFiles: files,
      sensitiveFiles,
      resultCount: Number(structured.total ?? 0),
      contextChars,
      estimatedContextTokens: Math.ceil(contextChars / 4),
      toolCalls: 1,
      latencyMs: Math.round(performance.now() - started),
    });
  }
  const expectedPaths = [...new Set(corpus.questions.flatMap((question) => question.expectedAnchors))];
  const coverageResponse = await client.callTool('check_index_coverage', { project, paths: expectedPaths });
  coverage = coverageResponse.structuredContent ?? {};
} finally {
  await client.close();
}

const after = gitStatus();
const correct = results.filter((result) => result.correct).length;
const sensitiveExposureCount = results.reduce((sum, result) => sum + result.sensitiveFiles.length, 0);
const stalePaths = (coverage?.paths ?? []).filter((entry) => entry.recommended_action === 'read_source_and_reindex');
const coveragePass = coverage?.signal === 'best_effort'
  && coverage?.metadata?.recording_status === 'complete'
  && coverage?.metadata?.generation_matches === true
  && stalePaths.length === 0;
const summary = {
  questionCount: results.length,
  correct,
  incorrect: results.length - correct,
  falseAuthoritativeAnswers: null,
  falseAuthoritativeMeasurement: 'pending: this runner measures structural retrieval only; answer-level review remains manual',
  sensitiveExposureCount,
  gitStatusUnchanged: before === after,
  coveragePass,
  stalePathCount: stalePaths.length,
  medianEstimatedContextTokens: median(results.map((result) => result.estimatedContextTokens)),
  medianToolCalls: median(results.map((result) => result.toolCalls)),
  medianLatencyMs: median(results.map((result) => result.latencyMs)),
  structuralGatePassed: correct >= manifest.benchmark.minimumCorrect
    && sensitiveExposureCount === 0
    && before === after
    && coveragePass,
  adoptionStatus: 'pending_baseline_and_answer_review',
};

if (baselinePath) {
  const baseline = JSON.parse(readFileSync(resolve(root, baselinePath), 'utf8'));
  summary.contextReductionPercent = baseline.medianContextTokens > 0
    ? Math.round((1 - summary.medianEstimatedContextTokens / baseline.medianContextTokens) * 1000) / 10
    : null;
  summary.toolCallReductionPercent = baseline.medianToolCalls > 0
    ? Math.round((1 - summary.medianToolCalls / baseline.medianToolCalls) * 1000) / 10
    : null;
  summary.adoptionStatus = summary.structuralGatePassed
    && summary.contextReductionPercent >= manifest.benchmark.minimumMedianContextReductionPercent
    && summary.toolCallReductionPercent >= manifest.benchmark.minimumToolCallReductionPercent
    ? 'eligible_for_answer_review'
    : 'rejected';
}

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  gitCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  binaryVersion: manifest.release.version,
  binarySha256: manifest.release.binarySha256,
  project,
  summary,
  coverage: {
    signal: coverage?.signal ?? null,
    indexedAt: coverage?.indexed_at ?? null,
    metadata: coverage?.metadata ?? null,
    stalePaths,
    caveat: coverage?.caveat ?? null,
  },
  results,
};
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(summary, null, 2));
if (!summary.structuralGatePassed) process.exitCode = 1;
