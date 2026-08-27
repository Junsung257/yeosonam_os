import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const allowedLegacy = new Set([
  'src/lib/llm-gateway.ts',
  'src/lib/blog-ai-caller.ts',
  // Existing non-blog lanes are deliberately isolated from the durable blog
  // rollout. Each entry is a migration backlog item; new files still fail.
  'src/app/api/admin/ai-credits/route.ts',
  'src/app/api/products/scan/route.ts',
  'src/lib/ai.ts',
  'src/lib/attraction-desc-gen.ts',
  'src/lib/band-ai-analyzer.ts',
  'src/lib/blog-ai-caller.test.ts',
  'src/lib/card-news-html/critic.ts',
  'src/lib/destination-setup.ts',
  'src/lib/jarvis/claude-router.ts',
  'src/lib/jarvis/deepseek-agent-loop-v2.ts',
  'src/lib/jarvis/deepseek-agent-loop.ts',
  'src/lib/ktkg-extractor.ts',
  'src/lib/normalize-with-llm.ts',
  'src/lib/passenger-extractor.ts',
]);
const prohibited = [
  /api\.deepseek\.com/i,
  /new\s+OpenAI\s*\(/,
  /chat\.completions\.create\s*\(/,
  /responses\.create\s*\(/,
  /getDeep[Ss]eek[Cc]lient\s*\(/,
];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next' || entry.name.startsWith('.')) continue;
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.(?:ts|tsx|mjs|cjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const violations: string[] = [];
for (const file of walk(resolve(root, 'src'))) {
  const relative = file.slice(root.length + 1).replaceAll('\\', '/');
  const text = readFileSync(file, 'utf8');
  if (!prohibited.some((pattern) => pattern.test(text))) continue;
  if (allowedLegacy.has(relative)) continue;
  violations.push(relative);
}

if (violations.length > 0) {
  console.error('[ai-direct-call-guard] prohibited provider call outside legacy allowlist:');
  for (const violation of violations) console.error(` - ${violation}`);
  process.exit(1);
}

console.log(`[ai-direct-call-guard] PASS (legacy allowlist ${[...allowedLegacy].join(', ')})`);
