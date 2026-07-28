-- Repair legacy WMO monthly rows that stored only the highest temperature.
-- The source excerpt and immutable source version remain unchanged; only the
-- derived structured value is rebuilt from all four values in that excerpt.

WITH parsed_evidence AS MATERIALIZED (
  SELECT
    id,
    regexp_match(
      excerpt,
      '최고기온[[:space:]]*(-?[0-9]+[.]?[0-9]*)[[:space:]]*[℃°C]+.*최저기온[[:space:]]*(-?[0-9]+[.]?[0-9]*)[[:space:]]*[℃°C]+.*강수량[[:space:]]*([0-9]+[.]?[0-9]*)[[:space:]]*mm.*강수일수[[:space:]]*([0-9]+[.]?[0-9]*)[[:space:]]*일',
      'i'
    ) AS parts
  FROM public.blog_information_evidence
  WHERE claim_type = 'climate'
    AND scope ->> 'unit' IN ('°C', '℃')
    AND excerpt ~ '최고기온.*최저기온.*강수량.*강수일수'
)
UPDATE public.blog_information_evidence AS evidence
SET
  scope = jsonb_set(
    jsonb_set(
      jsonb_set(
        evidence.scope,
        '{normalizedValue}',
        to_jsonb(array_to_string(parsed.parts, '|'))
      ),
      '{unit}',
      to_jsonb('월별 기후 지표'::text)
    ),
    '{currency}',
    'null'::jsonb
  ),
  metadata = coalesce(evidence.metadata, '{}'::jsonb)
    || jsonb_build_object('climate_value_contract', 'monthly_composite_v1'),
  updated_at = now()
FROM parsed_evidence AS parsed
WHERE evidence.id = parsed.id
  AND cardinality(parsed.parts) = 4;

WITH parsed_claims AS MATERIALIZED (
  SELECT
    id,
    regexp_match(
      claim_text,
      '최고기온[[:space:]]*(-?[0-9]+[.]?[0-9]*)[[:space:]]*[℃°C]+.*최저기온[[:space:]]*(-?[0-9]+[.]?[0-9]*)[[:space:]]*[℃°C]+.*강수량[[:space:]]*([0-9]+[.]?[0-9]*)[[:space:]]*mm.*강수일수[[:space:]]*([0-9]+[.]?[0-9]*)[[:space:]]*일',
      'i'
    ) AS parts
  FROM public.blog_information_claims
  WHERE claim_type = 'climate'
    AND extracted_value ->> 'unit' IN ('°C', '℃')
    AND claim_text ~ '최고기온.*최저기온.*강수량.*강수일수'
)
UPDATE public.blog_information_claims AS claims
SET
  extracted_value = jsonb_build_object(
    'normalizedValue',
    array_to_string(parsed.parts, '|'),
    'unit',
    '월별 기후 지표',
    'currency',
    null
  ),
  updated_at = now()
FROM parsed_claims AS parsed
WHERE claims.id = parsed.id
  AND cardinality(parsed.parts) = 4;
