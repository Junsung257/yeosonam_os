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
  time?: string | null;
  activity?: string | null;
  transport?: string | null;
  type?: string | null;
};

type ItineraryDay = Record<string, unknown> & {
  day?: number;
  schedule?: ScheduleItem[];
};

type ItineraryData = Record<string, unknown> & {
  meta?: Record<string, unknown>;
  days?: ItineraryDay[];
  flight_segments?: unknown[];
};

type PackageRow = {
  id: string;
  title: string | null;
  display_title: string | null;
  destination: string | null;
  duration: number | null;
  nights: number | null;
  raw_text: string | null;
  itinerary_data: ItineraryData | null;
};

const TIME_RE = /\b\d{1,2}:\d{2}\b/g;

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function uniqueFlightCodes(rawText: string): string[] {
  return [...new Set([...rawText.matchAll(/\b([A-Z]{2}\d{2,4})\b/g)].map(match => match[1]))];
}

function timesIn(source: string): string[] {
  return [...source.matchAll(TIME_RE)].map(match => match[0]);
}

function extractBaekduFlightTimes(rawText: string) {
  const codes = uniqueFlightCodes(rawText);
  const outboundCode = codes.find(code => /337$/.test(code)) ?? codes[0] ?? null;
  const inboundCode = codes.find(code => /338$/.test(code)) ?? codes.at(-1) ?? null;
  if (!outboundCode || !inboundCode) return null;

  const outboundIndex = rawText.indexOf(outboundCode);
  const inboundIndex = rawText.lastIndexOf(inboundCode);
  if (outboundIndex < 0 || inboundIndex < 0 || inboundIndex <= outboundIndex) return null;

  const outboundTimes = timesIn(rawText.slice(outboundIndex, inboundIndex));
  const inboundTimes = timesIn(rawText.slice(inboundIndex));
  const meetingTime = outboundTimes.length >= 3 ? outboundTimes[0] : null;
  const outboundDep = outboundTimes.length >= 3 ? outboundTimes[1] : outboundTimes[0] ?? null;
  const outboundArr = outboundTimes.length >= 3 ? outboundTimes[2] : outboundTimes[1] ?? null;
  const inboundDep = inboundTimes[0] ?? null;
  const inboundArr = inboundTimes[1] ?? null;
  if (!outboundDep || !outboundArr || !inboundDep || !inboundArr) return null;

  return {
    outboundCode,
    inboundCode,
    meetingTime,
    outboundDep,
    outboundArr,
    inboundDep,
    inboundArr,
  };
}

function updateItem(
  schedule: ScheduleItem[],
  predicate: (activity: string) => boolean,
  patch: Partial<ScheduleItem>,
): boolean {
  const item = schedule.find(candidate => predicate(text(candidate.activity)));
  if (!item) return false;
  let changed = false;
  for (const [key, value] of Object.entries(patch)) {
    if (item[key] !== value) {
      item[key] = value;
      changed = true;
    }
  }
  return changed;
}

function ensureItemBefore(
  schedule: ScheduleItem[],
  activity: string,
  before: (activity: string) => boolean,
): boolean {
  if (schedule.some(item => text(item.activity).includes(activity))) return false;
  const index = schedule.findIndex(item => before(text(item.activity)));
  const next: ScheduleItem = { type: 'normal', time: null, transport: null, note: null, activity };
  if (index >= 0) schedule.splice(index, 0, next);
  else schedule.push(next);
  return true;
}

function splitArrivalMeeting(
  schedule: ScheduleItem[],
  flightCode: string,
  arrivalTime: string,
): boolean {
  const index = schedule.findIndex(item => /연길 도착 후 가이드 미팅/.test(text(item.activity)));
  if (index < 0) return false;
  const current = schedule[index];
  let changed = false;
  const arrivalItem = {
    ...current,
    activity: '연길 도착',
    time: arrivalTime,
    type: 'flight',
    transport: flightCode,
  };
  if (JSON.stringify(current) !== JSON.stringify(arrivalItem)) {
    schedule[index] = arrivalItem;
    changed = true;
  }
  const next = schedule[index + 1];
  if (!next || !/가이드 미팅/.test(text(next.activity))) {
    schedule.splice(index + 1, 0, {
      type: 'normal',
      time: null,
      transport: null,
      note: null,
      activity: '가이드 미팅',
    });
    changed = true;
  }
  return changed;
}

function normalizeHotelLikeScheduleItems(schedule: ScheduleItem[]): boolean {
  let changed = false;
  for (const item of schedule) {
    const activity = text(item.activity);
    if (!/호텔.*동급|호텔\s*또는\s*동급|HOTEL\s*:/i.test(activity)) continue;
    if (item.type !== 'hotel') {
      item.type = 'hotel';
      changed = true;
    }
    for (const key of ['attraction_ids', 'attraction_names', 'attraction_note', 'attraction_query', 'attraction_queries']) {
      if (key in item) {
        delete item[key];
        changed = true;
      }
    }
  }
  return changed;
}

