import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/lib/llm-gateway.ts'), 'utf8');

describe('legacy LLM gateway safety contract', () => {
  it('keeps automatic escalation opt-in and caps advisor calls', () => {
    expect(source).toContain('params.autoEscalate === true');
    expect(source).toContain('advisorCalls < (route.maxAdvisorCalls ?? 1)');
    expect(source).toContain('AI_LEGACY_INTERNAL_RETRIES_ENABLED');
  });

  it('does not allow durable blog tasks to use fallback or advisor', () => {
    expect(source).toContain("effectiveTask === 'blog-generate' || effectiveTask === 'content-brief'");
  });
});
