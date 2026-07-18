import type { SupabaseClient } from '@supabase/supabase-js';

import {
  getCustomerAttractionRenderBlockers,
  type AttractionData,
} from '@/lib/attraction-matcher';

type AnyRecord = Record<string, unknown>;

function asRecord(value: unknown): AnyRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as AnyRecord : null;
}

export function collectItineraryAttractionIds(value: unknown): string[] {
  const ids = new Set<string>();
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    const record = asRecord(node);
    if (!record) return;
    if (Array.isArray(record.attraction_ids)) {
      for (const id of record.attraction_ids) {
        if (typeof id === 'string' && id.trim()) ids.add(id.trim());
      }
    }
    for (const child of Object.values(record)) visit(child);
  };
  visit(value);
  return [...ids];
}

export async function validateCustomerPublishableAttractionIds(
  supabase: SupabaseClient,
  ids: string[],
): Promise<{ invalidIds: string[]; lookupError: string | null }> {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  if (uniqueIds.length === 0) return { invalidIds: [], lookupError: null };

  const { data, error } = await supabase
    .from('attractions')
    .select('id, name, category, badge_type, is_active, customer_publishable')
    .in('id', uniqueIds)
    .eq('is_active', true);
  if (error) {
    return {
      invalidIds: uniqueIds,
      lookupError: `customer-publishable attraction_id lookup failed: ${error.message ?? String(error)}`,
    };
  }

  const publishableIds = new Set(
    ((data ?? []) as Array<AttractionData>)
      .filter(row => getCustomerAttractionRenderBlockers(row).length === 0)
      .map(row => typeof row.id === 'string' ? row.id.trim() : '')
      .filter(Boolean),
  );
  return {
    invalidIds: uniqueIds.filter(id => !publishableIds.has(id)),
    lookupError: null,
  };
}
