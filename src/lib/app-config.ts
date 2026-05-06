import { getSecret } from '@/lib/secret-registry';

export function isMetaAdsTestMode(): boolean {
  return process.env.META_ADS_TEST_MODE === '1';
}

export function getSupabasePublicConfig(): { url: string | null; anonKey: string | null } {
  const url = getSecret('NEXT_PUBLIC_SUPABASE_URL') || getSecret('SUPABASE_URL') || null;
  const anonKey = getSecret('NEXT_PUBLIC_SUPABASE_ANON_KEY') || getSecret('SUPABASE_ANON_KEY');
  return { url, anonKey };
}

