import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const REGISTRATION_AI_PATHS = [
  'src/lib/product-registration-v6/critical-fact-automation.ts',
  'src/lib/product-registration-v6/critical-fact-consensus.ts',
  'src/lib/parser/catalog-pre-split.ts',
  'src/lib/parser/upload-consistency-judge.ts',
  'src/lib/parser/activity-normalizer.ts',
  'src/lib/parser/extract-itinerary.ts',
  'src/lib/parser/extracted-field-repair.ts',
  'src/lib/parser/llm/section-extractors.ts',
  'src/lib/product-registration/price-recovery.ts',
  'src/lib/product-registration/upload-supplier-context.ts',
  'src/lib/normalize-with-llm.ts',
  'src/lib/upload-ir-extract.ts',
  'src/lib/upload-ir-shadow.ts',
  'src/lib/ir-canary.ts',
  'src/app/api/register-via-ir/route.ts',
];

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('product registration DeepSeek-only contract', () => {
  it('does not keep a direct Gemini/Claude execution path in registration AI modules', () => {
    for (const path of REGISTRATION_AI_PATHS) {
      const text = source(path);
      expect(text, path).not.toMatch(/(?:GoogleGenerativeAI|@google\/generative-ai|\.generateContent\s*\()/u);
      expect(text, path).not.toMatch(/getSecret\(['"](?:GOOGLE|GEMINI|ANTHROPIC)_/u);
      expect(text, path).not.toMatch(/pinnedProvider:\s*['"](?:gemini|claude)['"]/u);
    }
  });

  it('pins every registration LLM call to DeepSeek and disables escalation', () => {
    const pathsWithCalls = REGISTRATION_AI_PATHS.filter(path => (
      path !== 'src/lib/product-registration-v6/critical-fact-automation.ts'
      && (/llmCall\s*</u.test(source(path)) || /llmCall\(/u.test(source(path)))
    ));
    expect(pathsWithCalls.length).toBeGreaterThan(0);
    for (const path of pathsWithCalls) {
      const text = source(path);
      if (path === 'src/lib/product-registration-v6/critical-fact-consensus.ts') {
        expect(text, path).toContain('pinnedProvider: input.provider');
      } else {
        expect(text, path).toContain("pinnedProvider: 'deepseek'");
      }
      expect(text, path).toContain('autoEscalate: false');
    }
    expect(source('src/lib/product-registration-v6/critical-fact-automation.ts')).toContain('pinnedProvider: request.provider');
    expect(source('src/lib/product-registration-v6/critical-fact-consensus.ts')).toContain("provider: 'deepseek'");
  });

  it('rejects non-DeepSeek engines at the IR registration boundary', () => {
    const route = source('src/app/api/register-via-ir/route.ts');
    expect(route).toContain('PRODUCT_REGISTRATION_DEEPSEEK_ONLY');
    expect(route).toContain("engine?: 'deepseek' | 'direct'");
    expect(source('src/lib/normalize-with-llm.ts')).toContain('PRODUCT_REGISTRATION_DEEPSEEK_ONLY');
  });
});
