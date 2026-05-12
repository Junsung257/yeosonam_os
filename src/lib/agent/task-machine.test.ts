import { describe, expect, it } from 'vitest';
import { canTransitionTask } from '@/lib/agent/task-machine';

describe('agent task machine', () => {
  it('queued -> running 허용', () => {
    expect(canTransitionTask('queued', 'running')).toBe(true);
  });

  it('running -> done 허용', () => {
    expect(canTransitionTask('running', 'done')).toBe(true);
  });

  it('frozen -> resumed 허용', () => {
    expect(canTransitionTask('frozen', 'resumed')).toBe(true);
  });

  it('done -> running 금지', () => {
    expect(canTransitionTask('done', 'running')).toBe(false);
  });
});

