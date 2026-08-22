import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  PRODUCTION_SUPABASE_HOSTNAME,
  getSupabaseNetworkPolicy,
} = require('../../scripts/lib/supabase-network-allowlist.cjs') as {
  PRODUCTION_SUPABASE_HOSTNAME: string;
  getSupabaseNetworkPolicy: (input: { vercelEnv?: string; urls: string[] }) => {
    origins: string[];
    hostnames: string[];
    websocketOrigins: string[];
    remotePatterns: Array<{ protocol: string; hostname: string }>;
  };
};

const FREE_URL = 'https://nwtmtksjedkqehgnrxij.supabase.co/rest/v1';
const PRO_URL = `https://${PRODUCTION_SUPABASE_HOSTNAME}/rest/v1`;

describe('Supabase network allowlist', () => {
  it('uses only the exact Free origin for Preview', () => {
    const policy = getSupabaseNetworkPolicy({ vercelEnv: 'preview', urls: [FREE_URL, FREE_URL] });

    expect(policy.origins).toEqual([`https://nwtmtksjedkqehgnrxij.supabase.co`]);
    expect(policy.hostnames).toEqual(['nwtmtksjedkqehgnrxij.supabase.co']);
    expect(policy.websocketOrigins).toEqual(['wss://nwtmtksjedkqehgnrxij.supabase.co']);
    expect(policy.remotePatterns).toEqual([{
      protocol: 'https',
      hostname: 'nwtmtksjedkqehgnrxij.supabase.co',
    }]);
    expect(policy.origins.some((value) => value.includes('*'))).toBe(false);
    expect(policy.hostnames.some((value) => value === PRODUCTION_SUPABASE_HOSTNAME)).toBe(false);
  });

  it('fails closed when Preview is configured with the production origin', () => {
    expect(() => getSupabaseNetworkPolicy({ vercelEnv: 'preview', urls: [PRO_URL] }))
      .toThrow(/Preview must not allow the production Supabase origin/);
  });

  it('uses only the exact production origin for production', () => {
    const policy = getSupabaseNetworkPolicy({ vercelEnv: 'production', urls: [PRO_URL, PRO_URL] });

    expect(policy.origins).toEqual([`https://${PRODUCTION_SUPABASE_HOSTNAME}`]);
    expect(policy.websocketOrigins).toEqual([`wss://${PRODUCTION_SUPABASE_HOSTNAME}`]);
    expect(policy.remotePatterns).toEqual([{
      protocol: 'https',
      hostname: PRODUCTION_SUPABASE_HOSTNAME,
    }]);
  });

  it('fails closed when production is configured with a non-production origin', () => {
    expect(() => getSupabaseNetworkPolicy({ vercelEnv: 'production', urls: [FREE_URL] }))
      .toThrow(/Production must use only the approved Supabase origin/);
  });
});
