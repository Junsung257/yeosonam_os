-- card_news 상태에 RENDERING 추가
-- RENDERING: render-v2 진행 중. 완료 시 자동으로 CONFIRMED 전환.
-- blog_topic_queue는 CONFIRMED 전환 후 삽입되므로 race condition 방어.
ALTER TABLE card_news
  DROP CONSTRAINT IF EXISTS card_news_status_check;

ALTER TABLE card_news
  ADD CONSTRAINT card_news_status_check
  CHECK (status IN ('DRAFT','RENDERING','CONFIRMED','LAUNCHED','ARCHIVED'));
