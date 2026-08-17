import type { SupabaseClient } from '@supabase/supabase-js';

import { productRegistrationV6PublicationBlocker } from './runtime-config';

type KillSwitch = {
  scope: string;
  scope_key: string;
  reason: string;
};

export async function loadProductRegistrationV6PublicationBlockers(input: {
  supabase: SupabaseClient;
  catalogProductIds: string[];
  supplierKeys?: string[];
}): Promise<string[]> {
  const blockers: string[] = [];
  const runtimeBlocker = productRegistrationV6PublicationBlocker();
  if (runtimeBlocker) blockers.push(runtimeBlocker);

  const suppliers = new Set((input.supplierKeys ?? []).map(value => value.trim()).filter(Boolean));

  const { data: switches, error: switchError } = await input.supabase
    .from('product_registration_v5_kill_switches')
    .select('scope,scope_key,reason')
    .eq('active', true)
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`);
  if (switchError) throw switchError;
  for (const item of (switches ?? []) as KillSwitch[]) {
    const applies = item.scope === 'global'
      || (item.scope === 'product' && (item.scope_key === '*' || input.catalogProductIds.includes(item.scope_key)))
      || (item.scope === 'supplier' && (item.scope_key === '*' || suppliers.has(item.scope_key)))
      || (item.scope === 'parser' && ['*', 'product-registration-v6'].includes(item.scope_key))
      || ['model', 'ocr_provider', 'transport_provider'].includes(item.scope);
    if (applies) blockers.push(`KILL_SWITCH:${item.scope}:${item.scope_key}:${item.reason}`);
  }
  return [...new Set(blockers)];
}
