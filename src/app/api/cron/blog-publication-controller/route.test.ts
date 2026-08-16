import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('blog publication controller source contract', () => {
  const source = readFileSync('src/app/api/cron/blog-publication-controller/route.ts', 'utf8');

  it('publishes only durable approved attempts without importing an AI caller', () => {
    expect(source).toContain(".eq('status', 'approved_for_slot')");
    expect(source).toContain("attempt?.route !== 'approved_for_slot'");
    expect(source).toContain('Number(run.latest_quality_score ?? 0) < 90');
    expect(source).not.toMatch(/blog-ai-caller|generateBlogText|DEEPSEEK_API_KEY|GoogleGenerativeAI|OpenAI/);
  });

  it('reports zero model calls and uses the atomic informational publication path', () => {
    expect(source).toContain('publishBlogInformationAtomically');
    expect(source).toContain('modelCalls: 0');
  });

  it('does not quarantine an article after its public commit has succeeded', () => {
    expect(source).toContain('if (publicCommitComplete)');
    expect(source).toContain("status: 'published_state_sync_error'");
    expect(source).toContain('post_publish_state_sync_failed');
  });
});
