-- ============================================================================
-- Data Intelligence Phase 1 — Critique & Response Quality 영속화
-- ============================================================================
-- 목적:
--   - QA·자비스 응답에 대한 critic 결과를 적재 (현재는 console.warn만)
--   - 어드민·고객 피드백(up/down rating) 영속화
--   - AI 응답 정정 메모리 (Reflexion 일반화) — extractions_corrections 의 응답 버전
-- ============================================================================

-- ─── critique_results: 모든 LLM 응답에 대한 critic 평가 ──────────────────
CREATE TABLE IF NOT EXISTS critique_results (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  source          TEXT NOT NULL CHECK (source IN (
                    'qa_chat', 'jarvis_v1', 'jarvis_v2',
                    'card_news', 'blog', 'free_travel', 'other'
                  )),
  session_id      UUID,
  conversation_id UUID,
  trace_id        UUID,
  agent_task_id   UUID,
  tenant_id       UUID,
  affiliate_id    UUID REFERENCES affiliates(id) ON DELETE SET NULL,
  llm_provider    TEXT,
  llm_model       TEXT,
  severity        TEXT NOT NULL CHECK (severity IN ('ok','warn','block')),
  issues          TEXT[] DEFAULT '{}',
  user_question_sha256 CHAR(64),
  reply_sha256    CHAR(64),
  reply_redacted  TEXT,
  corrected_reply_redacted TEXT,
  was_gated       BOOLEAN NOT NULL DEFAULT FALSE,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_critique_results_source_created
  ON critique_results(source, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_critique_results_severity
  ON critique_results(severity, created_at DESC)
  WHERE severity != 'ok';
CREATE INDEX IF NOT EXISTS idx_critique_results_session
  ON critique_results(session_id)
  WHERE session_id IS NOT NULL;

COMMENT ON TABLE critique_results IS
  'AI 응답 품질 평가 결과. critic 호출 직후 fire-and-forget INSERT. 학습 신호 + 운영 모니터링.';

-- ─── response_feedback: 사용자·어드민의 응답 평가 (up/down rating) ──────
CREATE TABLE IF NOT EXISTS response_feedback (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  source          TEXT NOT NULL CHECK (source IN (
                    'qa_chat', 'jarvis_v1', 'jarvis_v2', 'card_news', 'blog', 'other'
                  )),
  session_id      UUID,
  conversation_id UUID,
  reply_sha256    CHAR(64),
  rating          SMALLINT NOT NULL CHECK (rating BETWEEN -1 AND 1),  -- -1 down / 0 neutral / 1 up
  rater_type      TEXT NOT NULL CHECK (rater_type IN ('customer','admin','partner','auto_critic')),
  rater_id        TEXT,
  reason_category TEXT CHECK (reason_category IS NULL OR reason_category IN (
                    'hallucination',         -- 환각/거짓
                    'irrelevant',            -- 질문과 무관
                    'wrong_price',           -- 가격 오류
                    'wrong_recommendation',  -- 추천 부적절
                    'tone_issue',            -- 톤 문제
                    'too_long',              -- 너무 길음
                    'too_short',             -- 너무 짧음
                    'great_match',           -- 잘 맞음 (positive)
                    'great_tone',            -- 톤 좋음 (positive)
                    'other'
                  )),
  comment         TEXT,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_response_feedback_source_rating
  ON response_feedback(source, rating, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_response_feedback_session
  ON response_feedback(session_id)
  WHERE session_id IS NOT NULL;

-- ─── response_corrections: 응답에 대한 학습 가능한 정정 메모리 ─────────────
-- (extractions_corrections 의 응답 버전 — QA·자비스 양쪽에 주입)
CREATE TABLE IF NOT EXISTS response_corrections (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  source          TEXT NOT NULL,
  scope_destination TEXT,                          -- 목적지(다낭 등) — 없으면 글로벌
  scope_tenant_id UUID,                            -- 테넌트 격리
  scope_affiliate_id UUID REFERENCES affiliates(id) ON DELETE SET NULL,
  pattern         TEXT NOT NULL,                   -- 패턴 (한 줄 lesson)
  bad_example     TEXT,                            -- ❌ 이렇게 답하지 말 것
  good_example    TEXT,                            -- ✅ 이렇게 답할 것
  severity        TEXT NOT NULL DEFAULT 'warn' CHECK (severity IN ('info','warn','block')),
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  applied_count   INTEGER NOT NULL DEFAULT 0,
  last_applied_at TIMESTAMPTZ,
  created_by      TEXT,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_response_corrections_active
  ON response_corrections(source, scope_destination)
  WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_response_corrections_tenant
  ON response_corrections(scope_tenant_id)
  WHERE scope_tenant_id IS NOT NULL;

COMMENT ON TABLE response_corrections IS
  '응답 정정 메모리(Reflexion 일반화). QA·자비스 양쪽 프롬프트에 우선순위(tenant+dest>dest>global) 주입.';
