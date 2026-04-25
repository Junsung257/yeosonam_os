-- @ts-nocheck
-- 20260427100000_card_news_html_mode.sql
--
-- 카드뉴스 HTML 모드 (Claude Sonnet 4.6 + Puppeteer) 지원을 위한 컬럼 추가.
-- 기존 V2 (Satori) 파이프라인과 병행. mode 구분은 template_version 컬럼 활용 ('html-v1').

ALTER TABLE card_news
  ADD COLUMN IF NOT EXISTS html_raw TEXT,
  ADD COLUMN IF NOT EXISTS html_generated TEXT,
  ADD COLUMN IF NOT EXISTS html_thinking TEXT,
  ADD COLUMN IF NOT EXISTS html_usage JSONB;

COMMENT ON COLUMN card_news.html_raw IS 'HTML 모드 입력 원문 텍스트 (Claude 생성 트레이서)';
COMMENT ON COLUMN card_news.html_generated IS 'Claude Sonnet 4.6 이 생성한 6장 carousel HTML 풀 코드';
COMMENT ON COLUMN card_news.html_thinking IS 'Claude Extended Thinking 트레이스 (디버그·분석용)';
COMMENT ON COLUMN card_news.html_usage IS 'Anthropic API 토큰 사용 + 비용 기록 ({input_tokens, output_tokens, cache_*, costUsd})';
