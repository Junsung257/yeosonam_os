CREATE OR REPLACE FUNCTION increment_ab_metric(
  p_variant_id bigint,
  p_field text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  EXECUTE format('UPDATE ab_variants SET %I = %I + 1 WHERE id = $1', p_field, p_field) USING p_variant_id;
END;
$$;
