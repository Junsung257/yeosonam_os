ALTER TABLE affiliates
  ADD COLUMN IF NOT EXISTS landing_video_url TEXT;

COMMENT ON COLUMN affiliates.landing_video_url IS
'코브랜딩 랜딩 상단 임베드용 원본 영상 URL (현재 YouTube URL만 허용)';
