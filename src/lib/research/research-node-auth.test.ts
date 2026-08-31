import { afterEach, describe, expect, it } from 'vitest';

import { isResearchNodeAuthorized } from '@/lib/research/research-node-auth';

const originalToken = process.env.RESEARCH_NODE_INGEST_TOKEN;

afterEach(() => {
  if (originalToken === undefined) delete process.env.RESEARCH_NODE_INGEST_TOKEN;
  else process.env.RESEARCH_NODE_INGEST_TOKEN = originalToken;
});

describe('research node authorization', () => {
  it('fails closed when the server token is absent or too short', () => {
    delete process.env.RESEARCH_NODE_INGEST_TOKEN;
    expect(isResearchNodeAuthorized(new Request('https://example.com'))).toBe(false);
    process.env.RESEARCH_NODE_INGEST_TOKEN = 'short';
    expect(isResearchNodeAuthorized(new Request('https://example.com', {
      headers: { authorization: 'Bearer short' },
    }))).toBe(false);
  });

  it('requires an exact bearer token', () => {
    const token = 'r'.repeat(48);
    process.env.RESEARCH_NODE_INGEST_TOKEN = token;

    expect(isResearchNodeAuthorized(new Request('https://example.com', {
      headers: { authorization: `Bearer ${token}` },
    }))).toBe(true);
    expect(isResearchNodeAuthorized(new Request('https://example.com', {
      headers: { authorization: `Bearer ${'x'.repeat(48)}` },
    }))).toBe(false);
  });
});
