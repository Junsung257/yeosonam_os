type AnyRecord = Record<string, unknown>;

const INTERNAL_ITEM_KEYS = new Set([
  'cost',
  'cost_price',
  'net_price',
  'margin',
  'margin_rate',
  'selling_price',
]);

const INTERNAL_ATTR_KEYS = new Set([
  'cost',
  'cost_price',
  'net_price',
  'margin',
  'margin_rate',
  'selling_price',
]);

function sanitizeAttrs(attrs: unknown): AnyRecord | undefined {
  if (!attrs || typeof attrs !== 'object' || Array.isArray(attrs)) return undefined;

  const safeAttrs: AnyRecord = {};
  for (const [key, value] of Object.entries(attrs as AnyRecord)) {
    if (INTERNAL_ATTR_KEYS.has(key)) continue;
    safeAttrs[key] = value;
  }
  return Object.keys(safeAttrs).length > 0 ? safeAttrs : undefined;
}

export function sanitizeConciergeItemForPublic<T extends AnyRecord>(item: T): AnyRecord {
  const safe: AnyRecord = {};
  for (const [key, value] of Object.entries(item)) {
    if (INTERNAL_ITEM_KEYS.has(key)) continue;
    if (key === 'attrs') {
      const attrs = sanitizeAttrs(value);
      if (attrs) safe.attrs = attrs;
      continue;
    }
    safe[key] = value;
  }
  return safe;
}

export function sanitizeConciergeItemsForPublic(items: unknown): AnyRecord[] {
  if (!Array.isArray(items)) return [];
  return items
    .filter((item): item is AnyRecord => Boolean(item && typeof item === 'object' && !Array.isArray(item)))
    .map((item) => sanitizeConciergeItemForPublic(item));
}
