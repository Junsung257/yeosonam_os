/**
 * 다낭 BX 패키지 post-process 검증
 * 실행: npx tsx --env-file=.env.local db/_verify_dad_postprocess.ts
 */
import { createClient } from '@supabase/supabase-js';
import { postProcessPackageRow } from '../src/lib/package-post-process';
import { renderPackage } from '../src/lib/render-contract';

const QUERY_CODES = ['PUS-ETC-DAD-05-0009'];

(async () => {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  let rows: Array<Record<string, unknown>> = [];

  for (const code of QUERY_CODES) {
    const { data, error } = await sb
      .from('travel_packages')
      .select('id, title, internal_code, excludes, notices_parsed, itinerary_data, raw_text')
      .eq('internal_code', code)
      .limit(1);
    if (error) {
      console.error('query error', code, error.message);
      continue;
    }
    if (data?.length) rows.push(...(data as Array<Record<string, unknown>>));
  }

  if (rows.length === 0) {
    const { data } = await sb
      .from('travel_packages')
      .select('id, title, internal_code, excludes, notices_parsed, itinerary_data, raw_text')
      .ilike('title', '%노팁%노옵션%BX%다낭%특급%')
      .limit(3);
    rows = (data ?? []) as Array<Record<string, unknown>>;
  }

  if (rows.length === 0) {
    console.log('NO_PACKAGE_FOUND');
    process.exit(1);
  }

  for (const row of rows) {
    const processed = postProcessPackageRow(row);
    const view = renderPackage(processed as Parameters<typeof renderPackage>[0]);
    const segs = (processed.itinerary_data as { flight_segments?: Array<{ leg: string; dep_time: string | null; arr_time: string | null }> })?.flight_segments ?? [];
    const outbound = segs.find(s => s.leg === 'outbound') ?? segs[0];
    const inbound = segs.find(s => s.leg === 'inbound') ?? segs[segs.length - 1];

    console.log('\n===', row.internal_code, row.id, '===');
    console.log('title:', String(row.title).slice(0, 60));
    console.log('flight_header_out:', view.flightHeader.outbound?.depTime, '→', view.flightHeader.outbound?.arrTime);
    console.log('flight_header_in:', view.flightHeader.inbound?.depTime, '→', view.flightHeader.inbound?.arrTime);
    console.log('segments_out:', outbound?.dep_time, outbound?.arr_time);
    console.log('segments_in:', inbound?.dep_time, inbound?.arr_time);
    console.log('surcharges_merged:', view.surchargesMerged.map(s => s.label).join(' | '));
    console.log('excludes_basic:', view.excludes.basic.join(' | '));
    const critical = (processed.notices_parsed as Array<{ type: string; text: string }>)?.find(n => n.type === 'CRITICAL');
    console.log('critical_has_shopping_penalty:', /150|패널티/.test(critical?.text ?? ''));
    console.log('policy_has_notip:', (processed.notices_parsed as Array<{ type: string; text: string }>)?.some(n => n.type === 'POLICY' && /포함되지/.test(n.text)));
    console.log('PAGE_URL:', `/packages/${row.id}`);
  }
})();
