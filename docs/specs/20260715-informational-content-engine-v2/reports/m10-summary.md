# 정보성 콘텐츠 엔진 V2 — M10 평가 요약

- 결과: PASS (11/11)
- 실행 범위: 고정 fixture/draft 전용
- 외부 API 호출: 0회
- 공개/운영 데이터 변경: 0건

| 샘플 | 의도 | 필수 내용 | 근거/claim | 중복 | 관련 글 | CTA | 렌더 | 발행 상태 | 결과 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 삿포로 식비 | PASS | PASS | PASS/PASS | PASS | PASS | PASS | PASS | published | PASS |
| 광저우 월별 날씨 | PASS | PASS | PASS/PASS | PASS | PASS | PASS | PASS | published | PASS |
| 오사카 공항 이동 | PASS | PASS | PASS/PASS | PASS | PASS | PASS | PASS | published | PASS |
| 대만 숙소 지역 | PASS | PASS | PASS/PASS | PASS | PASS | PASS | PASS | published | PASS |
| 싱가포르 가족 예산 | PASS | PASS | PASS/PASS | PASS | PASS | PASS | PASS | published | PASS |
| 입국·비자 고위험 | PASS | PASS | PASS/EXPECTED_BLOCK | PASS | PASS | PASS | PASS | pending_review | PASS |
| 보험 고위험 | PASS | PASS | PASS/EXPECTED_BLOCK | PASS | PASS | PASS | PASS | pending_review | PASS |
| 잘못된 목적지 slug | EXPECTED_BLOCK | SKIPPED | SKIPPED/SKIPPED | SKIPPED | SKIPPED | SKIPPED | SKIPPED | blocked_plan | PASS |
| 동일 destination+intent 중복 생성 | PASS | PASS | PASS/PASS | EXPECTED_BLOCK | PASS | PASS | PASS | update_existing | PASS |
| URL 미설정 CTA | PASS | PASS | PASS/PASS | PASS | PASS | PASS | PASS | published | PASS |
| URL 설정 CTA | PASS | PASS | PASS/PASS | PASS | PASS | PASS | PASS | published | PASS |

> 이 보고서는 운영 글을 생성·수정·발행하지 않습니다. 모든 샘플은 메모리 내 fixture로만 평가했습니다.
