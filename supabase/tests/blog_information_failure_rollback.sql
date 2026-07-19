BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions, pg_catalog;

SELECT plan(30);

CREATE FUNCTION pg_temp.make_information_creative(
  p_id uuid,
  p_slug text,
  p_destination text,
  p_intent text,
  p_audience text DEFAULT 'general'
)
RETURNS void
LANGUAGE sql
AS $$
  INSERT INTO public.content_creatives (
    id, title, description, angle_type, channel, blog_html, seo_title,
    seo_description, slug, status, quality_gate, generation_meta
  ) VALUES (
    p_id,
    p_slug || ' title',
    p_slug || ' description',
    'emotional',
    'naver_blog',
    '<p>' || p_slug || '</p>',
    p_slug || ' seo title',
    p_slug || ' seo description',
    p_slug,
    'draft',
    jsonb_build_object('passed', true),
    jsonb_build_object(
      'content_brief', jsonb_build_object(
        'destination_id', p_destination,
        'intent_type', p_intent,
        'audience', p_audience,
        'locale', 'ko-KR'
      ),
      'information_claim_validation', jsonb_build_object('passed', true)
    )
  );
$$;

CREATE FUNCTION pg_temp.information_fingerprint(p_id uuid)
RETURNS char(64)
LANGUAGE sql
STABLE
AS $$
  SELECT encode(extensions.digest(concat_ws(E'\n',
    coalesce(creative.blog_html, ''),
    coalesce(creative.seo_title, ''),
    coalesce(creative.seo_description, ''),
    coalesce(creative.slug, '')
  ), 'sha256'), 'hex')::char(64)
  FROM public.content_creatives AS creative
  WHERE creative.id = p_id;
$$;

CREATE FUNCTION pg_temp.call_information_publish(
  p_id uuid,
  p_case_id uuid,
  p_destination text,
  p_intent text,
  p_audience text,
  p_idempotency_key text
)
RETURNS TABLE(is_idempotent boolean)
LANGUAGE sql
AS $$
  SELECT publication.idempotent
  FROM public.publish_blog_information_atomically(
    p_id,
    p_case_id,
    NULL,
    pg_temp.information_fingerprint(p_id),
    jsonb_build_object(
      'information_claim_validation', jsonb_build_object('passed', true)
    ),
    jsonb_build_object('passed', true),
    now(),
    concat('v1|', p_destination, '|', p_intent, '|', p_audience, '|ko-KR'),
    p_destination,
    p_intent,
    p_audience,
    'ko-KR',
    'rollback-test-owner',
    p_idempotency_key
  ) AS publication;
$$;

CREATE FUNCTION public.test_fail_information_article_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'published' THEN
    RAISE EXCEPTION 'test failure: article published update';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.test_fail_information_representative_activation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'active' THEN
    RAISE EXCEPTION 'test failure: representative activation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.test_fail_information_indexing_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.source = 'information_atomic_publish' THEN
    RAISE EXCEPTION 'test failure: indexing outbox insert';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.test_fail_information_publication_audit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'test failure: publication audit insert';
END;
$$;

-- Failure 1: a stale/non-publishable review case is fail-closed.
SELECT pg_temp.make_information_creative(
  '51000000-0000-4000-8000-000000000001',
  'rollback-review', 'osaka', 'hotel_areas', 'couple'
);
INSERT INTO public.blog_information_review_cases (
  id, creative_id, content_key, intent_type, risk_level, status,
  content_fingerprint, validator_report
) VALUES (
  '61000000-0000-4000-8000-000000000001',
  '51000000-0000-4000-8000-000000000001',
  'rollback-review', 'hotel_areas', 'LOW', 'pending_review',
  pg_temp.information_fingerprint('51000000-0000-4000-8000-000000000001'),
  jsonb_build_object('passed', true)
);
SELECT throws_ok(
  $$SELECT * FROM pg_temp.call_information_publish(
    '51000000-0000-4000-8000-000000000001',
    '61000000-0000-4000-8000-000000000001',
    'osaka', 'hotel_areas', 'couple', 'rollback-review-idem'
  )$$,
  'P0001', 'latest information review is not publishable',
  'a non-publishable review case aborts publication'
);
SELECT is((SELECT status FROM public.content_creatives WHERE id = '51000000-0000-4000-8000-000000000001'), 'draft', 'review failure leaves the article private');
SELECT is((SELECT count(*)::integer FROM public.blog_information_representatives WHERE representative_key = 'v1|osaka|hotel_areas|couple|ko-KR'), 0, 'review failure creates no representative');
SELECT is((SELECT count(*)::integer FROM public.blog_information_publications WHERE idempotency_key = 'rollback-review-idem'), 0, 'review failure creates no publication audit');

