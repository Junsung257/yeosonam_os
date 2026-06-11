import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { AttractionData } from '@/lib/attraction-matcher';
import { evaluateMasterCandidate } from '@/lib/entity-master-candidates';

type ScheduleItemLike = {
  activity?: unknown;
  note?: unknown;
  type?: unknown;
  entity_kind?: unknown;
  kind?: unknown;
  attraction_ids?: unknown;
  attraction_names?: unknown;
  attraction_query?: unknown;
};

type ItineraryDayLike = {
  day?: unknown;
  regions?: unknown;
  schedule?: unknown;
};

export type AttractionMediaCandidate = {
  label: string;
  day: number | null;
  activity: string;
  matchedIds: string[];
  matchedNames: string[];
  photoCount: number;
  hasPhoto: boolean;
  customerVisible: boolean;
  reason: string;
};

export type AttractionMediaReadinessResult = {
  candidateCount: number;
  matchedCount: number;
  matchedWithPhotos: number;
  unmatchedCandidates: AttractionMediaCandidate[];
  missingPhotoCandidates: AttractionMediaCandidate[];
  warnings: string[];
  blockers: string[];
};

const NON_ATTRACTION_TYPES = new Set([
  'flight',
  'hotel',
  'meal',
  'transfer',
  'shopping',
  'optional_tour',
  'notice',
  'free_time',
  'price_noise',
]);

const ATTRACTION_NOUN_RE =
  /(로프웨이|케이블카|신사|사찰|절|호수|마을|공원|거리|폭포|온천마을|시장|마켓|스카이워크|전망대|성|궁|박물관|미술관|유적|유적지|사사바|마츠바라|핫카이|지옥|협곡|계곡|해변|비치|천지|경계비|수목한계선|일송정|생가|교회|성당|광장|민속촌|강변)/;

const DROP_FRAGMENT_RE =
  /^(?:조식|중식|석식|식사|호텔\s*조식|호텔\s*석식|중식\s*후|석식\s*후|조식\s*후|호텔\s*체크인|호텔\s*이동|공항\s*이동|자유시간|휴식|전일)$/;

const CUSTOMER_INVISIBLE_RE =
  /(김해|인천|부산|대구|청주|무안|국제공항|입국\s*수속|출국\s*수속|가이드\s*미팅|항공|직항|출발|도착|이동|소요|차창|호텔|조식|중식|석식|식사)/;

const PRICE_OR_DATE_FRAGMENT_RE =
  /(?:^\d[\d,]*(?:원|만원|만|불|달러|\$)?$|^\d{1,2}[./-]\d{1,2}|^\d{4}[./-]\d{1,2}[./-]\d{1,2})/;

const NON_ATTRACTION_CONTENT_RE =
  /(마사지|현지\s*지불\s*옵션|현지지불옵션|선택\s*관광|옵션가|추천\s*선택|옵션|자유\s*일정|자유시간|또는\s*동급|호텔\s*또는|기념품|토산품|쇼핑센터|쇼핑\s*센터|5D\s*비행|5D비행|스쿠버다이빙|호핑투어)/i;

function text(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(item => text(item)).filter(Boolean)
    : [];
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map(value => normalizeLabel(value)).filter(Boolean)));
}

function compactHangul(value: string): string {
  return value.replace(/\s+/g, '');
}

function knownCustomerAttractionLabels(activity: string): string[] {
  const compact = compactHangul(activity);
  const cases: Array<{ includes: string[]; labels: string[] }> = [
    {
      includes: ['\uBE44\uC554\uC0B0', '\uC77C\uC1A1\uC815', '\uD574\uB780\uAC15'],
      labels: ['\uBE44\uC554\uC0B0 \uC77C\uC1A1\uC815', '\uD574\uB780\uAC15'],
    },
    {
      includes: ['\uC724\uB3D9\uC8FC', '\uBA85\uB3D9\uAD50\uD68C'],
      labels: ['\uC724\uB3D9\uC8FC\uC0DD\uAC00', '\uBA85\uB3D9\uAD50\uD68C'],
    },
    {
      includes: ['\uB450\uB9CC\uAC15', '\uAC15\uBCC0\uACF5\uC6D0'],
      labels: ['\uB450\uB9CC\uAC15 \uAC15\uBCC0\uACF5\uC6D0'],
    },
    {
      includes: ['36\uD638', '\uACBD\uACC4\uBE44'],
      labels: ['36\uD638 \uACBD\uACC4\uBE44'],
    },
    {
      includes: ['37\uD638', '\uACBD\uACC4\uBE44'],
      labels: ['37\uD638 \uACBD\uACC4\uBE44'],
    },
    {
      includes: ['\uC218\uBAA9\uD55C\uACC4\uC120'],
      labels: ['\uC218\uBAA9\uD55C\uACC4\uC120'],
    },
    {
      includes: ['\uC5F0\uAE38', '\uBBFC\uC18D\uCD0C'],
      labels: ['\uC5F0\uAE38 \uBBFC\uC18D\uCD0C'],
    },
  ];

  return unique(cases
    .filter(item => item.includes.every(term => compact.includes(term)))
    .flatMap(item => item.labels));
}

