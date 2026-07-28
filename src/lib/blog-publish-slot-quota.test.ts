import { describe, expect, it } from 'vitest';
import { calculateBlogPublishSlotQuota } from './blog-publish-slot-quota';

describe('calculateBlogPublishSlotQuota', () => {
  it('opens exactly one additional publication at each KST slot', () => {
    const slots = ['09:00', '12:00', '15:00', '18:00', '21:00'];

    expect(calculateBlogPublishSlotQuota({
      now: new Date('2026-07-28T00:07:00.000Z'),
      dailyTarget: 5,
      alreadyPublished: 0,
      slotTimes: slots,
    })).toMatchObject({
      scheduledTargetNow: 1,
      remainingDueNow: 1,
      remainingDaily: 5,
      nextSlot: '12:00',
    });

    expect(calculateBlogPublishSlotQuota({
      now: new Date('2026-07-28T03:07:00.000Z'),
      dailyTarget: 5,
      alreadyPublished: 1,
      slotTimes: slots,
    })).toMatchObject({
      scheduledTargetNow: 2,
      remainingDueNow: 1,
      remainingDaily: 4,
      nextSlot: '15:00',
    });
  });

  it('does not flood the daily quota before the first slot', () => {
    expect(calculateBlogPublishSlotQuota({
      now: new Date('2026-07-27T23:59:00.000Z'),
      dailyTarget: 5,
      alreadyPublished: 0,
      slotTimes: ['09:00', '12:00', '15:00', '18:00', '21:00'],
    })).toMatchObject({
      scheduledTargetNow: 0,
      remainingDueNow: 0,
      remainingDaily: 5,
      nextSlot: '09:00',
    });
  });

  it('allows final-slot catch-up while keeping the five-post daily cap', () => {
    expect(calculateBlogPublishSlotQuota({
      now: new Date('2026-07-28T13:07:00.000Z'),
      dailyTarget: 5,
      alreadyPublished: 2,
      slotTimes: ['09:00', '12:00', '15:00', '18:00', '21:00'],
    })).toMatchObject({
      scheduledTargetNow: 5,
      remainingDueNow: 3,
      remainingDaily: 3,
      nextSlot: null,
    });
  });

  it('falls back to the reviewed five-slot contract when policy slots are malformed', () => {
    const quota = calculateBlogPublishSlotQuota({
      now: new Date('2026-07-28T06:01:00.000Z'),
      dailyTarget: 5,
      alreadyPublished: 2,
      slotTimes: ['bad'],
    });

    expect(quota.slotTimes).toEqual(['09:00', '12:00', '15:00', '18:00', '21:00']);
    expect(quota.remainingDueNow).toBe(1);
  });
});
