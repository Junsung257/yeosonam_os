import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildBlogInformationPublicationIdempotencyKey,
  buildBlogInformationReplacementIdempotencyKey,
} from './blog-information-atomic-publication';

const migration = fs.readFileSync(path.join(
  process.cwd(),
  'supabase/migrations/20260715228000_blog_information_atomic_publication.sql',
), 'utf8');

describe('atomic informational publication migration', () => {
  it('uses one service-only transaction for article, representative, and indexing outbox', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.publish_blog_information_atomically');
    expect(migration).toContain("v_creative.product_id IS NOT NULL");
    expect(migration).toContain("SET status = 'published'");
    expect(migration).toContain('UPDATE public.blog_information_representatives');
    expect(migration).toContain('INSERT INTO public.blog_indexing_jobs');
    expect(migration).toContain('INSERT INTO public.blog_information_publications');
    expect(migration).toContain('pg_advisory_xact_lock');
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.publish_blog_information_atomically');
    expect(migration).toContain('TO service_role');
  });

  it('keeps every failure-injection boundary inside the atomic function', () => {
    const functionStart = migration.indexOf('CREATE OR REPLACE FUNCTION public.publish_blog_information_atomically');
    const articleWrite = migration.indexOf("UPDATE public.content_creatives\n  SET status = 'published'", functionStart);
    const representativeWrite = migration.indexOf('UPDATE public.blog_information_representatives AS representative', articleWrite);
    const outboxWrite = migration.indexOf('INSERT INTO public.blog_indexing_jobs', representativeWrite);
    const publicationWrite = migration.indexOf('INSERT INTO public.blog_information_publications', outboxWrite);
    const functionEnd = migration.indexOf('\nEND;\n$$;', publicationWrite);
    expect(functionStart).toBeGreaterThan(0);
    expect(articleWrite).toBeGreaterThan(functionStart);
    expect(representativeWrite).toBeGreaterThan(articleWrite);
    expect(outboxWrite).toBeGreaterThan(representativeWrite);
    expect(publicationWrite).toBeGreaterThan(outboxWrite);
    expect(functionEnd).toBeGreaterThan(publicationWrite);
    expect(migration.slice(functionStart, functionEnd)).toContain('reservation expired; explicit recovery required');
    expect(migration.slice(functionStart, functionEnd)).toContain('latest information review is not publishable');
  });

  it('locks and revalidates review, quality, claim, identity, and concurrent claim state', () => {
    expect(migration).toContain('latest information review is not publishable');
    expect(migration).toContain('latest information quality gate did not pass');
    expect(migration).toContain('latest information claim validation did not pass');
    expect(migration).toContain('persisted informational identity does not match publication identity');
    expect(migration).toMatch(/blog_information_claims[\s\S]+FOR SHARE/);
    expect(migration).toContain('high-risk information requires current human approval');
  });

  it('makes retries durable and explicit conflict states fail before commit', () => {
    expect(migration).toContain('idempotency_key text NOT NULL UNIQUE');
    expect(migration).toContain('informational representative update_existing_required');
    expect(migration).toContain('informational representative reservation expired');
    expect(migration).toContain('informational publication indexing outbox failed');
    expect(migration).toContain('RETURN QUERY SELECT');
    expect(migration).toContain('true;');
  });

  it('does not reference product publication or snapshot tables', () => {
    expect(migration).not.toMatch(/travel_packages|product_snapshots|product_evidence|product_details/i);
  });

  it('removes the earlier split reviewed-publish function', () => {
    expect(migration).toContain('DROP FUNCTION public.publish_blog_information_reviewed_draft');
  });
});

describe('informational publication idempotency key', () => {
  it('is stable for a retry and changes with the reviewed content', () => {
    const base = {
      creativeId: 'creative-1',
      contentFingerprint: 'a'.repeat(64),
      representativeKey: 'v1|sapporo|food_budget|general|ko-KR',
    };
    expect(buildBlogInformationPublicationIdempotencyKey(base))
      .toBe(buildBlogInformationPublicationIdempotencyKey(base));
    expect(buildBlogInformationPublicationIdempotencyKey(base))
      .not.toBe(buildBlogInformationPublicationIdempotencyKey({ ...base, contentFingerprint: 'b'.repeat(64) }));
  });

  it('separates reviewed replacement retries by draft, target, content, and representative', () => {
    const base = {
      replacementDraftId: 'draft-1',
      targetCreativeId: 'public-1',
      sourceFingerprint: 'a'.repeat(64),
      representativeKey: 'v1|vietnam|entry_requirements|general|ko-KR',
    };
    expect(buildBlogInformationReplacementIdempotencyKey(base))
      .toBe(buildBlogInformationReplacementIdempotencyKey(base));
    expect(buildBlogInformationReplacementIdempotencyKey(base))
      .not.toBe(buildBlogInformationReplacementIdempotencyKey({
        ...base,
        targetCreativeId: 'public-2',
      }));
  });
});
