#!/usr/bin/env tsx

import dotenv from 'dotenv';
import { evaluateCustomerInquiryReadiness } from '../src/lib/jarvis/eval/customer-inquiry-readiness';

dotenv.config({ path: '.env.local' });
dotenv.config();

type CliOptions = {
  json: boolean;
  strict: boolean;
  requireDb: boolean;
  requireExternal: boolean;
};

type EnvCheck = {
  id: string;
  label: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
};

function parseCliOptions(args: string[]): CliOptions {
  return {
    json: args.includes('--json'),
    strict: args.includes('--strict'),
    requireDb: args.includes('--require-db'),
    requireExternal: args.includes('--require-external'),
  };
}

function hasEnv(...keys: string[]): boolean {
  return keys.some((key) => Boolean(process.env[key]?.trim()));
}

function buildEnvChecks(options: CliOptions): EnvCheck[] {
  const hasSupabaseUrl = hasEnv('NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL');
  const hasServiceKey = hasEnv('SUPABASE_SERVICE_ROLE_KEY');
  const hasAnonKey = hasEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  const hasAnyDbKey = hasServiceKey || hasAnonKey;
  const hasLlm = hasEnv('DEEPSEEK_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_AI_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY');
  const hasExternalChannel = hasEnv('SOLAPI_API_KEY', 'KAKAO_REST_API_KEY', 'KAKAO_CHANNEL_ID', 'SLACK_WEBHOOK_URL');

  return [
    {
      id: 'supabase',
      label: 'Supabase customer/RAG data',
      status: hasSupabaseUrl && hasAnyDbKey ? 'pass' : options.requireDb ? 'fail' : 'warn',
      message: hasSupabaseUrl && hasAnyDbKey
        ? hasServiceKey ? 'Supabase URL and service key present' : 'Supabase URL and anon key present'
        : 'Missing Supabase URL or key; live inquiry/RAG evidence will be skipped',
    },
    {
      id: 'llm',
      label: 'LLM response generation',
      status: hasLlm ? 'pass' : options.strict ? 'fail' : 'warn',
      message: hasLlm ? 'At least one LLM provider key is present' : 'Missing LLM provider key; live answer generation will use fallback or fail',
    },
    {
      id: 'external-channel',
      label: 'External handoff channel',
      status: hasExternalChannel ? 'pass' : options.requireExternal ? 'fail' : 'warn',
      message: hasExternalChannel
        ? 'At least one customer handoff channel key is present'
        : 'Missing Kakao/Alimtalk/Slack channel env; external handoff is not live-verifiable',
    },
  ];
}

function printText(payload: ReturnType<typeof buildPayload>) {
  console.log(
    `Customer inquiry readiness: ${payload.ok ? 'PASS' : 'FAIL'} ` +
    `${payload.scenarios.score}/100 (${payload.scenarios.passed}/${payload.scenarios.total} scenarios)`,
  );

  for (const result of payload.scenarios.results) {
    console.log(`- ${result.passed ? 'PASS' : 'FAIL'} ${result.id} [${result.category}] ${result.description}`);
    for (const check of result.checks) {
      if (check.passed) continue;
      console.log(`  - ${check.name}: expected=${JSON.stringify(check.expected)} actual=${JSON.stringify(check.actual)}`);
    }
  }

  console.log('Environment:');
  for (const check of payload.envChecks) {
    console.log(`- ${check.status.toUpperCase()} ${check.id}: ${check.message}`);
  }
}

function buildPayload(options: CliOptions) {
  const scenarios = evaluateCustomerInquiryReadiness();
  const envChecks = buildEnvChecks(options);
  const envOk = envChecks.every((check) => check.status !== 'fail');
  const ok = scenarios.status === 'pass' && envOk;

  return {
    ok,
    options,
    scenarios,
    envChecks,
  };
}

const options = parseCliOptions(process.argv.slice(2));
const payload = buildPayload(options);

if (options.json) {
  console.log(JSON.stringify(payload, null, 2));
} else {
  printText(payload);
}

if (!payload.ok) {
  process.exitCode = 1;
}
