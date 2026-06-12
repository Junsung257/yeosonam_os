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
  service_name?: string | null;
  service_detail?: string | null;
}

function cleanLine(value: string | null | undefined): string {
  return (value ?? '')
    .replace(/^[▶◆◇●○■□*ㆍ·\-\s]+/, '')
    .replace(/^[\p{So}\p{Co}\s]+/u, '')
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

  if (/\uBC31\uB450\uC0B0/.test(text) && /\uCC9C\uC9C0/.test(text)) queries.push('\uBC31\uB450\uC0B0 \uCC9C\uC9C0');
  if (/\uB450\uB9CC\uAC15/.test(text) && /\uAC15\uBCC0\uACF5\uC6D0/.test(text)) queries.push('\uB450\uB9CC\uAC15 \uAC15\uBCC0\uACF5\uC6D0');
  if (/\uBE44\uC554\uC0B0/.test(text) && /\uC77C\uC1A1\uC815/.test(text)) queries.push('\uBE44\uC554\uC0B0 \uC77C\uC1A1\uC815');
  if (/\uD574\uB780\uAC15/.test(text)) queries.push('\uD574\uB780\uAC15');
  if (/\uC724\uB3D9\uC8FC\s*\uC0DD\uAC00|\uC724\uB3D9\uC8FC\uC0DD\uAC00/.test(text)) queries.push('\uC724\uB3D9\uC8FC\uC0DD\uAC00');
  if (/\uBA85\uB3D9\uAD50\uD68C/.test(text)) queries.push('\uBA85\uB3D9\uAD50\uD68C');
  if (/\uC7A5\uBC31\uD3ED\uD3EC/.test(text)) queries.push('\uC7A5\uBC31\uD3ED\uD3EC');

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

function directionParticleSafe(name: string): string {
  const code = compact(name).charCodeAt(compact(name).length - 1);
  if (!Number.isFinite(code) || code < 0xac00 || code > 0xd7a3) return '\uC73C\uB85C';
  const jong = (code - 0xac00) % 28;
  return jong === 0 || jong === 8 ? '\uB85C' : '\uC73C\uB85C';
}

function joinKoreanList(values: string[]): string {
  if (values.length <= 1) return values[0] ?? '';
  return values.join(', ');
}

function normalizeDuration(value: string | null | undefined): string | null {
  const clean = cleanLine(value);
  return clean || null;
}

function parseIncludedService(activity: string): { name: string; duration: string | null; note: string | null } | null {
  const text = cleanLine(activity);
  const massage = text.match(/((?:\uC804\uC2E0\s*\+\s*\uBC1C|\uBC1C\s*\+\s*\uC804\uC2E0|\uC804\uC2E0|\uBC1C|\uC804\uD1B5\s*\uC624\uC77C|\uC624\uC77C|\uC2A4\uD1A4|\uC544\uB85C\uB9C8)?\s*(?:\uB9C8\uC0AC\uC9C0|\uB9DB\uC0AC\uC9C0))(?:\s*\(?\s*(\d+\s*(?:\uBD84|\uC2DC\uAC04)(?:\s*\d+\s*\uBD84)?)\s*\)?)?/);
  if (massage) {
    const parenNotes = [...text.matchAll(/\(([^)]*)\)/g)].map(match => cleanLine(match[1])).filter(Boolean);
    const note = parenNotes.length > 0 ? parenNotes.join(', ') : null;
    return {
      name: cleanLine(massage[1]).replace(/\s+/g, ''),
      duration: normalizeDuration(massage[2]),
      note,
    };
  }

  if (/\uC628\uCC9C\uC695/.test(text)) {
    const parenNotes = [...text.matchAll(/\(([^)]*)\)/g)].map(match => cleanLine(match[1])).filter(Boolean);
    return {
      name: '\uC628\uCC9C\uC695',
      duration: null,
      note: parenNotes.length > 0 ? parenNotes.join(', ') : null,
    };
  }

  return null;
}

function hasExplicitLocalPrice(text: string): boolean {
  return /(?:\$|＄)\s*\d{1,3}|\b\d{1,3}\s*(?:USD|달러|불)\b/i.test(text);
}

function hasIncludedValueSignal(text: string): boolean {
  return /(?:상당|포함|제공|특전|무료|서비스|체험)/.test(text);
}

function transferDestination(text: string): string {
  const match = text.match(/([\uAC00-\uD7A3A-Za-z0-9/]+?)(?:\uB85C|\uC73C\uB85C)?\s*\uC774\uB3D9(?:\s*\([^)]*\))?$/);
  return match?.[1]?.trim() || text.replace(/\s*(?:\uB85C|\uC73C\uB85C)?\s*\uC774\uB3D9(?:\s*\([^)]*\))?$/, '').trim();
}

