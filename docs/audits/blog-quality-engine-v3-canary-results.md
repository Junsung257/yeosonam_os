# Blog Quality Engine V3 canary results

실행 모드는 `offline_structured_canary_no_publication`입니다. 외부 모델이나 운영 DB를 쓰지 않았고, fixture source ID는 production evidence로 사용할 수 없습니다.

| 항목 | 결과 | 기준 |
|---|---:|---:|
| 초안 | 24 | >= 24 |
| 목적지 | 24 | >= 12 |
| intent | 12 | >= 8 |
| archetype | 12 | >= 8 |
| exact duplicate title | 0 | 0 |
| normalized title 최대 반복 | 2 | <= 2 |
| duplicate opening | 0 | 0 |
| unsupported numeric claim | 0 | 0 |
| stale HIGH claim | 0 | 0 |
| cross-destination image reuse | 0 | 0 |
| FAQ 비율 | 12.5% | <= 40% |
| checklist 비율 | 4.2% | <= 40% |
| broken Korean | 0 | 0 |

종합 판정: **PASS**

각 canary의 archetype, source fixture와 failure evidence는 JSON에 저장했습니다. 이 검사는 실제 모델 문장 품질이나 실제 출처의 진위를 증명하지 않으므로, 운영 전에는 승인된 provider로 별도 live canary를 실행해야 합니다.
