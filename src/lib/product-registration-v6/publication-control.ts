import type { SupabaseClient } from '@supabase/supabase-js';

import {
  productRegistrationV6PublicationBlocker,
  productRegistrationV6SourceProofAutoPublishEnabled,
} from './runtime-config';

type KillSwitch = {
  scope: string;
  scope_key: string;
  reason: string;
};

export async function loadProductRegistrationV6PublicationBlockers(input: {
  supabase: SupabaseClient;
  catalogProductIds: string[];
  supplierKeys?: string[];
  /**
   * Let the workflow reach the database source-proof CAS writer even while
   * the normal cohort/freeze flags are off.  This does not publish by itself;
   * an ineligible source is rejected by the immutable DB gate.
   */
  allowSourceProofAutoPublish?: boolean;
}): Promise<string[]> {
  const blockers: string[] = [];
  const runtimeBlocker = productRegistrationV6PublicationBlocker();
  const sourceProofMode = input.allowSourceProofAutoPublish
    && productRegistrationV6SourceProofAutoPublishEnabled();
  const sourceProofSoftBlockers = new Set([
    'PUBLICATION_FREEZE_ACTIVE',
    'V6_SHADOW_MODE_PUBLICATION_DISABLED',
    'V6_PUBLICATION_DISABLED',
  ]);
  if (runtimeBlocker && !(sourceProofMode && sourceProofSoftBlockers.has(runtimeBlocker))) {
    blockers.push(runtimeBlocker);
  }

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
