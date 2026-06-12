import { config as loadEnv } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

loadEnv({ path: '.env.local' });
loadEnv();

const APPLY = process.argv.includes('--apply');

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error('Missing Supabase env');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

type ScheduleItem = Record<string, unknown> & {
  activity?: string;
  note?: string | null;
  entity_kind?: string;
  attraction_ids?: unknown[];
  attraction_names?: unknown[];
};

type ItineraryDay = Record<string, unknown> & {
  day?: number;
  schedule?: ScheduleItem[];
};

type ItineraryData = Record<string, unknown> & {
  days?: ItineraryDay[];
};

type PackageRow = {
  id: string;
  title: string | null;
  display_title: string | null;
  status: string | null;
  destination: string | null;
  itinerary_data: ItineraryData | null;
};

const ATTRACTIONS = {
  tumenRiverPark: {
    id: '2457e3e2-fcf2-4df5-ac1d-f454bb4a84a4',
    name: '\uB450\uB9CC\uAC15 \uAC15\uBCC0\uACF5\uC6D0',
  },
  ilSongJeong: {
    id: 'a64a737f-5ed9-40e2-880b-f5560f79dc41',
    name: '\uC77C\uC1A1\uC815',
  },
  haeranRiver: {
    id: '92c43809-de3d-4278-9b1b-2771b731a12e',
    name: '\uD574\uB780\uAC15',
  },
  heavenLake: {
    id: '1bb803f5-a918-4939-b02b-7849c839346a',
    name: '\uBC31\uB450\uC0B0 \uCC9C\uC9C0',
  },
  changbaiWaterfall: {
    id: '19eb7fab-b71b-41fb-b182-c4133b8f82bf',
    name: '\uC7A5\uBC31\uD3ED\uD3EC',
  },
  hotSpringZone: {
    id: 'f755b352-e690-4e02-9eba-fdd8c84c4ba2',
    name: '\uB178\uCC9C\uC628\uCC9C\uC9C0\uB300',
  },
  grandCanyon: {
    id: '956e3265-0471-4cb7-9dfc-a35d561ae89a',
    name: '\uAE08\uAC15\uB300\uD611\uACE1',
  },
  border37: {
    id: 'f85ed4a0-1369-4a05-bfe0-253e0dbec405',
    name: '37\uD638\uACBD\uACC4\uBE44',
  },
};

const NON_PUBLIC_IDS = new Set([
  '598935b9-9beb-453b-9530-5e5bb7e46c6e',
  '6de41fab-ff85-469f-ba20-fb777f0758ef',
  '676dd6c3-27f6-4612-88a6-65a552b30d64',
  '0f98084c-204e-4a7e-989f-30860c4f3669',
  '5227b333-5ed6-4685-bddc-32effc4695ce',
  '43a11c58-26b8-4e48-9f1e-121ae4604660',
  '14bdf470-7a5d-4397-b6b9-ce4bc5f4e3b5',
]);

const HEADER_LINE_RE = /(?:\uC5F0\uAE38\/\uBC31\uB450\uC0B0.*\uCD9C\uBC1C\s*\uC99D\uD3B8|\uCD9C\uBC1C\uC77C|\uC694\uAE08\uD45C|\uC0C1\uD488\uAC00|\uD328\uD134)/;
const OPTIONAL_OR_PRICE_RE = /(?:\uD604\uC9C0\uC9C0\uBD88\uC635\uC158|\uC120\uD0DD\uAD00\uAD11|5D|\uD50C\uB77C\uC789|\uB9C8\uC0AC\uC9C0|(?:\$|\uFF04)\s*\d)/;
const PURE_TRANSFER_RE = /(?:\uB85C\s*\uC774\uB3D9|\uC73C\uB85C\s*\uC774\uB3D9)$/;
const VISIT_HINT_RE = /(?:\uAD00\uAD11|\uBC29\uBB38|\uC0B0\uCC45|\uAC15\uBCC0\uACF5\uC6D0|\uD3ED\uD3EC|\uD638\uC218|\uBBFC\uC18D\uCD0C|\uC77C\uC1A1\uC815|\uD574\uB780\uAC15|\uCC9C\uC9C0|\uC628\uCC9C\uC9C0\uB300|\uACBD\uACC4\uBE44|\uB300\uD611\uACE1|\uACE0\uC0B0\uD654\uC6D0)/;

