import { describe, expect, it } from 'vitest';
import {
  parseAdOsJsonResponse,
  type AdOsJsonActionRequest,
  type AdOsJsonBatchActionRequest,
  type AdOsJsonIdActionRequest,
} from './action-runner';

describe('Ad OS action runner', () => {
  it('returns parsed JSON when the response is ok and payload ok is true', async () => {
    const response = new Response(JSON.stringify({ ok: true, summary: { count: 1 } }), {
      status: 200,
    });

    await expect(parseAdOsJsonResponse(response, 'fallback')).resolves.toEqual({
      ok: true,
      summary: { count: 1 },
    });
  });

  it('throws payload error when the API returns ok false', async () => {
    const response = new Response(JSON.stringify({ ok: false, error: 'blocked' }), {
      status: 200,
    });

    await expect(parseAdOsJsonResponse(response, 'fallback')).rejects.toThrow('blocked');
  });

  it('throws fallback error when the response fails without a payload error', async () => {
    const response = new Response(JSON.stringify({ ok: false }), {
      status: 500,
    });

    await expect(parseAdOsJsonResponse(response, 'fallback')).rejects.toThrow('fallback');
  });

  it('throws fallback error when the response body is not JSON', async () => {
    const response = new Response('', {
      status: 502,
    });

    await expect(parseAdOsJsonResponse(response, 'fallback')).rejects.toThrow('fallback');
  });

  it('throws fallback error when the response JSON is not an object', async () => {
    const response = new Response('null', {
      status: 200,
    });

    await expect(parseAdOsJsonResponse(response, 'fallback')).rejects.toThrow('fallback');
  });

  it('allows success messages to be derived from parsed JSON', () => {
    const request: AdOsJsonActionRequest = {
      flag: 'runningAutomation',
      url: '/api/admin/ad-os/autopilot',
      errorMessage: 'fallback',
      successMessage: (json) => `created ${Number(json.count || 0).toLocaleString('ko-KR')}`,
    };

    expect(typeof request.successMessage).toBe('function');
    if (typeof request.successMessage !== 'function') throw new Error('expected success message function');
    expect(request.successMessage({ count: 1200 })).toBe('created 1,200');
  });

  it('allows batch success messages to be derived from keyed JSON results', () => {
    const request: AdOsJsonBatchActionRequest<{
      google: { clean: number };
      meta: { clean: number };
    }> = {
      flag: 'runningConversionUpload',
      requests: [
        { key: 'google', url: '/api/admin/ad-os/conversion-upload/run', body: { platform: 'google' } },
        { key: 'meta', url: '/api/admin/ad-os/conversion-upload/run', body: { platform: 'meta' } },
      ],
      errorMessage: 'fallback',
      successMessage: (json) => `google ${json.google.clean}, meta ${json.meta.clean}`,
    };

    expect(typeof request.successMessage).toBe('function');
    if (typeof request.successMessage !== 'function') throw new Error('expected batch success message function');
    expect(request.successMessage({ google: { clean: 3 }, meta: { clean: 5 } })).toBe('google 3, meta 5');
  });

  it('allows row action success messages to use parsed response details', () => {
    const request: AdOsJsonIdActionRequest<{ summary: { blocked_reason?: string } }> = {
      activeId: 'ops:123:executor_dry_run',
      url: '/api/admin/ad-os/ops-queues/action',
      body: { action: 'executor_dry_run' },
      errorMessage: 'fallback',
      successMessage: (json) => json.summary.blocked_reason || 'clear',
    };

    expect(typeof request.successMessage).toBe('function');
    if (typeof request.successMessage !== 'function') throw new Error('expected row success message function');
    expect(request.successMessage({ summary: { blocked_reason: 'approval required' } })).toBe('approval required');
  });
});
