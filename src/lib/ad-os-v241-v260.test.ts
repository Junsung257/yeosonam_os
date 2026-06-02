import { describe, expect, it } from 'vitest';
import { decideConversionExternalUpload } from './ad-os-v241-v260';

const readyJob = {
  id: 'upload-1',
  tenant_id: null,
  platform: 'meta' as const,
  status: 'approved' as const,
  event_name: 'Purchase',
  event_time: '2026-06-03T00:00:00.000Z',
  consent_status: 'granted' as const,
  signal_quality_score: 88,
  dedupe_status: 'unique' as const,
  identifiers: { hashed_email: 'a'.repeat(64), fbp: 'fb.1.1.1' },
  upload_payload: { event_id: 'event-1', value_krw: 10000, currency: 'KRW' },
};

describe('ad-os-v241-v260 conversion external upload adapter', () => {
  it('passes dry-run preflight without external API write', () => {
    const decision = decideConversionExternalUpload({
      job: readyJob,
      requestedMode: 'dry_run',
      apply: false,
      confirmExternalUpload: false,
      globalEnvEnabled: false,
      platformEnvEnabled: false,
      credentialsReady: false,
      now: new Date('2026-06-03T01:00:00.000Z'),
    });

    expect(decision.allowed).toBe(true);
    expect(decision.willCallExternalApi).toBe(false);
    expect(decision.attempt).toMatchObject({ status: 'succeeded', dry_run: true, external_api_write: false });
  });

  it('blocks live upload unless every external-write control passes', () => {
    const decision = decideConversionExternalUpload({
      job: readyJob,
      requestedMode: 'live_upload',
      apply: false,
      confirmExternalUpload: false,
      globalEnvEnabled: false,
      platformEnvEnabled: false,
      credentialsReady: false,
      now: new Date('2026-06-03T01:00:00.000Z'),
    });

    expect(decision.allowed).toBe(false);
    expect(decision.willCallExternalApi).toBe(false);
    expect(decision.blockers).toEqual(expect.arrayContaining([
      'apply_required_for_live_upload',
      'confirm_external_upload_required',
      'conversion_upload_env_flag_missing',
      'meta_upload_env_flag_missing',
      'meta_upload_credentials_missing',
    ]));
    expect(decision.attempt.external_api_write).toBe(false);
  });

  it('allows live upload only at the final explicit gate', () => {
    const decision = decideConversionExternalUpload({
      job: readyJob,
      requestedMode: 'live_upload',
      apply: true,
      confirmExternalUpload: true,
      globalEnvEnabled: true,
      platformEnvEnabled: true,
      credentialsReady: true,
      now: new Date('2026-06-03T01:00:00.000Z'),
    });

    expect(decision.allowed).toBe(true);
    expect(decision.willCallExternalApi).toBe(true);
    expect(decision.attempt).toMatchObject({ status: 'succeeded', dry_run: false, external_api_write: false });
  });

  it('blocks stale, non-consented, low-quality, or unidentified jobs before upload', () => {
    const decision = decideConversionExternalUpload({
      job: {
        ...readyJob,
        event_time: '2026-04-01T00:00:00.000Z',
        consent_status: 'denied',
        signal_quality_score: 20,
        identifiers: {},
      },
      requestedMode: 'live_upload',
      apply: true,
      confirmExternalUpload: true,
      globalEnvEnabled: true,
      platformEnvEnabled: true,
      credentialsReady: true,
      now: new Date('2026-06-03T01:00:00.000Z'),
    });

    expect(decision.allowed).toBe(false);
    expect(decision.willCallExternalApi).toBe(false);
    expect(decision.blockers).toEqual(expect.arrayContaining([
      'consent_not_granted',
      'signal_quality_below_threshold',
      'event_stale_or_missing',
      'identifiers_missing',
    ]));
  });
});
