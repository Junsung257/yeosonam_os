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
    expect(source).toContain('replaceBlogInformationAutomatedDraftAtomically');
    expect(source).toContain('readAutomatedPublishedBlogReplacement');
    expect(source).toContain('modelCalls: 0');
  });

  it('publishes an automated refresh only through its canonical target contract', () => {
    expect(source).toContain('automatedReplacement.queueId !== String(run.queue_id)');
    expect(source).toContain('targetCreativeId: automatedReplacement.targetCreativeId');
    expect(source).toContain('runId: String(run.id)');
    expect(source).toContain('selectedAttemptId');
    expect(source).toContain('content_creative_id: publishedCreativeId');
    expect(source).toContain('publishedSlug = replacement.slug');
  });

  it('does not quarantine an article after its public commit has succeeded', () => {
    expect(source).toContain('if (publicCommitComplete)');
    expect(source).toContain("status: 'published_state_sync_error'");
    expect(source).toContain('post_publish_state_sync_failed');
  });

  it('allows only an explicit UUID-targeted force canary without bypassing the daily cap', () => {
    expect(source).toContain("searchParams.get('runId')");
    expect(source).toContain("searchParams.get('force') === 'true'");
    expect(source).toContain('remainingDailyCapacity <= 0');
    expect(source).toContain("dueRunsQuery.eq('id', targetedRunId).limit(1)");
    expect(source).not.toContain("searchParams.get('force') === 'true' ? 30");
  });

  it('counts only public-eligible posts against the daily publication cap', () => {
    expect(source).toContain(".from(PUBLIC_BLOG_READ_SOURCE)");
    expect(source).not.toMatch(/\.from\('content_creatives'\)[\s\S]{0,180}\.select\('id', \{ count: 'exact', head: true \}\)/);
  });
});
