/**
 * raw_text 없는 travel_packages — normalized_intakes · 정형 필드 합성으로 복구
 *
 *   npx tsx --env-file=.env.local db/backfill_missing_raw_text.ts --dry-run
 *   npx tsx --env-file=.env.local db/backfill_missing_raw_text.ts --apply --all
 *   npx tsx --env-file=.env.local db/backfill_missing_raw_text.ts --apply --all --synthesize
 */
import { createClient } from '@supabase/supabase-js';
import { synthesizeRawText } from '../src/lib/packages/raw-text';

const PAGE = 100;
const MIN_RAW = 10;
const PKG_SELECT =
  'id, internal_code, raw_text, title, destination, duration, nights, product_summary, product_highlights, inclusions, excludes, itinerary_data, special_notes, optional_tours, price_tiers, price_dates, products(selling_price, departure_region)';

function parseArgs(argv: string[]) {
  const dryRun = !argv.includes('--apply');
  const all = argv.includes('--all');
  const synthesize = argv.includes('--synthesize');
  const codeArg = argv.find(a => a.startsWith('--code='))?.slice('--code='.length);
  const limitArg = argv.find(a => a.startsWith('--limit='))?.slice('--limit='.length);
  const limit = limitArg ? Math.max(1, parseInt(limitArg, 10)) : 200;
  return { dryRun, all, synthesize, code: codeArg || null, limit };
}

function hasUsableRaw(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length >= MIN_RAW;
}

function pickRawFromIntake(intake: {
  raw_text?: string | null;
  ir?: { rawText?: string | null } | null;
}): string | null {
  if (hasUsableRaw(intake.raw_text)) return intake.raw_text!.trim();
  const fromIr = intake.ir?.rawText;
  if (hasUsableRaw(fromIr)) return fromIr!.trim();
  return null;
}

(async () => {
  const { dryRun, all, synthesize, code, limit } = parseArgs(process.argv.slice(2));
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  let scanned = 0;
  let missing = 0;
  let recovered = 0;
  let synthesized = 0;
  let noSource = 0;
  let applied = 0;

  const processPkg = async (row: Record<string, unknown>) => {
    scanned += 1;
    if (hasUsableRaw(row.raw_text)) return;

    missing += 1;
    const label = (row.internal_code as string | null) ?? (row.id as string);

    const { data: intake, error } = await sb
      .from('normalized_intakes')
      .select('id, raw_text, ir')
      .eq('package_id', row.id as string)
      .maybeSingle();

    if (error) {
      console.error('INTAKE_QUERY_FAIL', label, error.message);
      return;
    }

    let recoveredRaw = intake ? pickRawFromIntake(intake as { raw_text?: string; ir?: { rawText?: string } }) : null;
    let source: 'intake' | 'synthesized' | null = recoveredRaw ? 'intake' : null;

    if (!recoveredRaw && synthesize) {
      const product = Array.isArray(row.products) ? row.products[0] : row.products;
      recoveredRaw = synthesizeRawText({
        title: row.title as string | null,
        destination: row.destination as string | null,
        departureRegion: (product as { departure_region?: string } | null)?.departure_region ?? null,
        duration: row.duration as number | null,
        nights: row.nights as number | null,
        sellingPrice: (product as { selling_price?: number } | null)?.selling_price ?? null,
        product_summary: row.product_summary as string | null,
        product_highlights: row.product_highlights as string[] | null,
        inclusions: row.inclusions as string[] | null,
        excludes: row.excludes as string[] | null,
        itinerary_data: row.itinerary_data as Parameters<typeof synthesizeRawText>[0]['itinerary_data'],
        special_notes: row.special_notes as string | string[] | null,
        optional_tours: row.optional_tours as Parameters<typeof synthesizeRawText>[0]['optional_tours'],
        price_tiers: row.price_tiers,
        price_dates: row.price_dates,
      });
      if (hasUsableRaw(recoveredRaw)) source = 'synthesized';
      else recoveredRaw = null;
    }

    if (!recoveredRaw || !source) {
      noSource += 1;
      console.log('NO_SOURCE', label, synthesize ? '' : '(use --synthesize for stub rebuild)');
      return;
    }

    if (source === 'intake') recovered += 1;
    else synthesized += 1;

    console.log(
      dryRun ? 'WOULD_RECOVER' : 'RECOVER',
      label,
      source,
      `len=${recoveredRaw.length}`,
      intake?.id ? `intake=${intake.id}` : '',
    );

    if (!dryRun) {
      const { error: upErr } = await sb
        .from('travel_packages')
        .update({ raw_text: recoveredRaw })
        .eq('id', row.id);
      if (upErr) {
        console.error('  UPDATE FAILED:', label, upErr.message);
        return;
      }
      applied += 1;
    }
  };

  if (code) {
    const { data, error } = await sb
      .from('travel_packages')
      .select(PKG_SELECT)
      .eq('internal_code', code)
      .maybeSingle();
    if (error || !data) {
      console.error(error?.message ?? 'NOT_FOUND');
      process.exit(1);
    }
    await processPkg(data);
    console.log(
      `\nSummary: scanned=${scanned} missing=${missing} from_intake=${recovered} synthesized=${synthesized} no_source=${noSource}` +
        `${dryRun ? '' : ` applied=${applied}`}`,
    );
    return;
  }

  let offset = 0;
  const maxRows = all ? Infinity : limit;

  while (scanned < maxRows) {
    const pageSize = all ? PAGE : Math.min(PAGE, maxRows - scanned);
    const { data, error } = await sb
      .from('travel_packages')
      .select(PKG_SELECT)
      .order('updated_at', { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (error) {
      console.error('query failed:', error.message);
      process.exit(1);
    }

    const rows = data ?? [];
    if (rows.length === 0) break;

    for (const row of rows) {
      await processPkg(row);
      if (scanned >= maxRows) break;
    }

    offset += rows.length;
    if (rows.length < pageSize) break;
  }

  console.log(
    `\nSummary: scanned=${scanned} missing=${missing} from_intake=${recovered} synthesized=${synthesized} no_source=${noSource}` +
      `${dryRun ? '' : ` applied=${applied}`}`,
  );
})();
