import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  claim: vi.fn(),
  bind: vi.fn(),
  cancel: vi.fn(),
}));

vi.mock('workflow/api', () => ({ start: mocks.start }));
vi.mock('@/workflows/blog-content-operation-v4', () => ({ blogContentOperationWorkflow: vi.fn() }));
vi.mock('./repository', () => ({
  claimBlogContentOperationV4: mocks.claim,
  bindBlogContentOperationWorkflowV4: mocks.bind,
}));

import { startBlogContentOperationWorkflowV4 } from './start-workflow';

function supabaseWith(row: Record<string, unknown>) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.maybeSingle = vi.fn(async () => ({ data: row, error: null }));
  return { from: vi.fn(() => chain) } as never;
}

describe('Blog V4 workflow start idempotency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cancel.mockResolvedValue(undefined);
  });

  it('reuses an already bound running workflow instead of starting a duplicate', async () => {
    const result = await startBlogContentOperationWorkflowV4({
      supabase: supabaseWith({
        id: 'operation-1', status: 'running', workflow_run_id: 'workflow-1',
        fencing_token: 4, queue_id: 'queue-1', lease_owner: 'owner',
        lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
      }),
      operationId: 'operation-1',
      requestBaseUrl: 'https://example.com',
    });
    expect(result).toEqual({ operationId: 'operation-1', workflowRunId: 'workflow-1', fencingToken: 4, reused: true });
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it('claims, starts, and binds one workflow for a queued operation', async () => {
    mocks.claim.mockResolvedValue({ id: 'operation-1', queueId: 'queue-1', fencingToken: 2 });
    mocks.start.mockResolvedValue({ runId: 'workflow-2', cancel: mocks.cancel });
    mocks.bind.mockResolvedValue(undefined);
    const result = await startBlogContentOperationWorkflowV4({
      supabase: supabaseWith({
        id: 'operation-1', status: 'queued', workflow_run_id: null,
        fencing_token: 0, queue_id: 'queue-1', lease_owner: null, lease_expires_at: null,
      }),
      operationId: 'operation-1',
      requestBaseUrl: 'https://example.com',
    });
    expect(result).toEqual({ operationId: 'operation-1', workflowRunId: 'workflow-2', fencingToken: 2, reused: false });
    expect(mocks.claim).toHaveBeenCalledTimes(1);
    expect(mocks.claim).toHaveBeenCalledWith(expect.objectContaining({
      leaseOwner: expect.stringMatching(/^blog-content-factory:operation-1:[0-9a-f-]{36}$/),
    }));
    expect(mocks.start).toHaveBeenCalledTimes(1);
    expect(mocks.bind).toHaveBeenCalledWith(expect.objectContaining({ workflowRunId: 'workflow-2', fencingToken: 2 }));
  });

  it('reclaims an expired running workflow with a new fencing token', async () => {
    mocks.claim.mockResolvedValue({ id: 'operation-1', queueId: 'queue-1', fencingToken: 8 });
    mocks.start.mockResolvedValue({ runId: 'workflow-recovered', cancel: mocks.cancel });
    mocks.bind.mockResolvedValue(undefined);
    const result = await startBlogContentOperationWorkflowV4({
      supabase: supabaseWith({
        id: 'operation-1', status: 'running', workflow_run_id: 'workflow-expired',
        fencing_token: 7, queue_id: 'queue-1', lease_owner: 'old-owner',
        lease_expires_at: '2026-08-18T00:00:00Z',
      }),
      operationId: 'operation-1',
      requestBaseUrl: 'https://example.com',
    });
    expect(result).toEqual({
      operationId: 'operation-1', workflowRunId: 'workflow-recovered', fencingToken: 8, reused: false,
    });
    expect(mocks.claim).toHaveBeenCalledTimes(1);
    expect(mocks.start).toHaveBeenCalledTimes(1);
  });

  it('cancels the newly started workflow when durable run binding loses the fence', async () => {
    mocks.claim.mockResolvedValue({ id: 'operation-1', queueId: 'queue-1', fencingToken: 3 });
    mocks.start.mockResolvedValue({ runId: 'workflow-3', cancel: mocks.cancel });
    mocks.bind.mockRejectedValue(new Error('fencing conflict'));
    await expect(startBlogContentOperationWorkflowV4({
      supabase: supabaseWith({
        id: 'operation-1', status: 'queued', workflow_run_id: null,
        fencing_token: 0, queue_id: 'queue-1', lease_owner: null, lease_expires_at: null,
      }),
      operationId: 'operation-1',
      requestBaseUrl: 'https://example.com',
    })).rejects.toThrow('fencing conflict');
    expect(mocks.cancel).toHaveBeenCalledTimes(1);
  });
});
