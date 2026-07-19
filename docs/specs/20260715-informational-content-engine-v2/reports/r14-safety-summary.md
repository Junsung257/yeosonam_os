# 정보성 콘텐츠 엔진 V2 — R14 실제 경로 안전성 평가

- 결과: PASS (10/10)
- 경로: intent → planner → 구조 계약 → claim/evidence → 관련 글/CTA → 렌더 → 공개 적격성
- 외부 API 호출: 0회
- 공개/운영 데이터 변경: 0건

| 샘플 | 라벨만 차단 | 구조 | 근거 없는 수치 | claim | 관련 글/CTA | 렌더 | 공개 적격성 | 발행 상태 | 결과 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 삿포로 식비 | EXPECTED_BLOCK | PASS | EXPECTED_BLOCK | PASS | PASS/PASS | PASS | PASS | published | PASS |
| 광저우 월별 날씨 | EXPECTED_BLOCK | PASS | EXPECTED_BLOCK | PASS | PASS/PASS | PASS | PASS | published | PASS |
| 오사카 공항 이동 | EXPECTED_BLOCK | PASS | EXPECTED_BLOCK | PASS | PASS/PASS | PASS | PASS | published | PASS |
| 대만 숙소 지역 | EXPECTED_BLOCK | PASS | EXPECTED_BLOCK | PASS | PASS/PASS | PASS | PASS | published | PASS |
| 싱가포르 가족 예산 | EXPECTED_BLOCK | PASS | EXPECTED_BLOCK | PASS | PASS/PASS | PASS | PASS | published | PASS |
| 세부 쇼핑·기념품 | EXPECTED_BLOCK | PASS | EXPECTED_BLOCK | PASS | PASS/PASS | PASS | PASS | published | PASS |
| 석가장 환전·결제 | EXPECTED_BLOCK | PASS | EXPECTED_BLOCK | PASS | PASS/PASS | PASS | PASS | published | PASS |
| 몽골 날씨·옷차림 | EXPECTED_BLOCK | PASS | EXPECTED_BLOCK | PASS | PASS/PASS | PASS | PASS | published | PASS |
| 일본 입국·비자 | EXPECTED_BLOCK | PASS | EXPECTED_BLOCK | EXPECTED_BLOCK | PASS/PASS | PASS | EXPECTED_BLOCK | pending_review | PASS |
| 해외여행 보험 | EXPECTED_BLOCK | PASS | EXPECTED_BLOCK | EXPECTED_BLOCK | PASS/PASS | PASS | EXPECTED_BLOCK | pending_review | PASS |

> 실제 운영 모듈을 호출하되, 고정 메모리 fixture만 사용하며 운영 글·원격 DB·외부 API는 변경하거나 호출하지 않습니다.
