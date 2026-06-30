import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  loadEnvFileIfExists,
  resolveSupabaseEnv,
} = require('../../../scripts/refresh-baselines.js') as {
  loadEnvFileIfExists: (path?: string) => { loaded: boolean; keys: string[] };
  resolveSupabaseEnv: (env?: NodeJS.ProcessEnv | Record<string, string | undefined>) => {
    url: string;
    serviceKey: string;
  };
};

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('refresh-baselines env handling', () => {
  it('uses SUPABASE_SERVICE_KEY as the fallback service key', () => {
    const resolved = resolveSupabaseEnv({
      NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_KEY: 'x'.repeat(80),
    });

    expect(resolved.url).toBe('https://example.supabase.co');
    expect(resolved.serviceKey).toBe('x'.repeat(80));
  });

  it('fails before Playwright when the Supabase env is missing', () => {
    expect(() => resolveSupabaseEnv({})).toThrow(/Baseline Refresh Supabase preflight failed/);
    expect(() => resolveSupabaseEnv({})).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
    expect(() => resolveSupabaseEnv({})).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it('loads .env fallback values without overriding explicit environment values', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'baseline-env-'));
    const envPath = path.join(tempDir, '.env.local');
    fs.writeFileSync(
      envPath,
      [
        'NEXT_PUBLIC_SUPABASE_URL=https://file.supabase.co',
        'SUPABASE_SERVICE_ROLE_KEY=file-key',
      ].join('\n'),
    );

    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://env.supabase.co';
    const loaded = loadEnvFileIfExists(envPath);

    expect(loaded.loaded).toBe(true);
    expect(process.env.NEXT_PUBLIC_SUPABASE_URL).toBe('https://env.supabase.co');
    expect(process.env.SUPABASE_SERVICE_ROLE_KEY).toBe('file-key');
  });
});
