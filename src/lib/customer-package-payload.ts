import type { CustomerProductPriceRow } from './customer-package-price-options';

const INTERNAL_PACKAGE_KEYS = new Set([
  'raw_text',
  'raw_text_hash',
  'raw_extracted_text',
  'internal_notes',
  'special_notes',
  'land_operator_id',
  'audit_status',
  'audit_report',
  'audit_checked_at',
  'agent_audit_report',
  'parser_version',
  'parsed_data',
  'parsed_at',
  'embedding',
  'tenant_id',
  'created_by',
  'baseline_created_at',
  'baseline_requested_at',
  'filename',
  'file_type',
  'notes',
  'net_price',
  'cost_price',
  'usd_cost',
  'margin_rate',
  'selling_price',
  'departing_location_id',
  'catalog_id',
  'commission_rate',
  'affiliate_commission_rate',
  'commission_fixed_amount',
  'commission_currency',
  'data_completeness',
  'field_confidences',
  'price_markup_rate',
  'hard_block_quota',
  'dp_reason',
  'dp_triggered_at',
  'view_count_snap_at',
  'view_count_weekly_snap',
  'review_reject_category',
  'review_reject_subnote',
  'seats_held',
  'seats_confirmed',
  'seats_ticketed',
  'is_stub',
  'stub_source',
]);

type AnyRecord = Record<string, unknown>;

function sanitizeProductPrices(value: unknown): CustomerProductPriceRow[] {
  if (!Array.isArray(value)) return [];
  return value.map((row) => {
    const record = row && typeof row === 'object' ? row as AnyRecord : {};
    return {
      target_date: typeof record.target_date === 'string' ? record.target_date : null,
      adult_selling_price: typeof record.adult_selling_price === 'number' ? record.adult_selling_price : null,
      note: typeof record.note === 'string' ? record.note : null,
    };
  });
}

function sanitizeNestedProductRecord(value: AnyRecord): AnyRecord {
  const product = { ...value };
  delete product.net_price;
  delete product.cost_price;
  delete product.margin_rate;
  delete product.selling_price;
  return product;
}

function sanitizeNestedProduct(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => (
      item && typeof item === 'object' && !Array.isArray(item)
        ? sanitizeNestedProductRecord(item as AnyRecord)
        : item
    ));
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  return sanitizeNestedProductRecord(value as AnyRecord);
}

export function sanitizeCustomerPackageForClient<T extends AnyRecord>(pkg: T | null | undefined): AnyRecord | null {
  if (!pkg) return null;

  const publicPackage: AnyRecord = {};
  for (const [key, value] of Object.entries(pkg)) {
    if (INTERNAL_PACKAGE_KEYS.has(key)) continue;
    if (key === 'product_prices') {
      publicPackage.product_prices = sanitizeProductPrices(value);
      continue;
    }
    if (key === 'products') {
      publicPackage.products = sanitizeNestedProduct(value);
      continue;
    }
    publicPackage[key] = value;
  }

  return publicPackage;
}
