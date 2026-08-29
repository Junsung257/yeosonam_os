import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { prioritizeQueuedInformationResearch } from './blog-queue-research';

describe('blog queue research source contract', () => {
  it('also researches editor-approved seeds that already carry a requested publish time', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/blog-queue-research.ts'),
      'utf8',
    );
    const candidateQuery = source.slice(
      source.indexOf("from('blog_topic_queue')"),
      source.indexOf('if (error) throw new Error(`blog_queue_research_load:'),
    );

    expect(candidateQuery).toContain(".eq('status', 'queued')");
    expect(candidateQuery).toContain(".or('target_publish_at.is.null,source.eq.user_seed')");
  });

  it('tries one candidate per research intent before repeating weather', () => {
    const rows = [
      {
        id: 'weather-1',
        topic: '괌 월별 날씨',
        destination: '괌',
        category: 'preparation',
        meta: { micro_angle: 'weather_packing', expected_slug: 'guam-weather-1' },
      },
      {
        id: 'weather-2',
        topic: '세부 월별 날씨',
        destination: '세부',
        category: 'preparation',
        meta: { micro_angle: 'weather_packing', expected_slug: 'cebu-weather-2' },
      },
      {
        id: 'food-1',
        topic: '괌 식비 예산',
        destination: '괌',
        category: 'food',
        meta: { micro_angle: 'food_budget', expected_slug: 'guam-food-1' },
      },
      {
        id: 'hotel-1',
        topic: '괌 호텔 지역 비교',
        destination: '괌',
        category: 'hotel',
        meta: { micro_angle: 'hotel_area', expected_slug: 'guam-hotel-1' },
      },
    ];

    expect(prioritizeQueuedInformationResearch(rows).map((row) => row.id)).toEqual([
      'weather-1',
      'food-1',
      'hotel-1',
      'weather-2',
    ]);
    expect(prioritizeQueuedInformationResearch(rows, ['monthly_weather']).map((row) => row.id)).toEqual([
      'food-1',
      'hotel-1',
      'weather-1',
      'weather-2',
    ]);
  });

  it('requires intent diversity even when the total ready buffer is already full', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/blog-queue-research.ts'),
      'utf8',
    );

    expect(source).toContain('readyIntents.size >= targetIntentDiversity');
    expect(source).toContain('MIN_READY_INFORMATION_INTENT_DIVERSITY');
  });

  it('researches in bounded parallel batches so the cron stays within its runtime budget', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/blog-queue-research.ts'),
      'utf8',
    );

    expect(source).toContain('BLOG_INFORMATION_RESEARCH_CONCURRENCY = 3');
    expect(source).toContain('await Promise.all(batch.map(async (row) =>');
    expect(source).toContain('remainingBudget');
    expect(source).toContain('remainingNeeded');
  });

  it('does not bulk-skip candidates that were not attempted in the research budget', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/blog-queue-research.ts'),
      'utf8',
    );

    expect(source).not.toContain("replaced_by: 'reviewed_research_fallback'");
    expect(source).not.toContain("last_error: 'research_not_prepared_replaced'");
  });
});