function objectParticleSafe(name: string): string {
  const code = compact(name).charCodeAt(compact(name).length - 1);
  if (!Number.isFinite(code) || code < 0xac00 || code > 0xd7a3) return '\uC744';
  return (code - 0xac00) % 28 === 0 ? '\uB97C' : '\uC744';
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

function classifySafe(activity: string, type?: string | null): ScheduleEntityKind {
  const text = cleanLine(activity);
  const compactText = compact(text);
  const flightLike = /\b[A-Z0-9]{2}\s*\d{3,4}\b/.test(text)
    || (/\uACF5\uD56D/.test(text) && /(\uCD9C\uBC1C|\uB3C4\uCC29|\uBBF8\uD305)/.test(text))
    || (/(\uCD9C\uBC1C|\uB3C4\uCC29)$/.test(compactText) && !/(\uAD00\uAD11|\uCCB4\uD5D8|\uB4F1\uC815|\uC0B0\uCC45|\uC870\uB9DD)/.test(text));
  if (type === 'flight' && flightLike) return 'flight';
  if (type === 'meal') return 'meal';
  if (type === 'shopping' || /(\uBA74\uC138|\uC1FC\uD551|\uC1FC\uD551\uC13C\uD130|lala\s*port)/i.test(text)) return 'shopping';
  if (type === 'optional' || /(\uC120\uD0DD\s*\uAD00\uAD11|\uC635\uC158|\uBCC4\uB3C4\s*\uC694\uAE08)/.test(text)) return 'optional_tour';
  if (
    /(\uB9C8\uC0AC\uC9C0|\uB9DB\uC0AC\uC9C0|\uC628\uCC9C\uC695|\uC2A4\uD30C)/.test(text)
    && hasExplicitLocalPrice(text)
    && !hasIncludedValueSignal(text)
  ) return 'optional_tour';
  if (
    /(\uB9C8\uC0AC\uC9C0|\uB9DB\uC0AC\uC9C0|\uC628\uCC9C\uC695)/.test(text)
    && !/(?:\uD638\uD154.*(?:\uC774\uB3D9|\uD734\uC2DD|\uD22C\uC219|\uCCB4\uD06C|\uC11D\uC2DD)|\uD22C\uC219)/.test(text)
  ) return 'perk';
  if (
    type === 'hotel'
    || (/\uD638\uD154/.test(text) && /(\uCCB4\uD06C|\uD734\uC2DD|\uD22C\uC219|\uC774\uB3D9|\uC628\uCC9C\uC695|\uC11D\uC2DD)/.test(text))
    || /(?:HOTEL|hotel|\uD638\uD154|\uC8FC\uC810|\uB3D9\uAE09|\uC900\s*5\uC131|\uC815\s*5\uC131|5\uC131)/.test(text)
  ) return 'hotel_stay';
  if (/^(?:\uD638\uD154\uC2DD|\uD604\uC9C0\uC2DD|\uAE40\uBC25|\uB0C9\uBA74|\uAFC8\uBC14\uB85C\uC6B0|\uAFD4\uBC14\uB85C\uC6B0|\uC0E4\uBE0C\uC0E4\uBE0C|\uC0BC\uACB9\uC0B4|\uC591\uAF2C\uCE58|\uBE44\uBE54\uBC25|\uBB34\uC81C\uD55C|\uB9E4\uC6B4\uD0D5|\uC624\uB9AC\uAD6C\uC774|\uC0B0\uCC9C\uC5B4\uD68C)$/.test(compactText)) return 'meal';
  if (/^\uD2B9\uC804\s*:/.test(text)) return 'perk';
  if (/^(.+?)\s*(?:\uB85C|\uC73C\uB85C)?\s*\uC774\uB3D9(?:\s*\([^)]*\))?$/.test(text)) return 'transfer';
  if (attractionQueries(text).length > 0 || /(\uAD00\uAD11|\uBC29\uBB38|\uC0B0\uCC45|\uC870\uB9DD|\uCCB4\uD5D8)/.test(text)) return 'attraction_visit';
  return 'unknown';
}

