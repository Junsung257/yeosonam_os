import { matchAttraction, matchAttractions, type AttractionData } from '@/lib/attraction-matcher';

export interface AttractionRefScheduleItem {
  activity: string;
  attraction_ids?: (string | null)[] | null;
  attraction_names?: string[] | null;
}

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, '');
}

/**
 * schedule에 저장된 attraction_ids/names를 우선 사용하고,
 * 없으면 기존 activity 텍스트 매칭으로 폴백한다.
 */
export function resolvePrimaryAttraction(
  item: AttractionRefScheduleItem,
  attractions: AttractionData[],
  destination?: string,
): AttractionData | null {
  if (!item.activity || attractions.length === 0) return null;

  const byId = new Map<string, AttractionData>();
  const byName = new Map<string, AttractionData>();
  for (const a of attractions) {
    if (a.id) byId.set(a.id, a);
    byName.set(norm(a.name), a);
  }

  const ids = item.attraction_ids ?? [];
  for (const id of ids) {
    if (!id) continue;
    const found = byId.get(id);
    if (found) return found;
  }

  const names = item.attraction_names ?? [];
  for (const name of names) {
    const byExact = byName.get(norm(name));
    if (byExact) return byExact;
    const bySemantic = matchAttractions(name, attractions, destination);
    if (bySemantic.length > 0) return bySemantic[0];
  }

  return matchAttraction(item.activity, attractions, destination);
}
