export type RecentInfoDuplicateScope = {
  destination: string;
  angleType: string;
  microAngle: string | null;
};

export function buildRecentInfoDuplicateScope(item: {
  product_id?: string | null;
  destination?: string | null;
  angle_type?: string | null;
  meta?: { micro_angle?: unknown } | null;
}): RecentInfoDuplicateScope | null {
  if (item.product_id) return null;
  const destination = typeof item.destination === 'string' ? item.destination.trim() : '';
  if (!destination) return null;
  const angleType = typeof item.angle_type === 'string' && item.angle_type.trim()
    ? item.angle_type.trim()
    : 'value';
  const rawMicroAngle = item.meta?.micro_angle;
  const microAngle = typeof rawMicroAngle === 'string' && rawMicroAngle.trim()
    ? rawMicroAngle.trim()
    : null;

  return { destination, angleType, microAngle };
}
