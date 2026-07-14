import type { PublicPackageSnapshot, PublishFinding } from './types';

type AnyRecord = Record<string, unknown>;

export type PublicSnapshotGenerationStatus = 'generated' | 'repairable' | 'blocked';

export type PublicSnapshotGenerationField =
  | 'title'
  | 'summary'
  | 'price'
  | 'itinerary'
  | 'terms'
  | 'optional_tours'
  | 'attractions'
  | 'images'
  | 'customer_copy';

export type PublicSnapshotGenerationDiagnostic = {
  field: PublicSnapshotGenerationField;
  status: PublicSnapshotGenerationStatus;
  evidence: string[];
  repair_actions: string[];
};

export type PublicSnapshotGenerationReport = {
  package_id: string;
  overall_status: PublicSnapshotGenerationStatus;
  diagnostics: PublicSnapshotGenerationDiagnostic[];
  repair_actions: string[];
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RISKY_OR_INTERNAL_COPY_RE =
  /\uC608\uC57D\s*\uC989\uC2DC|\uC989\uC2DC\s*\uD655\uC815|\uC88C\uC11D\s*\uD655\uBCF4|\uCD5C\uC800\uAC00\s*\uBCF4\uC7A5|100%\s*\uBCF4\uC7A5|Decision\s*guide|\uAD00\uB9AC\uC790|\uB79C\uB4DC\uC0AC\s*\uCEE4\uBBF8\uC158|internal|operator/i;
const PLACEHOLDER_RE =
  /\uC0AC\uC9C4\s*\uC900\uBE44\s*\uC911|\uC774\uBBF8\uC9C0\s*\uC900\uBE44\s*\uC911|placeholder/i;
const PRICE_RE =
  /\d{1,3}(?:,\d{3})+\s*(?:\uC6D0|\uC6D0\s*\/\s*\uC778)?|\d+\s*\uB9CC\s*\uC6D0/u;

const MIN_SOURCE_TEXT_FOR_FIELD_REPAIR = 120;
const PRICE_SOURCE_REPAIR_ACTION =
  'Regenerate price_dates and product_prices from source-backed departure date, adult selling price, and per-person basis.';
const PRICE_SOURCE_MISSING_ACTION =
  'Source text is missing a usable price table, product price, or departure-date basis. Do not use a scalar DB price as public evidence; re-upload supplier raw text with the price table.';
const ITINERARY_SOURCE_REPAIR_ACTION =
  'Re-split the source itinerary by DAY and exclude price table, inclusion, and exclusion fragments from itinerary rows.';
const ITINERARY_SOURCE_MISSING_ACTION =
  'Source text is missing a usable DAY itinerary section. Do not invent itinerary rows from title or summary; re-upload supplier raw text with the day-by-day itinerary.';
const ITINERARY_SOURCE_CUE_RE =
  /DAY\s*\d|Day\s*\d|D\s*\+?\s*\d|\uC77C\uCC28|\uC77C\uC815\uD45C|\uC5EC\uD589\s*\uC77C\uC815|\uACF5\uD56D|\uD638\uD154|\uAD00\uAD11|\uC774\uB3D9|\uC870\uC2DD|\uC911\uC2DD|\uC11D\uC2DD/u;

function asRecord(value: unknown): AnyRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as AnyRecord : null;
}

