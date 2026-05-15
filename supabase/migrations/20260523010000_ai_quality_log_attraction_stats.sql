-- ai_quality_log 에 관광지 매칭 통계 4종 추가 (2026-05-15)
-- 사장님 비전: "키워드 솔팅 성공률" 시각 검증
-- Same-Session Seed-Reflect 결과 + extractedCandidate 매칭률 추적

ALTER TABLE public.ai_quality_log
  ADD COLUMN IF NOT EXISTS attraction_matched_count   integer,
  ADD COLUMN IF NOT EXISTS attraction_unmatched_count integer,
  ADD COLUMN IF NOT EXISTS attraction_seeded_count    integer,
  ADD COLUMN IF NOT EXISTS attraction_reflected_count integer;

COMMENT ON COLUMN public.ai_quality_log.attraction_matched_count IS
'enrichItineraryWithAttractionReferences 매칭 성공 canonical 개수 (등록 시점)';
COMMENT ON COLUMN public.ai_quality_log.attraction_unmatched_count IS
'extractAttractionCandidates 추출했지만 매칭 안 된 활동 개수 (검수 큐)';
COMMENT ON COLUMN public.ai_quality_log.attraction_seeded_count IS
'autoSeedAttraction 으로 Wikidata + paraphrase 통과해 자동 시드된 신규 attraction 개수';
COMMENT ON COLUMN public.ai_quality_log.attraction_reflected_count IS
'Same-Session Seed-Reflect 로 같은 등록의 itinerary_data 에 즉시 반영된 patch 개수';