function compact(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, '');
}

function stripAttractions(item: ScheduleItem, entityKind?: string): ScheduleItem {
  const {
    attraction_ids: _ids,
    attraction_names: _names,
    attraction_note: _note,
    attraction_query: _query,
    attraction_queries: _queries,
    ...rest
  } = item;
  void _ids;
  void _names;
  void _note;
  void _query;
  void _queries;
  if (entityKind) rest.entity_kind = entityKind;
  return rest;
}

function withAttractions(item: ScheduleItem, attractions: Array<{ id: string; name: string }>): ScheduleItem {
  return {
    ...item,
    attraction_ids: attractions.map(attraction => attraction.id),
    attraction_names: attractions.map(attraction => attraction.name),
  };
}

function repairItem(item: ScheduleItem): { item: ScheduleItem | null; changed: boolean; reason?: string } {
  const text = String(item.activity ?? '');
  const allText = [item.activity, item.note].filter(Boolean).join(' ');
  const c = compact(allText);

  if (HEADER_LINE_RE.test(allText)) return { item: null, changed: true, reason: 'removed_header_line' };

  if (OPTIONAL_OR_PRICE_RE.test(allText) || item.entity_kind === 'optional_tour' || item.entity_kind === 'perk') {
    const next = stripAttractions(item, OPTIONAL_OR_PRICE_RE.test(allText) ? 'optional_tour' : item.entity_kind);
    return { item: next, changed: JSON.stringify(next) !== JSON.stringify(item), reason: 'stripped_optional_or_price' };
  }

  if (PURE_TRANSFER_RE.test(text) && !VISIT_HINT_RE.test(allText)) {
    const next = stripAttractions(item, 'transfer');
    return { item: next, changed: JSON.stringify(next) !== JSON.stringify(item), reason: 'stripped_pure_transfer' };
  }

  if (/\uB450\uB9CC\uAC15/.test(c) && /\uAC15\uBCC0\uACF5\uC6D0/.test(c)) {
    return { item: withAttractions(stripAttractions(item), [ATTRACTIONS.tumenRiverPark]), changed: true, reason: 'canonical_tumen_park' };
  }

  if (/\uC77C\uC1A1\uC815|\uBE44\uC554\uC0B0|\uD574\uB780\uAC15/.test(c)) {
    const matches = [];
    if (/\uC77C\uC1A1\uC815|\uBE44\uC554\uC0B0/.test(c)) matches.push(ATTRACTIONS.ilSongJeong);
    if (/\uD574\uB780\uAC15/.test(c)) matches.push(ATTRACTIONS.haeranRiver);
    return { item: withAttractions(stripAttractions(item), matches), changed: true, reason: 'canonical_ilsong_haeran' };
  }

  if (/\uC545\uD654\uD3ED\uD3EC/.test(c)) {
    return { item: stripAttractions(item), changed: true, reason: 'stripped_unpublished_akhwa_waterfall' };
  }

  if (/\uBC31\uB450\uC0B0.*\uCC9C\uC9C0|\uCC9C\uC9C0\uAD00\uAD11|\uCC9C\uC9C0\uC870\uB9DD|\uCC9C\uBB38\uBD09/.test(c)) {
    return { item: withAttractions(stripAttractions(item), [ATTRACTIONS.heavenLake]), changed: true, reason: 'canonical_heaven_lake' };
  }

  if (/\uC7A5\uBC31\uD3ED\uD3EC/.test(c)) {
    return { item: withAttractions(stripAttractions(item), [ATTRACTIONS.changbaiWaterfall]), changed: true, reason: 'canonical_changbai_waterfall' };
  }

  if (/\uB178\uCC9C\uC628\uCC9C\uC9C0\uB300/.test(c)) {
    return { item: withAttractions(stripAttractions(item), [ATTRACTIONS.hotSpringZone]), changed: true, reason: 'canonical_hot_spring_zone' };
  }

  if (/\uAE08\uAC15\uB300\uD611\uACE1/.test(c)) {
    return { item: withAttractions(stripAttractions(item), [ATTRACTIONS.grandCanyon]), changed: true, reason: 'canonical_grand_canyon' };
  }

  if (/37\uD638\uACBD\uACC4\uBE44/.test(c)) {
    return { item: withAttractions(stripAttractions(item), [ATTRACTIONS.border37]), changed: true, reason: 'canonical_border37' };
  }

  if (/36\uD638\uACBD\uACC4\uBE44|\uC218\uBAA9\uD55C\uACC4\uC120|\uC5F0\uAE38\uBBFC\uC18D\uCD0C|\uC724\uB3D9\uC8FC\uC0DD\uAC00|\uBA85\uB3D9\uAD50\uD68C/.test(c)) {
    return { item: stripAttractions(item), changed: true, reason: 'stripped_unpublished_baekdu_master' };
  }

  const ids = Array.isArray(item.attraction_ids) ? item.attraction_ids.map(String) : [];
  if (ids.some(id => NON_PUBLIC_IDS.has(id))) {
    const next = stripAttractions(item);
    return { item: next, changed: true, reason: 'stripped_non_public_id' };
  }

  return { item, changed: false };
}

