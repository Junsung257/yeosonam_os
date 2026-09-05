-- Database Performance Indices — Phase 2 Optimization (Sprint 1 + 2)
-- N+1 쿼리 방지 및 Hot Path 최적화용 인덱스

-- 1. bookings 테이블 — 자주 사용되는 필터링
CREATE INDEX IF NOT EXISTS idx_bookings_lead_customer_id_status
  ON bookings(lead_customer_id, status)
  WHERE is_deleted IS NULL;

CREATE INDEX IF NOT EXISTS idx_bookings_affiliate_id_created
  ON bookings(affiliate_id, created_at DESC)
  WHERE is_deleted IS NULL;

CREATE INDEX IF NOT EXISTS idx_bookings_status_departure_date
  ON bookings(status, departure_date DESC)
  WHERE is_deleted IS NULL;

-- 2. customers 테이블 — 검색 및 필터링 최적화
CREATE INDEX IF NOT EXISTS idx_customers_phone
  ON customers(phone)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_customers_grade_created
  ON customers(grade, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_customers_name_trgm
  ON customers USING GIN(name gin_trgm_ops)
  WHERE deleted_at IS NULL;

-- 3. message_logs 테이블 — booking 타임라인 조회
CREATE INDEX IF NOT EXISTS idx_message_logs_booking_created
  ON message_logs(booking_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_message_logs_event_type_booking
  ON message_logs(event_type, booking_id)
  WHERE event_type IN ('DEPOSIT_CONFIRMED', 'CANCELLATION');

-- 4. bank_transactions 테이블 — 입출금 매칭 및 조회
CREATE INDEX IF NOT EXISTS idx_bank_transactions_booking_id_match_status
  ON bank_transactions(booking_id, match_status)
  WHERE status != 'excluded';

CREATE INDEX IF NOT EXISTS idx_bank_transactions_received_status
  ON bank_transactions(received_at DESC, status)
  WHERE status != 'excluded';

CREATE INDEX IF NOT EXISTS idx_bank_transactions_amount_range
  ON bank_transactions(amount, received_at DESC)
  WHERE status != 'excluded' AND match_status = 'unmatched';

-- 5. conversations 테이블 — 사용자별 대화 조회
CREATE INDEX IF NOT EXISTS idx_conversations_customer_created
  ON conversations(customer_id, created_at DESC);

-- 6. secure_chats 테이블 — 예약별 채팅 조회
CREATE INDEX IF NOT EXISTS idx_secure_chats_booking_id_created
  ON secure_chats(booking_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_secure_chats_is_unmasked
  ON secure_chats(booking_id, is_unmasked)
  WHERE is_unmasked = false;

-- 7. settlements 테이블 — 정산 상태별 조회
CREATE INDEX IF NOT EXISTS idx_settlements_tenant_status
  ON settlements(tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_settlements_period_status
  ON settlements(settlement_period, status)
  WHERE status IN ('PENDING', 'READY');

-- 8. affiliates 테이블 — 활동 어필리에이트 조회
CREATE INDEX IF NOT EXISTS idx_affiliates_is_active_created
  ON affiliates(is_active, created_at DESC)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_affiliates_referral_code
  ON affiliates(referral_code);

-- 9. booking_companions 테이블 — 동행자 조회
CREATE INDEX IF NOT EXISTS idx_booking_companions_booking_id
  ON booking_companions(booking_id);

-- 10. product_reviews: legacy/manual installations only.
DO $$
BEGIN
  IF to_regclass('public.product_reviews') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_product_reviews_product_id_rating
      ON public.product_reviews(product_id, rating DESC)
      WHERE is_verified = true';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_product_reviews_created_recent
      ON public.product_reviews(created_at DESC)
      WHERE is_verified = true';
  END IF;
END;
$$;

-- 11. card_news 테이블 — 발행 상태별 조회 및 검색
CREATE INDEX IF NOT EXISTS idx_card_news_status_created
  ON card_news(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_card_news_package_id_status
  ON card_news(package_id, status);

-- 12. blog_posts 테이블 — SEO 및 발행 최적화
DO $$
BEGIN
  IF to_regclass('public.blog_posts') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_blog_posts_published_rank
      ON public.blog_posts(published_at DESC, serp_rank DESC)
      WHERE is_published = true';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_blog_posts_destination_published
      ON public.blog_posts(destination, published_at DESC)
      WHERE is_published = true';
  END IF;
END;
$$;

-- 13. influencer_links 테이블 — 클릭 및 전환 추적
CREATE INDEX IF NOT EXISTS idx_influencer_links_affiliate_click_count
  ON influencer_links(affiliate_id, click_count DESC);

-- 14. free_travel_plans 테이블 — 사용자별 플랜 조회
DO $$
BEGIN
  IF to_regclass('public.free_travel_plans') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_free_travel_plans_user_created
      ON public.free_travel_plans(user_id, created_at DESC)
      WHERE is_deleted IS NULL';
  END IF;
END;
$$;

-- 15. llm_prompts 테이블 — 프롬프트 조회 최적화
CREATE INDEX IF NOT EXISTS idx_llm_prompts_task_type_active
  ON llm_prompts(task_type, is_active)
  WHERE is_active = true;

-- Analytics: 인덱스 상태 확인용 쿼리
-- SELECT schemaname, tablename, indexname, idx_scan
-- FROM pg_stat_user_indexes
-- ORDER BY idx_scan DESC LIMIT 20;