function splitCompositeAttractionLabel(label: string): string[] {
  const normalized = normalizeLabel(label);
  if (!/[,\u3001/]| \+ | & /.test(normalized)) return normalized ? [normalized] : [];
  return unique(normalized
    .split(/\s*(?:,|\u3001|\/|\+|&)\s*/g)
    .map(part => part
      .replace(/\s*(?:\uCC28\uCC3D\uAD00\uAD11|\uAD00\uAD11|\uC0B0\uCC45|\uBC29\uBB38)\s*$/g, '')
      .trim())
    .filter(part => part.length >= 2));
}

function normalizeLabel(value: string): string {
  return value
    .replace(/^[▶◆★*ㆍ\-\s]+/g, '')
    .replace(/★.*$/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\s*(관광|산책|탐방|방문|체험|왕복탑승|탑승|입장|감상)\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractKnownJapaneseFujiLabel(activity: string): string | null {
  const compact = activity.replace(/\s+/g, '');
  const known = [
    '니혼다이라로프웨이',
    '후지산파노라마로프웨이',
    '미호노마츠바라',
    '오부치사사바',
    '아라쿠라야마센겐신사',
    '오시노핫카이',
    '미시마스카이워크',
  ];
  const found = known.find(label => compact.includes(label));
  if (!found) return null;
  return found
    .replace('니혼다이라로프웨이', '니혼다이라 로프웨이')
    .replace('후지산파노라마로프웨이', '후지산 파노라마 로프웨이')
    .replace('미호노마츠바라', '미호노 마츠바라')
    .replace('오부치사사바', '오부치사사바')
    .replace('아라쿠라야마센겐신사', '아라쿠라야마 센겐신사')
    .replace('오시노핫카이', '오시노핫카이')
    .replace('미시마스카이워크', '미시마 스카이워크');
}

function extractKnownLabel(activity: string): string | null {
  const fuji = extractKnownJapaneseFujiLabel(activity);
  if (fuji) return fuji;

  const compact = activity.replace(/\s+/g, '');
  if (compact.includes('비암산일송정') && compact.includes('해란강')) return '비암산 일송정, 해란강';
  if (compact.includes('윤동주생가') && compact.includes('명동교회')) return '윤동주생가, 명동교회';
  if (compact.includes('두만강강변공원')) return '두만강 강변공원';
  if (compact.includes('백두산천지')) return '백두산 천지';
  if (compact.includes('천문봉')) return '천문봉';
  if (compact.includes('장백폭포')) return '장백폭포';
  if (compact.includes('악화폭포')) return '악화폭포';
  if (compact.includes('36호경계비')) return '36호 경계비';
  if (compact.includes('37호경계비')) return '37호 경계비';
  if (compact.includes('금강대협곡')) return '금강대협곡';
  if (compact.includes('수목한계선')) return '수목한계선';
  if (compact.includes('노천온천지대')) return '노천온천지대';
  if (compact.includes('연길민속촌')) return '연길 민속촌';
  return null;
}

function labelFromDescriptiveActivity(activity: string): string {
  const known = extractKnownLabel(activity);
  if (known) return known;

  const parts = activity
    .split(/[,\n]| 및 | 그리고 | \/|·/)
    .map(part => normalizeLabel(part))
    .filter(Boolean);
  const nounPart = [...parts].reverse().find(part => ATTRACTION_NOUN_RE.test(part));
  if (nounPart) return nounPart;

  return normalizeLabel(activity);
}

function hasEnoughAttractionSignal(label: string, activity: string): boolean {
  if (!label || label.length < 3) return false;
  if (DROP_FRAGMENT_RE.test(label)) return false;
  if (PRICE_OR_DATE_FRAGMENT_RE.test(label)) return false;
  if (NON_ATTRACTION_CONTENT_RE.test(label) || NON_ATTRACTION_CONTENT_RE.test(activity)) return false;
  if (ATTRACTION_NOUN_RE.test(label)) return true;
  if (extractKnownLabel(activity)) return true;
  if (label.length <= 5 && CUSTOMER_INVISIBLE_RE.test(activity)) return false;
  return false;
}

export function extractCustomerAttractionLabel(item: ScheduleItemLike): string | null {
  return extractCustomerAttractionLabels(item)[0] ?? null;
}

export function extractCustomerAttractionLabels(item: ScheduleItemLike): string[] {
  const type = text(item.type || item.entity_kind || item.kind).toLowerCase();
  if (NON_ATTRACTION_TYPES.has(type)) return [];

  const explicitNames = stringArray(item.attraction_names);
  if (explicitNames.length > 0) return unique(explicitNames);

  const explicitQueries = stringArray(item.attraction_query);
  if (explicitQueries.length > 0) return unique(explicitQueries.flatMap(splitCompositeAttractionLabel));

  const activity = text(item.activity);
  if (!activity) return [];
  if (DROP_FRAGMENT_RE.test(activity)) return [];

  const knownLabels = knownCustomerAttractionLabels(activity);
  if (knownLabels.length > 0) return knownLabels;

  const label = labelFromDescriptiveActivity(activity);
  return splitCompositeAttractionLabel(label)
    .filter(candidate => hasEnoughAttractionSignal(candidate, activity));
}

function itineraryDays(input: unknown): ItineraryDayLike[] {
  if (Array.isArray(input)) return input as ItineraryDayLike[];
  const days = (input as { days?: unknown } | null)?.days;
  return Array.isArray(days) ? days as ItineraryDayLike[] : [];
}

function photoCountFromAttraction(value: unknown): number {
  const photos = (value as { photos?: unknown } | null)?.photos;
  return Array.isArray(photos) ? photos.length : 0;
}

function attractionMap(attractions: AttractionData[]): Map<string, AttractionData> {
  const map = new Map<string, AttractionData>();
  for (const attraction of attractions) {
    if (attraction.id) map.set(attraction.id, attraction);
  }
  return map;
}

export function evaluateAttractionMediaReadiness(input: {
  itineraryData: unknown;
  attractions?: AttractionData[];
  attractionsById?: Map<string, AttractionData>;
  blockUnmatchedMajor?: boolean;
  includePhotoAudit?: boolean;
}): AttractionMediaReadinessResult {
  const byId = input.attractionsById ?? attractionMap(input.attractions ?? []);
  const candidates: AttractionMediaCandidate[] = [];

  for (const day of itineraryDays(input.itineraryData)) {
    const schedule = Array.isArray(day.schedule) ? day.schedule as ScheduleItemLike[] : [];
    for (const item of schedule) {
      const labels = extractCustomerAttractionLabels(item);
      if (labels.length === 0) continue;

      const ids = stringArray(item.attraction_ids);
      const matchedNames = ids
        .map(id => byId.get(id)?.name)
        .filter((name): name is string => Boolean(name));
      const photoCount = ids.reduce((sum, id) => sum + photoCountFromAttraction(byId.get(id)), 0);
      for (const label of labels) {
        candidates.push({
          label,
          day: typeof day.day === 'number' ? day.day : null,
          activity: text(item.activity),
          matchedIds: ids,
          matchedNames,
          photoCount,
          hasPhoto: photoCount > 0,
          customerVisible: true,
          reason: ids.length > 0 ? 'matched_attraction_id' : 'customer_visible_major_attraction_unmatched',
        });
      }
    }
  }

  const unmatchedCandidates = candidates.filter(candidate => candidate.matchedIds.length === 0);
  const missingPhotoCandidates = input.includePhotoAudit
    ? candidates.filter(candidate => candidate.matchedIds.length > 0 && !candidate.hasPhoto)
    : [];
  const warnings = [
    ...unmatchedCandidates.map(candidate => `attraction.unmatched_major:${candidate.label}`),
    ...missingPhotoCandidates.map(candidate => `attraction.photo_missing:${candidate.label}`),
  ];

  return {
    candidateCount: candidates.length,
    matchedCount: candidates.filter(candidate => candidate.matchedIds.length > 0).length,
    matchedWithPhotos: candidates.filter(candidate => candidate.matchedIds.length > 0 && candidate.hasPhoto).length,
    unmatchedCandidates,
    missingPhotoCandidates,
    warnings,
    blockers: input.blockUnmatchedMajor
      ? unmatchedCandidates.map(candidate => `attraction.unmatched_major:${candidate.label}`)
      : [],
  };
}

export async function persistAttractionMediaCandidates(input: {
  supabase: SupabaseClient;
  packageId: string;
  packageTitle: string;
  itineraryData: unknown;
  destination?: string | null;
  country?: string | null;
  activeAttractions?: AttractionData[];
  source?: string;
}): Promise<{ upserted: number; candidates: AttractionMediaCandidate[] }> {
  const readiness = evaluateAttractionMediaReadiness({
    itineraryData: input.itineraryData,
    attractions: input.activeAttractions ?? [],
  });
  const unmatched = readiness.unmatchedCandidates;
  if (unmatched.length === 0) return { upserted: 0, candidates: [] };

  const groups = new Map<string, { candidate: AttractionMediaCandidate; count: number; days: Set<number>; examples: string[] }>();
  for (const candidate of unmatched) {
    const decision = evaluateMasterCandidate({
      rawLabel: candidate.label,
      category: 'attraction',
      country: input.country ?? null,
      region: input.destination ?? null,
      destination: input.destination ?? null,
      occurrenceCount: 1,
      evidenceCount: 1,
      packageCount: 1,
    });
    const existing = groups.get(decision.candidateKey);
    if (existing) {
      existing.count += 1;
      if (candidate.day != null) existing.days.add(candidate.day);
      if (existing.examples.length < 5) existing.examples.push(candidate.activity);
    } else {
      groups.set(decision.candidateKey, {
        candidate,
        count: 1,
        days: new Set(candidate.day != null ? [candidate.day] : []),
        examples: [candidate.activity],
      });
    }
  }

  const keys = Array.from(groups.keys());
  const { data: existingRows, error: fetchError } = await input.supabase
    .from('entity_master_candidates')
    .select('candidate_key, evidence_count, occurrence_count, package_count, source_context')
    .in('candidate_key', keys);
  if (fetchError) throw fetchError;

  const existingByKey = new Map(
    ((existingRows ?? []) as Array<Record<string, unknown>>).map(row => [String(row.candidate_key), row]),
  );

  const payload = Array.from(groups.entries()).map(([candidateKey, group]) => {
    const decision = evaluateMasterCandidate({
      rawLabel: group.candidate.label,
      category: 'attraction',
      country: input.country ?? null,
      region: input.destination ?? null,
      destination: input.destination ?? null,
      occurrenceCount: group.count,
      evidenceCount: 1,
      packageCount: 1,
    });
    const existing = existingByKey.get(candidateKey);
    const sourceContext = (existing?.source_context && typeof existing.source_context === 'object'
      ? existing.source_context as Record<string, unknown>
      : {});
    const packageIds = new Set([
      ...stringArray(sourceContext.package_ids),
      input.packageId,
    ]);
    const packageTitles = new Set([
      ...stringArray(sourceContext.package_titles),
      input.packageTitle,
    ]);
    const examples = [
      ...(Array.isArray(sourceContext.examples) ? sourceContext.examples : []),
      ...group.examples.map(activity => ({
        package_id: input.packageId,
        package_title: input.packageTitle,
        day_numbers: Array.from(group.days),
        label: group.candidate.label,
        activity_hash: createHash('sha1').update(activity).digest('hex').slice(0, 16),
        activity_sample: activity.slice(0, 160),
      })),
    ].slice(-20);

    return {
      candidate_key: candidateKey,
      category: decision.category,
      raw_label: decision.rawLabel,
      normalized_label: decision.normalizedLabel,
      destination_scope: decision.destinationScope,
      country_scope: decision.countryScope,
      region_scope: decision.regionScope,
      evidence_count: Number(existing?.evidence_count ?? 0) + 1,
      occurrence_count: Number(existing?.occurrence_count ?? 0) + group.count,
      package_count: packageIds.size,
      source_unmatched_ids: [],
      source_context: {
        ...sourceContext,
        package_ids: Array.from(packageIds).slice(-50),
        package_titles: Array.from(packageTitles).slice(-20),
        examples,
        analyzer: input.source ?? 'upload-attraction-media-readiness',
        mobile_landing_impact: true,
        updated_at: new Date().toISOString(),
      },
      external_sources: [],
      suggested_master: decision.suggestedMaster,
      confidence: decision.confidence,
      promotion_status: decision.promotionStatus,
      auto_action: decision.autoAction,
      decision_reason: decision.decisionReason,
    };
  });

  const { error } = await input.supabase
    .from('entity_master_candidates')
    .upsert(payload, { onConflict: 'candidate_key' });
  if (error) throw error;

  return { upserted: payload.length, candidates: unmatched };
}
