-- ============================================================
-- JARVIS AI 시스템 DB 마이그레이션
-- Supabase SQL Editor에서 실행할 것
-- ============================================================

-- 1. 자비스 대화 세션 테이블
CREATE TABLE IF NOT EXISTS jarvis_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,                  -- auth.users 또는 user_profiles 참조 (FK 없이 유연하게)
  messages JSONB DEFAULT '[]',   -- {role, content, agent, tools_used, timestamp}
  context JSONB DEFAULT '{}',    -- 대화 중 누적된 컨텍스트 (고객명, 예약번호 등)
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_jarvis_sessions_user ON jarvis_sessions(user_id, created_at DESC);

-- 2. Human-in-the-Loop 승인 대기 테이블
CREATE TABLE IF NOT EXISTS jarvis_pending_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES jarvis_sessions(id) ON DELETE CASCADE,
  agent_type TEXT NOT NULL,       -- operations, finance, marketing 등
  tool_name TEXT NOT NULL,        -- create_booking, create_settlement 등
  tool_args JSONB NOT NULL,       -- 실행할 파라미터
  description TEXT NOT NULL,      -- 사람이 읽을 수 있는 설명
  risk_level TEXT DEFAULT 'medium' CHECK (risk_level IN ('low','medium','high')),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  approved_by UUID,              -- 승인자 ID
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_jarvis_pending_session ON jarvis_pending_actions(session_id, status);

-- 3. 카카오 인바운드 메시지 테이블
CREATE TABLE IF NOT EXISTS kakao_inbound (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kakao_user_id TEXT NOT NULL,    -- 카카오 사용자 식별자
  customer_id UUID,               -- 매칭된 고객 (customers 테이블 존재 시 참조)
  message TEXT NOT NULL,
  message_type TEXT DEFAULT 'text',  -- text, image, file
  attachments JSONB DEFAULT '[]',
  is_processed BOOLEAN DEFAULT FALSE,  -- 자비스가 처리했는지
  jarvis_session_id UUID REFERENCES jarvis_sessions(id),
  received_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_kakao_inbound_unprocessed ON kakao_inbound(is_processed, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_kakao_inbound_user ON kakao_inbound(kakao_user_id, received_at DESC);

-- 4. 자비스 Tool 실행 로그 (audit_logs 보조)
CREATE TABLE IF NOT EXISTS jarvis_tool_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES jarvis_sessions(id),
  agent_type TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  tool_args JSONB,
  result JSONB,
  is_hitl BOOLEAN DEFAULT FALSE,   -- HITL 거쳤는지
  pending_action_id UUID REFERENCES jarvis_pending_actions(id),
  executed_at TIMESTAMPTZ DEFAULT now(),
  duration_ms INTEGER
);

-- 확인 쿼리 (실행 후 아래를 돌려서 4개 나오면 정상)
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public'
-- AND table_name IN ('jarvis_sessions','jarvis_pending_actions','kakao_inbound','jarvis_tool_logs');
