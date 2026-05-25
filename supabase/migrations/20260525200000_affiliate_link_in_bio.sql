/**
 * 어필리에이터 링크인바이오 / 공개 프로필 지원
 *
 * - affiliates 테이블에 bio / profile_image_url / social_links 컬럼 추가
 * - /link/[referral_code] 라우트 지원
 * - /share/card-news/[id] 공유 페이지 지원
 */

-- 1. affiliates 테이블에 프로필 컬럼 추가
ALTER TABLE affiliates
  ADD COLUMN IF NOT EXISTS bio TEXT,
  ADD COLUMN IF NOT EXISTS profile_image_url TEXT,
  ADD COLUMN IF NOT EXISTS social_links JSONB DEFAULT '{}'::jsonb;

-- 2. RLS: 누구나 bio/profile_image_url/social_links 읽기 가능 (공개 정보)
-- (기존 RLS 정책으로 커버되면 스킵)

-- 3. card_news 테이블에 공유용 컬럼 확인
ALTER TABLE card_news
  ADD COLUMN IF NOT EXISTS share_count INTEGER DEFAULT 0;
