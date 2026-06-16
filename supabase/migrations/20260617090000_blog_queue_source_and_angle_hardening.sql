-- Keep blog queue sources aligned with every live producer.
-- Producers may keep their raw angle/source context in meta, but queue rows must
-- use values that downstream publisher and content_creatives can persist.

BEGIN;

ALTER TABLE public.blog_topic_queue DROP CONSTRAINT IF EXISTS blog_topic_queue_source_check;
ALTER TABLE public.blog_topic_queue ADD CONSTRAINT blog_topic_queue_source_check
  CHECK (source IN (
    'seasonal',
    'coverage_gap',
    'user_seed',
    'product',
    'trend',
    'pillar',
    'card_news',
    'programmatic_seo',
    'auto_heal',
    'gsc_longtail'
  ));

UPDATE public.blog_topic_queue
SET
  meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object('raw_angle_type', angle_type),
  angle_type = 'value',
  updated_at = NOW()
WHERE angle_type IS NOT NULL
  AND angle_type NOT IN ('value', 'emotional', 'filial', 'luxury', 'urgency', 'activity', 'food');

COMMIT;
