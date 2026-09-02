import { beforeEach, describe, expect, it, vi } from 'vitest';

const from = vi.fn();

vi.mock('./supabase', () => ({
  supabaseAdmin: { from },
}));

describe('blog pillar generator demand boundary', () => {
  beforeEach(() => {
    from.mockReset();
  });

  it('does not create a queue row from a coverage gap alone', async () => {
    const { queuePillarGeneration } = await import('./blog-pillar-generator');
    await expect(queuePillarGeneration({ destination: '푸꾸옥' })).resolves.toEqual({
      queued: false,
      reason: 'verified demand required',
    });
    expect(from).not.toHaveBeenCalled();
  });

  it('does not accept an operator-note boolean without a durable note id', async () => {
    const { queuePillarGeneration } = await import('./blog-pillar-generator');
    await expect(queuePillarGeneration({
      destination: '푸꾸옥',
      demand: { verifiedOperatorNote: true },
    })).resolves.toEqual({ queued: false, reason: 'verified demand required' });
    expect(from).not.toHaveBeenCalled();
  });
});
