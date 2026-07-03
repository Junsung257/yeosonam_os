#!/usr/bin/env tsx

import './load-script-env';

import { supabaseAdmin } from '../src/lib/supabase';
import { enqueueBlogIndexingJob } from '../src/lib/blog-indexing-outbox';
import {
  buildDestinationlessInfoGenericGenerationMeta,
  classifyDestinationlessInfoCandidate,
  looksLikeGenericInfoTopic,
} from '../src/lib/blog-destinationless-info';

type PublishedRow = {
  id: string;
  slug: string | null;
  seo_title: string | null;
  destination: string | null;
  category: string | null;
  product_id: string | null;
  status: string | null;
  published_at: string | null;
  generation_meta: Record<string, unknown> | null;
};

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function argValue(name: string): string | null {
  const prefix = `${name}=`;
  const found = process.argv.find(arg => arg.startsWith(prefix));
  return found ? found.slice(prefix.length).trim() : null;
}

function numberArg(name: string, fallback: number, max: number): number {
  const parsed = Number(argValue(name));
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function publishedInfoRow(row: PublishedRow) {
  return {
    ...row,
    topic: row.seo_title,
    source: 'content_creatives',
  };
}

const DESTINATION_HINTS = [
  '유럽',
  '동남아',
  '일본',
  '도쿄',
  '오사카',
  '후쿠오카',
  '오키나와',
  '홍콩',
  '방콕',
  '싱가포르',
  '다낭',
  '세부',
  '발리',
  '괌',
  '사이판',
  '파리',
  '런던',
  '로마',
  '뉴욕',
  '하와이',
];

function inferReplacementDestination(row: PublishedRow): string | null {
  const meta = row.generation_meta ?? {};
  const brief = meta.content_brief && typeof meta.content_brief === 'object' && !Array.isArray(meta.content_brief)
    ? meta.content_brief as Record<string, unknown>
    : {};
  const keywords = Array.isArray(meta.keywords) ? meta.keywords.map(clean).join(' ') : '';
  const text = [
    row.seo_title,
    row.slug,
    row.category,
    keywords,
    brief.destination,
    brief.primary_keyword,
    brief.title,
  ].map(clean).join(' ');

  return DESTINATION_HINTS.find(destination => text.includes(destination)) ?? null;
}

function needsConcreteDestination(row: PublishedRow): boolean {
  const meta = row.generation_meta ?? {};
  const brief = meta.content_brief && typeof meta.content_brief === 'object' && !Array.isArray(meta.content_brief)
    ? meta.content_brief as Record<string, unknown>
    : {};
  const text = [
    row.seo_title,
    row.slug,
    brief.title,
    brief.primary_keyword,
    brief.reader_question,
  ].map(clean).join(' ');
  return /(?:월별\s*)?(?:날씨|기온|옷차림|우기|건기)/i.test(text);
}

async function loadRows(limit: number): Promise<PublishedRow[]> {
  const { data, error } = await supabaseAdmin
    .from('content_creatives')
    .select('id,slug,seo_title,destination,category,product_id,status,published_at,generation_meta')
    .eq('status', 'published')
    .eq('channel', 'naver_blog')
    .is('product_id', null)
    .order('published_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as PublishedRow[];
}

async function enqueueUpdated(row: PublishedRow, source: string) {
  if (!row.slug) return;
  const indexing = await enqueueBlogIndexingJob({
    slug: row.slug,
    contentCreativeId: row.id,
    source,
    type: 'URL_UPDATED',
  });
  if (!indexing.ok) throw new Error(indexing.error ?? 'indexing enqueue failed');
}

async function markGeneric(row: PublishedRow, checkedAt: string, clearDestination = false) {
  const updatePayload: Record<string, unknown> = {
    generation_meta: {
      ...buildDestinationlessInfoGenericGenerationMeta({ row, checkedAt }),
      ...(clearDestination
        ? {
            destination_cleared_at: checkedAt,
            destination_cleared_by: 'blog-published-info-destination-recheck',
            previous_destination: row.destination,
          }
        : {}),
    },
    updated_at: checkedAt,
  };
  if (clearDestination) updatePayload.destination = null;

  const { error } = await supabaseAdmin
    .from('content_creatives')
    .update(updatePayload as never)
    .eq('id', row.id)
    .eq('status', 'published');
  if (error) throw new Error(error.message);

  if (clearDestination) {
    await enqueueUpdated(row, 'blog_published_info_destination_clear');
  }
}

async function repairDestination(row: PublishedRow, destination: string, checkedAt: string) {
  const { error } = await supabaseAdmin
    .from('content_creatives')
    .update({
      destination,
      generation_meta: {
        ...(row.generation_meta ?? {}),
        destination_repaired_at: checkedAt,
        destination_repaired_by: 'blog-published-info-destination-recheck',
        previous_destination: row.destination,
        repaired_destination: destination,
      },
      updated_at: checkedAt,
    } as never)
    .eq('id', row.id)
    .eq('status', 'published');
  if (error) throw new Error(error.message);

  await enqueueUpdated(row, 'blog_published_info_destination_repair');
}

async function archiveBroken(row: PublishedRow, issue: string, checkedAt: string) {
  const generationMeta = {
    ...(row.generation_meta ?? {}),
    failure_code: issue,
    quarantine_reason: issue,
    archived_at: checkedAt,
    archived_by: 'blog-published-info-destination-recheck',
  };
  const { error } = await supabaseAdmin
    .from('content_creatives')
    .update({
      status: 'archived',
      generation_meta: generationMeta,
      updated_at: checkedAt,
    } as never)
    .eq('id', row.id)
    .eq('status', 'published');
  if (error) throw new Error(error.message);

  if (row.slug) {
    const indexing = await enqueueBlogIndexingJob({
      slug: row.slug,
      contentCreativeId: row.id,
      source: 'blog_published_info_destination_archive',
      type: 'URL_DELETED',
    });
    if (!indexing.ok) throw new Error(indexing.error ?? 'indexing enqueue failed');
  }

  const queueItemId = row.generation_meta?.queue_item_id;
  if (typeof queueItemId === 'string' && queueItemId) {
    await supabaseAdmin
      .from('blog_topic_queue')
      .update({
        status: 'skipped',
        last_error: issue,
        updated_at: checkedAt,
      } as never)
      .eq('id', queueItemId)
      .in('status', ['queued', 'generating', 'generated_draft', 'prepared_for_publish', 'quality_checked', 'published']);
  }
}

async function main() {
  const write = hasFlag('--write');
  const json = hasFlag('--json');
  const limit = numberArg('--limit', 500, 2000);
  const checkedAt = new Date().toISOString();
  const rows = await loadRows(limit);
  const results: Array<Record<string, unknown>> = [];
  let markedGeneric = 0;
  let clearedInvalidDestination = 0;
  let repairedDestination = 0;
  let archived = 0;
  let alreadyGeneric = 0;

  for (const row of rows) {
    const issue = classifyDestinationlessInfoCandidate(publishedInfoRow(row));
    if (!issue) continue;

    const result: Record<string, unknown> = {
      content_id: row.id,
      slug: row.slug,
      title: row.seo_title,
      destination: row.destination,
      issue,
      action: 'none',
    };

    if (issue === 'intentionally_generic') {
      alreadyGeneric += 1;
      result.action = 'already_generic';
    } else if (issue === 'generic_unmarked') {
      markedGeneric += 1;
      result.action = 'mark_intentionally_generic';
      if (write) {
        await markGeneric(row, checkedAt);
        result.updated = true;
      }
    } else if (issue === 'invalid_destination') {
      const replacementDestination = inferReplacementDestination(row);
      const genericAfterDestinationClear = looksLikeGenericInfoTopic({
        ...publishedInfoRow(row),
        destination: null,
      });

      if (replacementDestination) {
        repairedDestination += 1;
        result.action = 'set_real_destination';
        result.repaired_destination = replacementDestination;
        if (write) {
          await repairDestination(row, replacementDestination, checkedAt);
          result.updated = true;
          result.after_destination = replacementDestination;
        }
      } else if (needsConcreteDestination(row)) {
        archived += 1;
        result.action = 'archive_broken_info_destination';
        result.reason = 'destination_required_for_weather_or_clothing_topic';
        if (write) {
          await archiveBroken(row, issue, checkedAt);
          result.updated = true;
          result.after_status = 'archived';
        }
      } else if (genericAfterDestinationClear) {
        markedGeneric += 1;
        clearedInvalidDestination += 1;
        result.action = 'mark_intentionally_generic_clear_destination';
        if (write) {
          await markGeneric(row, checkedAt, true);
          result.updated = true;
          result.after_destination = null;
        }
      } else {
        archived += 1;
        result.action = 'archive_broken_info_destination';
        if (write) {
          await archiveBroken(row, issue, checkedAt);
          result.updated = true;
          result.after_status = 'archived';
        }
      }
    } else {
      archived += 1;
      result.action = 'archive_broken_info_destination';
      if (write) {
        await archiveBroken(row, issue, checkedAt);
        result.updated = true;
        result.after_status = 'archived';
      }
    }

    results.push(result);
  }

  const writeReasons = [
    ...(markedGeneric > 0 ? ['mark_generic_published_info_rows'] : []),
    ...(clearedInvalidDestination > 0 ? ['clear_invalid_destination_from_generic_info_rows'] : []),
    ...(repairedDestination > 0 ? ['repair_invalid_destination_info_rows'] : []),
    ...(archived > 0 ? ['archive_invalid_or_missing_destination_info_rows'] : []),
  ];
  const report = {
    mode: write ? 'write' : 'dry-run',
    checked_at: checkedAt,
    scanned: rows.length,
    marked_generic: markedGeneric,
    cleared_invalid_destination: clearedInvalidDestination,
    repaired_destination: repairedDestination,
    archived,
    already_generic: alreadyGeneric,
    write_recommended: writeReasons.length > 0,
    write_reasons: writeReasons,
    results,
  };

  if (json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`[blog-published-info-destination-recheck] mode=${report.mode} scanned=${report.scanned} marked_generic=${markedGeneric} cleared_invalid_destination=${clearedInvalidDestination} repaired_destination=${repairedDestination} archived=${archived} write_recommended=${report.write_recommended}`);
    for (const row of results.slice(0, 25)) {
      console.log(`- ${row.action} ${row.slug ?? ''} ${row.title ?? ''}`);
    }
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
