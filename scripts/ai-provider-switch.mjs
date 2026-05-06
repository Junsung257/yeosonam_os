import fs from 'node:fs';
import path from 'node:path';

const ENV_PATH = path.resolve(process.cwd(), '.env.local');

function parseArgs(argv) {
  const args = { all: null, task: null, model: null };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--all') args.all = argv[++i] || null;
    else if (token === '--task') args.task = argv[++i] || null;
    else if (token === '--model') args.model = argv[++i] || null;
  }
  return args;
}

function normalizeProvider(v) {
  const x = (v || '').trim().toLowerCase();
  if (x === 'deepseek' || x === 'claude' || x === 'gemini') return x;
  return null;
}

function readEnvFile() {
  if (!fs.existsSync(ENV_PATH)) return [];
  return fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/);
}

function upsert(lines, key, value) {
  const pattern = new RegExp(`^${key}=`);
  const idx = lines.findIndex((line) => pattern.test(line));
  const row = `${key}=${value}`;
  if (idx >= 0) lines[idx] = row;
  else lines.push(row);
}

function parseOverrideMap(raw) {
  return (raw || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((acc, pair) => {
      const [k, v] = pair.split(':').map((x) => x?.trim());
      if (k && v) acc[k] = v;
      return acc;
    }, {});
}

function serializeOverrideMap(map) {
  return Object.entries(map)
    .map(([k, v]) => `${k}:${v}`)
    .join(',');
}

function getCurrentValue(lines, key) {
  const row = lines.find((line) => line.startsWith(`${key}=`));
  return row ? row.slice(key.length + 1) : '';
}

function help() {
  console.log('사용법:');
  console.log('  npm run ai:switch -- --all deepseek');
  console.log('  npm run ai:switch -- --all claude');
  console.log('  npm run ai:switch -- --task blog-generate=deepseek');
  console.log('  npm run ai:switch -- --task card-news=claude');
  console.log('  npm run ai:switch -- --model blog-generate=deepseek-v4-pro');
}

const args = parseArgs(process.argv.slice(2));
const lines = readEnvFile();

if (!args.all && !args.task && !args.model) {
  help();
  process.exit(0);
}

if (args.all) {
  const provider = normalizeProvider(args.all);
  if (!provider) {
    console.error('오류: --all 값은 deepseek|claude|gemini 중 하나여야 합니다.');
    process.exit(1);
  }
  upsert(lines, 'AI_DEFAULT_PROVIDER', provider);
  console.log(`AI_DEFAULT_PROVIDER => ${provider}`);
}

if (args.task) {
  const [task, providerRaw] = args.task.split('=');
  const provider = normalizeProvider(providerRaw);
  if (!task || !provider) {
    console.error('오류: --task 형식은 task=deepseek|claude|gemini');
    process.exit(1);
  }
  const current = parseOverrideMap(getCurrentValue(lines, 'AI_TASK_PROVIDER_OVERRIDES'));
  current[task.trim()] = provider;
  upsert(lines, 'AI_TASK_PROVIDER_OVERRIDES', serializeOverrideMap(current));
  console.log(`AI_TASK_PROVIDER_OVERRIDES: ${task.trim()} => ${provider}`);
}

if (args.model) {
  const [task, model] = args.model.split('=');
  if (!task || !model) {
    console.error('오류: --model 형식은 task=model_name');
    process.exit(1);
  }
  const current = parseOverrideMap(getCurrentValue(lines, 'AI_TASK_MODEL_OVERRIDES'));
  current[task.trim()] = model.trim();
  upsert(lines, 'AI_TASK_MODEL_OVERRIDES', serializeOverrideMap(current));
  console.log(`AI_TASK_MODEL_OVERRIDES: ${task.trim()} => ${model.trim()}`);
}

if (!lines.some((line) => line.startsWith('AI_DEFAULT_PROVIDER='))) {
  lines.push('AI_DEFAULT_PROVIDER=deepseek');
}

fs.writeFileSync(ENV_PATH, `${lines.join('\n').replace(/\n{3,}/g, '\n\n')}\n`, 'utf8');
console.log(`완료: ${ENV_PATH}`);

