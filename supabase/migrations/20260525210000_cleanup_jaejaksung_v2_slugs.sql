-- ============================================================
-- content_creatives slug 정리: '재작성 v2' 접미사 제거
-- 
-- blog_topic_queue에 topic이 "— 재작성 v2" 접미사가 포함된 채로
-- 저장되면서 slug에도 "재작성-v2"가 붙어 SEO에 악영향을 줌.
-- 이제는 생성 시 slug에서 접미사를 제거하도록 코드 수정했으나
-- 기존 발행된 글의 slug는 정리 필요함.
-- ============================================================

-- 1) content_creatives — slug에서 '재작성-v2' 제거
UPDATE content_creatives
SET slug = regexp_replace(slug, '[\s\-–—]*재작성-v\d+', '', 'g')
WHERE slug ~ '재작성-v\d';

-- 2) content_creatives — title (seo_title)에서도 제거
UPDATE content_creatives
SET title = regexp_replace(title, '[\s\-–—]*재작성\s*v\d+', '', 'g')
WHERE title ~ '재작성\s*v\d';

-- 3) blog_topic_queue — 이미 queued 상태인 topic에서도 제거 (queue에 아직 있는 항목)
UPDATE blog_topic_queue
SET topic = regexp_replace(topic, '[\s\-–—]*재작성\s*v\d+', '', 'g')
WHERE status = 'queued'
  AND topic ~ '재작성\s*v\d';

-- 4) blog_topic_queue — meta.original_title도 같이 정리
UPDATE blog_topic_queue
SET meta = (
  SELECT jsonb_set(meta, '{original_title}', to_jsonb(regexp_replace(meta->>'original_title', '[\s\-–—]*재작성\s*v\d+', '', 'g')))
  WHERE meta ? 'original_title'
)
WHERE status = 'queued'
  AND meta ? 'original_title'
  AND meta->>'original_title' ~ '재작성\s*v\d';
