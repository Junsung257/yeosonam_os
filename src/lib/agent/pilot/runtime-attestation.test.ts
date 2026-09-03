import { describe, expect, it, vi } from 'vitest';
import type { CodexAppServerConnection, CodexAppServerConnectionFactory } from '@/lib/agent/runtime';
import { attestTechnologyScoutRuntime } from './runtime-attestation';

class FakeConnection implements CodexAppServerConnection {
  calls: string[] = [];
  async request(method: string): Promise<unknown> {
    this.calls.push(method);
    if (method === 'initialize') return { userAgent: 'Codex Desktop/test' };
    if (method === 'account/read') return { account: { type: 'chatgpt' } };
    if (method === 'permissionProfile/list') return { data: [{ id: ':read-only' }] };
    if (method === 'thread/start') return {
      thread: { id: 'thread-attestation', ephemeral: true },
      sandbox: { type: 'readOnly', networkAccess: false },
      activePermissionProfile: { id: ':read-only' },
    };
    throw new Error(`unexpected ${method}`);
  }
  notify() {}
  subscribe() { return vi.fn(); }
  async close() {}
}

describe('Codex Technology Scout runtime attestation', () => {
  it('proves the read-only profile without starting a model turn', async () => {
    const connection = new FakeConnection();
    const factory: CodexAppServerConnectionFactory = { open: vi.fn(async () => connection) };
    const report = await attestTechnologyScoutRuntime({
      connectionFactory: factory,
      workspaceRoot: process.cwd(),
      now: () => new Date('2026-09-04T00:00:00.000Z'),
    });
    expect(report.restrictedReadableRootsSupported).toBe(true);
    expect(report.permissionProfileId).toBe(':read-only');
    expect(report.networkAccessDisabled).toBe(true);
    expect(connection.calls).not.toContain('turn/start');
  });
});
