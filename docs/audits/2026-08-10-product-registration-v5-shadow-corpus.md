# 상품등록 통합 자동화 엔진 전수 Shadow/Quarantine 검증 결과

- 실행 시각: 2026-08-19T01:07:35.093Z
- 처리 모드: 원문 기반 오프라인 격리 검증 (고객 노출 없음)
- 원본 폴더: `C:\Users\admin\Downloads\코덱스테스트`
- 업로드 기준일: `2026-08-19` (연도 없는 출발일은 이 기준일 정책으로 올해/내년 판정)

## 고객 관점 최종 판정

**limited_automated_pilot** — 검증 또는 안전 축약이 가능한 상품은 자동 공개 후보로 끝나고, 구매 판단에 중요한 정보가 부족한 상품만 자동 차단됩니다.

- 고유 원문 추출 40/40건 성공
- 실제 판매 대상 66/69개 섹션 (과거 일정·판매가 부재는 정상 종결로 제외)
- 안전 자동 공개 후보 61/66개 섹션
- 검증 공개 2개, 안전 축약 공개 59개, 차단 5개
- 과거 일정 보관 3개, 판매가 부재 폐기 0개
- 근거 연결률 100%
- 고객 화면 계약 통과 66/66개

## 전체 수치

| 항목 | 결과 |
|---|---:|
| 원문 파일 | 40건 |
| 고유 원문 | 40건 (중복 0건) |
| 여행상품 문서 | 40건 |
| 비여행 문서 | 0건 (정상 비등록) |
| 손상·지원불가 문서 | 0건 |
| 추출 성공 | 40/40 고유 원문 (100%) |
| 정규화 성공 | 40/40 여행상품 원문 (100%) |
| 상품 섹션 | 69개 |
| 실제 판매 대상 | 66개 (96%) |
| 과거 일정 정상 보관 | 3개 |
| 판매가 부재 정상 폐기 | 0개 |
| 안전 자동 공개 후보 | 61/66개 (92%) |
| 검증 공개 | 2개 (3%) |
| 안전 축약 공개 | 59개 (89%) |
| 공개 차단 | 5개 (8%) |
| 가격 규칙 | 4780개 |
| 일정 항목 | 3287개 |
| claim 근거 연결률 | 100% (561/561) |
| 고객 화면 계약 통과 | 66/66 (100%) |

## 파일별 결과

