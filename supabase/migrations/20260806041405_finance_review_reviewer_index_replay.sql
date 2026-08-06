-- The same index was created concurrently and verified valid on production
-- before this replay-safe migration was recorded.
CREATE INDEX IF NOT EXISTS idx_booking_settlement_reviews_reviewed_by
  ON public.booking_settlement_reviews(reviewed_by);
