-- affiliate_applications 에 has_invite_code 컬럼 추가
ALTER TABLE affiliate_applications
  ADD COLUMN IF NOT EXISTS has_invite_code BOOLEAN NOT NULL DEFAULT false;
