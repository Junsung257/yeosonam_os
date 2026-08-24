import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { createClient } = vi.hoisted(() => ({
  createClient: vi.fn(() => ({ auth: {} })),
}));

vi.mock('@supabase/supabase-js', () => ({ createClient }));

describe('Supabase browser auth client', () => {
  beforeEach(() => {
    vi.resetModules();
    createClient.mockClear();
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project-ref.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_example');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '');
    vi.stubEnv('SUPABASE_URL', '');
    vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', '');
    vi.stubEnv('SUPABASE_ANON_KEY', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses the statically referenced publishable key and does not persist or refresh sessions', async () => {
    const { getSupabaseAuthClient } = await import('./supabase');

    getSupabaseAuthClient();

    expect(createClient).toHaveBeenCalledWith(
      'https://project-ref.supabase.co',
      'sb_publishable_example',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
          detectSessionInUrl: false,
        },
      },
    );
  });

  it('fails with a stable non-secret code when public config is absent', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', '');
    const { getSupabaseAuthClient } = await import('./supabase');

    expect(() => getSupabaseAuthClient()).toThrow('SUPABASE_PUBLIC_CONFIG_MISSING');
    expect(createClient).not.toHaveBeenCalled();
  });
});
