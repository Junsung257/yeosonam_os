import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkAiReadability, checkHook, checkLength } from './blog-quality-gate';

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

  it('does not require FAQ or five fixed H2 sections for a flexible V3 brief', () => {
    const markdown = [
      '# 다낭 가볼만한곳 선택 기준',
      '',
      '다낭 가볼만한곳은 내 일정과 동행자의 우선순위를 먼저 정하고 검증된 정보를 비교해 고릅니다.',
      '',
      '## 오행산 공식 정보',
      '',
      '검증된 사실 문장입니다.',
      '',
      '## 린응사 공식 정보',
      '',
      '- 이 공식 정보가 내 일정과 맞는가?',
      '- 이 수치를 내 우선순위와 비교하면 어떤 선택이 남는가?',
    ].join('\n');

    expect(checkAiReadability(markdown, 'info', true).passed).toBe(true);
    expect(checkAiReadability(markdown, 'info', false).passed).toBe(false);
  });

  it('accepts a direct decision answer without forcing a numeric hook', () => {
    const markdown = [
      '# 다낭 가볼만한곳 선택 기준',
      '',
      '다낭에서 어디를 갈지는 내 일정과 체력을 먼저 확인한 뒤, 공식 정보와 우선순위를 비교해 결정하면 됩니다.',
    ].join('\n');

    expect(checkHook(markdown, true)).toMatchObject({
      passed: true,
      evidence: { policy: 'v3_answer_first_without_forced_numeric_hook' },
    });
    expect(checkHook(markdown, false).passed).toBe(false);
  });
});
