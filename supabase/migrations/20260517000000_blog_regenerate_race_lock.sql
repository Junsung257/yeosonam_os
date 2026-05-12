-- ============================================================
-- blog_regenerate_log 동시 실행 race lock
--
-- Why: /api/cron/blog-regenerate-zero-click 가 cooldown 7일 체크 후
--      INSERT 까지 atomic 하지 않아, 동일 slug 를 두 인스턴스가 동시에
--      재생성하면 LLM 호출 비용이 2배로 발생하고 같은 본문이 2회 저장됨.
--
-- 방어: 같은 (slug, UTC-day) 가 reason='zero_click' 행에 대해 partial UNIQUE.
--      LLM 호출 *직전* sentinel INSERT 가 race lock 역할.
--      두 번째 인스턴스의 INSERT 는 23505 UNIQUE 위반으로 즉시 reject 됨.
--
-- 구현 메모:
--   - timestamptz → date 캐스트나 extract(epoch from timestamptz) 는 PG17 에서도
--     IMMUTABLE 로 인정되지 않아 generated stored / 표현식 인덱스로 못 만든다.
--   - 그래서 일반 컬럼 created_day_utc 를 두고 application(cron) 이
--     Math.floor(Date.now()/86400000) 으로 채운다 (UTC epoch-day 정수).
--   - 다른 reason ('manual','rank_drop','quality_gate_fail') 은 의도된 다중
--     호출이 있을 수 있으므로 partial WHERE 로 zero_click 만 강제한다.
-- ============================================================

BEGIN;

ALTER TABLE blog_regenerate_log
  ADD COLUMN IF NOT EXISTS created_day_utc BIGINT;

-- 기존 행 backfill — created_at 기반
UPDATE blog_regenerate_log
  SET created_day_utc = (EXTRACT(EPOCH FROM created_at)::BIGINT / 86400)
  WHERE created_day_utc IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS blog_regenerate_log_zero_click_daily_unique
  ON blog_regenerate_log (slug, created_day_utc)
  WHERE reason = 'zero_click';

COMMENT ON COLUMN blog_regenerate_log.created_day_utc IS 'UTC epoch-day integer (Math.floor(Date.now()/86400000)) — race lock UNIQUE 인덱스용. cron 이 sentinel INSERT 시 채움.';

COMMIT;
