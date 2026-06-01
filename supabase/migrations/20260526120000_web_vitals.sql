-- Web Vitals 실제 사용자 측정 수집
-- LCP/CLS/INP/FCP/TTFB 저장 + 알림 cooldown
-- Speed Insights 대신 admin 대시보드에서 직접 확인 가능

CREATE TABLE IF NOT EXISTS web_vitals (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL CHECK (name IN ('LCP','CLS','INP','FCP','TTFB')),
  value numeric NOT NULL,
  rating text NOT NULL CHECK (rating IN ('good','needs-improvement','poor')),
  path text NOT NULL,
  slug text,
  page_type text NOT NULL DEFAULT 'page',
  timestamp timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 빠른 조회: 메트릭별 최근 7일
CREATE INDEX IF NOT EXISTS idx_web_vitals_name_created ON web_vitals (name, created_at DESC);
-- 페이지별 필터
CREATE INDEX IF NOT EXISTS idx_web_vitals_path ON web_vitals (path);
-- 페이지타입별 집계
CREATE INDEX IF NOT EXISTS idx_web_vitals_page_type ON web_vitals (page_type);

-- 알림 cooldown 테이블 (unique constraint로 1시간 간격 강제)
CREATE TABLE IF NOT EXISTS web_vital_alerts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL,
  value numeric NOT NULL,
  path text NOT NULL,
  rating text NOT NULL,
  alert_hour timestamptz NOT NULL DEFAULT date_trunc('hour', now()),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 동일 메트릭 + 동일 경로는 1시간 내 재알림 금지
CREATE UNIQUE INDEX IF NOT EXISTS idx_web_vital_alerts_dedup
  ON web_vital_alerts (name, path, alert_hour);

-- 관리자 RLS: authenticated만 읽기/쓰기
ALTER TABLE web_vitals ENABLE ROW LEVEL SECURITY;
ALTER TABLE web_vital_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "web_vitals_authenticated_all" ON web_vitals
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "web_vital_alerts_authenticated_all" ON web_vital_alerts
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 서비스 롤(익명 브라우저)은 INSERT만 허용
CREATE POLICY "web_vitals_anon_insert" ON web_vitals
  FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "web_vital_alerts_anon_insert" ON web_vital_alerts
  FOR INSERT TO anon WITH CHECK (true);
