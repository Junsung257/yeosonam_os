#!/usr/bin/env node
/* eslint-disable no-console */
require('dotenv').config({ path: '.env.local' });
require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Supabase env missing');
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
});

const GROUPS = [
  {
    key: 'guide_presence',
    label: '가이드 유무/형태',
    patterns: [/한국어\s*가이드/i, /현지\s*가이드/i, /가이드\s*(동행|미팅|안내|포함|없음|불포함|미포함|NO|전문)/i, /인솔자\s*(동행|포함|없음|불포함|미동행)/i],
  },
  {
    key: 'guide_tip',
    label: '가이드/기사 팁',
    patterns: [/가이드\s*팁/i, /기사\s*팁/i, /가이드\/기사\s*(경비|팁)/i, /매너\s*팁/i, /팁\s*(불포함|포함|별도|현지)/i, /(USD|US\$|\$)\s*\d{1,4}.*(팁|가이드|기사)/i],
  },
  {
    key: 'shopping',
    label: '쇼핑 유무/횟수/품목',
    patterns: [/노\s*쇼핑/i, /쇼핑\s*(없음|무|0\s*회|센터|횟수|방문|\d+\s*회)/i, /쇼핑센터/i, /면세/i, /침향|잡화|커피|진주|보석|건강식품|특산품/i],
  },
  {
    key: 'hotel_grade',
    label: '호텔 등급/동급 예정',
    patterns: [/(준\s*)?[345]\s*성급/i, /특급|준특급|일급|디럭스|럭셔리|프리미엄|리조트/i, /호텔\s*(등급|업그레이드|동급|미정|예정)/i],
  },
  {
    key: 'room_policy',
    label: '객실/룸배정/싱글차지',
    patterns: [/2\s*인\s*1\s*실/i, /3\s*인\s*1\s*실/i, /싱글\s*(차지|룸|사용|추가)/i, /1인실|룸\s*배정|객실\s*배정|커넥팅룸|트윈|더블|침대/i],
  },
  {
    key: 'meals',
    label: '식사 유형/횟수',
    patterns: [/조\s*[:：\-/]/i, /중\s*[:：\-/]/i, /석\s*[:：\-/]/i, /호텔식|현지식|한식|중식|일식|양식|특식|기내식|자유식|불포함|뷔페|반쎄오|쌀국수/i],
  },
  {
    key: 'transport',
    label: '차량/이동수단',
    patterns: [/전용\s*차량/i, /리무진|버스|페리|전보|도보|케이블카|국내선|기차|고속철|열차|보트|스피드보트|짐차|택시|픽업|샌딩|이동/i],
  },
  {
    key: 'optional_tour',
    label: '선택관광/옵션',
    patterns: [/선택\s*관광/i, /옵션\s*(투어|관광|비용|별도|현지)/i, /현지\s*결제/i, /(USD|US\$|\$|원)\s*\d{1,6}.*(선택|옵션|관광)/i],
  },
  {
    key: 'surcharges',
    label: '추가비용/불포함 비용',
    patterns: [/유류\s*할증료/i, /추가\s*(요금|비용|금액)/i, /별도\s*(비용|요금)/i, /불포함|미포함/i, /입장료|관광세|리조트피|비자비|환경세/i],
  },
  {
    key: 'passport_visa_law',
    label: '여권/비자/반입금지',
    patterns: [/여권.*6\s*개월/i, /비자|무비자|전자비자|입국/i, /전자\s*담배|반입\s*금지|출입국/i],
  },
  {
    key: 'schedule_policy',
    label: '일정변경/미참여/패널티',
    patterns: [/일정\s*(변경|순서|조정)/i, /현지\s*사정|기상\s*악화/i, /미\s*참여|불참|패널티|노쇼|개별\s*일정/i],
  },
  {
    key: 'prep_items',
    label: '준비물/복장',
    patterns: [/수영복|수화가능|운동화|모자|선크림|우산|여권\s*사본|상비약/i],
  },
  {
    key: 'flight',
    label: '항공/출도착',
    patterns: [/항공권|항공편|직항|경유|출발\s*시간|도착\s*시간|공항\s*미팅|수하물|기내/i],
  },
  {
    key: 'min_pax_departure',
    label: '최소출발/모객/출발확정',
    patterns: [/최소\s*출발/i, /출발\s*확정/i, /모객|행사\s*인원|\d+\s*명\s*(이상|부터)/i],
  },
];

const SELECT_FIELDS = [
  'id', 'title', 'destination', 'created_at', 'status', 'raw_text', 'itinerary_data', 'inclusions', 'excludes',
  'special_notes', 'customer_notes', 'notices_parsed', 'optional_tours', 'surcharges', 'normalized_surcharges',
  'accommodations', 'category_attrs', 'guide_tip', 'min_participants', 'single_supplement', 'small_group_surcharge',
].join(',');

function flatten(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value); } catch { return String(value); }
}

function hasValue(value) {
  if (value == null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 && trimmed !== '[]' && trimmed !== '{}';
  }
  return Boolean(value);
}

function getText(row) {
  return [row.raw_text, row.itinerary_data, row.inclusions, row.excludes, row.special_notes, row.customer_notes, row.notices_parsed, row.optional_tours, row.surcharges, row.normalized_surcharges, row.accommodations, row.category_attrs]
    .map(flatten)
    .join('\n');
}

function evidenceSnippet(text, patterns) {
  const lines = String(text).split(/\r?\n|\\n/).map(line => line.trim()).filter(Boolean);
  for (const pattern of patterns) {
    const line = lines.find(candidate => pattern.test(candidate));
    if (line) return line.replace(/\s+/g, ' ').slice(0, 150);
  }
  const compact = String(text).replace(/\s+/g, ' ');
  for (const pattern of patterns) {
    const match = compact.match(pattern);
    if (match?.index != null) return compact.slice(Math.max(0, match.index - 35), Math.min(compact.length, match.index + 115));
  }
  return '';
}

async function main() {
  const limit = Number(process.argv[2] || 500);
  const { data, error } = await supabase.from('travel_packages').select(SELECT_FIELDS).order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  const rows = data || [];

  const groups = GROUPS.map(group => {
    const hits = rows
      .map(row => ({ row, text: getText(row) }))
      .filter(({ text }) => group.patterns.some(pattern => pattern.test(text)))
      .map(({ row, text }) => ({ id: row.id, title: row.title, status: row.status, evidence: evidenceSnippet(text, group.patterns) }));
    return { key: group.key, label: group.label, hits: hits.length, rate: rows.length ? Number(((hits.length / rows.length) * 100).toFixed(1)) : 0, examples: hits.slice(0, 5) };
  });

  const populated = {
    guide_tip: rows.filter(row => hasValue(row.guide_tip)).length,
    min_participants: rows.filter(row => hasValue(row.min_participants)).length,
    single_supplement: rows.filter(row => hasValue(row.single_supplement)).length,
    small_group_surcharge: rows.filter(row => hasValue(row.small_group_surcharge)).length,
    optional_tours: rows.filter(row => hasValue(row.optional_tours)).length,
    surcharges: rows.filter(row => hasValue(row.surcharges)).length,
    normalized_surcharges: rows.filter(row => hasValue(row.normalized_surcharges)).length,
    accommodations: rows.filter(row => hasValue(row.accommodations)).length,
    category_attrs: rows.filter(row => hasValue(row.category_attrs)).length,
  };

  console.log(JSON.stringify({ scannedPackages: rows.length, populated, groups }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
