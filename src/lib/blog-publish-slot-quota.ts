const KST_OFFSET_MINUTES = 9 * 60;

export const DEFAULT_BLOG_PUBLISH_SLOT_TIMES = [
  '09:00',
  '12:00',
  '15:00',
  '18:00',
  '21:00',
] as const;

export type BlogPublishSlotQuota = {
  dailyTarget: number;
  scheduledTargetNow: number;
  alreadyPublished: number;
  remainingDueNow: number;
  remainingDaily: number;
  nextSlot: string | null;
  slotTimes: string[];
};

function parseSlotMinutes(value: string): number | null {
  const match = value.trim().match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour > 23 || minute > 59) {
    return null;
  }
  return hour * 60 + minute;
}

function normalizedSlotTimes(slotTimes: string[], dailyTarget: number): Array<{
  label: string;
  minutes: number;
}> {
  const fallback = [...DEFAULT_BLOG_PUBLISH_SLOT_TIMES];
  void dailyTarget;
  const source = slotTimes.length > 0 ? slotTimes : fallback;
  const unique = new Map<number, string>();
  for (const value of source) {
    const minutes = parseSlotMinutes(value);
    if (minutes === null || unique.has(minutes)) continue;
    unique.set(minutes, value.trim());
  }
  const normalized = [...unique.entries()]
    .map(([minutes, label]) => ({ label, minutes }))
    .sort((a, b) => a.minutes - b.minutes);
  if (normalized.length > 0) return normalized;
  return fallback
    .map((label) => ({ label, minutes: parseSlotMinutes(label)! }));
}

export function calculateBlogPublishSlotQuota(input: {
  now?: Date;
  dailyTarget: number;
  alreadyPublished: number;
  slotTimes?: string[] | null;
}): BlogPublishSlotQuota {
  const now = input.now ?? new Date();
  const dailyTarget = Math.max(1, Math.trunc(input.dailyTarget));
  const alreadyPublished = Math.max(0, Math.trunc(input.alreadyPublished));
  const slots = normalizedSlotTimes(input.slotTimes ?? [], dailyTarget);
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const kstMinutes = (utcMinutes + KST_OFFSET_MINUTES) % (24 * 60);
  const elapsedSlotCount = slots.filter((slot) => slot.minutes <= kstMinutes).length;
  const scheduledTargetNow = elapsedSlotCount === 0
    ? 0
    : Math.min(
        dailyTarget,
        dailyTarget <= slots.length
          ? Math.floor(((elapsedSlotCount - 1) * dailyTarget) / slots.length) + 1
          : Math.ceil((elapsedSlotCount * dailyTarget) / slots.length),
      );

  return {
    dailyTarget,
    scheduledTargetNow,
    alreadyPublished,
    remainingDueNow: Math.max(0, scheduledTargetNow - alreadyPublished),
    remainingDaily: Math.max(0, dailyTarget - alreadyPublished),
    nextSlot: slots.find((slot) => slot.minutes > kstMinutes)?.label ?? null,
    slotTimes: slots.map((slot) => slot.label),
  };
}
