import { matchAttraction, type AttractionData } from '@/lib/attraction-matcher';
import type { V3DraftLedger, V3MatchSummary } from './types';
import { buildV3EntitySummary } from './entity-normalizer';

function cloneLedger(ledger: V3DraftLedger): V3DraftLedger {
  return JSON.parse(JSON.stringify(ledger)) as V3DraftLedger;
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

        const match = matchAttraction(event.raw_text, attractions, destination ?? undefined);
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
