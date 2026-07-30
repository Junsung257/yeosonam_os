#!/usr/bin/env tsx

import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

import {
  getCustomerAttractionRenderBlockers,
  type AttractionData,
} from '@/lib/attraction-matcher';
import {
  enrichItineraryWithAttractionReferences,
  type ItineraryScheduleItem,
} from '@/lib/itinerary-attraction-enricher';
import { recoverCatalogSplitFromRawText } from '@/lib/product-registration/catalog-split-recovery';
import { evaluateAttractionMediaReadiness } from '@/lib/product-registration/attraction-media-readiness';
import { extractUploadDestinationFromFilename } from '@/lib/product-registration/destination-resolution';
import { registerProductFromRaw } from '@/lib/product-registration/register-product-from-raw';
import { runProductRegistrationV3 } from '@/lib/product-registration-v3';
import type { ExtractedData } from '@/lib/parser';

function argValue(name: string): string | null {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find(arg => arg.startsWith(prefix))?.slice(prefix.length) ?? null;
}

function requiredArg(name: string): string {
  const value = argValue(name);
  if (!value) throw new Error(`Missing required argument --${name}=...`);
  return value;
}

async function main(): Promise<void> {
  const textPath = resolve(requiredArg('text'));
  const attractionPath = resolve(requiredArg('active-attractions-json'));
  const productIndex = Number.parseInt(argValue('product-index') ?? '0', 10);
  const summaryOnly = process.argv.slice(2).includes('--summary-only');
  const contains = (argValue('contains') ?? '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  const sourceFileName = argValue('file-name') ?? basename(textPath).replace(/\.txt$/i, '');

  const [documentBuffer, attractionCacheBuffer] = await Promise.all([
    readFile(textPath),
    readFile(attractionPath),
  ]);
  const documentRawText = documentBuffer.toString('utf8');
  const attractionCacheText = attractionCacheBuffer.toString('utf8');
  const attractionPayload = JSON.parse(attractionCacheText) as {
    attractions?: AttractionData[];
  };
  const activeAttractions = attractionPayload.attractions ?? [];
  const recovered = recoverCatalogSplitFromRawText(documentRawText);
  const products = recovered.length > 0
    ? recovered
    : [{
        sectionRawText: documentRawText,
        extractedData: { rawText: documentRawText } as ExtractedData,
      }];
  const product = products[productIndex];
  if (!product) {
    throw new Error(`Product index ${productIndex} is unavailable; recovered ${products.length} products`);
  }

  const rawText = product.sectionRawText ?? documentRawText;
  const sourceLines = rawText.split(/\r?\n/);
  const sourceMatches = contains.flatMap(term => sourceLines.flatMap((quote, index) => (
    quote.includes(term)
      ? [{
          term,
          line: index + 1,
          quote,
          context: sourceLines.slice(Math.max(0, index - 2), index + 3),
        }]
      : []
  )));
  const extractedData: ExtractedData = {
    ...product.extractedData,
    rawText,
  };
  const registration = await registerProductFromRaw({
    rawText,
    documentRawText,
    extractedData,
    title: product.extractedData.title ?? null,
    activeAttractions,
    tempDestination: extractUploadDestinationFromFilename(sourceFileName),
    enableGeminiFallback: false,
  });
  const v3 = await runProductRegistrationV3(rawText, {
    attractions: activeAttractions,
    destination: registration.identity.destination ?? undefined,
  });
  const itineraryData = registration.itinerary.itineraryDataToSave;
  const media = evaluateAttractionMediaReadiness({
    itineraryData,
    attractions: activeAttractions,
    includePhotoAudit: false,
  });
  const schedule: Array<ItineraryScheduleItem & {
    day?: number;
    attraction_names: string[];
  }> = (itineraryData?.days ?? []).flatMap(day => (
    (day.schedule ?? []).map(item => ({
      day: day.day,
      activity: item.activity,
      note: item.note ?? null,
      ...(typeof item.type === 'string' ? { type: item.type } : {}),
      ...(typeof item.entity_kind === 'string' ? { entity_kind: item.entity_kind } : {}),
      ...(typeof item.attraction_query === 'string' ? { attraction_query: item.attraction_query } : {}),
      attraction_ids: Array.isArray(item.attraction_ids)
        ? item.attraction_ids.filter((value): value is string => typeof value === 'string')
        : [],
      attraction_names: Array.isArray(item.attraction_names)
        ? item.attraction_names.filter((value): value is string => typeof value === 'string')
        : [],
    }))
  ));
  const filteredSchedule = contains.length === 0
    ? schedule
    : schedule.filter(item => contains.some(term => (
      `${item.activity} ${item.note ?? ''} ${(item.attraction_names ?? []).join(' ')}`.includes(term)
    )));
  const isolated = filteredSchedule.map(item => ({
    activity: item.activity,
    destinationScoped: enrichItineraryWithAttractionReferences(
      { days: [{ day: item.day, schedule: [item] }] },
      activeAttractions,
      registration.identity.destination ?? undefined,
    ).itineraryData?.days?.[0]?.schedule?.[0] ?? null,
    globallyScoped: enrichItineraryWithAttractionReferences(
      { days: [{ day: item.day, schedule: [item] }] },
      activeAttractions,
    ).itineraryData?.days?.[0]?.schedule?.[0] ?? null,
  }));

  const payload = {
    sourceFileName,
    productIndex,
    title: registration.identity.title,
    destination: registration.identity.destination,
    sourceMatches,
    extractedFacts: {
      minParticipants: registration.extractedData.min_participants ?? null,
      optionalTours: registration.extractedData.optional_tours ?? [],
      surcharges: registration.extractedData.surcharges ?? [],
      notices: registration.extractedData.notices_parsed ?? [],
    },
    itinerary: {
      matchedCanonicalNames: registration.itinerary.matchedCanonicalNames,
      unmatchedCandidates: registration.itinerary.unmatchedCandidates,
    },
    v3: {
      structurePlan: v3.structure_plan,
      gate: summaryOnly
        ? {
            status: v3.gate_result.status,
            failedChecks: v3.gate_result.checks.filter(check => check.status === 'fail'),
          }
        : v3.gate_result,
      matchSummary: summaryOnly
        ? {
            attraction_matched_count: v3.match_summary.attraction_matched_count,
            attraction_unmatched_count: v3.match_summary.attraction_unmatched_count,
            option_review_count: v3.match_summary.option_review_count,
            shopping_count: v3.match_summary.shopping_count,
            unmatched: v3.match_summary.unmatched,
          }
        : v3.match_summary,
      variants: v3.ledger.variants.map(variant => ({
        variant_key: variant.variant_key,
        minimum_departure: variant.minimum_departure,
        flight_segments: variant.flight_segments,
        options: variant.options,
        shopping: variant.shopping,
        structured_facts: summaryOnly
          ? variant.structured_facts.filter(fact => (
              fact.review_status === 'review_needed'
              || fact.category === 'surcharge'
              || fact.category === 'room_policy'
            ))
          : variant.structured_facts,
        standard_notices: summaryOnly
          ? variant.standard_notices.filter(notice => notice.review_status === 'review_needed')
          : variant.standard_notices,
      })),
    },
    media: {
      unmatchedCandidates: media.unmatchedCandidates,
      missingDescriptionCandidates: media.missingDescriptionCandidates,
    },
    ...(!summaryOnly ? {
      catalogMatches: contains.flatMap(term => activeAttractions
        .filter(attraction => attraction.name.includes(term) || term.includes(attraction.name))
        .map(attraction => ({
          id: attraction.id,
          name: attraction.name,
          region: attraction.region,
          customer_publishable: attraction.customer_publishable,
          renderBlockers: getCustomerAttractionRenderBlockers(attraction),
        }))),
      isolated,
      schedule: filteredSchedule,
    } : {}),
  };
  console.log(JSON.stringify(payload, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