function buildSentencesSafe(activity: string, kind: ScheduleEntityKind, queries: string[]): {
  landing: string;
  a4: string;
} {
  const text = cleanLine(activity);
  const primary = queries[0] ?? text;

  if (kind === 'transfer') {
    const destination = transferDestination(text);
    const routeAttractions = attractionQueries(text).filter(query => {
      const key = compact(query);
      return key !== compact(destination) && !/\uC774\uB3D9/.test(query);
    });
    if (routeAttractions.length > 0) {
      return {
        landing: `${joinKoreanList(routeAttractions)} \uC77C\uC815\uC744 \uC9C4\uD589\uD55C \uB4A4 ${destination}${directionParticleSafe(destination)} \uC774\uB3D9\uD569\uB2C8\uB2E4.`,
        a4: `${joinKoreanList(routeAttractions)} \uD6C4 ${destination} \uC774\uB3D9`,
      };
    }
    const transferStem = text.replace(/\s*\([^)]*\)\s*$/, '').trim();
    if (/(?:\uB85C|\uC73C\uB85C)\s*\uC774\uB3D9$/.test(transferStem)) {
      return { landing: `${transferStem}\uD569\uB2C8\uB2E4.`, a4: `${destination} \uC774\uB3D9` };
    }
    return { landing: `${destination}${directionParticleSafe(destination)} \uC774\uB3D9\uD569\uB2C8\uB2E4.`, a4: `${destination} \uC774\uB3D9` };
  }

  if (kind === 'perk') {
    const service = parseIncludedService(text);
    if (service) {
      const nameWithDuration = [service.name, service.duration].filter(Boolean).join(' ');
      const tipSentence = service.note && /\uB9E4\uB108\s*\uD301|\uD301/.test(service.note)
        ? ' \uB9E4\uB108\uD301\uC740 \uBCC4\uB3C4\uC785\uB2C8\uB2E4.'
        : service.note
          ? ` ${service.note}`
          : '';
      return {
        landing: `${nameWithDuration}\uC73C\uB85C \uC5EC\uD589\uC758 \uD53C\uB85C\uB97C \uD480\uC5B4\uBD05\uB2C8\uB2E4.${tipSentence}`.trim(),
        a4: [nameWithDuration, service.note ? `(${service.note})` : null].filter(Boolean).join(' '),
      };
    }
    return { landing: text, a4: text };
  }

  if (kind === 'shopping' || kind === 'optional_tour' || kind === 'flight' || kind === 'meal') {
    return { landing: text, a4: text };
  }

  if (kind === 'hotel_stay' && /(?:\uC628\uCC9C\uC695|\uC628\uCC9C\s*\uD734\uC2DD|\uC628\uCC9C\uD734\uC2DD)/.test(text)) {
    return {
      landing: '\uD638\uD154\uB85C \uC774\uB3D9\uD574 \uC11D\uC2DD \uD6C4 \uD734\uC2DD\uD558\uBA70 \uC628\uCC9C\uC695\uC744 \uC990\uAE41\uB2C8\uB2E4.',
      a4: '\uD638\uD154 \uC774\uB3D9 \uD6C4 \uC11D\uC2DD \uBC0F \uD734\uC2DD, \uC628\uCC9C\uC695',
    };
  }

  if (kind === 'attraction_visit' && /\uCFE0\uB85C\uAC00\uC640/.test(primary) && /\uC0B0\uCC45/.test(text)) {
    return {
      landing: '\uCFE0\uB85C\uAC00\uC640 \uC628\uCC9C\uB9C8\uC744\uC744 \uC0B0\uCC45\uD558\uBA70 \uC628\uCC9C \uB9C8\uC744\uC758 \uBD84\uC704\uAE30\uB97C \uB458\uB7EC\uBD05\uB2C8\uB2E4.',
      a4: '\uCFE0\uB85C\uAC00\uC640 \uC628\uCC9C\uB9C8\uC744 \uC0B0\uCC45',
    };
  }

  if (kind === 'attraction_visit' && primary) {
    if (/\uC870\uB9DD/.test(text)) {
      return {
        landing: `${primary}${objectParticleSafe(primary)} \uC870\uB9DD\uD569\uB2C8\uB2E4.`,
        a4: `${primary} \uC870\uB9DD`,
      };
    }
    if (/\uAD00\uAD11/.test(text)) {
      return {
        landing: `${primary} \uAD00\uAD11\uC744 \uC9C4\uD589\uD569\uB2C8\uB2E4.`,
        a4: `${primary} \uAD00\uAD11`,
      };
    }
    if (/\uC0B0\uCC45/.test(text)) {
      return {
        landing: `${primary}\uC744 \uC0B0\uCC45\uD569\uB2C8\uB2E4.`,
        a4: `${primary} \uC0B0\uCC45`,
      };
    }
    return {
      landing: `${primary} \uC77C\uC815\uC744 \uC9C4\uD589\uD569\uB2C8\uB2E4.`,
      a4: `${primary} \uAD00\uAD11`,
    };
  }

  return { landing: text, a4: text };
}

