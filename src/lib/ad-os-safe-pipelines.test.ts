import { describe, expect, it } from 'vitest';
import {
  AD_OS_SAFE_PIPELINE_KEYS,
  buildAdOsSafePipelineSteps,
  isAdOsSafePipelineKey,
  parseAdOsSafePipelineList,
} from './ad-os-safe-pipelines';

describe('ad-os safe pipelines', () => {
  it('defines the supported server-orchestrated pipeline keys', () => {
    expect(AD_OS_SAFE_PIPELINE_KEYS).toEqual(['google', 'conversion', 'optimization', 'meta_creative']);
    expect(isAdOsSafePipelineKey('google')).toBe(true);
    expect(isAdOsSafePipelineKey('unknown')).toBe(false);
  });

  it('parses cron pipeline lists with fallback and de-duplication', () => {
    expect(parseAdOsSafePipelineList('', ['conversion'])).toEqual(['conversion']);
    expect(parseAdOsSafePipelineList('conversion,google,unknown,google', ['optimization'])).toEqual([
      'conversion',
      'google',
    ]);
  });

  it('keeps Google safe pipeline draft-only and audit-backed', () => {
    const steps = buildAdOsSafePipelineSteps('google');

    expect(steps.map((step) => step.key)).toEqual([
      'google_rsa_drafts',
      'google_draft_packets',
      'google_execution_gate',
      'google_platform_jobs',
      'google_platform_dry_run',
      'tenant_audit_export',
    ]);
    expect(steps[4].body).toMatchObject({ mode: 'dry_run', platform: 'google' });
    expect(steps.at(-1)?.url).toBe('/api/admin/ad-os/tenant-audit-export');
  });

  it('keeps conversion and optimization pipelines ending with an audit export', () => {
    expect(buildAdOsSafePipelineSteps('conversion').at(-1)?.key).toBe('tenant_audit_export');
    expect(buildAdOsSafePipelineSteps('optimization').at(-1)?.key).toBe('tenant_audit_export');
  });

  it('builds Meta creative seed orchestration without live publish body fields', () => {
    const steps = buildAdOsSafePipelineSteps('meta_creative');
    const seedStep = steps.find((step) => step.key === 'meta_creative_seed');

    expect(seedStep?.url).toBe('/api/admin/ad-os/channel-adapters/meta/creative-seed');
    expect(seedStep?.body).toMatchObject({ apply: true, call_to_action: 'LEARN_MORE' });
    expect(seedStep?.body).not.toHaveProperty('live_publish_enabled');
  });
});
