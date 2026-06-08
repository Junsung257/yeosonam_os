import type { ItineraryDataLike, ItineraryScheduleItem } from '@/lib/itinerary-attraction-enricher';

export type ScheduleEntityKind =
  | 'attraction_visit'
  | 'transfer'
  | 'hotel_stay'
  | 'meal'
  | 'shopping'
  | 'optional_tour'
  | 'perk'
  | 'flight'
  | 'unknown';

export interface CompiledScheduleItem extends ItineraryScheduleItem {
  entity_kind?: ScheduleEntityKind;
  attraction_query?: string | null;
  attraction_queries?: string[];
  landing_sentence?: string | null;
  a4_sentence?: string | null;
}

function cleanLine(value: string | null | undefined): string {
  return (value ?? '')
    .replace(/^[▶◆◇●○■□*ㆍ·\-\s]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function compact(value: string): string {
  return value.replace(/\s+/g, '');
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values.map(cleanLine).filter(Boolean)) {
    const key = compact(value).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function attractionQueries(activity: string): string[] {
  const text = cleanLine(activity);
  const queries: string[] = [];

  if (/유황\s*재배지/.test(text) && /유노\s*하나|유노하나/.test(text)) queries.push('유노하나 재배지');
  if (/가마도/.test(text) && /지옥/.test(text)) queries.push('가마도 지옥순례', '가마도지옥');
  if (/긴린/.test(text) && /호수/.test(text)) queries.push('긴린 호수', '긴린코호수');
  if (/민예\s*거리/.test(text) || /민예거리/.test(text)) queries.push('민예거리', '유후인 민예거리');
  if (/쿠로가와/.test(text) && /온천\s*마을|온천마을/.test(text)) queries.push('쿠로가와 온천마을');
  if (/후쿠오카\s*타워/i.test(text)) queries.push('후쿠오카 타워');

  const parenthesisRemoved = text.replace(/\([^)]*\)/g, ' ');
  const beforeAction = parenthesisRemoved
    .replace(/\s*(?:관광|방문|산책|순례|체험|내부관광)\s*$/g, '')
    .trim();
  if (beforeAction && beforeAction !== text && beforeAction.length >= 2 && beforeAction.length <= 30) {
    queries.push(beforeAction);
  }

  return unique(queries);
}

function classify(activity: string, type?: string | null): ScheduleEntityKind {
  const text = cleanLine(activity);
  if (type === 'flight') return 'flight';
  if (type === 'meal') return 'meal';
  if (type === 'shopping' || /(면세|쇼핑|쇼핑센터|라라포트|lala\s*port)/i.test(text)) return 'shopping';
  if (type === 'optional' || /(선택관광|옵션|별도\s*요금)/.test(text)) return 'optional_tour';
  if (type === 'hotel' || (/호텔/.test(text) && /(체크|휴식|투숙|이동|온천욕|석식)/.test(text))) return 'hotel_stay';
  if (/^특전\s*:/.test(text)) return 'perk';
  if (/^(.+?)\s*이동$/.test(text)) return 'transfer';
  if (attractionQueries(text).length > 0 || /(관광|방문|산책|순례|족욕|체험)/.test(text)) return 'attraction_visit';
  return 'unknown';
}

function particle(name: string): string {
  const last = compact(name).charCodeAt(compact(name).length - 1);
  if (!Number.isFinite(last)) return '를';
  return (last - 0xac00) % 28 === 0 ? '를' : '을';
}

function directionParticle(name: string): string {
  const lastCode = compact(name).charCodeAt(compact(name).length - 1);
  if (!Number.isFinite(lastCode) || lastCode < 0xac00 || lastCode > 0xd7a3) return '로';
  const jong = (lastCode - 0xac00) % 28;
  return jong === 0 || jong === 8 ? '로' : '으로';
}

function buildSentences(activity: string, kind: ScheduleEntityKind, queries: string[]): {
  landing: string;
  a4: string;
} {
  const text = cleanLine(activity);
  const primary = queries[0] ?? text;

  if (kind === 'transfer') {
    const destination = text.replace(/\s*이동$/, '').trim();
    return { landing: `${destination}${directionParticle(destination)} 이동합니다.`, a4: `${destination} 이동` };
  }

  if (kind === 'hotel_stay' && /온천욕/.test(text)) {
    return {
      landing: '호텔로 이동해 석식 후 휴식하며 온천욕을 즐깁니다.',
      a4: '호텔 이동 후 석식 및 휴식, 온천욕',
    };
  }

  if (kind === 'perk') return { landing: text, a4: text };
  if (kind === 'shopping') return { landing: text, a4: text };
  if (kind === 'flight') return { landing: text, a4: text };

  if (/쿠로가와/.test(primary) && /산책/.test(text)) {
    return {
      landing: `${primary}${particle(primary)} 산책하며 온천 마을의 분위기를 둘러봅니다.`,
      a4: `${primary} 산책`,
    };
  }

  if (/가마도/.test(primary) && /족욕/.test(text)) {
    return {
      landing: '가마도 지옥순례와 족욕 체험을 진행합니다.',
      a4: '가마도 지옥순례 및 족욕체험',
    };
  }

  if (queries.length > 1 && /긴린/.test(queries[0]) && /민예/.test(queries[1])) {
    return {
      landing: '긴린 호수와 유후인 민예거리를 둘러봅니다.',
      a4: '긴린 호수 및 유후인 민예거리 관광',
    };
  }

  if (kind === 'attraction_visit' && primary) {
    return {
      landing: `${primary}${particle(primary)} 둘러봅니다.`,
      a4: `${primary} 관광`,
    };
  }

  return { landing: text, a4: text };
}

export function compileScheduleItemForLanding(item: ItineraryScheduleItem): CompiledScheduleItem {
  const activity = cleanLine(item.activity);
  if (!activity) return item as CompiledScheduleItem;

  const kind = classify(activity, item.type);
  const queries = kind === 'attraction_visit' ? attractionQueries(activity) : [];
  const sentences = buildSentences(activity, kind, queries);

  return {
    ...item,
    activity,
    entity_kind: kind,
    attraction_query: queries[0] ?? null,
    attraction_queries: queries.length > 0 ? queries : undefined,
    landing_sentence: sentences.landing,
    a4_sentence: sentences.a4,
  };
}

export function compileItineraryForLanding<T extends ItineraryDataLike | null>(itineraryData: T): T {
  if (!itineraryData?.days?.length) return itineraryData;
  return {
    ...itineraryData,
    days: itineraryData.days.map(day => ({
      ...day,
      schedule: (day.schedule ?? []).map(item => compileScheduleItemForLanding(item)),
    })),
  } as T;
}
