-- ============================================================
-- 입출금 채팅식 매칭 — land_operators.aliases 컬럼 추가
-- 마이그레이션: 20260427400000
-- ============================================================
-- 목적
--  사장님이 어드민 ⌘K 에 `260505_남영선_베스트아시아` 한 줄 입력 시,
--  마지막 토큰("베스트아시아")을 land_operators 와 fuzzy 매칭하기 위함.
--  통장 거래자명("(주)베스트투어"/"주식회사투어폰" 등) 표기 변동도 흡수.
-- 정책: project_payment_command_matching.md (출금 자동매칭 절대 금지)
-- ============================================================

BEGIN;

-- 1) aliases 컬럼 추가 (비파괴, IF NOT EXISTS)
ALTER TABLE land_operators
  ADD COLUMN IF NOT EXISTS aliases TEXT[] DEFAULT '{}'::text[];

-- 2) GIN 인덱스 (배열 element 검색 고속화)
CREATE INDEX IF NOT EXISTS idx_land_operators_aliases_gin
  ON land_operators USING GIN (aliases);

COMMENT ON COLUMN land_operators.aliases IS
  '랜드사 약칭 배열. 통장 메모 매칭(payment-command-parser)용. 예: ["(주)베스트투어","베스트투어","베스트아시아"]. 길이 3+ 토큰만.';

-- 3) 기존 행 자동 alias 채우기
--    name 자체 + (주)/주식회사/공백 제거 + 한글만 추출
--    length >= 3 필터 (1~2글자 토큰은 false-positive 방지)
UPDATE land_operators
SET aliases = (
  SELECT array_agg(DISTINCT a)
  FROM (
    SELECT unnest(ARRAY[
      name,
      regexp_replace(name, '\(주\)|주식회사|\s', '', 'g'),
      regexp_replace(name, '[^가-힣]', '', 'g')
    ]) AS a
  ) sub
  WHERE a IS NOT NULL AND length(a) >= 3
)
WHERE aliases IS NULL OR cardinality(aliases) = 0
   OR EXISTS (
     SELECT 1 FROM unnest(aliases) AS x WHERE length(x) < 3
   );

COMMIT;

NOTIFY pgrst, 'reload schema';
