-- ────────────────────────────────────────────────────────────────────────────
-- llm_semantic_cache (P1-1, GPTCache 패턴, arXiv:2306.13782)
--   동일 의미 LLM 쿼리 → cosine ≥ threshold 일 때 LLM 호출 없이 캐시 응답.
--   DeepSeek context cache 는 prefix 캐시(input 90% 할인)지만 응답은 재생성됨.
--   이 캐시는 응답 자체를 0-token 으로 반환 → 완전 무료.
--
--   적용 대상: src/lib/semantic-cache.ts SAFE_CACHE_TASKS 화이트리스트
--   PII/가격/날짜 변동 task 는 자동 우회.
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.llm_semantic_cache (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task        text NOT NULL,
  prompt_hash text NOT NULL,
  prompt_emb  extensions.vector(1536) NOT NULL,
  prompt_text text NOT NULL,
  response    text NOT NULL,
  metadata    jsonb DEFAULT '{}'::jsonb,
  hit_count   int  DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  CONSTRAINT llm_semantic_cache_task_check CHECK (length(task) <= 64),
  CONSTRAINT llm_semantic_cache_response_check CHECK (length(response) <= 64000)
);

CREATE INDEX IF NOT EXISTS llm_semantic_cache_emb_hnsw
  ON public.llm_semantic_cache
  USING hnsw (prompt_emb extensions.vector_cosine_ops)
  WITH (m=16, ef_construction=64);

CREATE INDEX IF NOT EXISTS llm_semantic_cache_task_expires
  ON public.llm_semantic_cache (task, expires_at);

CREATE INDEX IF NOT EXISTS llm_semantic_cache_task_hash
  ON public.llm_semantic_cache (task, prompt_hash);

CREATE OR REPLACE FUNCTION public.lookup_semantic_cache(
  p_task text,
  p_prompt_hash text,
  p_query_emb extensions.vector(1536),
  p_threshold double precision DEFAULT 0.97
)
RETURNS TABLE (
  id uuid,
  response text,
  similarity double precision,
  hit_type text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  RETURN QUERY
  SELECT c.id, c.response, 1.0::double precision, 'exact'::text
  FROM public.llm_semantic_cache c
  WHERE c.task = p_task AND c.prompt_hash = p_prompt_hash AND c.expires_at > now()
  LIMIT 1;
  IF FOUND THEN RETURN; END IF;

  RETURN QUERY
  SELECT
    c.id,
    c.response,
    (1 - (c.prompt_emb <=> p_query_emb))::double precision AS similarity,
    'semantic'::text AS hit_type
  FROM public.llm_semantic_cache c
  WHERE c.task = p_task
    AND c.expires_at > now()
    AND (1 - (c.prompt_emb <=> p_query_emb)) >= p_threshold
  ORDER BY c.prompt_emb <=> p_query_emb ASC
  LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.lookup_semantic_cache(text, text, extensions.vector, double precision) TO service_role;

CREATE OR REPLACE FUNCTION public.increment_semantic_cache_hit(p_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.llm_semantic_cache SET hit_count = hit_count + 1 WHERE id = p_id;
$$;

GRANT EXECUTE ON FUNCTION public.increment_semantic_cache_hit(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.cleanup_expired_semantic_cache()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE deleted int;
BEGIN
  DELETE FROM public.llm_semantic_cache WHERE expires_at < now();
  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN deleted;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cleanup_expired_semantic_cache() TO service_role;

DO $$
BEGIN
  PERFORM cron.unschedule('cleanup-llm-semantic-cache');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'cleanup-llm-semantic-cache',
  '0 18 * * *',
  $cron$ SELECT public.cleanup_expired_semantic_cache(); $cron$
);

ALTER TABLE public.llm_semantic_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS llm_semantic_cache_service_only ON public.llm_semantic_cache;
CREATE POLICY llm_semantic_cache_service_only ON public.llm_semantic_cache
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

COMMENT ON TABLE public.llm_semantic_cache IS
  'GPTCache 패턴 의미 기반 LLM 응답 캐시. arXiv:2306.13782. 안전 task 화이트리스트만 사용.';