function repairItinerary(row: PackageRow): { itinerary: ItineraryData | null; changed: boolean; reasons: string[] } {
  const rawText = row.raw_text ?? '';
  const itinerary = row.itinerary_data ? structuredClone(row.itinerary_data) as ItineraryData : null;
  if (!itinerary || !Array.isArray(itinerary.days)) return { itinerary, changed: false, reasons: [] };
  const flight = extractBaekduFlightTimes(rawText);
  if (!flight) return { itinerary, changed: false, reasons: [] };

  let changed = false;
  const reasons: string[] = [];
  const days = itinerary.days;
  const lastDayIndex = Math.max(0, days.length - 1);
  const meta = itinerary.meta && typeof itinerary.meta === 'object' ? itinerary.meta : {};
  const nextMeta = {
    ...meta,
    destination: row.destination ?? meta.destination ?? null,
    nights: row.nights ?? meta.nights ?? (row.duration ? row.duration - 1 : null),
    days: row.duration ?? meta.days ?? days.length,
    airline: meta.airline ?? flight.outboundCode.slice(0, 2),
    flight_out: flight.outboundCode,
    flight_in: flight.inboundCode,
    flight_out_time: flight.outboundDep,
    flight_out_arrive_time: flight.outboundArr,
    flight_in_time: flight.inboundDep,
    flight_in_arrive_time: flight.inboundArr,
  };
  if (JSON.stringify(nextMeta) !== JSON.stringify(meta)) {
    itinerary.meta = nextMeta;
    changed = true;
    reasons.push('meta_flight_times');
  }

  const nextSegments = [
    {
      leg: 'outbound',
      flight_no: flight.outboundCode,
      dep_airport: '김해',
      dep_time: flight.outboundDep,
      arr_airport: '연길',
      arr_time: flight.outboundArr,
      arr_day_offset: 0,
      day_pair: [0, 0],
    },
    {
      leg: 'inbound',
      flight_no: flight.inboundCode,
      dep_airport: '연길',
      dep_time: flight.inboundDep,
      arr_airport: '김해',
      arr_time: flight.inboundArr,
      arr_day_offset: 0,
      day_pair: [lastDayIndex, lastDayIndex],
    },
  ];
  if (JSON.stringify(itinerary.flight_segments ?? []) !== JSON.stringify(nextSegments)) {
    itinerary.flight_segments = nextSegments;
    changed = true;
    reasons.push('flight_segments');
  }

  const day1 = days.find(day => day.day === 1);
  const day2 = days.find(day => day.day === 2);
  const day3 = days.find(day => day.day === 3);
  const day4 = days.find(day => day.day === 4);

  if (day1?.schedule) {
    if (flight.meetingTime && updateItem(day1.schedule, activity => /김해|공항|미팅/.test(activity), { time: flight.meetingTime, type: 'meeting' })) {
      changed = true;
      reasons.push('day1_meeting_time');
    }
    if (updateItem(day1.schedule, activity => /부산 출발|김해 출발/.test(activity), { time: flight.outboundDep, type: 'flight', transport: flight.outboundCode })) {
      changed = true;
      reasons.push('day1_outbound_departure');
    }
    if (splitArrivalMeeting(day1.schedule, flight.outboundCode, flight.outboundArr)) {
      changed = true;
      reasons.push('day1_arrival_meeting_split');
    } else if (updateItem(day1.schedule, activity => /^연길 도착$/.test(activity), { time: flight.outboundArr, type: 'flight', transport: flight.outboundCode })) {
      changed = true;
      reasons.push('day1_outbound_arrival');
    }
  }

  if (day2?.schedule && /백두산\s*남파로\s*이동/.test(rawText)) {
    if (ensureItemBefore(day2.schedule, '백두산 남파로 이동 (2시간 소요)', activity => /백두산 천지|36호|경계비/.test(activity))) {
      changed = true;
      reasons.push('day2_source_line_restored');
    }
  }

  if (day3?.schedule && /백두산\s*북파로\s*이동/.test(rawText)) {
    if (ensureItemBefore(day3.schedule, '백두산 북파로 이동 (15분 소요)', activity => /짚차|천문봉|장백폭포/.test(activity))) {
      changed = true;
      reasons.push('day3_source_line_restored');
    }
  }

  if (day4?.schedule && /진달래광장/.test(rawText)) {
    if (ensureItemBefore(day4.schedule, '호텔 조식 후 진달래광장', activity => /공항으로 이동|연길 출발/.test(activity))) {
      changed = true;
      reasons.push('day4_jindallae_restored');
    }
  }

  const lastDay = days[lastDayIndex];
  if (lastDay?.schedule) {
    if (updateItem(lastDay.schedule, activity => /연길 출발/.test(activity), { time: flight.inboundDep, type: 'flight', transport: flight.inboundCode })) {
      changed = true;
      reasons.push('inbound_departure');
    }
    if (updateItem(lastDay.schedule, activity => /부산 도착|김해 도착/.test(activity), { time: flight.inboundArr, type: 'flight', transport: flight.inboundCode })) {
      changed = true;
      reasons.push('inbound_arrival');
    }
  }

  for (const day of days) {
    if (!day.schedule) continue;
    if (normalizeHotelLikeScheduleItems(day.schedule)) {
      changed = true;
      reasons.push('hotel_like_schedule_normalized');
    }
  }

  return { itinerary, changed, reasons: [...new Set(reasons)] };
}

async function main() {
  const { data, error } = await supabase
    .from('travel_packages')
    .select('id, title, display_title, destination, duration, nights, raw_text, itinerary_data')
    .or('title.ilike.%백두산%,title.ilike.%연길%,display_title.ilike.%백두산%,display_title.ilike.%연길%,destination.ilike.%백두산%,destination.ilike.%연길%')
    .in('status', ['active', 'approved', 'selling', 'available', 'published'])
    .order('created_at', { ascending: false });

  if (error) throw error;
  const rows = (data ?? []) as PackageRow[];
  const summary = [];

  for (const row of rows) {
    const repaired = repairItinerary(row);
    summary.push({
      id: row.id,
      title: row.display_title || row.title,
      changed: repaired.changed,
      reasons: repaired.reasons,
      flight_segments: repaired.itinerary?.flight_segments ?? null,
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
