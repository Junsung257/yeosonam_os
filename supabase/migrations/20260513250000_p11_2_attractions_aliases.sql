-- P11-2: attractions alias 자동 학습 테이블
-- 박제일: 2026-05-13

CREATE TABLE IF NOT EXISTS attractions_aliases (
  id              bigserial PRIMARY KEY,
  canonical_name  text NOT NULL,
  alias           text NOT NULL,
  destination     text,
  confidence      numeric(4,3) DEFAULT 0.85,
  source          text DEFAULT 'manual' CHECK (source IN ('manual','reflexion','llm_suggest')),
  occurrence_count int DEFAULT 1,
  last_used_at    timestamptz DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (canonical_name, alias)
);

CREATE INDEX IF NOT EXISTS idx_attractions_aliases_canonical ON attractions_aliases(canonical_name);
CREATE INDEX IF NOT EXISTS idx_attractions_aliases_alias ON attractions_aliases(alias);
CREATE INDEX IF NOT EXISTS idx_attractions_aliases_destination ON attractions_aliases(destination) WHERE destination IS NOT NULL;
