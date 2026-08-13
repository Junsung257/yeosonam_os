# Blog SERP benchmark — 2026-08-14

이 감사는 Google 순위 대체값이 아니라 **네이버 블로그·웹문서 API의 editorial 표본**입니다. 통합검색 실제 순위와 동일하다고 해석하면 안 됩니다. 경쟁사 본문 전체는 저장하지 않았고 구조 측정값과 첫 문단의 짧은 excerpt만 보관했습니다.

| 항목 | 결과 | 기준 |
|---|---:|---:|
| 키워드 | 24 | 24 |
| 목표 editorial 결과 | 240 | 240 |
| 수집 editorial 결과 | 240 | 240 |
| 결과 10개 확보 query | 24 | 24 |
| 상세 구조 fetch 성공 | 204/240 (85.0%) | >= 85% |
| fetch_blocked | 35 | 별도 기록 |
| verified demand 보유 query | 20 | 관측값만 인정 |
| unavailable query | 0 | 0 |

## 데이터 품질 판정

- 24개 query: PASS
- 240개 editorial 표본: PASS
- query당 최소 6개: PASS
- 상세 구조 fetch 85%: PASS
- 빈 provider 응답을 성공으로 오판하지 않음: PASS

네이버 검색광고 API 키가 없으면 월간 검색량은 null로 남습니다. DataLab 상대지수는 검색량으로 환산하지 않습니다. 상세 행과 실패 원인은 JSON/CSV에 저장했습니다.
