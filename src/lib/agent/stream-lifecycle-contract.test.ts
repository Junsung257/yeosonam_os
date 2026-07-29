import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('agent stream lifecycle contract', () => {
  it('terminalizes the V1 QA task before closing the successful response stream', () => {
    const text = source('src/lib/qa-chat-engine.ts');
    const successStart = text.indexOf('recordPlatformLearningEvent({');
    const transition = text.indexOf(
      "transitionAgentTask(agentTaskId, 'running', 'done'",
      successStart,
    );
    const close = text.indexOf('closeStream()', transition);

    expect(successStart).toBeGreaterThan(-1);
    expect(transition).toBeGreaterThan(successStart);
    expect(close).toBeGreaterThan(transition);
  });

  it('terminalizes the V2 wrapper when it delegates to V1 and closes only in finally', () => {
    const text = source('src/app/api/qa/chat/v2/route.ts');
    const fallbackStart = text.indexOf("fallback: 'v1'");
    const delegated = text.indexOf("delegatedTo: 'qa_chat_v1'", fallbackStart);
    const fallbackReturn = text.indexOf('return', delegated);
    const finalClose = text.indexOf('closeStream()', fallbackReturn);

    expect(delegated).toBeGreaterThan(fallbackStart);
    expect(fallbackReturn).toBeGreaterThan(delegated);
    expect(finalClose).toBeGreaterThan(fallbackReturn);
    expect(text.match(/controller\.close\(\)/g)).toHaveLength(1);
  });

  it('does not create a Jarvis stream task for unsupported V2 dispatch', () => {
    const text = source('src/app/api/jarvis/stream/route.ts');
    const unsupported = text.indexOf('if (!dispatch.supported || !dispatch.config)');
    const createTask = text.indexOf('createAgentTask(decision.envelope)');

    expect(unsupported).toBeGreaterThan(-1);
    expect(createTask).toBeGreaterThan(unsupported);
  });

  it('keeps the approval ledger observation-only without a fake resume endpoint', () => {
    expect(
      existsSync(join(
        process.cwd(),
        'src/app/api/agent/approvals/[id]/route.ts',
      )),
    ).toBe(false);
  });

  it('isolates housekeeping from external executor and channel actions', () => {
    const text = source('src/app/api/cron/agent-housekeeping/route.ts');

    expect(text).toContain('requireCronBearer');
    expect(text).toContain('runAgentHousekeeping');
    expect(text).not.toContain('executeAction');
    expect(text).not.toContain('gsc-client');
    expect(text).not.toContain('instagram');
    expect(text).not.toContain('maybeSkipNonCriticalCron');
    expect(text).not.toContain('maybeSkipCronForResourceSaver');
  });
});
