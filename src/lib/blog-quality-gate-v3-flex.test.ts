import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkLength } from './blog-quality-gate';

describe('blog quality gate V3 flexible brief', () => {
  it('does not impose a fixed informational character target on a V3 brief', () => {
    const result = checkLength('질문의 결정을 근거 안에서 바로 답합니다.', 'info', true);
    expect(result.passed).toBe(true);
    expect(result.evidence).toMatchObject({
      min: null,
      policy: 'v3_intent_and_evidence_no_fixed_length',
    });
  });

  it('still rejects an empty V3 article', () => {
    expect(checkLength('', 'info', true).passed).toBe(false);
  });

  it('does not apply the legacy rigid information contract to V3 briefs', () => {
    const source = readFileSync(join(process.cwd(), 'src/lib/blog-quality-gate.ts'), 'utf8');
    expect(source).toContain("&& !input.generation_meta?.content_brief_v3");
  });
});
