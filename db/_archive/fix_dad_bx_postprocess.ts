/**
 * 기등록 다낭 BX 패키지 — post-process 결과 DB 영구 반영
 * 실행: npx tsx --env-file=.env.local db/fix_dad_bx_postprocess.ts
 */
import { createClient } from '@supabase/supabase-js';
import { postProcessPackageRow } from '../src/lib/package-post-process';

const PACKAGE_ID = '997731d9-122e-4a92-a4d5-35cd4a776e38';
const INTERNAL_CODE = 'PUS-ETC-DAD-05-0009';

(async () => {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data: row, error: fetchErr } = await sb
    .from('travel_packages')
    .select('id, title, product_type, inclusions, excludes, notices_parsed, itinerary_data, raw_text')
    .eq('id', PACKAGE_ID)
    .single();

  if (fetchErr || !row) {
    console.error('fetch failed', fetchErr?.message);
    process.exit(1);
  }

  const processed = postProcessPackageRow(row);

  const { error: updErr } = await sb
    .from('travel_packages')
    .update({
      product_type: processed.product_type ?? row.product_type,
      inclusions: processed.inclusions,
      excludes: processed.excludes,
      notices_parsed: processed.notices_parsed,
      itinerary_data: processed.itinerary_data,
    })
    .eq('id', PACKAGE_ID);

  if (updErr) {
    console.error('update failed', updErr.message);
    process.exit(1);
  }

  const segs = (processed.itinerary_data as { flight_segments?: Array<{ leg: string; arr_time: string | null }> })?.flight_segments ?? [];
  const out = segs.find(s => s.leg === 'outbound') ?? segs[0];
  const inn = segs.find(s => s.leg === 'inbound') ?? segs[segs.length - 1];

  console.log('OK', INTERNAL_CODE, PACKAGE_ID);
  console.log('flight_segments outbound arr:', out?.arr_time);
  console.log('flight_segments inbound arr:', inn?.arr_time);
  console.log('notices types:', (processed.notices_parsed as Array<{ type: string }>)?.map(n => n.type).join(','));
  console.log('excludes count:', (processed.excludes as string[])?.length);
})();
