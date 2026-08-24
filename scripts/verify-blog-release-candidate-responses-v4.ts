import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { verifyBlogReleaseCandidateResponsesV4 } from './lib/blog-release-candidate-responses-v4';

function argument(name: string): string | null {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? null;
}

function readJson(path: string | null, label: string): Record<string, unknown> {
  if (!path) throw new Error(`candidate_response_path_missing:${label}`);
  const absolute = resolve(path);
  if (!existsSync(absolute)) throw new Error(`candidate_response_file_missing:${label}:${absolute}`);
  try {
    const value = JSON.parse(readFileSync(absolute, 'utf8')) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('response_is_not_an_object');
    }
    return value as Record<string, unknown>;
  } catch (error) {
    throw new Error(
      `candidate_response_not_json:${label}:${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

try {
  const result = verifyBlogReleaseCandidateResponsesV4({
    aiModelCanary: readJson(argument('ai-model-canary'), 'ai_model_canary'),
    analyticsCanary: readJson(argument('analytics-canary'), 'analytics_canary'),
    rankTracking: readJson(argument('rank-tracking'), 'rank_tracking'),
    dataReadiness: readJson(argument('data-readiness'), 'data_readiness'),
  }, {
    requirePublicationReady: process.argv.includes('--require-publication-ready'),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  process.stderr.write(
    `blog V4 candidate response verification failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
