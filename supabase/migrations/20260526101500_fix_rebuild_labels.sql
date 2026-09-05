-- ============================================================
-- 블로그 제목에서 '재작성 v2' 라벨 정리
-- ============================================================

-- 1) blog_posts — legacy/manual installations only
DO $$
BEGIN
  IF to_regclass('public.blog_posts') IS NOT NULL THEN
    EXECUTE $cleanup$
      UPDATE public.blog_posts
      SET title = regexp_replace(title, '[\s\-–—]*재작성\s*v\d+', '', 'g')
      WHERE title ~ '재작성\s*v\d+'
    $cleanup$;

    EXECUTE $cleanup$
      UPDATE public.blog_posts
      SET slug = regexp_replace(slug, '[\s\-–—]*재작성\s*v\d+', '', 'g')
      WHERE slug ~ '재작성\s*v\d+'
    $cleanup$;
  END IF;
END;
$$;

-- 3) content_creatives (혹시 누락된 경우)
UPDATE content_creatives
SET slug = regexp_replace(slug, '[\s\-–—]*재작성-v\d+', '', 'g'),
    seo_title = regexp_replace(seo_title, '[\s\-–—]*재작성\s*v\d+', '', 'g')
WHERE slug ~ '재작성\s*v\d+'
   OR seo_title ~ '재작성\s*v\d+';

-- 4) blog_topic_queue (처리 대기 중인 항목)
UPDATE blog_topic_queue
SET topic = regexp_replace(topic, '[\s\-–—]*재작성\s*v\d+', '', 'g')
WHERE status IN ('queued', 'processing')
  AND topic ~ '재작성\s*v\d+';
