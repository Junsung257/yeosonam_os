export interface CustomerNoticeCard {
  type: string;
  title: string;
  text: string;
}

const NON_CUSTOMER_NOTICE_TYPES = new Set([
  'ADMIN',
  'INTERNAL',
  'OPERATOR',
  'SUPPLIER_RAW',
]);

/**
 * Reads the already customer-sanitized `notices_parsed` payload into one
 * stable shape shared by `/packages` and `/lp`.
 */
export function extractCustomerNoticeCards(value: unknown): CustomerNoticeCard[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const cards: CustomerNoticeCard[] = [];

  for (const item of value) {
    const record = typeof item === 'object' && item !== null
      ? item as Record<string, unknown>
      : null;
    const type = String(record?.type ?? 'INFO').trim().toUpperCase();
    const title = String(record?.title ?? '예약 전 안내').trim();
    const text = typeof item === 'string'
      ? item.trim()
      : String(record?.text ?? '').trim();

    if (!text || NON_CUSTOMER_NOTICE_TYPES.has(type)) continue;
    const key = `${title}\u0000${text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    cards.push({ type, title, text });
  }

  return cards;
}
