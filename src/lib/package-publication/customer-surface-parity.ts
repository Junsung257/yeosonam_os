type AnyRecord = Record<string, unknown>;

export type CustomerSurfaceParityCode =
  | 'customer_surface_id_mismatch'
  | 'customer_surface_title_mismatch'
  | 'customer_surface_destination_mismatch'
  | 'customer_surface_price_mismatch'
  | 'customer_surface_image_mismatch'
  | 'customer_surface_duration_mismatch';

export type CustomerSurfaceParityFinding = {
  code: CustomerSurfaceParityCode;
  message: string;
  fieldPath: string;
};

export type CustomerSurfaceParityResult = {
  ok: boolean;
  findings: CustomerSurfaceParityFinding[];
};

function asRecord(value: unknown): AnyRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as AnyRecord : null;
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.normalize('NFKC').replace(/\s+/g, ' ').trim();
  return normalized || null;
}

function number(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function firstImage(projection: AnyRecord | null): string | null {
  return text(projection?.hero_image_url ?? projection?.lp_hero_image_url);
}

function addIfMismatch(
  findings: CustomerSurfaceParityFinding[],
  code: CustomerSurfaceParityCode,
  fieldPath: string,
  label: string,
  left: unknown,
  right: unknown,
): void {
  if (left === null || right === null || left === right) return;
  findings.push({
    code,
    fieldPath,
    message: `${label} differs between the customer card and landing page (${String(left)} vs ${String(right)})`,
  });
}

/**
 * Compares only the customer identity contract shared by /packages and /lp.
 * Surface-specific copy (card badges, LP summary, CTA helper) is intentionally
 * excluded; those fields may be adapted for the layout while the product
 * identity must remain immutable and source-backed.
 */
export function evaluateCustomerSurfaceParity(input: {
  package?: AnyRecord | null;
  cardProjection?: AnyRecord | null;
  lpProjection?: AnyRecord | null;
}): CustomerSurfaceParityResult {
  const pkg = input.package ?? {};
  const card = input.cardProjection ?? null;
  const lp = input.lpProjection ?? null;
  const findings: CustomerSurfaceParityFinding[] = [];

  const packageId = text(pkg.id);
  addIfMismatch(findings, 'customer_surface_id_mismatch', 'id', 'package id', packageId, text(card?.id));
  addIfMismatch(findings, 'customer_surface_id_mismatch', 'id', 'package id', packageId, text(lp?.id));

  const cardTitle = text(card?.title);
  const lpTitle = text(lp?.title);
  addIfMismatch(findings, 'customer_surface_title_mismatch', 'card.title↔lp.title', 'title', cardTitle, lpTitle);

  addIfMismatch(findings, 'customer_surface_destination_mismatch', 'card.destination↔lp.destination', 'destination', text(card?.destination), text(lp?.destination));

  addIfMismatch(findings, 'customer_surface_price_mismatch', 'card.price↔lp.price', 'price', number(card?.price), number(lp?.price));

  addIfMismatch(findings, 'customer_surface_duration_mismatch', 'card.duration↔lp.duration', 'duration', number(card?.duration), number(lp?.duration));

  const cardImage = firstImage(card);
  const lpImage = firstImage(lp);
  addIfMismatch(findings, 'customer_surface_image_mismatch', 'hero_image_url', 'hero image', cardImage, lpImage);

  return { ok: findings.length === 0, findings };
}
