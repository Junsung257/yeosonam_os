-- ═══════════════════════════════════════════════════════════════════════════
-- LLM Prompt Registry — 코드 배포 없이 프롬프트 관리
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS llm_prompts (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  key         text NOT NULL,
  body        text NOT NULL,
  version     integer NOT NULL DEFAULT 1,
  is_active   boolean NOT NULL DEFAULT true,
  task_type   text,
  metadata    jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  text,
  change_note text
);

CREATE UNIQUE INDEX IF NOT EXISTS llm_prompts_key_version_idx
  ON llm_prompts (key, version);

CREATE INDEX IF NOT EXISTS llm_prompts_key_active_idx
  ON llm_prompts (key, is_active)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS llm_prompts_key_version_desc_idx
  ON llm_prompts (key, version DESC);

ALTER TABLE llm_prompts ENABLE ROW LEVEL SECURITY;

CREATE POLICY llm_prompts_service_all ON llm_prompts
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY llm_prompts_anon_read ON llm_prompts
  FOR SELECT TO anon USING (true);

-- ── 롤백 헬퍼: 특정 key를 지정 version 내용으로 새 버전 생성 (원자 트랜잭션)
CREATE OR REPLACE FUNCTION rollback_prompt(
  p_key     text,
  p_version integer,
  p_by      text DEFAULT 'admin'
)
RETURNS json
LANGUAGE plpgsql
AS $$
DECLARE
  v_target  llm_prompts%ROWTYPE;
  v_new_ver integer;
BEGIN
  SELECT * INTO v_target
  FROM llm_prompts
  WHERE key = p_key AND version = p_version;

  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'version not found');
  END IF;

  UPDATE llm_prompts
  SET is_active = false
  WHERE key = p_key AND is_active = true;

  SELECT COALESCE(MAX(version), 0) + 1 INTO v_new_ver
  FROM llm_prompts WHERE key = p_key;

  INSERT INTO llm_prompts (key, body, version, is_active, task_type, metadata, created_by, change_note)
  VALUES (
    p_key,
    v_target.body,
    v_new_ver,
    true,
    v_target.task_type,
    v_target.metadata,
    p_by,
    format('롤백: v%s → v%s', p_version, v_new_ver)
  );

  RETURN json_build_object('ok', true, 'new_version', v_new_ver);
END;
$$;
