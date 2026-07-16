-- llm_prompts anon SELECT 정책 제거 — 시스템 프롬프트 내용 외부 노출 방지
-- 프롬프트 조회는 service_role(서버)만 가능해야 함

DROP POLICY IF EXISTS llm_prompts_anon_read ON llm_prompts;
