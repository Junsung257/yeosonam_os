import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';
import { extractStructuredFactsFromSupplierText } from '../src/lib/product-registration-v3/structured-facts';
import type { StandardNoticeDraft } from '../src/lib/product-registration-v3/standard-notices';
import type { StructuredFact } from '../src/lib/product-registration-v3/structured-facts';

type PackageRow = {
  id: string;
  title: string | null;
  destination: string | null;
  status: string | null;
  created_at: string | null;
  raw_text: string | null;
  itinerary_data: unknown;
  inclusions: unknown;
  excludes: unknown;
  notices_parsed: unknown;
};

type DraftRow = {
  id: string;
  package_id: string | null;
  status: string | null;
  ledger: any;
  gate_result: unknown;
  created_at: string | null;
};

function loadEnvFile(file: string): void {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx < 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFile(path.resolve(process.cwd(), '.env.local'));
loadEnvFile(path.resolve(process.cwd(), '.env'));

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = supabaseUrl && supabaseKey
  ? createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } })
  : null;

function argValue(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  const found = process.argv.find(arg => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

const apply = process.argv.includes('--apply');
const force = process.argv.includes('--force');
const includeArchived = process.argv.includes('--include-archived');
const days = Number(argValue('days', '3'));
const limit = Number(argValue('limit', '50'));

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function noticeKey(row: StandardNoticeDraft): string {
  return [row.category, row.template_key, row.source_text].join('::');
}

function mergeNotices(existing: unknown, incoming: StandardNoticeDraft[]): StandardNoticeDraft[] {
  const base = Array.isArray(existing) ? existing.filter(isObject) as unknown as StandardNoticeDraft[] : [];
  const seen = new Set(base.map(noticeKey));
  const next = [...base];
  for (const notice of incoming) {
    const key = noticeKey(notice);
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(notice);
  }
  return next;
}

function countVariantRows(ledger: unknown, key: 'structured_facts' | 'standard_notices'): number {
  if (!isObject(ledger) || !Array.isArray(ledger.variants)) return 0;
  return ledger.variants.reduce((sum: number, variant: unknown) => {
    if (!isObject(variant) || !Array.isArray(variant[key])) return sum;
    return sum + variant[key].length;
  }, 0);
}

function patchLedger(
  ledger: unknown,
  structuredFacts: StructuredFact[],
  standardNotices: StandardNoticeDraft[],
): { ledger: unknown; changed: boolean; beforeFacts: number; afterFacts: number; beforeNotices: number; afterNotices: number } {
  if (!isObject(ledger) || !Array.isArray(ledger.variants)) {
    return { ledger, changed: false, beforeFacts: 0, afterFacts: 0, beforeNotices: 0, afterNotices: 0 };
  }

  const beforeFacts = countVariantRows(ledger, 'structured_facts');
  const beforeNotices = countVariantRows(ledger, 'standard_notices');
  let changed = false;

  const variants = ledger.variants.map((variant: unknown) => {
    if (!isObject(variant)) return variant;
    const currentFacts = Array.isArray(variant.structured_facts) ? variant.structured_facts : [];
    const shouldReplaceFacts = force || currentFacts.length === 0;
    const nextFacts = shouldReplaceFacts ? structuredFacts : currentFacts;
    const nextNotices = mergeNotices(variant.standard_notices, standardNotices);

    if (shouldReplaceFacts && structuredFacts.length !== currentFacts.length) changed = true;
    if (nextNotices.length !== (Array.isArray(variant.standard_notices) ? variant.standard_notices.length : 0)) changed = true;

    return {
      ...variant,
      structured_facts: nextFacts,
      standard_notices: nextNotices,
    };
  });

  const nextLedger = { ...ledger, variants };
  return {
    ledger: nextLedger,
    changed,
    beforeFacts,
    afterFacts: countVariantRows(nextLedger, 'structured_facts'),
    beforeNotices,
    afterNotices: countVariantRows(nextLedger, 'standard_notices'),
  };
}

async function loadLatestDraft(packageId: string): Promise<DraftRow | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('product_registration_drafts')
    .select('id, package_id, status, ledger, gate_result, created_at')
    .eq('package_id', packageId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return data as DraftRow;
}

async function main() {
  if (!supabase) throw new Error('Supabase env missing.');
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  let query = supabase
    .from('travel_packages')
    .select('id, title, destination, status, created_at, raw_text, itinerary_data, inclusions, excludes, notices_parsed')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (!includeArchived) query = query.neq('status', 'archived');

  const { data, error } = await query;
  if (error) throw error;

  const rows = (data ?? []) as PackageRow[];
  const results = [];
  let changedCount = 0;
  let appliedCount = 0;

  for (const pkg of rows) {
    const draft = await loadLatestDraft(pkg.id);
    if (!draft) {
      results.push({ id: pkg.id, title: pkg.title, status: pkg.status, action: 'skip_no_draft' });
      continue;
    }

    const extracted = extractStructuredFactsFromSupplierText({
      rawText: pkg.raw_text,
      itinerary_data: pkg.itinerary_data,
      inclusions: pkg.inclusions,
      excludes: pkg.excludes,
      notices: pkg.notices_parsed,
      title: pkg.title,
      destination: pkg.destination,
    });

    const patched = patchLedger(draft.ledger, extracted.structuredFacts, extracted.standardNotices);
    if (patched.changed) changedCount += 1;

    if (apply && patched.changed) {
      const { error: updateError } = await supabase
        .from('product_registration_drafts')
        .update({ ledger: patched.ledger })
        .eq('id', draft.id);
      if (updateError) throw updateError;
      appliedCount += 1;
    }

    results.push({
      id: pkg.id,
      title: pkg.title,
      package_status: pkg.status,
      draft_id: draft.id,
      draft_status: draft.status,
      action: patched.changed ? (apply ? 'applied' : 'would_update') : 'no_change',
      extracted_facts: extracted.structuredFacts.length,
      extracted_standard_notices: extracted.standardNotices.length,
      before_facts: patched.beforeFacts,
      after_facts: patched.afterFacts,
      before_notices: patched.beforeNotices,
      after_notices: patched.afterNotices,
    });
  }

  console.log(JSON.stringify({
    dry_run: !apply,
    apply,
    force,
    since,
    scanned: rows.length,
    changed: changedCount,
    applied: appliedCount,
    results,
  }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});