-- Failure 2: a high-risk intent cannot publish without current approval.
SELECT pg_temp.make_information_creative(
  '51000000-0000-4000-8000-000000000002',
  'rollback-high-risk', 'japan', 'entry_requirements', 'general'
);
SELECT throws_ok(
  $$SELECT * FROM pg_temp.call_information_publish(
    '51000000-0000-4000-8000-000000000002', NULL,
    'japan', 'entry_requirements', 'general', 'rollback-high-risk-idem'
  )$$,
  'P0001', 'high-risk information requires current human approval',
  'high-risk information without approval aborts publication'
);
SELECT is((SELECT status FROM public.content_creatives WHERE id = '51000000-0000-4000-8000-000000000002'), 'draft', 'high-risk failure leaves the article private');
SELECT is((SELECT count(*)::integer FROM public.blog_information_representatives WHERE representative_key = 'v1|japan|entry_requirements|general|ko-KR'), 0, 'high-risk failure creates no representative');
SELECT is((SELECT count(*)::integer FROM public.blog_indexing_jobs WHERE idempotency_key = 'rollback-high-risk-idem'), 0, 'high-risk failure creates no indexing job');

-- Failure 3: the public article transition fails and rolls back everything.
SELECT pg_temp.make_information_creative(
  '51000000-0000-4000-8000-000000000003',
  'rollback-article', 'taipei', 'airport_transport', 'general'
);
CREATE TRIGGER test_fail_information_article_update
BEFORE UPDATE ON public.content_creatives
FOR EACH ROW EXECUTE FUNCTION public.test_fail_information_article_update();
SELECT throws_ok(
  $$SELECT * FROM pg_temp.call_information_publish(
    '51000000-0000-4000-8000-000000000003', NULL,
    'taipei', 'airport_transport', 'general', 'rollback-article-idem'
  )$$,
  'P0001', 'test failure: article published update',
  'an article update exception aborts publication'
);
DROP TRIGGER test_fail_information_article_update ON public.content_creatives;
SELECT is((SELECT status FROM public.content_creatives WHERE id = '51000000-0000-4000-8000-000000000003'), 'draft', 'article update failure leaves the draft unchanged');
SELECT is((SELECT count(*)::integer FROM public.blog_information_representatives WHERE representative_key = 'v1|taipei|airport_transport|general|ko-KR'), 0, 'article update failure rolls back the reservation');
SELECT is((SELECT count(*)::integer FROM public.blog_information_publications WHERE idempotency_key = 'rollback-article-idem'), 0, 'article update failure writes no audit');

-- Failure 4: representative activation fails after the article update.
SELECT pg_temp.make_information_creative(
  '51000000-0000-4000-8000-000000000004',
  'rollback-representative', 'sapporo', 'monthly_weather', 'general'
);
CREATE TRIGGER test_fail_information_representative_activation
BEFORE UPDATE ON public.blog_information_representatives
FOR EACH ROW EXECUTE FUNCTION public.test_fail_information_representative_activation();
SELECT throws_ok(
  $$SELECT * FROM pg_temp.call_information_publish(
    '51000000-0000-4000-8000-000000000004', NULL,
    'sapporo', 'monthly_weather', 'general', 'rollback-representative-idem'
  )$$,
  'P0001', 'test failure: representative activation',
  'a representative activation exception aborts publication'
);
DROP TRIGGER test_fail_information_representative_activation ON public.blog_information_representatives;
SELECT is((SELECT status FROM public.content_creatives WHERE id = '51000000-0000-4000-8000-000000000004'), 'draft', 'representative failure rolls back the article update');
SELECT is((SELECT count(*)::integer FROM public.blog_information_representatives WHERE representative_key = 'v1|sapporo|monthly_weather|general|ko-KR'), 0, 'representative failure rolls back the representative row');
SELECT is((SELECT count(*)::integer FROM public.blog_indexing_jobs WHERE idempotency_key = 'rollback-representative-idem'), 0, 'representative failure writes no indexing job');

