// 1회용 디버그 — page.tsx 매칭 로직 시뮬레이션
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { buildAttractionIndex, matchAttractionIndexed, type AttractionData } from '../src/lib/attraction-matcher';
import { destinationToIsoSet } from '../src/lib/destination-iso';

const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

(async () => {
  const dest = '시즈오카';
  const tokens = dest.split(/[\/,·&]/).map(t => t.trim()).filter(Boolean);
  const regionClauses = tokens.map(t => `region.ilike.%${t}%`).join(',');
  const destIsoCountries = destinationToIsoSet(dest);
  console.log('destinationToIsoSet:', [...destIsoCountries]);
  const isoCountryClauses = [...destIsoCountries].map(c => `country.eq.${c}`).join(',');
  const koreanCountryList = '중국,베트남,일본,필리핀,태국,말레이시아,싱가포르,대만,몽골,라오스,인도네시아,홍콩,마카오';
  const koreanCountryClauses = koreanCountryList.split(',').map(c => `country.eq.${c}`).join(',');
  const clauses = [regionClauses, isoCountryClauses, koreanCountryClauses].filter(Boolean).join(',');

  const { data: lightAttrs } = await supa.from('attractions').select('name, country, region, aliases, category, mrt_gid').or(clauses).limit(2000);
  console.log('lightAttrs:', lightAttrs?.length);

  const { data: pkgRows } = await supa.from('travel_packages').select('itinerary_data').eq('id', '7f485215-370b-423d-9ce1-31838ce26db6').limit(1);
  const itin = (pkgRows as { itinerary_data: { days?: { day: number; schedule?: { activity: string; type?: string }[] }[] } }[])[0].itinerary_data;

  const index = buildAttractionIndex(lightAttrs as AttractionData[], dest);
  const matchedNames = new Set<string>();
  for (const day of (itin.days || [])) {
    for (const item of (day.schedule || [])) {
      if (!item.activity) continue;
      if (item.type === 'flight' || item.type === 'hotel' || (item.type as string) === 'shopping') continue;
      const single = matchAttractionIndexed(item.activity, index);
      if (single) {
        matchedNames.add(single.name);
        console.log(`  ✓ day ${day.day} "${item.activity.slice(0, 50)}" → ${single.name}`);
      } else {
        console.log(`  ✗ day ${day.day} "${item.activity.slice(0, 50)}"`);
      }
    }
  }
  console.log('\n총 matchedNames:', matchedNames.size, [...matchedNames]);

  if (matchedNames.size > 0) {
    const { data: detail } = await supa.from('attractions').select('id, name, photos').in('name', [...matchedNames]);
    console.log('\nStep B 결과 (photos 컬럼):');
    for (const a of (detail as { id: string; name: string; photos: unknown }[]) || []) {
      const cnt = Array.isArray(a.photos) ? a.photos.length : 0;
      console.log(`  ${a.name}: photos=${cnt}`);
    }
  }
})();
