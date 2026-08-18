import { describe, expect, it } from 'vitest';
import { evaluateBlogAutopublishActivationV4 } from './blog-autopublish-activation-v4';

describe('blog autopublish activation v4', () => {
  it('blocks the exact production-safe defaults', () => {
    const report = evaluateBlogAutopublishActivationV4({
      generation: {
        status: 200,
        body: {
          skipped: true,
          reason: 'blog_generation_cron_paused',
          generationCronEnabled: false,
          autopublishMode: 'draft_only',
        },
      },
      publication: {
        status: 200,
        body: {
          skipped: true,
          reason: 'autopublish_mode_draft_only',
          policy: { mode: 'draft_only' },
        },
      },
    });

    expect(report.ready).toBe(false);
    expect(report.generation.reason).toBe('generation_cron_disabled');
    expect(report.publication.reason).toBe('autopublish_not_live');
  });

  it('treats an off-window generation and a due-slot skip as configured', () => {
    const report = evaluateBlogAutopublishActivationV4({
      generation: {
        status: 200,
        body: { skipped: true, reason: 'outside_kst_offpeak_generation_window' },
      },
      publication: {
        status: 200,
        body: { skipped: true, reason: 'publication_slot_not_due' },
      },
    });

    expect(report.ready).toBe(true);
    expect(report.generation.reason).toBe('generation_enabled_outside_window');
    expect(report.publication.reason).toBe('configured_but_not_due');
  });

  it('surfaces provenance failure instead of hiding it behind draft_only', () => {
    const report = evaluateBlogAutopublishActivationV4({
      generation: { status: 200, body: { skipped: true, reason: 'outside_kst_offpeak_generation_window' } },
      publication: {
        status: 200,
        body: {
          skipped: true,
          reason: 'autopublish_mode_draft_only',
          policy: {
            mode: 'draft_only',
            requestedMode: 'live',
            deploymentProvenance: {
              passed: false,
              reasons: ['production_git_ref_missing', 'production_commit_sha_missing'],
              source: 'missing',
              expectedGitRef: 'main',
              expectedCommitSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
              actualGitRef: null,
              commitSha: null,
            },
          },
        },
      },
    });

    expect(report.ready).toBe(false);
    expect(report.publication.reason).toBe('deployment_provenance_failed');
    expect(report.publication.evidence.reasons).toEqual([
      'production_git_ref_missing',
      'production_commit_sha_missing',
    ]);
    expect(report.publication.evidence).toMatchObject({
      source: 'missing',
      expectedGitRef: 'main',
      expectedCommitSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      actualGitRef: null,
      commitSha: null,
    });
  });

  it('never treats an unavailable endpoint as ready', () => {
    const report = evaluateBlogAutopublishActivationV4({
      generation: { status: null, body: null, error: 'timeout' },
      publication: { status: 401, body: { error: 'unauthorized' } },
    });

    expect(report.ready).toBe(false);
    expect(report.generation.status).toBe('unavailable');
    expect(report.publication.reason).toBe('cron_auth_required');
  });
});
