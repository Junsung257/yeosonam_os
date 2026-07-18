BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions, pg_catalog;

SELECT plan(17);

INSERT INTO public.content_creatives (
  id, title, description, angle_type, channel, blog_html, seo_title,
  seo_description, slug, status, quality_gate, generation_meta
)
VALUES (
  '11111111-1111-4111-8111-111111111111',
  'Runtime publication fixture',
  'Atomic publication success fixture',
  'emotional',
  'naver_blog',
  '<p>Atomic publication success fixture</p>',
  'Runtime publication SEO title',
  'Runtime publication SEO description',
  'runtime-publication-success',
  'draft',
  '{"passed":true}'::jsonb,
  '{"content_brief":{"destination_id":"osaka","intent_type":"airport_transport","audience":"general","locale":"ko-KR"},"information_claim_validation":{"passed":true}}'::jsonb
);

SELECT lives_ok(
  format(
    $call$
      SELECT * FROM public.publish_blog_information_atomically(
        %L::uuid, NULL, NULL,
        %L::char(64),
        '{"information_claim_validation":{"passed":true}}'::jsonb,
        '{"passed":true}'::jsonb,
        now(),
        'v1|osaka|airport_transport|general|ko-KR',
        'osaka', 'airport_transport', 'general', 'ko-KR',
        'runtime-test-owner', 'runtime-success-idempotency'
      )
    $call$,
    '11111111-1111-4111-8111-111111111111',
    encode(extensions.digest(concat_ws(E'\n',
      '<p>Atomic publication success fixture</p>',
      'Runtime publication SEO title',
      'Runtime publication SEO description',
      'runtime-publication-success'
    ), 'sha256'), 'hex')
  ),
  'atomic publication succeeds with a valid informational draft'
);

SELECT is(
  (SELECT status FROM public.content_creatives WHERE id = '11111111-1111-4111-8111-111111111111'),
  'published',
  'the article transitions to published'
);
SELECT is(
  (SELECT status FROM public.blog_information_representatives WHERE representative_key = 'v1|osaka|airport_transport|general|ko-KR'),
  'active',
  'the representative becomes active'
);
SELECT is(
  (SELECT canonical_creative_id FROM public.blog_information_representatives WHERE representative_key = 'v1|osaka|airport_transport|general|ko-KR'),
  '11111111-1111-4111-8111-111111111111'::uuid,
  'the representative points to the published article'
);
SELECT is(
  (SELECT count(*)::integer FROM public.blog_information_publications WHERE idempotency_key = 'runtime-success-idempotency'),
  1,
  'one publication audit row is written'
);
SELECT is(
  (SELECT count(*)::integer FROM public.blog_indexing_jobs WHERE idempotency_key = 'runtime-success-idempotency'),
  1,
  'one indexing outbox row is written'
);

SELECT is(
  (SELECT idempotent FROM public.publish_blog_information_atomically(
    '11111111-1111-4111-8111-111111111111', NULL, NULL,
    encode(extensions.digest(concat_ws(E'\n',
      '<p>Atomic publication success fixture</p>',
      'Runtime publication SEO title',
      'Runtime publication SEO description',
      'runtime-publication-success'
    ), 'sha256'), 'hex')::char(64),
    '{"information_claim_validation":{"passed":true}}'::jsonb,
    '{"passed":true}'::jsonb,
    now(),
    'v1|osaka|airport_transport|general|ko-KR',
    'osaka', 'airport_transport', 'general', 'ko-KR',
    'runtime-test-owner', 'runtime-success-idempotency'
  )),
  true,
  'a retry is reported as idempotent'
);
SELECT is(
  (SELECT count(*)::integer FROM public.blog_information_publications WHERE creative_id = '11111111-1111-4111-8111-111111111111'),
  1,
  'the retry does not duplicate publication audit rows'
);
SELECT is(
  (SELECT count(*)::integer FROM public.blog_indexing_jobs WHERE content_creative_id = '11111111-1111-4111-8111-111111111111'),
  1,
  'the retry does not duplicate indexing rows'
);

INSERT INTO public.content_creatives (
  id, title, angle_type, channel, blog_html, seo_title, seo_description,
  slug, status, quality_gate, generation_meta
)
VALUES (
  '22222222-2222-4222-8222-222222222222',
  'Quality failure fixture',
  'emotional', 'naver_blog', '<p>Quality failure</p>',
  'Quality failure title', 'Quality failure description',
  'runtime-quality-failure', 'draft', '{"passed":false}'::jsonb,
  '{"content_brief":{"destination_id":"taipei","intent_type":"hotel_areas","audience":"couple","locale":"ko-KR"},"information_claim_validation":{"passed":true}}'::jsonb
);

