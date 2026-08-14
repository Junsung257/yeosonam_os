begin;

do $$
declare
  result record;
  fixture_id uuid := '00000000-0000-0000-0000-000000000001';
begin
  select * into result from public.evaluate_blog_public_eligibility_v3(
    fixture_id, 'useful-guide', 'published', 'naver_blog', null, 'none', '오사카 숙소 위치', null, 'informational', null,
    '2026-08-10T00:00:00Z', '{"content_brief":{"destination_id":"osaka"},"information_claim_validation":{"passed":true}}',
    '{"passed":true}', 'active', fixture_id, 'useful-guide');
  assert result.eligible and result.reason = 'eligible_information_v2', 'eligible-v3 parity failed';

  select * into result from public.evaluate_blog_public_eligibility_v3(
    fixture_id, 'useful-guide', 'published', 'naver_blog', null, 'changes_requested', '오사카 숙소 위치', null, 'informational', null,
    '2026-08-10T00:00:00Z', '{}', '{}', null, null, null);
  assert not result.eligible and result.reason = 'review_blocked', 'changes-requested parity failed';

  select * into result from public.evaluate_blog_public_eligibility_v3(
    fixture_id, 'etias-change', 'published', 'naver_blog', null, 'none', 'ETIAS 입국 규정 변경', null, 'informational', null,
    '2026-08-10T00:00:00Z', '{"content_brief":{"destination_id":"eu"},"information_claim_validation":{"passed":true}}',
    '{"passed":true}', 'active', fixture_id, 'etias-change');
  assert not result.eligible and result.reason = 'review_blocked', 'high-risk parity failed';

  select * into result from public.evaluate_blog_public_eligibility_v3(
    fixture_id, 'korean-high-risk', 'published', 'naver_blog', null, 'none', '베트남 여권과 세관 면세 규정', null, 'informational', null,
    '2026-08-10T00:00:00Z', '{"content_brief":{"destination_id":"vietnam"},"information_claim_validation":{"passed":true}}',
    '{"passed":true}', 'active', fixture_id, 'korean-high-risk');
  assert not result.eligible and result.reason = 'review_blocked', 'Korean-only high-risk parity failed';

  select * into result from public.evaluate_blog_public_eligibility_v3(
    fixture_id, 'legacy', 'published', 'naver_blog', null, 'none', '저위험 문화 정보', null, 'informational', null,
    '2026-07-01T00:00:00Z', '{}', '{}', null, null, null);
  assert result.eligible and result.reason = 'eligible_information_legacy', 'legacy parity failed';
end $$;

rollback;
