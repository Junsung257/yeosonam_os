-- ═══════════════════════════════════════════════════════════════════════════
-- 2026-05-18 박제 (ERR-unmatched-count-stuck-at-1):
--   upload/route.ts 가 unmatched_activities upsert 시 occurrence_count: 1 고정.
--   같은 activity 가 N개 패키지에 등장해도 빈도 누적 안 됨 → 사장님 어드민 우선순위
--   정렬 무의미. RPC 함수로 atomic INSERT … ON CONFLICT DO UPDATE 박제.
--
-- 참고: increment_mention_count (attractions.mention_count) 와 동일 패턴.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.increment_unmatched_count(
  p_activity TEXT,
  p_package_id UUID,
  p_package_title TEXT,
  p_day_number INT,
  p_country TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.unmatched_activities (
    activity, package_id, package_title, day_number, country,
    occurrence_count, status, created_at, updated_at
  ) VALUES (
    p_activity, p_package_id, p_package_title, p_day_number, p_country,
    1, 'pending', NOW(), NOW()
  )
  ON CONFLICT (activity) DO UPDATE
    SET occurrence_count = public.unmatched_activities.occurrence_count + 1,
        updated_at       = NOW(),
        package_id       = EXCLUDED.package_id,
        package_title    = EXCLUDED.package_title,
        day_number       = EXCLUDED.day_number,
        country          = COALESCE(EXCLUDED.country, public.unmatched_activities.country);
END;
$$;

-- feedback_postgres_function_revoke_pattern: PUBLIC 명시 REVOKE 필수 (anon/authenticated 은 멤버라 silently no-op)
REVOKE ALL ON FUNCTION public.increment_unmatched_count(TEXT, UUID, TEXT, INT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_unmatched_count(TEXT, UUID, TEXT, INT, TEXT) TO service_role;

COMMENT ON FUNCTION public.increment_unmatched_count IS
  '2026-05-18 박제: unmatched_activities upsert 시 occurrence_count atomic 증가. upload/route.ts 가 호출. RPC 미존재 시 호출 측에서 legacy upsert 로 fallback.';
