/**
 * travel_packages — write-time postProcess backfill + L1 status 강등
 *
 * 실행:
 *   npx tsx --env-file=.env.local db/backfill_package_postprocess.ts
 *   npx tsx --env-file=.env.local db/backfill_package_postprocess.ts --apply
 *   npx tsx --env-file=.env.local db/backfill_package_postprocess.ts --apply --id=<uuid>
 *   npx tsx --env-file=.env.local db/backfill_package_postprocess.ts --apply --skip-status
 */
import { createClient } from '@supabase/supabase-js';
import {
  POSTPROCESS_VERSION,
  computeWriteTimePackageState,
  type ItineraryLike,
} from '../src/lib/package-post-process';
import {
  decidePackageStatusFromL1,
  evaluateL1CustomerReadyGate,
} from '../src/lib/l1-customer-ready-gate';
import { isCustomerVisibleStatus } from '../src/lib/visibility-status';

const PAGE = 50;
const MIN_RAW_LEN = 10;

const SELECT_COLS = [
  'id',
  'internal_code',
  'short_code',
  'title',
  'status',
  'confidence',
  'parser_version',
  'product_type',
  'raw_text',
  'inclusions',
  'excludes',
  'notices_parsed',
  'itinerary_data',
  'customer_notes',
  'internal_notes',
  'destination',
  'display_title',
  'hero_tagline',
  'product_summary',
  'special_notes',
  'surcharges',
].join(', ');

type Row = Record<string, unknown>;

function parseArgs(argv: string[]) {
  return {
    apply: argv.includes('--apply'),
    skipStatus: argv.includes('--skip-status'),
    id: argv.find(a => a.startsWith('--id='))?.slice('--id='.length) ?? null,
  };
}

function stableJson(v: unknown): string {
  return JSON.stringify(v ?? null);
}

function hasPostProcessDrift(row: Row, processed: Row): boolean {
  for (const key of ['excludes', 'notices_parsed', 'itinerary_data', 'inclusions', 'product_type'] as const) {
    if (stableJson(row[key]) !== stableJson(processed[key])) return true;
  }
  const pv = String(row.parser_version ?? '');
  if (!pv.includes(POSTPROCESS_VERSION)) return true;
  return false;
}

function targetStatus(row: Row, l1: ReturnType<typeof evaluateL1CustomerReadyGate>): string | null {
  const current = String(row.status ?? '');
  const conf = typeof row.confidence === 'number' ? row.confidence : Number(row.confidence) || 0;
  const desired = decidePackageStatusFromL1(l1, {
    confidence: conf,
    minConfidence: 0.85,
    allowWarningsApprove: false,
  });

  if (isCustomerVisibleStatus(current) && desired === 'pending_review') {
    return 'pending_review';
  }
  return null;
}

