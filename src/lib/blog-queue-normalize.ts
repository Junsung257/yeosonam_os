import type { AngleType } from './content-generator';

const VALID_CONTENT_ANGLES: readonly AngleType[] = [
  'value',
  'emotional',
  'filial',
  'luxury',
  'urgency',
  'activity',
  'food',
];

const ANGLE_ALIASES: Record<string, AngleType> = {
  budget: 'value',
  cost: 'value',
  deal: 'value',
  differentiator: 'value',
  price: 'value',
  price_objection: 'value',
  programmatic: 'value',
  safety: 'value',
  seasonal: 'value',
  trend: 'value',
  visa: 'value',
  weather: 'value',
  preparation: 'value',
  checklist: 'value',
  currency: 'value',
  transport: 'value',
  itinerary: 'activity',
  tour: 'activity',
  experience: 'activity',
  restaurant: 'food',
  gourmet: 'food',
  family: 'filial',
  parents: 'filial',
  honeymoon: 'emotional',
  deadline: 'urgency',
  last_minute: 'urgency',
  premium: 'luxury',
};

export function normalizeBlogAngleType(value: unknown): AngleType {
  if (typeof value !== 'string') return 'value';
  const key = value.trim().toLowerCase();
  if ((VALID_CONTENT_ANGLES as readonly string[]).includes(key)) return key as AngleType;
  return ANGLE_ALIASES[key] ?? 'value';
}

export function normalizeBlogTopicQueueRow<T extends Record<string, unknown>>(
  row: T,
): T & { angle_type: AngleType; meta: Record<string, unknown> } {
  const meta = row.meta && typeof row.meta === 'object' && !Array.isArray(row.meta)
    ? { ...(row.meta as Record<string, unknown>) }
    : {};

  const rawAngle = row.angle_type;
  const normalizedAngle = normalizeBlogAngleType(rawAngle);
  if (typeof rawAngle === 'string' && rawAngle.trim() && rawAngle.trim().toLowerCase() !== normalizedAngle) {
    meta.raw_angle_type = rawAngle;
  }

  if ('search_intent' in row && row.search_intent != null) {
    meta.search_intent = row.search_intent;
  }

  const normalized = { ...row } as Record<string, unknown>;
  delete normalized.search_intent;
  normalized.angle_type = normalizedAngle;
  normalized.meta = meta;

  return normalized as T & { angle_type: AngleType; meta: Record<string, unknown> };
}
