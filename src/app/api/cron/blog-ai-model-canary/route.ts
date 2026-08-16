import { NextRequest } from 'next/server';

import {
  generateBlogTextWithReceipt,
  hasBlogApiKey,
} from '@/lib/blog-ai-caller';
import {
  buildBlogAiModelCanaryChecksV4,
  validateBlogAiModelCanaryResultV4,
} from '@/lib/blog-ai-model-canary-v4';
import { cronUnauthorizedResponse, isCronAuthorized } from '@/lib/cron-auth';
import { withCronLogging } from '@/lib/cron-observability';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 180;

async function runBlogAiModelCanary(request: NextRequest) {
  if (!isCronAuthorized(request)) return cronUnauthorizedResponse();
  const results: Array<Record<string, unknown>> = [];
  for (const check of buildBlogAiModelCanaryChecksV4()) {
    if (!hasBlogApiKey(check.model)) {
      results.push({ ...check, passed: false, failures: ['api_key_missing'] });
      continue;
    }
    try {
      const generated = await generateBlogTextWithReceipt(
        'Reply with exactly the two uppercase letters OK. Add no punctuation or explanation.',
        {
          model: check.model,
          systemPrompt: 'This is a production connectivity canary. Follow the response format exactly.',
          temperature: 0,
          maxTokens: 128,
          requestTimeoutMs: 45_000,
          deepseekThinking: check.deepseekThinking,
          reasoningEffort: check.reasoningEffort,
        },
      );
      const failures = validateBlogAiModelCanaryResultV4({ check, ...generated });
      results.push({
        ...check,
        passed: failures.length === 0,
        failures,
        receipt: generated.receipt,
      });
    } catch (error) {
      results.push({
        ...check,
        passed: false,
        failures: [error instanceof Error ? error.message : String(error)],
      });
    }
  }
  return {
    ok: results.length === 3 && results.every((result) => result.passed === true),
    read_only: true,
    model_calls: results.length,
    results,
  };
}

export const GET = withCronLogging('blog-ai-model-canary', runBlogAiModelCanary, {
  handlerTimeoutMs: 170_000,
  sideEffectTimeoutMs: 5_000,
});
