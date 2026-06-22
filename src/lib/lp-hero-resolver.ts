import type { SupabaseClient } from '@supabase/supabase-js';
import type { AttractionData } from '@/lib/attraction-matcher';
import { destinationToIsoSet } from '@/lib/destination-iso';
import { runOptionalSupabaseQuery } from '@/lib/supabase-query-guard';

interface ItineraryDayData {
  day?: number;
  schedule?: Array<{
    activity?: string;
    type?: string;
    attraction_ids?: string[];
    attraction_names?: string[];
  }>;
  [key: string]: unknown;
}

export async function resolveLpHeroPhotoUrl(
  sb: SupabaseClient,
  pkg: { destination?: string | null; itinerary_data?: unknown },
): Promise<string | null> {
  if (!pkg?.destination) return null;

  const collectedIds = collectAttractionIds(pkg.itinerary_data);
  if (collectedIds.length > 0) {
    const { data: detail } = await runOptionalSupabaseQuery(
      sb
        .from('attractions')
        .select('id, name, photos, country, region')
        .in('id', collectedIds)
        .limit(30),
      { data: [] },
      { label: 'lp.hero.attractions-by-id', timeoutMs: 1200 },
    );

    const hero = chooseHeroCandidate((detail ?? []) as unknown as AttractionData[], pkg.destination, true);
    const p = hero?.photos?.[0];
    const url = p?.src_large || p?.src_medium || null;
    if (url) return url;
  }

  const fallback = await resolveDestinationFallbackHero(sb, pkg.destination);
  const p = fallback?.photos?.[0];
  return p?.src_large || p?.src_medium || null;
}

async function resolveDestinationFallbackHero(
  sb: SupabaseClient,
  destination: string,
): Promise<AttractionData | null> {
  const tokens = destinationTokens(destination).slice(0, 4);
  if (tokens.length === 0) return null;

  const filter = tokens
    .flatMap(token => [`region.ilike.%${escapeSupabaseOrToken(token)}%`, `name.ilike.%${escapeSupabaseOrToken(token)}%`])
    .join(',');

  const { data } = await runOptionalSupabaseQuery(
    sb
      .from('attractions')
      .select('id, name, photos, country, region')
      .not('photos', 'is', null)
      .or(filter)
      .limit(50),
    { data: [] },
    { label: 'lp.hero.destination-fallback', timeoutMs: 1200 },
  );

  return chooseHeroCandidate((data ?? []) as unknown as AttractionData[], destination, false);
}

function chooseHeroCandidate(
  matched: AttractionData[],
  destination: string,
  requireCountryMatch: boolean,
): AttractionData | null {
  if (matched.length === 0) return null;

  const destIsoSet = destinationToIsoSet(destination);
  const countryMatched = matched
    .filter(a => a.photos && a.photos.length > 0 && a.country && destIsoSet.has(a.country))
    .sort((a, b) => scoreHeroCandidate(b, destination) - scoreHeroCandidate(a, destination))[0];
  if (countryMatched) return countryMatched;
  if (requireCountryMatch) return null;

  return matched
    .filter(a => a.photos && a.photos.length > 0)
    .sort((a, b) => scoreHeroCandidate(b, destination) - scoreHeroCandidate(a, destination))[0]
    ?? null;
}

function scoreHeroCandidate(attraction: AttractionData, destination?: string | null): number {
  const name = attraction.name ?? '';
  const region = attraction.region ?? '';
  const photo = attraction.photos?.[0] as { alt?: string } | undefined;
  const photoAlt = photo?.alt ?? '';
  const haystack = `${name} ${region} ${photoAlt}`.toLowerCase();
  const tokens = destinationTokens(String(destination ?? ''));

  let score = 0;
  for (const token of tokens) {
    if (name.includes(token)) score += 60;
    if (region.includes(token)) score += 25;
  }

  if (/천지|백두산|heaven lake|changbai|mountain|lake/i.test(haystack)) score += 40;
  if (/beach|coast|sea|ocean|island|bay|resort/i.test(haystack)) score += 20;
  if (/luggage|smartphone|esim|phone|traveler activating/i.test(photoAlt)) score -= 80;

  return score;
}

function destinationTokens(destination: string): string[] {
  return Array.from(new Set(
    destination
      .split(/[\/,\s·|()]+/)
      .map(v => v.trim())
      .filter(v => v.length >= 2 && !/^\d+$/.test(v)),
  ));
}

function escapeSupabaseOrToken(token: string): string {
  return token.replace(/[%*,()]/g, ' ').replace(/\s+/g, ' ').trim();
}

function collectAttractionIds(itineraryData: unknown): string[] {
  if (!itineraryData || typeof itineraryData !== 'object') return [];

  const raw = itineraryData as Record<string, unknown>;
  const days: unknown[] = Array.isArray(raw)
    ? raw
    : Array.isArray(raw.days)
      ? (raw.days as unknown[])
      : [];

  const ids = new Set<string>();
  for (const day of days) {
    if (!day || typeof day !== 'object') continue;
    const d = day as ItineraryDayData;
    if (!Array.isArray(d.schedule)) continue;
    for (const item of d.schedule) {
      if (Array.isArray(item.attraction_ids)) {
        for (const id of item.attraction_ids) {
          if (id && typeof id === 'string') ids.add(id);
        }
      }
    }
  }
  return Array.from(ids);
}
