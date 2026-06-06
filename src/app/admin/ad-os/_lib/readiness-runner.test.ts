import { describe, expect, it } from 'vitest';
import { runAdOsReadinessCheck } from './readiness-runner';

describe('Ad OS readiness runner', () => {
  it('sets loading, stores the result, and publishes the success message', async () => {
    const flags: string[] = [];
    const errors: Array<string | null> = [];
    const messages: Array<string | null> = [];
    let saved: { ok: boolean } | null = null;

    await runAdOsReadinessCheck({
      request: {
        flag: 'checkingStagingSmoke',
        fetchResult: async () => ({ ok: true }),
        onSuccess: (json) => { saved = json; },
        successMessage: (json) => json.ok ? 'passed' : 'failed',
        errorMessage: 'fallback',
      },
      setActionFlag: (key, value) => { flags.push(`${key}:${value}`); },
      setError: (error) => { errors.push(error); },
      setAutomationMessage: (message) => { messages.push(message); },
    });

    expect(flags).toEqual(['checkingStagingSmoke:true', 'checkingStagingSmoke:false']);
    expect(errors).toEqual([null]);
    expect(saved).toEqual({ ok: true });
    expect(messages).toEqual([null, 'passed']);
  });

  it('clears stale messages, uses the thrown error message, and still clears loading', async () => {
    const flags: string[] = [];
    const errors: Array<string | null> = [];
    const messages: Array<string | null> = [];

    await runAdOsReadinessCheck({
      request: {
        flag: 'checkingAdminSurfaceQa',
        fetchResult: async () => { throw new Error('upstream failed'); },
        onSuccess: () => { throw new Error('should not run'); },
        successMessage: () => 'passed',
        errorMessage: 'fallback',
      },
      setActionFlag: (key, value) => { flags.push(`${key}:${value}`); },
      setError: (error) => { errors.push(error); },
      setAutomationMessage: (message) => { messages.push(message); },
    });

    expect(flags).toEqual(['checkingAdminSurfaceQa:true', 'checkingAdminSurfaceQa:false']);
    expect(errors).toEqual([null, 'upstream failed']);
    expect(messages).toEqual([null]);
  });
});
