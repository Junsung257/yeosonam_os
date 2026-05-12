-- ============================================================================
-- Data Intelligence Phase 2 — Jarvis 누적 학습 메모리
-- ============================================================================
-- 목적:
--   - 자비스 V2 루프가 매번 zero-shot 인 문제 해결
--   - "지난 주 같은 질문에서 틀렸던 패턴" 메모리 주입
--   - 어드민이 같은 결정을 반복하면 학습 (선호도)
-- ============================================================================

-- ─── jarvis_lessons: 실패 교훈 / 정답 패턴 ──────────────────────────────────
CREATE TABLE IF NOT EXISTS jarvis_lessons (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 스코프 (격리)
  tenant_id       UUID,
  agent_type      TEXT,                       -- products / bookings / settlements / etc
  task_pattern    TEXT,                       -- 정규식 또는 키워드 (예: "재고 부족", "환불")
  -- 교훈 본문
  lesson_type     TEXT NOT NULL CHECK (lesson_type IN ('avoid','prefer','clarify')),
  pattern         TEXT NOT NULL,              -- 한 줄 lesson
  bad_action      TEXT,                       -- 하지 말 것
  good_action     TEXT,                       -- 대신 이렇게
  -- 라이프사이클
  severity        TEXT NOT NULL DEFAULT 'warn' CHECK (severity IN ('info','warn','block')),
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  applied_count   INTEGER NOT NULL DEFAULT 0,
  last_applied_at TIMESTAMPTZ,
  source_incident_id UUID,                    -- 어떤 incident로부터 도출됐는지 추적
  created_by      TEXT,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_jarvis_lessons_active
  ON jarvis_lessons(tenant_id, agent_type)
  WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_jarvis_lessons_severity
  ON jarvis_lessons(severity, last_applied_at DESC)
  WHERE is_active = TRUE;

COMMENT ON TABLE jarvis_lessons IS
  '자비스 누적 교훈. V2 루프에서 buildTenantSystemPrompt 후 active lessons 주입.';

-- ─── jarvis_admin_preferences: 어드민 반복 결정 자동 학습 ───────────────────
CREATE TABLE IF NOT EXISTS jarvis_admin_preferences (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id        TEXT NOT NULL,
  preference_key  TEXT NOT NULL,              -- e.g. "default_commission_rate", "preferred_reply_tone"
  preference_value JSONB NOT NULL,
  observed_count  INTEGER NOT NULL DEFAULT 1,
  last_observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (admin_id, preference_key)
);

CREATE INDEX IF NOT EXISTS idx_jarvis_admin_pref_admin
  ON jarvis_admin_preferences(admin_id);

-- ─── qa_negative_examples: 부정 평가된 QA 답변 패턴 (Few-shot negative) ────
CREATE TABLE IF NOT EXISTS qa_negative_examples (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  destination     TEXT,
  question_pattern TEXT,                      -- 짧은 질문 요약 (PII 제외)
  bad_reply_excerpt TEXT NOT NULL,            -- ❌ 이렇게 답하지 말 것 (PII 마스킹된 발췌)
  issue_category  TEXT,
  severity        TEXT NOT NULL DEFAULT 'warn' CHECK (severity IN ('info','warn','block')),
  source_feedback_id UUID REFERENCES response_feedback(id) ON DELETE SET NULL,
  source_critique_id UUID REFERENCES critique_results(id) ON DELETE SET NULL,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  applied_count   INTEGER NOT NULL DEFAULT 0,
  last_applied_at TIMESTAMPTZ,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_qa_neg_active
  ON qa_negative_examples(destination)
  WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_qa_neg_severity
  ON qa_negative_examples(severity, created_at DESC)
  WHERE is_active = TRUE;

COMMENT ON TABLE qa_negative_examples IS
  'QA 부정평가 답변 발췌. QA 챗 생성 시 system prompt 에 "이런 답변 금지" few-shot 으로 주입.';