| 파일 | 분류 | 추출 | 섹션 | 후보/검수/차단 | 가격 | 일정 | 고객 화면 | 주요 사유 |
|---|---|---:|---:|---:|---:|---:|---:|---|
| [★KE-499특가] 다낭 9월 499 스팟특가 3박4일_0827발권.hwp | travel_product | 성공 | 1 | 0/1/0 | 14 | 33 | 1/1 | ATTRACTION_UNMATCHED:6 |
| [★LJ-399특가] 다낭 8~9월 399 스팟특가_0813발권.hwp | travel_product | 성공 | 1 | 0/1/0 | 4 | 33 | 1/1 | ATTRACTION_UNMATCHED:6 |
| [0814발권] 진에어 노팁 노옵션 바나힐특식 - 컴 10%.hwp | travel_product | 성공 | 1 | 0/1/0 | 12 | 35 | 1/1 | v1.minimum_departure:minimum departure evidence exists<br>ATTRACTION_UNMATCHED:6 |
| [0825발권 BX] 알테라 세미PKG 특가  - 컴 10%.hwp | travel_product | 성공 | 1 | 1/0/0 | 27 | 17 | 1/1 | - |
| [요금표]다낭 KE 아침출발 2날짜 스팟특가 PKG - 8월발권.hwp | travel_product | 성공 | 3 | 0/3/0 | 10 | 177 | 3/3 | ATTRACTION_UNMATCHED:6<br>ATTRACTION_UNMATCHED:7 |
| [요금표]몽골 7C 저녁출발 9월 - 0826발권.hwp | travel_product | 성공 | 2 | 0/0/2 | 26 | 147 | 2/2 | v1.shopping_not_contradictory:no-shopping notice cannot coexist with shopping visits<br>ATTRACTION_UNMATCHED:18 |
| [요금표]보홀 7C 부산출발 8~10월 특가 8.14이전발권 - 0731.hwp | travel_product | 성공 | 1 | 0/0/1 | 456 | 312 | 1/1 | v1-table-axis-1.optional_tour_not_contradictory:no-option notice cannot coexist with customer-visible optional tours<br>v1-table-axis-2.optional_tour_not_contradictory:no-option notice cannot coexist with customer-visible optional tours |
| [요금표]세부 LJ 부산출발 샹그릴라 특가 - 8.14발권 (0731).hwp | travel_product | 성공 | 3 | 0/3/0 | 522 | 145 | 3/3 | v1.options_reflected:source option section is reflected in ledger<br>ATTRACTION_UNMATCHED:2 |
| [요금표]싱가폴 7C 부산출발 8~10월 8.14이전발권 - 0803.hwp | travel_product | 성공 | 4 | 0/4/0 | 452 | 246 | 4/4 | v1.options_reflected:source option section is reflected in ledger<br>ATTRACTION_UNMATCHED:10 |
| [일정표] BX 부산출발 나달 노노 특가일정 3박5일 260919,20 -8.14발권.hwp | travel_product | 성공 | 1 | 0/1/0 | 4 | 62 | 1/1 | v1.options_reflected:source option section is reflected in ledger<br>ATTRACTION_UNMATCHED:10 |
| [일정표]다낭 LJ 특가모음 PKG - 0813발권.hwp | travel_product | 성공 | 1 | 0/1/0 | 28 | 59 | 1/1 | ATTRACTION_UNMATCHED:4 |
| [일정표]하노이 VN 0925 황금연휴 특가 PKG - 0702.hwp | travel_product | 성공 | 3 | 0/3/0 | 12 | 219 | 3/3 | ATTRACTION_UNMATCHED:13<br>ATTRACTION_UNMATCHED:12 |
| [BX-8월선발] 부산출발-나트랑&달랏 3박5일-패키지_(0729).hwp | travel_product | 성공 | 6 | 0/6/0 | 817 | 352 | 6/6 | ATTRACTION_UNMATCHED:9<br>ATTRACTION_UNMATCHED:12 |
| [BX전세기] 0815 장가계 3박 4일 노노 699 특가 - 컴10만.hwp | travel_product | 성공 | 1 | 0/0/0 | 0 | 0 | 0/0 | ALL_DEPARTURES_PAST |
| [BX전세기] 0818 장가계 4박 5일 노노 499 특가 - 컴10만_영진 정리★.hwp | travel_product | 성공 | 1 | 0/1/0 | 2 | 39 | 1/1 | v1.minimum_departure:minimum departure evidence exists<br>v1.shopping_reflected:source shopping section is reflected in ledger |
| [LJ-8월선발] 부산출발-나트랑&달랏 3박,4박-패키지_(0803).hwp | travel_product | 성공 | 7 | 0/7/0 | 43 | 433 | 7/7 | v1.flight_times_complete:source-timed outbound/inbound flight segments must include both departure and arrival times<br>sections[0].variants[0].flight_times: 항공편은 확인했지만 출도착 시각이 모두 원문 근거로 연결되지 않았습니다. |
| [LJ]푸꾸옥 3박 ♥특가♥노옵션스페셜팩 0910 0918 (0814발권) 0804.hwp | travel_product | 성공 | 1 | 0/1/0 | 4 | 41 | 1/1 | sections[0].variants[0].itinerary: 원문 여행기간은 5일이지만 DAY 표제가 4일만 있어 출발·도착일 일정은 상담 시 최종 확인합니다.<br>v1.minimum_departure:minimum departure evidence exists |
| [TW-8월선발] 부산출발-나트랑&달랏 3박,4박-패키지_(0728).hwp | travel_product | 성공 | 7 | 0/7/0 | 699 | 433 | 7/7 | v1.flight_times_complete:source-timed outbound/inbound flight segments must include both departure and arrival times<br>sections[0].variants[0].flight_times: 항공편은 확인했지만 출도착 시각이 모두 원문 근거로 연결되지 않았습니다. |
| [VN,VJ-8월특가] 하노이 0902 노노옌뜨 스팟특가_0727.hwp | travel_product | 성공 | 2 | 0/2/0 | 4 | 64 | 2/2 | v1.high_risk_structured_fact_disclosure:일부 현지비용·입국 고지는 원문 근거를 유지한 상담 확인 문구로 표시합니다.<br>ATTRACTION_UNMATCHED:14 |
| #나리타_[스탠다드]_(0828TL) 조조 초시CC(구,레인보이힐스CC) 3박4일(컴10만원).hwp | travel_product | 성공 | 1 | 0/1/0 | 346 | 18 | 1/1 | v1.minimum_departure:minimum departure evidence exists<br>v1.shopping_reflected:source shopping section is reflected in ledger |
| #마쓰야마_[스탠다드]_0828TL_시내 다색 골프 2박3일 (컴10만원).hwp | travel_product | 성공 | 1 | 1/0/0 | 60 | 13 | 1/1 | - |
| #방콕(BX)_[세이브]_0828TL_썬밸리 무제한 2색골프 (컴 10만원).hwp | travel_product | 성공 | 1 | 0/1/0 | 88 | 20 | 1/1 | v1.flight_times_complete:source-timed outbound/inbound flight segments must include both departure and arrival times<br>sections[0].variants[0].flight_times: 항공편은 확인했지만 출도착 시각이 모두 원문 근거로 연결되지 않았습니다. |
| #방콕(BX)_[세이브]_0828TL아티타야 무제한 골프 (컴 7만원).hwp | travel_product | 성공 | 1 | 0/1/0 | 88 | 21 | 1/1 | v1.flight_times_complete:source-timed outbound/inbound flight segments must include both departure and arrival times<br>sections[0].variants[0].flight_times: 항공편은 확인했지만 출도착 시각이 모두 원문 근거로 연결되지 않았습니다. |
| #방콕(BX)_[스탠다드]_0828TL 타나시티 2색 골프 (컴 10만원).hwp | travel_product | 성공 | 1 | 0/1/0 | 88 | 20 | 1/1 | v1.flight_times_complete:source-timed outbound/inbound flight segments must include both departure and arrival times<br>sections[0].variants[0].flight_times: 항공편은 확인했지만 출도착 시각이 모두 원문 근거로 연결되지 않았습니다. |
| #방콕(BX)_[스탠다드]_0828TL 파타야 품격 자유 다색 골프 (컴 10만원).hwp | travel_product | 성공 | 1 | 0/1/0 | 88 | 18 | 1/1 | v1.flight_times_complete:source-timed outbound/inbound flight segments must include both departure and arrival times<br>sections[0].variants[0].flight_times: 항공편은 확인했지만 출도착 시각이 모두 원문 근거로 연결되지 않았습니다. |
| #방콕(BX)_[스탠다드]_0828TL_시라차 J타운 다색 골프 (컴 10만원).hwp | travel_product | 성공 | 1 | 0/1/0 | 8 | 17 | 1/1 | v1.flight_times_complete:source-timed outbound/inbound flight segments must include both departure and arrival times<br>sections[0].variants[0].flight_times: 항공편은 확인했지만 출도착 시각이 모두 원문 근거로 연결되지 않았습니다. |
| #방콕(BX)_[스탠다드]_0828TL_아유타야 다색 무제한 골프 (컴 10만원).hwp | travel_product | 성공 | 1 | 0/1/0 | 80 | 20 | 1/1 | v1.flight_times_complete:source-timed outbound/inbound flight segments must include both departure and arrival times<br>sections[0].variants[0].flight_times: 항공편은 확인했지만 출도착 시각이 모두 원문 근거로 연결되지 않았습니다. |
| #방콕(BX)_[스탠다드]_0828TL_파타야 원파티오 다색 골프 (컴 10만원).hwp | travel_product | 성공 | 1 | 0/1/0 | 80 | 20 | 1/1 | v1.flight_times_complete:source-timed outbound/inbound flight segments must include both departure and arrival times<br>sections[0].variants[0].flight_times: 항공편은 확인했지만 출도착 시각이 모두 원문 근거로 연결되지 않았습니다. |
| #방콕(BX)_[프리미엄]_0828TL_방콕+리버데일 2색 골프 (컴 10만원).hwp | travel_product | 성공 | 1 | 0/1/0 | 8 | 20 | 1/1 | v1.flight_times_complete:source-timed outbound/inbound flight segments must include both departure and arrival times<br>sections[0].variants[0].flight_times: 항공편은 확인했지만 출도착 시각이 모두 원문 근거로 연결되지 않았습니다. |
| #세부 [스탠다드]_0827TL_세부 3색 골프 3박5일(컴10%).hwp | travel_product | 성공 | 1 | 0/1/0 | 208 | 17 | 1/1 | v1.shopping_reflected:source shopping section is reflected in ledger<br>LEGACY_GATE_REVIEW_CONVERTED_TO_V6_DEGRADED |
| #오사카_[스탠다드]_(0828TL)조석 시내 다색골프(이즈미사노)_컴10만원.hwp | travel_product | 성공 | 1 | 0/1/0 | 140 | 15 | 1/1 | v1.minimum_departure:minimum departure evidence exists<br>LEGACY_GATE_REVIEW_CONVERTED_TO_V6_DEGRADED |
| #오키나와_[스탠다드]_(0828TL)조조 시내 다색 골프 3박4일(컴10만원).hwp | travel_product | 성공 | 1 | 0/0/0 | 0 | 0 | 0/0 | ALL_DEPARTURES_PAST |
| #장가계_[스탠다드]_0814TL_천문산 골프&관광 4일, 5일 (컴10만).hwp | travel_product | 성공 | 1 | 0/1/0 | 8 | 22 | 1/1 | v1.shopping_reflected:source shopping section is reflected in ledger<br>ATTRACTION_UNMATCHED:1 |
| #코타_[세이브]_0825TL_코타 보르네오 무제한(컴 7%).hwp | travel_product | 성공 | 1 | 0/0/1 | 0 | 20 | 1/1 | sections[0].variants[0].price: 출발일에 적용되는 성인 기준 판매가가 없습니다.<br>v1.price:variant has price evidence; final price is owned by ProductRegistrationResult pricing |
| #후쿠오카_[스탠다드]_(0828TL)초석 시내 다색 골프 2박3일 (컴10만원).hwp | travel_product | 성공 | 1 | 0/1/0 | 144 | 15 | 1/1 | v1.minimum_departure:minimum departure evidence exists<br>LEGACY_GATE_REVIEW_CONVERTED_TO_V6_DEGRADED |
| 0813 증편특가★투어폰 26년 7월 백두산 ADM증편-컴15만.hwp | travel_product | 성공 | 1 | 0/0/0 | 0 | 0 | 0/0 | ALL_DEPARTURES_PAST |
| 8,9월 특가 4박) BX방콕썬밸리무제한골프 0724.hwp | travel_product | 성공 | 1 | 0/1/0 | 12 | 48 | 1/1 | ATTRACTION_UNMATCHED:7 |
| 특가 - BX세부에스타디럭스패키지 0806.hwp | travel_product | 성공 | 1 | 0/0/1 | 10 | 27 | 1/1 | v1.optional_tour_not_contradictory:no-option notice cannot coexist with customer-visible optional tours<br>v1.shopping_not_contradictory:no-shopping notice cannot coexist with shopping visits |
| BX나트랑달랏품격노팁노옵션 0803.hwp | travel_product | 성공 | 1 | 0/1/0 | 4 | 31 | 1/1 | ATTRACTION_UNMATCHED:14 |
| BX다낭호이안알란씨,페닌슐라 노노패키지 0803.hwp | travel_product | 성공 | 2 | 0/2/0 | 184 | 58 | 2/2 | ATTRACTION_UNMATCHED:9<br>ATTRACTION_UNMATCHED:9 |

## 고객이라면 이렇게 판단합니다

- 가격과 출발일이 원문 근거와 연결되고, 일정이 실제 모바일 화면에서 깨지지 않는 상품만 구매 후보로 봅니다.
- 관광지 미매칭, 옵션/쇼핑 해석 불명확, 항공·호텔·취소조건 누락이 하나라도 있으면 “문의 필요” 또는 비공개가 맞습니다.
- 이번 결과는 고객 공개 전 단계입니다. 이 리포트는 자동 승인·DB 공개·캐시 반영을 수행하지 않았습니다.
- 다음 공개 게이트는 운영 DB shadow 저장 → 핵심 필드 diff → 동일 snapshot 모바일 proof → 정책 기준 자동 판정 → CAS atomic publication 순서입니다.

## 정확도 해석

이 수치는 정답 원문과 자동 추출 결과의 완전한 의미 정확도(precision/recall)가 아니라, 추출 성공·근거 연결·규칙 통과·렌더 계약 통과를 측정한 안전성 지표입니다. 실제 가격 숫자와 고객 문구의 사업적 정확도는 운영 DB shadow와 사람 검수 표본에서 최종 확정해야 합니다.

