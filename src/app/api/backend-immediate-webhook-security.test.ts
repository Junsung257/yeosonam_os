import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  secrets: {} as Record<string, string | undefined>,
  ingestSlackRawEvent: vi.fn(),
  supabaseFrom: vi.fn(),
}));

vi.mock('@/lib/secret-registry', () => ({
  getSecret: vi.fn((key: string) => mocks.secrets[key]),
}));

vi.mock('@/lib/slack-ingest', () => ({
  ingestSlackRawEvent: mocks.ingestSlackRawEvent,
}));

vi.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabaseAdmin: { from: mocks.supabaseFrom },
}));

import { POST as slackPost } from './slack-webhook/route';
import { POST as kakaoPost } from './webhooks/kakao/route';

function slackRequest(body: string, headers: Record<string, string> = {}, origin = 'http://localhost') {
  return new NextRequest(`${origin}/api/slack-webhook`, {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function kakaoRequest(body: string, apiKey = '', origin = 'http://localhost') {
  return new NextRequest(`${origin}/api/webhooks/kakao`, {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
  });
}

describe('production webhook signature boundaries', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    for (const key of Object.keys(mocks.secrets)) delete mocks.secrets[key];
  });

  it('fails Slack closed before ingest when the production signing secret is missing', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    mocks.ingestSlackRawEvent.mockResolvedValue({
      rawEventId: 'raw-1', parsedCount: 0, parseStatus: 'ignored', duplicated: false, errors: [],
    });
    const body = JSON.stringify({
      type: 'event_callback',
      event_id: 'evt-1',
      event: { type: 'message', channel: 'C1', ts: '1', text: 'forged deposit' },
    });

    const response = await slackPost(slackRequest(body));

    expect(response.status).toBe(503);
    expect(mocks.ingestSlackRawEvent).not.toHaveBeenCalled();
  });

  it('requires a Slack signature before returning a url verification challenge', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    mocks.secrets.SLACK_SIGNING_SECRET = 'slack-secret';
    const body = JSON.stringify({ type: 'url_verification', challenge: 'challenge-value' });

    const response = await slackPost(slackRequest(body));

    expect(response.status).toBe(401);
  });

  it('preserves a correctly signed Slack url verification request', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const secret = 'slack-secret';
    const timestamp = String(Math.floor(Date.now() / 1000));
    const body = JSON.stringify({ type: 'url_verification', challenge: 'challenge-value' });
    const signature = `v0=${createHmac('sha256', secret).update(`v0:${timestamp}:${body}`).digest('hex')}`;
    mocks.secrets.SLACK_SIGNING_SECRET = secret;

    const response = await slackPost(slackRequest(body, {
      'x-slack-request-timestamp': timestamp,
      'x-slack-signature': signature,
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ challenge: 'challenge-value' });
  });

  it('preserves ingest for a correctly signed Slack event', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const secret = 'slack-secret';
    const timestamp = String(Math.floor(Date.now() / 1000));
    const body = JSON.stringify({
      type: 'event_callback',
      event_id: 'evt-valid',
      event: { type: 'message', channel: 'C1', ts: '1', text: 'valid event' },
    });
    const signature = `v0=${createHmac('sha256', secret).update(`v0:${timestamp}:${body}`).digest('hex')}`;
    mocks.secrets.SLACK_SIGNING_SECRET = secret;
    mocks.ingestSlackRawEvent.mockResolvedValue({
      rawEventId: 'raw-valid', parsedCount: 1, parseStatus: 'parsed', duplicated: false, errors: [],
    });

    const response = await slackPost(slackRequest(body, {
      'x-slack-request-timestamp': timestamp,
      'x-slack-signature': signature,
    }));

    expect(response.status).toBe(200);
    expect(mocks.ingestSlackRawEvent).toHaveBeenCalledOnce();
  });

  it('fails Kakao closed before DB access when the production channel secret is missing', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      not: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
    };
    mocks.supabaseFrom.mockReturnValue(chain);
    const body = JSON.stringify({
      userRequest: { user: { id: 'attacker' }, utterance: 'forged inbound message' },
    });

    const response = await kakaoPost(kakaoRequest(body));

    expect(response.status).toBe(503);
    expect(mocks.supabaseFrom).not.toHaveBeenCalled();
  });

  it('preserves a correctly signed Kakao request', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const secret = 'kakao-secret';
    const body = JSON.stringify({ userRequest: {} });
    mocks.secrets.KAKAO_CHANNEL_SECRET = secret;

    const response = await kakaoPost(kakaoRequest(body, secret));

    expect(response.status).toBe(200);
    expect(mocks.supabaseFrom).not.toHaveBeenCalled();
  });

  it('rejects an invalid Kakao static API key before DB access', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    mocks.secrets.KAKAO_CHANNEL_SECRET = 'kakao-secret';
    const body = JSON.stringify({
      userRequest: { user: { id: 'attacker' }, utterance: 'forged inbound message' },
    });

    const response = await kakaoPost(kakaoRequest(body, 'invalid-signature'));

    expect(response.status).toBe(401);
    expect(mocks.supabaseFrom).not.toHaveBeenCalled();
  });

  it('preserves DB processing for a correctly signed Kakao message', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const secret = 'kakao-secret';
    const body = JSON.stringify({
      userRequest: { user: { id: 'customer-1' }, utterance: 'valid inbound message' },
    });
    mocks.secrets.KAKAO_CHANNEL_SECRET = secret;
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      not: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
    };
    mocks.supabaseFrom.mockReturnValue(chain);

    const response = await kakaoPost(kakaoRequest(body, secret));

    expect(response.status).toBe(200);
    expect(mocks.supabaseFrom).toHaveBeenCalledWith('kakao_inbound');
  });

  it.each([
    ['Slack', () => slackPost(slackRequest('{}', {}, 'https://preview.example.com'))],
    ['Kakao', () => kakaoPost(kakaoRequest('{}', '', 'https://preview.example.com'))],
  ])('does not allow unsigned %s requests on a non-local development host', async (_provider, invoke) => {
    vi.stubEnv('NODE_ENV', 'development');

    const response = await invoke();

    expect(response.status).toBe(503);
  });
});
