-- Blog Quality Engine V3: keep medication topics in the same human-reviewed
-- HIGH-risk lane as other health and medical travel information.
--
-- Schema/backfill: none. This is a backward-compatible policy-only replacement
-- for the existing function consumed by public_blog_content_creatives.
-- Dry-run audit before apply:
--   select id, slug, seo_title, review_status
--   from public.content_creatives
--   where concat_ws(' ', seo_title, category, content_type, title) ~*
--     '(의약품|상비약|비상약|처방약|처방전|약국|복용|해외[[:space:]]*여행[[:space:]]*약)';
-- Rollback SQL: re-run the function body from
-- 20260811132017_blog_quality_v3_policy.sql, then preserve the same REVOKE/GRANT.

begin;

create or replace function public.evaluate_blog_public_eligibility_v3(
  p_id uuid,
  p_slug text,
  p_status text,
  p_channel text,
  p_product_id uuid,
  p_review_status text,
  p_title text,
  p_category text,
  p_content_type text,
  p_topic text,
  p_published_at timestamptz,
  p_generation_meta jsonb,
  p_quality_gate jsonb,
  p_representative_status text,
  p_canonical_creative_id uuid,
  p_canonical_slug text
) returns table (eligible boolean, lane text, reason text)
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_text text := concat_ws(' ', p_title, p_category, p_content_type, p_topic);
  v_high_risk boolean := v_text ~* '(비자|입국|출입국|이민국|여권|세관|면세|보험[[:space:]]*(보장|면책|청구)|여행자?[[:space:]]*보험|법률|규제|안전[[:space:]]*(경보|주의보)|건강|의료|질병|예방접종|의약품|상비약|비상약|처방약|처방전|약국|복용|(해외[[:space:]]*여행|여행|휴대|반입|처방|상비|비상)[[:space:]]*약(품)?($|[[:space:],./·:;!?()])|visa|immigration|passport|customs|duty[ _-]?free|(^|[^a-z])(eta|esta|etias)([^a-z]|$)|entry[ _-]*requirements?|travel[ _-]*insurance|health[ _-]*advisory|safety[ _-]*alert|(^|[^a-z])(medication|medicine|prescription|pharmacy)([^a-z]|$))';
begin
  if p_status is distinct from 'published' then return query select false, null::text, 'not_published'; return; end if;
  if p_channel is distinct from 'naver_blog' then return query select false, null::text, 'wrong_channel'; return; end if;
  if nullif(btrim(p_slug), '') is null then return query select false, null::text, 'missing_slug'; return; end if;
  if coalesce(p_generation_meta ->> 'noindex', 'false') = 'true'
    or coalesce(p_generation_meta -> 'seo' ->> 'noindex', 'false') = 'true'
    then return query select false, null::text, 'noindex'; return;
  end if;
  if nullif(btrim(coalesce(p_generation_meta ->> 'redirect_to', '')), '') is not null
    or nullif(btrim(coalesce(p_generation_meta ->> 'redirectTo', '')), '') is not null
    or nullif(btrim(coalesce(p_generation_meta ->> 'canonical_redirect_to', '')), '') is not null
    then return query select false, null::text, 'redirected'; return;
  end if;
  if coalesce(p_review_status, 'none') in ('pending_review','in_review','rejected','changes_requested')
    then return query select false, case when p_product_id is not null then 'product' else null end, 'review_blocked'; return;
  end if;
  if v_high_risk and coalesce(p_review_status, 'none') <> 'approved'
    then return query select false, case when p_product_id is not null then 'product' else null end, 'review_blocked'; return;
  end if;
  if p_product_id is not null then return query select true, 'product', 'eligible_product'; return; end if;
  if p_published_at < timestamptz '2026-07-15 00:00:00+09'
    then
      if coalesce(p_quality_gate ->> 'passed', 'false') <> 'true'
        then return query select false, 'information_legacy', 'quality_gate_missing_or_failed'; return;
      end if;
      return query select true, 'information_legacy', 'eligible_information_legacy'; return;
  end if;
  if nullif(btrim(coalesce(p_generation_meta -> 'content_brief' ->> 'destination_id', '')), '') is null
    then return query select false, 'information_v2', 'information_contract_missing'; return;
  end if;
  if p_generation_meta -> 'content_brief' ->> 'destination_id' in ('unknown','undefined','null','top')
    then return query select false, 'information_v2', 'destination_entity_invalid'; return;
  end if;
  if coalesce(p_quality_gate ->> 'passed', 'false') <> 'true'
    then return query select false, 'information_v2', 'quality_gate_missing_or_failed'; return;
  end if;
  if coalesce(p_generation_meta -> 'information_claim_validation' ->> 'passed', 'false') <> 'true'
    then return query select false, 'information_v2', 'claim_gate_missing_or_failed'; return;
  end if;
  if p_representative_status is distinct from 'active'
    then return query select false, 'information_v2', 'representative_missing_or_inactive'; return;
  end if;
  if p_canonical_creative_id is distinct from p_id or p_canonical_slug is distinct from p_slug
    then return query select false, 'information_v2', 'representative_canonical_mismatch'; return;
  end if;
  return query select true, 'information_v2', 'eligible_information_v2';
end;
$$;

revoke all on function public.evaluate_blog_public_eligibility_v3(uuid,text,text,text,uuid,text,text,text,text,text,timestamptz,jsonb,jsonb,text,uuid,text) from public, anon, authenticated;
grant execute on function public.evaluate_blog_public_eligibility_v3(uuid,text,text,text,uuid,text,text,text,text,text,timestamptz,jsonb,jsonb,text,uuid,text) to service_role;

comment on function public.evaluate_blog_public_eligibility_v3 is
  'Canonical SQL public eligibility policy. Medication topics require current human approval; keep parity with blog-publication-review-policy.ts.';

commit;
