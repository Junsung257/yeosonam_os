import path from 'node:path';
import { fileURLToPath } from 'node:url';
import nextEnv from '@next/env';

const { loadEnvConfig } = nextEnv;

function value(env, key) {
  const raw = env[key];
  return typeof raw === 'string' ? raw.trim() : '';
}

export function validateAdminAuthBuildEnv(env) {
  const issues = [];
  const url = value(env, 'NEXT_PUBLIC_SUPABASE_URL');
  const publishableKey =
    value(env, 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY') ||
    value(env, 'NEXT_PUBLIC_SUPABASE_ANON_KEY');
  const adminEmails = value(env, 'ADMIN_EMAILS');

  if (!url) {
    issues.push('NEXT_PUBLIC_SUPABASE_URL is missing');
  } else {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:') issues.push('NEXT_PUBLIC_SUPABASE_URL must use https');
    } catch {
      issues.push('NEXT_PUBLIC_SUPABASE_URL must be a valid URL');
    }
  }

  if (!publishableKey) {
    issues.push('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or legacy NEXT_PUBLIC_SUPABASE_ANON_KEY) is missing');
  }
  if (!adminEmails) issues.push('ADMIN_EMAILS is missing');

  return { ok: issues.length === 0, issues };
}

export function main(args = process.argv.slice(2), env = process.env) {
  loadEnvConfig(process.cwd());
  const strict = args.includes('--strict') || env.VERCEL_ENV === 'production';
  if (!strict) {
    console.log('[admin-auth-env] skipped outside production (use --strict to enforce locally)');
    return 0;
  }

  const result = validateAdminAuthBuildEnv(env);
  if (!result.ok) {
    console.error('[admin-auth-env] production build blocked:');
    for (const issue of result.issues) console.error(`- ${issue}`);
    return 1;
  }

  console.log('[admin-auth-env] production login configuration verified');
  return 0;
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) process.exitCode = main();
