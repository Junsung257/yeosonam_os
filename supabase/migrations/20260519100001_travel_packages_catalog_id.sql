-- ═══════════════════════════════════════════════════════════════════════════
-- 2026-05-19 박제 (P2-A): travel_packages.catalog_id 컴럼 추가
--
-- 사고 배경:
--   /admin/upload 가 1 카탈로그 → N 패키지 분리 INSERT 했어도 패키지 간 관계
--   정보가 DB에 박히지 않음. 모바일에서 같은 카탈로그 패키지(예: [BX] 대만 단수이/
--   베이토우/우라이 3 상품)를 그룹핑 표시할 방법 0.
--
-- 변경:
--   - travel_packages.catalog_id UUID (NULL 허용 — 단일 상품은 NULL)
--   - 같은 catalog_id = 같은 원본 파일/텍스트에서 분리된 N 패키지
--   - index 박아서 그룹 조회 성능 보장
--
-- 호환성:
--   - 기존 1상품 INSERT 는 catalog_id=NULL (그룹 없음)
--   - 새 N상품 INSERT 시 upload/route.ts 가 동일 UUID 생성 후 모든 sub-package 에 박음
--   - 추후 어드민/모바일 UI 에서 같은 catalog_id 그룹 표시 (별도 PR)
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.travel_packages
  ADD COLUMN IF NOT EXISTS catalog_id UUID;

CREATE INDEX IF NOT EXISTS idx_travel_packages_catalog_id
  ON public.travel_packages (catalog_id)
  WHERE catalog_id IS NOT NULL;

COMMENT ON COLUMN public.travel_packages.catalog_id IS
  '2026-05-19 박제 (P2-A): 같은 카탈로그에서 분리된 N 패키지 그룹 ID. UUID 자동 생성. 단일 상품은 NULL.';
