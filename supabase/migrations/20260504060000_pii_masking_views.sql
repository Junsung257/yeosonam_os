-- admin_users 테이블에 role 컬럼 추가 (없으면 생성)
ALTER TABLE admin_users
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'cs_agent';
-- role: 'super_admin' | 'cs_agent' | 'marketer' | 'finance'
COMMENT ON COLUMN admin_users.role IS 'RBAC 역할. super_admin만 PII 원본 조회 가능';

-- PII 마스킹 뷰 (CS 에이전트용 — 전화번호 뒷 4자리 마스킹)
CREATE OR REPLACE VIEW customers_masked AS
SELECT
  id,
  name,
  email,
  REGEXP_REPLACE(phone, '(\d{3,4})-?(\d{4})$', '****-****') AS phone,
  grade,
  total_spent,
  created_at
FROM customers;
COMMENT ON VIEW customers_masked IS 'CS 에이전트용 PII 마스킹 뷰. 전화번호 뒷자리 마스킹';