function shouldDropLandingScheduleItem(item: CompiledScheduleItem, regions?: unknown): boolean {
  const text = cleanLine(item.activity);
  const compactText = compact(text);
  if (!compactText) return true;
  const regionLabels = Array.isArray(regions)
    ? regions.map(region => compact(String(region))).filter(Boolean)
    : [];
  if (regionLabels.includes(compactText)) return true;
  if (/^(?:\uD638\uD154\s*)?(?:\uC870\uC2DD|\uC911\uC2DD|\uC11D\uC2DD)\s*\uD6C4$/.test(text)) return true;
  if (/^(?:\uBD80\uC0B0|\uC5F0\uAE38|\uB3C4\uBB38|\uC6A9\uC815|\uC774\uB3C4\uBC31\uD558|\uC1A1\uAC15\uD558|\uB0A8\uD30C|\uBD81\uD30C|\uC11C\uD30C)$/.test(compactText)) return true;
  if (/^(?:\uC804\uC77C|\uC804\uC6A9\uCC28\uB7C9|\uBB34\uC81C\uD55C)$/.test(compactText)) return true;
  if (/^\([^)]*\)$/.test(text)) return true;
  if (/^\$?\d+(?:\/\uC778)?$/.test(compactText)) return true;
  if (/^\d{1,2}:\d{2}$/.test(compactText)) return true;
  if (
    item.entity_kind === 'unknown'
    && !item.attraction_query
    && !(Array.isArray(item.attraction_names) && item.attraction_names.length > 0)
    && /^[\uAC00-\uD7A3A-Za-z/·.-]{2,12}$/.test(compactText)
    && !/(\uAD00\uAD11|\uBC29\uBB38|\uC0B0\uCC45|\uD0D1\uC2B9|\uCCB4\uD5D8|\uACF5\uD56D|\uB85C\uD504\uC6E8\uC774|\uC2E0\uC0AC|\uD638\uC218|\uB9C8\uC744|\uACF5\uC6D0|\uAC70\uB9AC|\uD3ED\uD3EC|\uC628\uCC9C|\uC0AC\uC6D0|\uC2DC\uC7A5|\uBC15\uBB3C\uAD00|\uC804\uB9DD\uB300|\uC2A4\uCE74\uC774|\uC6CC\uD06C|\uD56B\uCE74\uC774|\uB9C8\uCE20\uBC14\uB77C|\uC0AC\uC0AC\uBC14|\uB2C8\uD63C\uB2E4\uC774\uB77C)/.test(text)
  ) return true;
  return false;
}

function coalesceScheduleItems(items: ItineraryScheduleItem[]): ItineraryScheduleItem[] {
  const out: ItineraryScheduleItem[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const activity = cleanLine(item.activity);
    const next = items[i + 1];
    const nextActivity = cleanLine(next?.activity);
    if (/\uC758$/.test(activity) && /^\uACBD\uACC4\uAC00 \uB418\uB294 \uACF3/.test(nextActivity)) {
      out.push({ ...item, activity: `${activity} ${nextActivity}` });
      i++;
      continue;
    }
    out.push(item);
  }
  return out;
}

export function compileScheduleItemForLanding(item: ItineraryScheduleItem): CompiledScheduleItem {
  const activity = cleanLine(item.activity);
  if (!activity) return item as CompiledScheduleItem;

  const kind = classifySafe(activity, item.type);
  const queries = kind === 'attraction_visit' ? attractionQueries(activity) : [];
  const sentences = buildSentencesSafe(activity, kind, queries);
  const service = kind === 'perk' ? parseIncludedService(activity) : null;
  const normalizedType = item.type === 'flight' && kind !== 'flight' ? 'normal' : item.type;

  return {
    ...item,
    activity,
    type: normalizedType,
    entity_kind: kind,
    attraction_query: queries[0] ?? null,
    attraction_queries: queries.length > 0 ? queries : undefined,
    landing_sentence: sentences.landing,
    a4_sentence: sentences.a4,
    service_name: service?.name ?? null,
    service_detail: service ? [service.duration, service.note].filter(Boolean).join(' / ') || null : null,
  };
}

export function compileItineraryForLanding<T extends ItineraryDataLike | null>(itineraryData: T): T {
  if (!itineraryData?.days?.length) return itineraryData;
  return {
    ...itineraryData,
    days: itineraryData.days.map(day => ({
      ...day,
      schedule: coalesceScheduleItems(day.schedule ?? [])
        .map(item => compileScheduleItemForLanding(item))
        .filter(item => !shouldDropLandingScheduleItem(item, day.regions)),
    })),
  } as T;
}