(async () => {
  const { apply, skipStatus, id: singleId } = parseArgs(process.argv.slice(2));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 필요');
    process.exit(1);
  }

  const sb = createClient(url, key);

  const stats = {
    scanned: 0,
    drift: 0,
    updatedPostProcess: 0,
    demoted: 0,
    productsSynced: 0,
    errors: 0,
    skippedItinerary: 0,
    l1BlockCodes: new Map<string, number>(),
  };

  const samples = {
    demoted: [] as string[],
    drift: [] as string[],
  };

  async function processRow(row: Row) {
    stats.scanned++;
    const raw = String(row.raw_text ?? '').trim();
    if (raw.length < MIN_RAW_LEN && !singleId) return;

    const draft = computeWriteTimePackageState({
      title: row.title as string,
      product_type: row.product_type as string | null,
      raw_text: raw,
      inclusions: row.inclusions as string[] | null,
      excludes: row.excludes as string[] | null,
      notices_parsed: row.notices_parsed,
      itinerary_data: row.itinerary_data as ItineraryLike,
      customer_notes: row.customer_notes as string | null,
      internal_notes: row.internal_notes as string | null,
      parser_version: row.parser_version as string | null,
      destination: row.destination as string | null,
      display_title: row.display_title as string | null,
      special_notes: row.special_notes as string | null,
      surcharges: row.surcharges as unknown[] | null,
    });

    const l1 = evaluateL1CustomerReadyGate({
      row: draft,
      rawText: raw,
      internalCode: (row.internal_code as string | null) ?? null,
      shortCode: (row.short_code as string | null) ?? null,
      alreadyProcessed: true,
    });

    for (const code of l1.codes) {
      if (l1.reasons.length > 0 || l1.warnings.length > 0) {
        stats.l1BlockCodes.set(code, (stats.l1BlockCodes.get(code) ?? 0) + 1);
      }
    }

    const drift = hasPostProcessDrift(row, draft as Row);
    if (drift) {
      stats.drift++;
      if (samples.drift.length < 10) {
        samples.drift.push(String(row.internal_code ?? row.id).slice(0, 40));
      }
    }

    const newStatus = skipStatus ? null : targetStatus(row, l1);
    if (newStatus) {
      if (!apply) stats.demoted++;
      if (samples.demoted.length < 15) {
        samples.demoted.push(
          `${row.internal_code ?? row.id} [${row.status}→${newStatus}] ${l1.codes.slice(0, 3).join(',')}`,
        );
      }
    }

    if (!apply) return;

    const patch: Record<string, unknown> = {};
    if (drift) {
      patch.inclusions = draft.inclusions;
      patch.excludes = draft.excludes;
      patch.notices_parsed = draft.notices_parsed;
      patch.itinerary_data = draft.itinerary_data;
      patch.product_type = draft.product_type;
      patch.parser_version = (draft as { parser_version?: string }).parser_version;
    }
    if (newStatus) {
      patch.status = newStatus;
    }

    if (Object.keys(patch).length === 0) return;

    let updatePayload = patch;

    async function tryUpdate(payload: Record<string, unknown>) {
      return sb.from('travel_packages').update(payload).eq('id', row.id);
    }

    let { error } = await tryUpdate(updatePayload);
    if (error && /itinerary_data_structure_check/i.test(error.message) && 'itinerary_data' in updatePayload) {
      const { itinerary_data: _omit, ...rest } = updatePayload;
      updatePayload = rest;
      stats.skippedItinerary++;
      console.warn('itinerary skip', row.internal_code ?? row.id, '— catalog 필드만 반영');
      ({ error } = await tryUpdate(updatePayload));
    }

    if (error) {
      // postProcess 실패 시 status 강등만 시도
      if (newStatus) {
        const { error: statusErr } = await tryUpdate({ status: newStatus });
        if (!statusErr) {
          stats.demoted++;
          stats.errors++;
          console.warn('partial OK (status only)', row.internal_code ?? row.id, error.message.slice(0, 80));
          return;
        }
      }
      stats.errors++;
      console.error('UPDATE fail', row.internal_code ?? row.id, error.message);
      return;
    }

    const hadDriftPatch = drift && Object.keys(updatePayload).some(k => k !== 'status');
    if (hadDriftPatch) stats.updatedPostProcess++;
    if (newStatus) {
      stats.demoted++;
      const ic = row.internal_code as string | null;
      if (ic) {
        const { error: pErr } = await sb
          .from('products')
          .update({ status: 'review_required' })
          .eq('internal_code', ic);
        if (!pErr) stats.productsSynced++;
      }
    }
  }

  if (singleId) {
    const { data, error } = await sb.from('travel_packages').select(SELECT_COLS).eq('id', singleId).maybeSingle();
    if (error || !data) {
      console.error('single id query fail', error?.message ?? 'not found');
      process.exit(1);
    }
    await processRow(data as unknown as Row);
  } else {
    let offset = 0;
    while (true) {
      const { data, error } = await sb
        .from('travel_packages')
        .select(SELECT_COLS)
        .not('raw_text', 'is', null)
        .order('internal_code', { ascending: true })
        .range(offset, offset + PAGE - 1);

      if (error) {
        console.error('query error', error.message);
        process.exit(1);
      }
      const rows = (data ?? []) as unknown as Row[];
      if (rows.length === 0) break;

      for (const row of rows) {
        await processRow(row);
      }

      if (rows.length < PAGE) break;
      offset += PAGE;
    }
  }

  console.log('\n=== postProcess backfill ===');
  console.log('모드:', apply ? 'APPLY (DB 반영)' : 'DRY-RUN');
  console.log('스캔:', stats.scanned, '| drift:', stats.drift);
  if (apply) {
    console.log('postProcess UPDATE:', stats.updatedPostProcess);
    console.log('itinerary 스킵 (구조 CHECK):', stats.skippedItinerary);
    console.log('status 강등 (→ pending_review):', stats.demoted);
    console.log('products → review_required:', stats.productsSynced);
    console.log('오류:', stats.errors);
  } else if (!skipStatus) {
    console.log('강등 예상:', stats.demoted, '건 (dry-run — --apply 로 반영)');
  }

  if (samples.drift.length) {
    console.log('\nDrift 샘플:', samples.drift.join(', '));
  }
  if (samples.demoted.length) {
    console.log('\n강등 샘플:');
    for (const s of samples.demoted) console.log(' ', s);
  }

  const topL1 = [...stats.l1BlockCodes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  if (topL1.length) {
    console.log('\nL1 이슈 코드 (상위):');
    for (const [code, n] of topL1) console.log(`  ${code}: ${n}`);
  }

  process.exit(stats.errors > 0 ? 1 : 0);
})();
