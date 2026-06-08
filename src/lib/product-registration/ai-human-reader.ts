import { createHash } from 'node:crypto';
import { extractPriceIR } from '@/lib/parser/deterministic/price-ir';
import type { MatrixPriceRow, PriceTier } from '@/lib/parser/deterministic/price-ir/types';
import {
  buildSupplierRawDeterministicItinerary,
} from '@/lib/supplier-raw-deterministic-facts';
import {
  compileScheduleItemForLanding,
  type ScheduleEntityKind,
} from '@/lib/itinerary-schedule-compiler';
import type { SourceEvidenceSpan } from './types';

export type HumanReaderSource = 'deterministic_evidence_reader' | 'ai_schema_reader';

export type HumanReaderPricePair = {
  date: string;
  adult_price: number;
  child_price: number | null;
  note: string | null;
  status: string | null;
  evidence: SourceEvidenceSpan;
};

export type HumanReaderItineraryEvent = {
  day_number: number | null;
  raw_text: string;
  entity_kind: ScheduleEntityKind;
  attraction_queries: string[];
  landing_sentence: string | null;
  a4_sentence: string | null;
  evidence: SourceEvidenceSpan;
};

export type HumanReaderEntityMention = {
  category: ScheduleEntityKind;
  raw_text: string;
  canonical_query: string | null;
  customer_visible: boolean;
  evidence: SourceEvidenceSpan;
};

export type HumanReaderResult = {
  source: HumanReaderSource;
  rawTextHash: string;
  priceSource: string;
  priceTiers: PriceTier[];
  pricePairs: HumanReaderPricePair[];
  itineraryEvents: HumanReaderItineraryEvent[];
  entityMentions: HumanReaderEntityMention[];
  uncertainties: string[];
  evidenceSpans: SourceEvidenceSpan[];
};

export type HumanReaderInput = {
  rawText: string;
  title?: string | null;
  accommodations?: string[] | null;
  durationDays?: number | null;
  departureDays?: string | string[] | null;
  year?: number;
};

function hashRawText(rawText: string): string {
  return createHash('sha256').update(rawText).digest('hex');
}

