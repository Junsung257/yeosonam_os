/**
 * 기등록 travel_packages → normalized_intakes 역변환 스냅샷 일괄 적재
 *
 *   npx tsx --env-file=.env.local db/backfill_intake_snapshots.ts --dry-run --limit=50
 *   npx tsx --env-file=.env.local db/backfill_intake_snapshots.ts --apply --all
 */
import { createClient } from '@supabase/supabase-js';
import { persistIntakeSnapshot } from '../src/lib/persist-intake-snapshot';

const SELECT_COLS =
  'id, title, destination, country, product_type, trip_style, duration, nights, departure_airport, departure_days, airline, min_participants, ticketing_deadline, price, surcharges, optional_tours, price_tiers, price_dates, inclusions, excludes, notices_parsed, accommodations, itinerary_data, raw_text, commission_rate, land_operator_id, land_operator, internal_code';

const PAGE = 100;

function parseArgs(argv: string[]) {
  const dryRun = !argv.includes('--apply');
  const all = argv.includes('--all');
  const codeArg = argv.find(a => a.startsWith('--code='))?.slice('--code='.length);
  const limitArg = argv.find(a => a.startsWith('--limit='))?.slice('--limit='.length);
  const limit = limitArg ? Math.max(1, parseInt(limitArg, 10)) : 200;
  return { dryRun, all, code: codeArg || null, limit };
}

(async () => {
  const { dryRun, all, code, limit } = parseArgs(process.argv.slice(2));
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const processRow = async (row: Record<string, unknown>) => {
    const landName =
      (row.land_operator as string | null) ??
      (typeof row.internal_code === 'string' ? row.internal_code.split('-')[1] : null);

    const rawOk = typeof row.raw_text === 'string' && row.raw_text.length >= 10;

    if (dryRun) {
      console.log('WOULD', row.internal_code ?? row.id, rawOk ? 'ok' : 'SKIP(no raw_text)');
      return rawOk ? 1 : 0;
    }

    if (!rawOk) {
      const { data: intake } = await sb
        .from('normalized_intakes')
        .select('raw_text, ir')
        .eq('package_id', row.id as string)
        .maybeSingle();
      const fromIntake =
        (typeof intake?.raw_text === 'string' && intake.raw_text.length >= 10
          ? intake.raw_text
          : null)
        ?? (typeof (intake?.ir as { rawText?: string } | null)?.rawText === 'string'
          && (intake!.ir as { rawText: string }).rawText.length >= 10
          ? (intake!.ir as { rawText: string }).rawText
          : null);
      if (fromIntake) {
        row.raw_text = fromIntake;
      }
    }

    const result = await persistIntakeSnapshot(sb, {
      packageId: row.id as string,
      pkg: row as Parameters<typeof persistIntakeSnapshot>[1]['pkg'],
      landOperatorName: landName,
      source: 'backfill',
    });

    if (!result.intakeId) {
      console.log('FAIL', row.internal_code ?? row.id, result.warnings.join('; '));
      return 0;
    }
    console.log(result.created ? 'CREATE' : 'UPDATE', row.internal_code ?? row.id, result.intakeId);
    return 1;
  };

  if (code) {
    const { data, error } = await sb
      .from('travel_packages')
      .select(SELECT_COLS)
      .eq('internal_code', code)
      .maybeSingle();
    if (error || !data) {
      console.error(error?.message ?? 'NOT_FOUND');
      process.exit(1);
    }
    const n = await processRow(data as Record<string, unknown>);
    console.log(`\nSummary: ${n} package(s) ${dryRun ? 'would be' : ''} snapshotted`);
    return;
  }

  let offset = 0;
  let total = 0;
  let processed = 0;
  const maxRows = all ? Infinity : limit;

  while (processed < maxRows) {
    const pageSize = all ? PAGE : Math.min(PAGE, maxRows - processed);
    const { data, error } = await sb
      .from('travel_packages')
      .select(SELECT_COLS)
      .order('updated_at', { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (error) {
      console.error('query failed:', error.message);
      process.exit(1);
    }
    const rows = data ?? [];
    if (rows.length === 0) break;

    for (const row of rows) {
      total += await processRow(row as Record<string, unknown>);
      processed += 1;
      if (processed >= maxRows) break;
    }

    offset += rows.length;
    if (rows.length < pageSize) break;
  }

  console.log(`\nSummary: ${total} package(s) ${dryRun ? 'would be' : ''} snapshotted (scanned ${processed})`);
})();
