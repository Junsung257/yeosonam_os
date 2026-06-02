import type { LimitedWritePilotPolicy } from './ad-os-v101-v120';
import { supabaseAdmin } from './supabase';

export function envFlagEnabled(flagName?: string | null): boolean {
  const name = String(flagName || 'AD_OS_NAVER_LIMITED_WRITE_ENABLED').trim();
  return ['1', 'true', 'yes', 'on'].includes(String(process.env[name] || '').trim().toLowerCase());
}

export async function loadLatestNaverLimitedPilotPolicy(): Promise<LimitedWritePilotPolicy | null> {
  const { data, error } = await supabaseAdmin
    .from('ad_os_limited_write_pilot_policies')
    .select('*')
    .is('tenant_id', null)
    .eq('platform', 'naver')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data as LimitedWritePilotPolicy | null;
}