function lineStarts(rawText: string): number[] {
  const starts = [0];
  for (let i = 0; i < rawText.length; i++) {
    if (rawText[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

function lineIndexForOffset(starts: number[], offset: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (starts[mid] <= offset) low = mid + 1;
    else high = mid - 1;
  }
  return Math.max(0, high);
}

function makeEvidence(input: {
  rawText: string;
  rawTextHash: string;
  field: string;
  quote: string;
  sourceKind?: SourceEvidenceSpan['sourceKind'];
  confidence?: number;
}): SourceEvidenceSpan {
  const starts = lineStarts(input.rawText);
  const cleanQuote = input.quote.replace(/\s+/g, ' ').trim().slice(0, 240);
  let start = cleanQuote ? input.rawText.indexOf(cleanQuote) : -1;
  if (start < 0 && cleanQuote) {
    const firstToken = cleanQuote.split(/\s+/)[0];
    start = firstToken ? input.rawText.indexOf(firstToken) : -1;
  }
  const safeStart = Math.max(0, start);
  const safeEnd = start >= 0 ? Math.min(input.rawText.length, start + cleanQuote.length) : safeStart;
  return {
    field: input.field,
    rawTextHash: input.rawTextHash,
    start: safeStart,
    end: safeEnd,
    quote: cleanQuote,
    productIndex: null,
    sourceKind: input.sourceKind ?? 'line',
    sectionKey: null,
    lineIndex: start >= 0 ? lineIndexForOffset(starts, start) : null,
    rowIndex: null,
    columnIndex: null,
    confidence: input.confidence ?? (start >= 0 ? 0.84 : 0.62),
  };
}

function priceEvidenceQuote(rawText: string, row: MatrixPriceRow): string {
  const price = row.adult_price.toLocaleString('en-US');
  const compactPrice = String(Math.round(row.adult_price / 1000));
  const dateParts = row.date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const dateHints = dateParts
    ? [
      `${Number(dateParts[2])}/${Number(dateParts[3])}`,
      `${Number(dateParts[2])}.${Number(dateParts[3])}`,
      `${Number(dateParts[2])}월 ${Number(dateParts[3])}`,
    ]
    : [];

  const lines = rawText.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const candidates = lines.filter(line => {
    const hasDate = dateHints.some(hint => line.includes(hint));
    const hasPrice = line.includes(price) || line.includes(compactPrice);
    const hasNote = row.note ? line.includes(row.note) : false;
    return hasDate || hasPrice || hasNote;
  });

  return candidates.slice(0, 3).join(' / ') || `${row.date} ${price}`;
}

function eventEvidenceQuote(rawText: string, value: string): string {
  const line = rawText.split(/\r?\n/).find(item => item.includes(value));
  return line?.trim() || value;
}

function buildPricePairs(input: HumanReaderInput, rawTextHash: string): {
  priceSource: string;
  tiers: PriceTier[];
  pairs: HumanReaderPricePair[];
  spans: SourceEvidenceSpan[];
} {
  const ir = extractPriceIR(input.rawText, {
    year: input.year,
    title: input.title,
    accommodations: input.accommodations ?? [],
    durationDays: input.durationDays,
    departureDays: input.departureDays,
  });
  const pairs: HumanReaderPricePair[] = [];
  const spans: SourceEvidenceSpan[] = [];
  const seen = new Set<string>();

  for (const row of ir.rows) {
    if (!row.date || !row.adult_price || row.adult_price <= 0) continue;
    const key = `${row.date}|${row.adult_price}|${row.note ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const evidence = makeEvidence({
      rawText: input.rawText,
      rawTextHash,
      field: 'human_reader.price_pair',
      quote: priceEvidenceQuote(input.rawText, row),
      sourceKind: 'table_cell',
      confidence: 0.88,
    });
    spans.push(evidence);
    pairs.push({
      date: row.date,
      adult_price: row.adult_price,
      child_price: row.child_price ?? null,
      note: row.note ?? null,
      status: row.status ?? null,
      evidence,
    });
  }

  return {
    priceSource: ir.source,
    tiers: ir.tiers,
    pairs,
    spans,
  };
}

function buildItineraryEvents(rawText: string, rawTextHash: string): {
  events: HumanReaderItineraryEvent[];
  mentions: HumanReaderEntityMention[];
  spans: SourceEvidenceSpan[];
} {
  const itinerary = buildSupplierRawDeterministicItinerary(rawText);
  const events: HumanReaderItineraryEvent[] = [];
  const mentions: HumanReaderEntityMention[] = [];
  const spans: SourceEvidenceSpan[] = [];

  for (const day of itinerary?.days ?? []) {
    for (const item of day.schedule ?? []) {
      if (!item.activity) continue;
      const compiled = compileScheduleItemForLanding(
        item as unknown as Parameters<typeof compileScheduleItemForLanding>[0],
      );
      const entityKind = compiled.entity_kind ?? 'unknown';
      const evidence = makeEvidence({
        rawText,
        rawTextHash,
        field: 'human_reader.itinerary_event',
        quote: eventEvidenceQuote(rawText, compiled.activity),
        confidence: entityKind === 'unknown' ? 0.62 : 0.82,
      });
      spans.push(evidence);
      const attractionQueries = compiled.attraction_queries ?? (compiled.attraction_query ? [compiled.attraction_query] : []);
      events.push({
        day_number: day.day ?? null,
        raw_text: compiled.activity,
        entity_kind: entityKind,
        attraction_queries: attractionQueries,
        landing_sentence: compiled.landing_sentence ?? null,
        a4_sentence: compiled.a4_sentence ?? null,
        evidence,
      });
      mentions.push({
        category: entityKind,
        raw_text: compiled.activity,
        canonical_query: attractionQueries[0] ?? null,
        customer_visible: entityKind !== 'unknown',
        evidence,
      });
    }
  }

  return { events, mentions, spans };
}

export function readSupplierDocumentLikeHuman(input: HumanReaderInput): HumanReaderResult {
  const rawTextHash = hashRawText(input.rawText);
  const price = buildPricePairs(input, rawTextHash);
  const itinerary = buildItineraryEvents(input.rawText, rawTextHash);
  const uncertainties: string[] = [];

  if (price.pairs.length === 0) {
    uncertainties.push('no source-backed product price/date pairs recognized by evidence reader');
  }
  if (itinerary.events.length === 0) {
    uncertainties.push('no source-backed itinerary events recognized by evidence reader');
  }

  return {
    source: 'deterministic_evidence_reader',
    rawTextHash,
    priceSource: price.priceSource,
    priceTiers: price.tiers,
    pricePairs: price.pairs,
    itineraryEvents: itinerary.events,
    entityMentions: itinerary.mentions,
    uncertainties,
    evidenceSpans: [...price.spans, ...itinerary.spans],
  };
}