function text(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function hasArrayItems(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}

function sourceTextIsLongEnoughForFieldRepair(rawText: string): boolean {
  return rawText.length >= MIN_SOURCE_TEXT_FOR_FIELD_REPAIR;
}

function itinerarySourceLooksRepairable(rawText: string): boolean {
  return sourceTextIsLongEnoughForFieldRepair(rawText) && ITINERARY_SOURCE_CUE_RE.test(rawText);
}

function itineraryDays(value: unknown): unknown {
  if (Array.isArray(value)) return value;
  return asRecord(value)?.days;
}

function addDiagnostic(
  diagnostics: PublicSnapshotGenerationDiagnostic[],
  field: PublicSnapshotGenerationField,
  status: PublicSnapshotGenerationStatus,
  evidence: string[],
  repairActions: string[],
): void {
  diagnostics.push({
    field,
    status,
    evidence: evidence.filter(Boolean),
    repair_actions: repairActions.filter(Boolean),
  });
}

function blockersByField(blockers: PublishFinding[]): Map<string, PublishFinding[]> {
  const map = new Map<string, PublishFinding[]>();
  for (const blocker of blockers) {
    const key = blocker.fieldPath?.split('.')[0] ?? blocker.code;
    map.set(key, [...(map.get(key) ?? []), blocker]);
  }
  return map;
}

function collectAttractionIds(value: unknown): string[] {
  const output: string[] = [];
  const visit = (item: unknown): void => {
    if (Array.isArray(item)) {
      item.forEach(visit);
      return;
    }
    const record = asRecord(item);
    if (!record) return;
    if (Array.isArray(record.attraction_ids)) {
      output.push(...record.attraction_ids.map(id => String(id ?? '')));
    }
    Object.values(record).forEach(visit);
  };
  visit(value);
  return output;
}

function summarizeBlockers(blockers: PublishFinding[], codes: string[]): string[] {
  const codeSet = new Set(codes);
  return blockers
    .filter(blocker => codeSet.has(String(blocker.code)))
    .map(blocker => `${blocker.code}: ${blocker.message}`);
}

function customerCopyRepairActions(blockers: PublishFinding[], routeTextIsBad: boolean): string[] {
  const actions = new Set<string>();
  for (const blocker of blockers) {
    const fieldPath = String(blocker.fieldPath ?? '');
    if (blocker.code === 'masked_data_pollution' && fieldPath.includes('itinerary_data.highlights.remarks')) {
      actions.add('Move REMARK or operational notice text out of itinerary_public and quarantine it unless it maps to an approved customer notice template.');
      continue;
    }
    if (blocker.code === 'masked_data_pollution' && fieldPath.includes('itinerary_data.highlights.shopping')) {
      actions.add('Reclassify shopping or commission fragments as exclusions or operational notices only when source-backed; do not expose them as itinerary copy.');
      continue;
    }
    if (blocker.code === 'masked_data_pollution' && fieldPath.includes('itinerary_data.meta.title')) {
      actions.add('Regenerate itinerary meta title from public title policy and remove supplier/internal title fragments from customer copy.');
      continue;
    }
    if (blocker.code === 'masked_data_pollution' && fieldPath.includes('itinerary_data.days')) {
      actions.add('Rebuild itinerary day rows from the source itinerary section and quarantine price, inclusion, exclusion, or notice fragments.');
      continue;
    }
    if (blocker.code === 'masked_data_pollution' && /product_highlights|product_summary|hero_tagline|marketing_copies/.test(fieldPath)) {
      actions.add('Regenerate customer-facing marketing copy from approved templates and source-backed facts only.');
      continue;
    }
    if (blocker.code === 'masked_data_pollution' && fieldPath.includes('optional_tours')) {
      actions.add('Reclassify optional tour candidates by source section; quarantine fragments and expose only validated paid options in optional_tours_public.');
      continue;
    }
    if ([
      'risky_reservation_claim',
      'english_internal_copy',
      'placeholder_or_mojibake',
      'customer_forbidden_internal_terms',
      'internal_source_copy',
    ].includes(String(blocker.code))) {
      actions.add('Replace unsafe route text with approved customer templates and regenerate the route_text_dump before proof.');
    }
  }
  if (routeTextIsBad) {
    actions.add('Regenerate /packages, /lp, card, similar, and sticky CTA text from the approved public snapshot only.');
  }
  return [...actions];
}

function publicText(snapshot: PublicPackageSnapshot): string {
  return snapshot.route_text_dump.join('\n');
}

export function diagnosePublicSnapshotGeneration(input: {
  pkg: AnyRecord;
  snapshot: PublicPackageSnapshot;
  hardBlockers?: PublishFinding[];
}): PublicSnapshotGenerationReport {
  const { pkg, snapshot } = input;
  const hardBlockers = input.hardBlockers ?? [];
  const byField = blockersByField(hardBlockers);
  const diagnostics: PublicSnapshotGenerationDiagnostic[] = [];
  const rawText = text(pkg.raw_text);
  const routeText = publicText(snapshot);

  const titleBlockers = [
    ...(byField.get('public_title') ?? []),
    ...(byField.get('title') ?? []),
    ...hardBlockers.filter(blocker => blocker.code === 'unsupported_title_claim'
      && /^(?:public_title|title|_card_projection\.title|_lp_projection\.title)$/.test(String(blocker.fieldPath ?? ''))),
  ];
  addDiagnostic(
    diagnostics,
    'title',
    snapshot.public_title && titleBlockers.length === 0 ? 'generated' : 'repairable',
    [
      snapshot.public_title ? `generated_title=${snapshot.public_title}` : 'generated_title_missing',
      rawText ? 'raw_text_available' : 'raw_text_missing',
    ],
    titleBlockers.length > 0 || !snapshot.public_title
      ? ['Regenerate public_title from source-backed destinations, verified favorable conditions, core trip nature, and duration.']
      : [],
  );

  const summary = text(asRecord(snapshot.lp_projection)?.summary ?? snapshot.package.product_summary);
  const summaryBlockers = hardBlockers.filter(blocker => blocker.code === 'unsupported_title_claim'
    && /summary|product_summary|hero_tagline/.test(String(blocker.fieldPath ?? '')));
  addDiagnostic(
    diagnostics,
    'summary',
    summary && summaryBlockers.length === 0 && !RISKY_OR_INTERNAL_COPY_RE.test(summary) && !PLACEHOLDER_RE.test(summary) ? 'generated' : 'repairable',
    [summary ? `summary=${summary.slice(0, 120)}` : 'summary_missing'],
    summary && summaryBlockers.length === 0 && !RISKY_OR_INTERNAL_COPY_RE.test(summary) && !PLACEHOLDER_RE.test(summary)
      ? []
      : ['Regenerate the summary from approved customer copy templates and source-backed package facts only.'],
  );

  const priceBlockers = byField.get('price_dates') ?? [];
  const snapshotPackage = asRecord(snapshot.package);
  const snapshotPriceDates = snapshotPackage?.price_dates ?? pkg.price_dates;
  const rawPricePatternPresent = PRICE_RE.test(rawText);
  const priceSourceRepairable = rawPricePatternPresent && sourceTextIsLongEnoughForFieldRepair(rawText);
  const priceGenerated = Boolean(snapshot.price_display && priceBlockers.length === 0);
  const priceRepairActions = priceGenerated
    ? []
    : priceSourceRepairable
      ? [PRICE_SOURCE_REPAIR_ACTION]
      : [PRICE_SOURCE_MISSING_ACTION];
  addDiagnostic(
    diagnostics,
    'price',
    priceGenerated ? 'generated' : (priceSourceRepairable ? 'repairable' : 'blocked'),
    [
      snapshot.price_display ? `price_display=${snapshot.price_display}` : 'price_display_missing',
      hasArrayItems(snapshotPriceDates) ? 'price_dates_present' : 'price_dates_missing',
      rawPricePatternPresent ? 'raw_price_pattern_present' : 'raw_price_pattern_missing',
      sourceTextIsLongEnoughForFieldRepair(rawText) ? 'raw_text_sufficient_for_price_repair' : 'raw_text_insufficient_for_price_repair',
    ],
    priceRepairActions,
  );

  const publicItineraryDays = itineraryDays(snapshot.itinerary_public);
  const itineraryRepairable = itinerarySourceLooksRepairable(rawText);
  const itineraryGenerated = hasArrayItems(publicItineraryDays);
  const itineraryRepairActions = itineraryGenerated
    ? []
    : itineraryRepairable
      ? [ITINERARY_SOURCE_REPAIR_ACTION]
      : [ITINERARY_SOURCE_MISSING_ACTION];
  addDiagnostic(
    diagnostics,
    'itinerary',
    itineraryGenerated ? 'generated' : (itineraryRepairable ? 'repairable' : 'blocked'),
    [
      itineraryGenerated ? `days=${(publicItineraryDays as unknown[]).length}` : 'itinerary_days_missing',
      itineraryRepairable ? 'raw_itinerary_source_repairable' : 'raw_itinerary_source_insufficient',
    ],
    itineraryRepairActions,
  );

  addDiagnostic(
    diagnostics,
    'terms',
    hasArrayItems(snapshot.inclusions_public) || hasArrayItems(snapshot.exclusions_public) ? 'generated' : (rawText ? 'repairable' : 'blocked'),
    [
      `inclusions=${snapshot.inclusions_public.length}`,
      `exclusions=${snapshot.exclusions_public.length}`,
    ],
    hasArrayItems(snapshot.inclusions_public) || hasArrayItems(snapshot.exclusions_public)
      ? []
      : ['Regenerate inclusions and exclusions from their source sections; quarantine headers, price fragments, and unrelated table rows.'],
  );

  addDiagnostic(
    diagnostics,
    'optional_tours',
    snapshot.option_policy.status === 'polluted' ? 'repairable' : 'generated',
    [
      `optional_tour_status=${snapshot.option_policy.status}`,
      `optional_tours_public=${snapshot.optional_tours_public.length}`,
      snapshot.option_policy.badges.length > 0 ? `badges=${snapshot.option_policy.badges.join(',')}` : '',
    ],
    snapshot.option_policy.status === 'polluted'
      ? ['Reclassify optional tour candidates by source section and rebuild optional_tours_public from validated paid options only.']
      : [],
  );

  const attractionIds = collectAttractionIds(snapshot.itinerary_public);
  const invalidAttractionIds = attractionIds.filter(id => !UUID_RE.test(id));
  addDiagnostic(
    diagnostics,
    'attractions',
    invalidAttractionIds.length > 0 ? 'repairable' : 'generated',
    [
      `attraction_ids=${attractionIds.length}`,
      invalidAttractionIds.length > 0 ? `invalid=${invalidAttractionIds.slice(0, 5).join(',')}` : '',
    ],
    invalidAttractionIds.length > 0
      ? ['Quarantine invalid attraction IDs and rematch only to existing attractions with a valid UUID and sufficient confidence.']
      : [],
  );

  addDiagnostic(
    diagnostics,
    'images',
    hasArrayItems(snapshot.images_public) ? 'generated' : 'repairable',
    [hasArrayItems(snapshot.images_public) ? `images=${snapshot.images_public.length}` : 'images_missing'],
    hasArrayItems(snapshot.images_public)
      ? []
      : ['Select source-backed product, attraction, or destination images; use only safe generic fallbacks that do not imply unavailable experiences.'],
  );

  const copyBlockers = summarizeBlockers(hardBlockers, [
    'masked_data_pollution',
    'risky_reservation_claim',
    'english_internal_copy',
    'placeholder_or_mojibake',
    'customer_forbidden_internal_terms',
    'internal_source_copy',
  ]);
  const badCopy = RISKY_OR_INTERNAL_COPY_RE.test(routeText) || PLACEHOLDER_RE.test(routeText);
  addDiagnostic(
    diagnostics,
    'customer_copy',
    badCopy || copyBlockers.length > 0 ? 'blocked' : 'generated',
    copyBlockers.length > 0 ? copyBlockers : ['customer_visible_text_lint_passed'],
    badCopy || copyBlockers.length > 0 ? customerCopyRepairActions(hardBlockers, badCopy) : [],
  );

  const priority: Record<PublicSnapshotGenerationStatus, number> = {
    generated: 0,
    repairable: 1,
    blocked: 2,
  };
  const overall_status = diagnostics.reduce<PublicSnapshotGenerationStatus>(
    (status, diagnostic) => priority[diagnostic.status] > priority[status] ? diagnostic.status : status,
    'generated',
  );
  const repair_actions = [...new Set(diagnostics.flatMap(item => item.repair_actions))];

  return {
    package_id: snapshot.package_id,
    overall_status,
    diagnostics,
    repair_actions,
  };
}
