import { matchAttraction, type AttractionData } from '@/lib/attraction-matcher';
import type { V3DraftLedger, V3MatchSummary } from './types';
import { buildV3EntitySummary } from './entity-normalizer';

function cloneLedger(ledger: V3DraftLedger): V3DraftLedger {
  return JSON.parse(JSON.stringify(ledger)) as V3DraftLedger;
}

const DESCRIPTIVE_ATTRACTION_PREFIX_RE =
  /^[\s\u25b6\u25cf\u2022\u00b7\u25c6\u25c7\u25a0\u25a1\u2605\u2606+\-\u2663\u220e\u203b]+/;

function normalizedAttractionCandidate(value: string): string {
  return value
    .replace(DESCRIPTIVE_ATTRACTION_PREFIX_RE, '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/(?:\uad00\uad11|\uc0b0\ucc45|\uccb4\ud5d8|\ubc29\ubb38|\uc870\ub9dd)\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function pushCandidate(candidates: string[], value: string | null | undefined): void {
  const normalized = normalizedAttractionCandidate(value ?? '');
  if (normalized.length < 2 || normalized.length > 40) return;
  if (!candidates.some(existing => existing.replace(/\s+/g, '') === normalized.replace(/\s+/g, ''))) {
    candidates.push(normalized);
  }
}

function extractAttractionCandidateLabels(rawText: string): string[] {
  const candidates: string[] = [];
  pushCandidate(candidates, rawText);
  const cleaned = normalizedAttractionCandidate(rawText);

  for (const part of cleaned.split(/\s*(?:,|\uff0c|\/|\u318d|\u00b7|\ubc0f|\u0026)\s*/)) {
    pushCandidate(candidates, part);
  }

  const beforeParen = rawText.match(/([A-Za-z0-9\uac00-\ud7a3][A-Za-z0-9\uac00-\ud7a3\s]{1,20})\s*\([^)]{1,20}\)/);
  pushCandidate(candidates, beforeParen?.[1]);

  const tokens = cleaned.split(/\s+/).filter(Boolean);
  pushCandidate(candidates, tokens.at(-1));

  return candidates;
}

export function applyProductRegistrationV3Matching(
  ledger: V3DraftLedger,
  attractions: AttractionData[] = [],
  destination?: string | null,
): { ledger: V3DraftLedger; matchSummary: V3MatchSummary } {
  const next = cloneLedger(ledger);
  const unmatched: V3MatchSummary['unmatched'] = [];
  let attractionMatched = 0;
  let attractionUnmatched = 0;
  let optionReview = 0;
  let shoppingCount = 0;

  for (const variant of next.variants) {
    for (const day of variant.days) {
      for (const event of day.events) {
        if (event.type === 'shopping') shoppingCount++;
        if (event.type === 'option') optionReview++;
        if (event.type !== 'attraction') continue;

        const scopedDestination = destination?.trim() || undefined;
        let match: AttractionData | null = null;
        for (const candidate of extractAttractionCandidateLabels(event.raw_text)) {
          match = matchAttraction(candidate, attractions, scopedDestination);
          if (!match && !scopedDestination) {
            match = matchAttraction(candidate, attractions, undefined);
          }
          if (match) break;
        }
        if (match?.id || match?.name) {
          event.canonical_id = match.id ?? match.name;
          event.canonical_type = 'attraction';
          event.match_status = 'matched';
          attractionMatched++;
        } else {
          event.match_status = 'unmatched';
          attractionUnmatched++;
          unmatched.push({
            raw_text: event.raw_text,
            day_number: day.day,
            evidence: event.evidence,
          });
        }
      }
    }
  }

  const entitySummary = buildV3EntitySummary({
    ledger: next,
    destination,
  });

  return {
    ledger: next,
    matchSummary: {
      attraction_matched_count: attractionMatched,
      attraction_unmatched_count: attractionUnmatched,
      option_review_count: Math.max(optionReview, entitySummary.option_review_needed_count),
      shopping_count: Math.max(shoppingCount, entitySummary.shopping_review_needed_count),
      unmatched,
      entity_summary: entitySummary,
    },
  };
}
