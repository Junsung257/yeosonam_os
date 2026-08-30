import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function selectedColumnLists(source: string): string[] {
  return [...source.matchAll(/\.select\('([^']+)'\)/g)].map((match) => match[1] ?? '');
}

describe('blog queue lifecycle schema contract', () => {
  it('does not query the removed blog_topic_queue.slug_hint column in recovery paths', () => {
    const lifecycleSource = readFileSync(join(process.cwd(), 'src/lib/blog-queue-lifecycle.ts'), 'utf8');
    const editorialRecheckSource = readFileSync(join(process.cwd(), 'scripts/recheck-blog-editorial-backlog.ts'), 'utf8');
    const lifecycleSelects = selectedColumnLists(lifecycleSource);
    const editorialSelects = selectedColumnLists(editorialRecheckSource);

    expect(lifecycleSelects.some((columns) => /\bslug_hint\b/.test(columns))).toBe(false);
    expect(editorialSelects.some((columns) => /\bslug_hint\b/.test(columns))).toBe(false);
  });

  it('quarantines due information rows whose durable research is not ready', () => {
    const lifecycleSource = readFileSync(join(process.cwd(), 'src/lib/blog-queue-lifecycle.ts'), 'utf8');

    expect(lifecycleSource).toContain('evaluateQueuedInformationResearch(row)');
    expect(lifecycleSource).toContain("forcedReason = 'information_research_not_ready'");
    expect(lifecycleSource).toContain("lastError = 'evidence_insufficient'");
    expect(lifecycleSource).toContain('research_issues: researchIssues');
    expect(lifecycleSource).toContain('research_failed_at: now');
    expect(lifecycleSource).toContain("forcedReason === 'information_research_not_ready'");
  });

  it('requeues research failures only when a verified demand signal is still present', () => {
    const lifecycleSource = readFileSync(join(process.cwd(), 'src/lib/blog-queue-lifecycle.ts'), 'utf8');

    expect(lifecycleSource).toContain('buildBlogInformationResearchRecheckDecision({');
    expect(lifecycleSource).toContain('hasVerifiedBlogDemandSignal(');
    expect(lifecycleSource).toContain("researchDecision.action === 'requeue' && demandVerified");
    expect(lifecycleSource).toContain('verified_demand_recovery: true');
    expect(lifecycleSource).toContain(".eq('last_error', 'evidence_insufficient')");
  });

  it('uses only public-eligible posts as active editorial duplicate truth', () => {
    const lifecycleSource = readFileSync(join(process.cwd(), 'src/lib/blog-queue-lifecycle.ts'), 'utf8');

    expect(lifecycleSource).toContain('.from(PUBLIC_BLOG_READ_SOURCE)');
  });
});
