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
  /예약\s*즉시|즉시\s*확정|좌석\s*확보|최저가\s*보장|100%\s*보장|Decision\s*guide|관리자노트|랜드사|커미션|internal|operator/i;
const PLACEHOLDER_RE = /사진\s*준비\s*중|이미지\s*준비\s*중|�/;
const PRICE_RE = /\d{1,3}(?:,\d{3})+\s*원|\d+\s*만\s*원/;

function asRecord(value: unknown): AnyRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as AnyRecord : null;
}

function text(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function hasArrayItems(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
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
      ? ['목적지, 기간, 노팁/노옵션, 핵심 여행 성격을 원문 근거에서 다시 추출해 public_title을 재생성하세요.']
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
      : ['원문 제목 복사가 아니라 가격/기간/항공/조건 근거에서 고객용 한두 문장 설명을 다시 생성하세요.'],
  );

  const priceBlockers = byField.get('price_dates') ?? [];
  addDiagnostic(
    diagnostics,
    'price',
    snapshot.price_display && priceBlockers.length === 0 ? 'generated' : (PRICE_RE.test(rawText) ? 'repairable' : 'blocked'),
    [
      snapshot.price_display ? `price_display=${snapshot.price_display}` : 'price_display_missing',
      hasArrayItems(pkg.price_dates) ? 'price_dates_present' : 'price_dates_missing',
      PRICE_RE.test(rawText) ? 'raw_price_pattern_present' : 'raw_price_pattern_missing',
    ],
    snapshot.price_display && priceBlockers.length === 0
      ? []
      : ['원문 가격표에서 출발일, 성인 판매가, 1인 기준을 구조화해 price_dates와 product_prices를 다시 생성하세요.'],
  );

  const itineraryDays = asRecord(snapshot.itinerary_public)?.days;
  addDiagnostic(
    diagnostics,
    'itinerary',
    hasArrayItems(itineraryDays) ? 'generated' : (rawText ? 'repairable' : 'blocked'),
    [hasArrayItems(itineraryDays) ? `days=${(itineraryDays as unknown[]).length}` : 'itinerary_days_missing'],
    hasArrayItems(itineraryDays)
      ? []
      : ['원문 일정 섹션을 DAY 단위로 다시 분리하고 가격표/포함내역 조각을 일정에서 제외하세요.'],
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
      : ['원문 포함/불포함 섹션을 재해석해 고객용 포함·불포함 항목만 다시 생성하세요.'],
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
      ? ['선택관광 원문 섹션만 다시 파싱하고 노옵션/가격표/포함내역 조각은 optional_tours_public에서 제외하세요.']
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
      ? ['깨진 attraction_id를 quarantine하고 원문 관광지명을 기존 attractions DB에 다시 매칭하세요. confidence가 낮으면 공개 이미지/설명에 쓰지 마세요.']
      : [],
  );

  addDiagnostic(
    diagnostics,
    'images',
    hasArrayItems(snapshot.images_public) ? 'generated' : 'repairable',
    [hasArrayItems(snapshot.images_public) ? `images=${snapshot.images_public.length}` : 'images_missing'],
    hasArrayItems(snapshot.images_public)
      ? []
      : ['상품 대표 관광지 또는 목적지 metadata의 승인된 이미지를 연결하세요. 상품에 없는 온천/호텔/시설 이미지는 fallback으로 쓰지 마세요.'],
  );

  const copyBlockers = summarizeBlockers(hardBlockers, [
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
    badCopy || copyBlockers.length > 0
      ? ['CTA와 고객 문구를 승인된 템플릿으로 교체하고 내부/영어/보장/확정/placeholder 문구를 제거한 뒤 route_text_dump를 다시 생성하세요.']
      : [],
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
