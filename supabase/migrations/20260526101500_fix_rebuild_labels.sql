-- Remove legacy "재작성 vN" labels from blog identifiers and SEO titles.

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

UPDATE public.content_creatives
SET slug = regexp_replace(slug, '[\s\-–—]*재작성\s*v\d+', '', 'g'),
    seo_title = regexp_replace(seo_title, '[\s\-–—]*재작성\s*v\d+', '', 'g')
WHERE slug ~ '재작성\s*v\d+'
   OR seo_title ~ '재작성\s*v\d+';

UPDATE public.blog_topic_queue
SET topic = regexp_replace(topic, '[\s\-–—]*재작성\s*v\d+', '', 'g')
WHERE status IN ('queued', 'processing')
  AND topic ~ '재작성\s*v\d+';