function repairItinerary(itinerary: ItineraryData | null): { itinerary: ItineraryData | null; changed: boolean; reasons: Record<string, number> } {
  if (!itinerary || !Array.isArray(itinerary.days)) return { itinerary, changed: false, reasons: {} };
  let changed = false;
  const reasons: Record<string, number> = {};

  const days = itinerary.days.map(day => {
    const schedule = Array.isArray(day.schedule) ? day.schedule : [];
    const repairedSchedule: ScheduleItem[] = [];
    for (const item of schedule) {
      const repaired = repairItem(item);
      if (repaired.changed) {
        changed = true;
        if (repaired.reason) reasons[repaired.reason] = (reasons[repaired.reason] ?? 0) + 1;
      }
      if (repaired.item) repairedSchedule.push(repaired.item);
    }
    return { ...day, schedule: repairedSchedule };
  });

  return { itinerary: { ...itinerary, days }, changed, reasons };
}

async function main() {
  const { data, error } = await supabase
    .from('travel_packages')
    .select('id, title, display_title, status, destination, itinerary_data')
    .or('title.ilike.%백두산%,title.ilike.%연길%,display_title.ilike.%백두산%,display_title.ilike.%연길%,destination.ilike.%백두산%,destination.ilike.%연길%')
    .in('status', ['active', 'approved', 'selling', 'available', 'published'])
    .order('created_at', { ascending: false });

  if (error) throw error;

  const rows = (data ?? []) as PackageRow[];
  const summary = [];

  for (const row of rows) {
    const repaired = repairItinerary(row.itinerary_data);
    summary.push({
      id: row.id,
      title: row.display_title || row.title,
      changed: repaired.changed,
      reasons: repaired.reasons,
    });

    if (APPLY && repaired.changed) {
      const { error: updateError } = await supabase
        .from('travel_packages')
        .update({ itinerary_data: repaired.itinerary, updated_at: new Date().toISOString() })
        .eq('id', row.id);
      if (updateError) throw updateError;
    }
  }

  console.log(JSON.stringify({
    apply: APPLY,
    scanned: rows.length,
    changed: summary.filter(row => row.changed).length,
    summary,
  }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