SELECT throws_ok(
  format(
    $call$
      SELECT * FROM public.publish_blog_information_atomically(
        %L::uuid, NULL, NULL, %L::char(64),
        '{"information_claim_validation":{"passed":true}}'::jsonb,
        '{"passed":false}'::jsonb, now(),
        'v1|taipei|hotel_areas|couple|ko-KR',
        'taipei', 'hotel_areas', 'couple', 'ko-KR',
        'runtime-test-owner', 'runtime-quality-failure-idempotency'
      )
    $call$,
    '22222222-2222-4222-8222-222222222222',
    encode(extensions.digest(concat_ws(E'\n',
      '<p>Quality failure</p>', 'Quality failure title',
      'Quality failure description', 'runtime-quality-failure'
    ), 'sha256'), 'hex')
  ),
  'P0001',
  'latest information quality gate did not pass',
  'a failed quality gate aborts publication'
);
SELECT is(
  (SELECT status FROM public.content_creatives WHERE id = '22222222-2222-4222-8222-222222222222'),
  'draft',
  'quality failure leaves the article private'
);
SELECT is(
  (SELECT count(*)::integer FROM public.blog_information_representatives WHERE representative_key = 'v1|taipei|hotel_areas|couple|ko-KR'),
  0,
  'quality failure rolls back the representative'
);
SELECT is(
  (SELECT count(*)::integer FROM public.blog_information_publications WHERE idempotency_key = 'runtime-quality-failure-idempotency'),
  0,
  'quality failure writes no publication audit'
);

INSERT INTO public.content_creatives (
  id, title, angle_type, channel, blog_html, seo_title, seo_description,
  slug, status, quality_gate, generation_meta
)
VALUES (
  '33333333-3333-4333-8333-333333333333',
  'Unsupported claim fixture',
  'emotional', 'naver_blog', '<p>Unsupported claim</p>',
  'Unsupported claim title', 'Unsupported claim description',
  'runtime-unsupported-claim', 'draft', '{"passed":true}'::jsonb,
  '{"content_brief":{"destination_id":"sapporo","intent_type":"food_budget","audience":"family","locale":"ko-KR"},"information_claim_validation":{"passed":true}}'::jsonb
);
INSERT INTO public.blog_information_claims (
  content_key, creative_id, claim_fingerprint, claim_text, claim_type,
  risk_level, requires_evidence, validation_status
)
VALUES (
  'runtime-unsupported-claim',
  '33333333-3333-4333-8333-333333333333',
  repeat('3', 64)::char(64),
  'Unsupported runtime claim', 'factual', 'LOW', true, 'unsupported'
);

SELECT throws_ok(
  format(
    $call$
      SELECT * FROM public.publish_blog_information_atomically(
        %L::uuid, NULL, NULL, %L::char(64),
        '{"information_claim_validation":{"passed":true}}'::jsonb,
        '{"passed":true}'::jsonb, now(),
        'v1|sapporo|food_budget|family|ko-KR',
        'sapporo', 'food_budget', 'family', 'ko-KR',
        'runtime-test-owner', 'runtime-unsupported-idempotency'
      )
    $call$,
    '33333333-3333-4333-8333-333333333333',
    encode(extensions.digest(concat_ws(E'\n',
      '<p>Unsupported claim</p>', 'Unsupported claim title',
      'Unsupported claim description', 'runtime-unsupported-claim'
    ), 'sha256'), 'hex')
  ),
  'P0001',
  'information claim is not publishable: 3333333333333333333333333333333333333333333333333333333333333333',
  'an unsupported evidence-required claim aborts publication'
);
SELECT is(
  (SELECT status FROM public.content_creatives WHERE id = '33333333-3333-4333-8333-333333333333'),
  'draft',
  'claim failure leaves the article private'
);
SELECT is(
  (SELECT count(*)::integer FROM public.blog_indexing_jobs WHERE idempotency_key = 'runtime-unsupported-idempotency'),
  0,
  'claim failure writes no indexing outbox row'
);
SELECT is(
  (SELECT count(*)::integer FROM public.blog_information_publications WHERE idempotency_key = 'runtime-unsupported-idempotency'),
  0,
  'claim failure writes no publication audit row'
);

SELECT * FROM finish();
ROLLBACK;