-- Failure 5: indexing outbox insertion fails after activation.
SELECT pg_temp.make_information_creative(
  '51000000-0000-4000-8000-000000000005',
  'rollback-indexing', 'cebu', 'shopping_souvenirs', 'family'
);
CREATE TRIGGER test_fail_information_indexing_insert
BEFORE INSERT ON public.blog_indexing_jobs
FOR EACH ROW EXECUTE FUNCTION public.test_fail_information_indexing_insert();
SELECT throws_ok(
  $$SELECT * FROM pg_temp.call_information_publish(
    '51000000-0000-4000-8000-000000000005', NULL,
    'cebu', 'shopping_souvenirs', 'family', 'rollback-indexing-idem'
  )$$,
  'P0001', 'test failure: indexing outbox insert',
  'an indexing outbox exception aborts publication'
);
DROP TRIGGER test_fail_information_indexing_insert ON public.blog_indexing_jobs;
SELECT is((SELECT status FROM public.content_creatives WHERE id = '51000000-0000-4000-8000-000000000005'), 'draft', 'indexing failure rolls back the article update');
SELECT is((SELECT count(*)::integer FROM public.blog_information_representatives WHERE representative_key = 'v1|cebu|shopping_souvenirs|family|ko-KR'), 0, 'indexing failure rolls back representative activation');
SELECT is((SELECT count(*)::integer FROM public.blog_indexing_jobs WHERE idempotency_key = 'rollback-indexing-idem'), 0, 'indexing failure leaves no partial outbox row');

-- Failure 6: publication audit insertion fails last and rolls back prior writes.
SELECT pg_temp.make_information_creative(
  '51000000-0000-4000-8000-000000000006',
  'rollback-audit', 'guangzhou', 'currency_payment', 'general'
);
CREATE TRIGGER test_fail_information_publication_audit
BEFORE INSERT ON public.blog_information_publications
FOR EACH ROW EXECUTE FUNCTION public.test_fail_information_publication_audit();
SELECT throws_ok(
  $$SELECT * FROM pg_temp.call_information_publish(
    '51000000-0000-4000-8000-000000000006', NULL,
    'guangzhou', 'currency_payment', 'general', 'rollback-audit-idem'
  )$$,
  'P0001', 'test failure: publication audit insert',
  'a publication audit exception aborts publication'
);
DROP TRIGGER test_fail_information_publication_audit ON public.blog_information_publications;
SELECT is((SELECT status FROM public.content_creatives WHERE id = '51000000-0000-4000-8000-000000000006'), 'draft', 'audit failure rolls back the article update');
SELECT is((SELECT count(*)::integer FROM public.blog_information_representatives WHERE representative_key = 'v1|guangzhou|currency_payment|general|ko-KR'), 0, 'audit failure rolls back representative activation');
SELECT is((SELECT count(*)::integer FROM public.blog_indexing_jobs WHERE idempotency_key = 'rollback-audit-idem'), 0, 'audit failure rolls back the outbox row');

-- Failure 7: an idempotency key cannot be reused for different content.
SELECT pg_temp.make_information_creative(
  '51000000-0000-4000-8000-000000000007',
  'rollback-idem-first', 'mongolia', 'itinerary', 'solo'
);
SELECT pg_temp.make_information_creative(
  '51000000-0000-4000-8000-000000000008',
  'rollback-idem-second', 'singapore', 'food_budget', 'couple'
);
SELECT is(
  (SELECT is_idempotent FROM pg_temp.call_information_publish(
    '51000000-0000-4000-8000-000000000007', NULL,
    'mongolia', 'itinerary', 'solo', 'rollback-shared-idem'
  )),
  false,
  'the first use of an idempotency key publishes normally'
);
SELECT throws_ok(
  $$SELECT * FROM pg_temp.call_information_publish(
    '51000000-0000-4000-8000-000000000008', NULL,
    'singapore', 'food_budget', 'couple', 'rollback-shared-idem'
  )$$,
  'P0001', 'informational publication idempotency key was reused for different content',
  'reusing an idempotency key for other content fails closed'
);
SELECT is((SELECT status FROM public.content_creatives WHERE id = '51000000-0000-4000-8000-000000000008'), 'draft', 'idempotency collision leaves the losing article private');
SELECT is((SELECT count(*)::integer FROM public.blog_information_representatives WHERE representative_key = 'v1|singapore|food_budget|couple|ko-KR'), 0, 'idempotency collision creates no losing representative');
SELECT is((SELECT count(*)::integer FROM public.blog_information_publications WHERE idempotency_key = 'rollback-shared-idem'), 1, 'idempotency collision preserves exactly one publication audit');
SELECT is((SELECT count(*)::integer FROM public.blog_indexing_jobs WHERE idempotency_key = 'rollback-shared-idem'), 1, 'idempotency collision preserves exactly one indexing row');

SELECT * FROM finish();
ROLLBACK;
