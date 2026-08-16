import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const runtimePaths = [
  'src/app/api/cron/blog-publisher/route.ts',
  'src/app/api/cron/blog-ai-model-canary/route.ts',
  'src/lib/blog-auto-research.ts',
  'src/lib/blog-deepseek-orchestrator-v4.ts',
  'src/lib/blog-ai-budget-v4.ts',
  'src/lib/blog-ai-model-canary-v4.ts',
];

const runtime = runtimePaths.map((path) => readFileSync(path, 'utf8')).join('\n');
const migration = readFileSync(
  'supabase/migrations/20260816015102_blog_ai_budget_deepseek_only.sql',
  'utf8',
).toLowerCase();
const workflow = readFileSync('.github/workflows/blog-v4-production-release.yml', 'utf8');

describe('Blog V4 DeepSeek-only publication contract', () => {
  it('contains no alternate-provider stage or fallback in the runtime publication lane', () => {
    expect(runtime).not.toContain('rescue_gemini');
    expect(runtime).not.toContain('gemini-2.5-pro');
    expect(runtime).not.toContain('BLOG_FINAL_REWRITE_PROVIDER');
    expect(runtime).not.toContain('BLOG_FINAL_REWRITE_MODEL');
    expect(runtime).not.toContain("getProviderApiKey('gemini')");
    expect(runtime).not.toContain('GoogleGenAI');
    expect(runtime).toContain('cascade: false');
  });

  it('pins research, draft, and rewrite stages to DeepSeek models', () => {
    expect(runtime).toContain('const AUTO_RESEARCH_MODEL = BLOG_DEEPSEEK_MODELS.rewrite');
    expect(runtime).toContain("draft: 'deepseek-v4-flash'");
    expect(runtime).toContain("rewrite: 'deepseek-v4-pro'");
    expect(runtime).toContain("provider: 'deepseek'");
  });

  it('rejects alternate providers at the database and release boundaries', () => {
    expect(migration).toContain("check (provider = 'deepseek')");
    expect(migration).toContain("p_provider <> 'deepseek'");
    expect(migration).not.toContain("provider = 'gemini'");
    expect(migration).not.toContain('rescue_gemini');
    expect(workflow).not.toContain('BLOG_FINAL_REWRITE_PROVIDER');
    expect(workflow).not.toContain('BLOG_FINAL_REWRITE_MODEL');
  });
});
