import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  loadImmutableRemoteJsonSnapshotV3,
  readImmutableRemoteSnapshotConfigV3,
} from './blog-public-remote-snapshot-v3';

describe('immutable remote blog snapshot', () => {
  it('requires HTTPS, an explicit checksum, and a content-addressed URL', () => {
    const sha = 'a'.repeat(64);
    expect(readImmutableRemoteSnapshotConfigV3({ url: `https://cdn.example/${sha}.json`, sha256: sha }))
      .toEqual({ url: `https://cdn.example/${sha}.json`, sha256: sha });
    expect(readImmutableRemoteSnapshotConfigV3({ url: 'https://cdn.example/latest.json', sha256: sha })).toBeNull();
    expect(readImmutableRemoteSnapshotConfigV3({ url: `http://cdn.example/${sha}.json`, sha256: sha })).toBeNull();
  });

  it('returns only a body whose SHA-256 matches the immutable address', async () => {
    const body = JSON.stringify({ generated_at: '2026-08-16T00:00:00.000Z', posts: [] });
    const sha = createHash('sha256').update(body).digest('hex');
    const fetchImpl = vi.fn().mockResolvedValue(new Response(body, {
      status: 200,
      headers: { 'content-length': String(Buffer.byteLength(body)) },
    }));

    await expect(loadImmutableRemoteJsonSnapshotV3({
      url: `https://cdn.example/blog/${sha}.json`,
      sha256: sha,
      fetchImpl,
    })).resolves.toEqual({ state: 'found', value: JSON.parse(body) });

    await expect(loadImmutableRemoteJsonSnapshotV3({
      url: `https://cdn.example/blog/${'b'.repeat(64)}.json`,
      sha256: 'b'.repeat(64),
      fetchImpl,
    })).resolves.toEqual({ state: 'unavailable', value: null });
  });

  it('fails closed for partial configuration and oversized artifacts', async () => {
    expect(await loadImmutableRemoteJsonSnapshotV3({ url: 'https://cdn.example/latest.json' }))
      .toEqual({ state: 'invalid_config', value: null });
    const body = JSON.stringify({ value: 'too-large' });
    const sha = createHash('sha256').update(body).digest('hex');
    expect(await loadImmutableRemoteJsonSnapshotV3({
      url: `https://cdn.example/${sha}.json`,
      sha256: sha,
      maxBytes: 2,
      fetchImpl: vi.fn().mockResolvedValue(new Response(body, { status: 200 })),
    })).toEqual({ state: 'unavailable', value: null });
  });
});
