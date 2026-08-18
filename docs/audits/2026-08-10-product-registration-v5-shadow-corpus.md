# 상품등록 통합 자동화 엔진 전수 Shadow/Quarantine 검증 결과

- 실행 시각: 2026-08-18T09:39:52.746Z
- 처리 모드: 원문 기반 오프라인 격리 검증 (고객 노출 없음)
- 원본 폴더: `C:\Users\admin\Downloads\코덱스테스트`
- 주의: 기존 corpus 경로를 재사용한 2026-08-18 parser-regression replay입니다. 운영 기준일·관광지 context를 주입하지 않은 오프라인 실행이므로 고객 오픈 readiness 수치로 사용하지 않고, parser 회귀와 차단 사유 확인용으로만 사용합니다.

## 고객 관점 최종 판정

**limited_automated_pilot** — 검증 또는 안전 축약이 가능한 상품은 자동 공개 후보로 끝나고, 구매 판단에 중요한 정보가 부족한 상품만 자동 차단됩니다.

- 원문 추출 40/40건 성공
- 안전 자동 공개 후보 36/69개 섹션
- 검증 공개 1개, 안전 축약 공개 35개, 차단 33개
- 근거 연결률 100%
- 고객 화면 계약 통과 69/69개

## 전체 수치

| 항목 | 결과 |
|---|---:|
| 원문 파일 | 40건 |
| 추출 성공 | 40/40 (100%) |
| 정규화 성공 | 40/40 (100%) |
| 상품 섹션 | 69개 |
| 안전 자동 공개 후보 | 36개 (52%) |
| 검증 공개 | 1개 (1%) |
| 안전 축약 공개 | 35개 (51%) |
| 공개 차단 | 33개 (48%) |
| 가격 규칙 | 4925개 |
| 일정 항목 | 3192개 |
| claim 근거 연결률 | 100% (528/528) |
| 고객 화면 계약 통과 | 69/69 (100%) |

## 파일별 결과

| 파일 | 추출 | 섹션 | 후보/검수/차단 | 가격 | 일정 | 고객 화면 | 주요 사유 |
|---|---:|---:|---:|---:|---:|---:|---|
| 특가 - BX세부에스타디럭스패키지 0806.hwp | 성공 | 1 | 0/0/1 | 10 | 27 | 1/1 | v1.optional_tour_not_contradictory:no-option notice cannot coexist with customer-visible optional tours<br>v1.shopping_not_contradictory:no-shopping notice cannot coexist with shopping visits |
| [일정표]하노이 VN 0925 황금연휴 특가 PKG - 0702.hwp | 성공 | 3 | 0/0/3 | 0 | 219 | 3/3 | sections[0].variants[0].price: 출발일에 적용되는 성인 기준 판매가가 없습니다.<br>v1.price:variant has price evidence; final price is owned by ProductRegistrationResult pricing |
| [일정표]다낭 LJ 특가모음 PKG - 0813발권.hwp | 성공 | 1 | 0/0/1 | 0 | 59 | 1/1 | sections[0].variants[0].price: 출발일에 적용되는 성인 기준 판매가가 없습니다.<br>v1.price:variant has price evidence; final price is owned by ProductRegistrationResult pricing |
| [일정표] BX 부산출발 나달 노노 특가일정 3박5일 260919,20 -8.14발권.hwp | 성공 | 1 | 0/1/0 | 4 | 62 | 1/1 | v1.options_reflected:source option section is reflected in ledger<br>ATTRACTION_UNMATCHED:10 |
| [요금표]싱가폴 7C 부산출발 8~10월 8.14이전발권 - 0803.hwp | 성공 | 4 | 0/0/4 | 508 | 246 | 4/4 | sections[0].variants[0].price: 판매가와 출발일 또는 적용 범위의 관계를 확인할 수 없습니다.<br>v1.options_reflected:source option section is reflected in ledger |
| [요금표]세부 LJ 부산출발 샹그릴라 특가 - 8.14발권 (0731).hwp | 성공 | 3 | 0/3/0 | 528 | 145 | 3/3 | v1.options_reflected:source option section is reflected in ledger<br>ATTRACTION_UNMATCHED:2 |
| [요금표]보홀 7C 부산출발 8~10월 특가 8.14이전발권 - 0731.hwp | 성공 | 1 | 0/0/1 | 21 | 52 | 1/1 | v1.optional_tour_not_contradictory:no-option notice cannot coexist with customer-visible optional tours<br>sections[0].variants[0].price: 출발일에 적용되는 성인 기준 판매가가 없습니다. |
| [요금표]몽골 7C 저녁출발 9월 - 0826발권.hwp | 성공 | 2 | 0/0/2 | 16 | 147 | 2/2 | v1.shopping_not_contradictory:no-shopping notice cannot coexist with shopping visits<br>ATTRACTION_UNMATCHED:18 |
| [요금표]다낭 KE 아침출발 2날짜 스팟특가 PKG - 8월발권.hwp | 성공 | 3 | 0/0/3 | 0 | 177 | 3/3 | sections[0].variants[0].price: 출발일에 적용되는 성인 기준 판매가가 없습니다.<br>v1.price:variant has price evidence; final price is owned by ProductRegistrationResult pricing |
| [★LJ-399특가] 다낭 8~9월 399 스팟특가_0813발권.hwp | 성공 | 1 | 0/0/1 | 0 | 33 | 1/1 | sections[0].variants[0].price: 출발일에 적용되는 성인 기준 판매가가 없습니다.<br>v1.price:variant has price evidence; final price is owned by ProductRegistrationResult pricing |
| [★KE-499특가] 다낭 9월 499 스팟특가 3박4일_0827발권.hwp | 성공 | 1 | 0/0/1 | 0 | 33 | 1/1 | sections[0].variants[0].price: 출발일에 적용되는 성인 기준 판매가가 없습니다.<br>v1.price:variant has price evidence; final price is owned by ProductRegistrationResult pricing |
| [VN,VJ-8월특가] 하노이 0902 노노옌뜨 스팟특가_0727.hwp | 성공 | 2 | 0/0/2 | 0 | 150 | 2/2 | v1.high_risk_structured_fact_values:high-risk structured facts must have values or an explicit safe state<br>sections[0].variants[0].price: 출발일에 적용되는 성인 기준 판매가가 없습니다. |
| [TW-8월선발] 부산출발-나트랑&달랏 3박,4박-패키지_(0728).hwp | 성공 | 7 | 0/7/0 | 1469 | 433 | 7/7 | v1.flight_times_complete:source-timed outbound/inbound flight segments must include both departure and arrival times<br>sections[0].variants[0].flight_times: 항공편은 확인했지만 출도착 시각이 모두 원문 근거로 연결되지 않았습니다. |
| [LJ]푸꾸옥 3박 ♥특가♥노옵션스페셜팩 0910 0918 (0814발권) 0804.hwp | 성공 | 1 | 0/0/1 | 0 | 41 | 1/1 | sections[0].variants[0].price: 출발일에 적용되는 성인 기준 판매가가 없습니다.<br>sections[0].variants[0].itinerary: 상품 기간은 5일인데 원문 DAY 일정은 4일로 재생되었습니다. |
| [LJ-8월선발] 부산출발-나트랑&달랏 3박,4박-패키지_(0803).hwp | 성공 | 7 | 0/7/0 | 69 | 433 | 7/7 | v1.flight_times_complete:source-timed outbound/inbound flight segments must include both departure and arrival times<br>sections[0].variants[0].flight_times: 항공편은 확인했지만 출도착 시각이 모두 원문 근거로 연결되지 않았습니다. |
| [BX전세기] 0818 장가계 4박 5일 노노 499 특가 - 컴10만_영진 정리★.hwp | 성공 | 1 | 0/0/1 | 2 | 39 | 1/1 | sections[0].variants[0].price: 판매가와 출발일 또는 적용 범위의 관계를 확인할 수 없습니다.<br>sections[0].variants[0].lodging: 원문에서 호텔이 미정 또는 동급으로 표시되었습니다. |
| [BX전세기] 0815 장가계 3박 4일 노노 699 특가 - 컴10만.hwp | 성공 | 1 | 0/0/1 | 2 | 33 | 1/1 | sections[0].variants[0].price: 판매가와 출발일 또는 적용 범위의 관계를 확인할 수 없습니다.<br>sections[0].variants[0].lodging: 원문에서 호텔이 미정 또는 동급으로 표시되었습니다. |
| [BX-8월선발] 부산출발-나트랑&달랏 3박5일-패키지_(0729).hwp | 성공 | 6 | 0/0/6 | 13 | 352 | 6/6 | sections[0].variants[0].price: 출발일에 적용되는 성인 기준 판매가가 없습니다.<br>v1.price:variant has price evidence; final price is owned by ProductRegistrationResult pricing |
| [0825발권 BX] 알테라 세미PKG 특가  - 컴 10%.hwp | 성공 | 1 | 0/0/1 | 3 | 17 | 1/1 | sections[0].variants[0].price: 출발일에 적용되는 성인 기준 판매가가 없습니다.<br>v1.price:variant has price evidence; final price is owned by ProductRegistrationResult pricing |
| [0814발권] 진에어 노팁 노옵션 바나힐특식 - 컴 10%.hwp | 성공 | 1 | 0/0/1 | 0 | 35 | 1/1 | sections[0].variants[0].price: 출발일에 적용되는 성인 기준 판매가가 없습니다.<br>v1.price:variant has price evidence; final price is owned by ProductRegistrationResult pricing |
| BX다낭호이안알란씨,페닌슐라 노노패키지 0803.hwp | 성공 | 2 | 0/2/0 | 224 | 58 | 2/2 | ATTRACTION_UNMATCHED:9<br>ATTRACTION_UNMATCHED:9 |
| BX나트랑달랏품격노팁노옵션 0803.hwp | 성공 | 1 | 0/1/0 | 288 | 31 | 1/1 | ATTRACTION_UNMATCHED:14 |
| 8,9월 특가 4박) BX방콕썬밸리무제한골프 0724.hwp | 성공 | 1 | 0/1/0 | 12 | 48 | 1/1 | ATTRACTION_UNMATCHED:7 |
| 0813 증편특가★투어폰 26년 7월 백두산 ADM증편-컴15만.hwp | 성공 | 1 | 0/1/0 | 6 | 34 | 1/1 | sections[0].variants[0].lodging: 원문에서 호텔이 미정 또는 동급으로 표시되었습니다.<br>v1.minimum_departure:minimum departure evidence exists |
| #후쿠오카_[스탠다드]_(0828TL)초석 시내 다색 골프 2박3일 (컴10만원).hwp | 성공 | 1 | 0/1/0 | 174 | 15 | 1/1 | v1.minimum_departure:minimum departure evidence exists<br>LEGACY_GATE_REVIEW_CONVERTED_TO_V6_DEGRADED |
| #코타_[세이브]_0825TL_코타 보르네오 무제한(컴 7%).hwp | 성공 | 1 | 0/0/1 | 0 | 20 | 1/1 | sections[0].variants[0].price: 출발일에 적용되는 성인 기준 판매가가 없습니다.<br>v1.price:variant has price evidence; final price is owned by ProductRegistrationResult pricing |
| #장가계_[스탠다드]_0814TL_천문산 골프&관광 4일, 5일 (컴10만).hwp | 성공 | 1 | 0/1/0 | 10 | 22 | 1/1 | v1.shopping_reflected:source shopping section is reflected in ledger<br>ATTRACTION_UNMATCHED:1 |
| #오키나와_[스탠다드]_(0828TL)조조 시내 다색 골프 3박4일(컴10만원).hwp | 성공 | 1 | 0/1/0 | 82 | 12 | 1/1 | v1.minimum_departure:minimum departure evidence exists<br>ATTRACTION_UNMATCHED:4 |
| #오사카_[스탠다드]_(0828TL)조석 시내 다색골프(이즈미사노)_컴10만원.hwp | 성공 | 1 | 0/1/0 | 164 | 15 | 1/1 | v1.minimum_departure:minimum departure evidence exists<br>LEGACY_GATE_REVIEW_CONVERTED_TO_V6_DEGRADED |
| #세부 [스탠다드]_0827TL_세부 3색 골프 3박5일(컴10%).hwp | 성공 | 1 | 0/1/0 | 224 | 17 | 1/1 | v1.shopping_reflected:source shopping section is reflected in ledger<br>LEGACY_GATE_REVIEW_CONVERTED_TO_V6_DEGRADED |
| #방콕(BX)_[프리미엄]_0828TL_방콕+리버데일 2색 골프 (컴 10만원).hwp | 성공 | 1 | 0/1/0 | 8 | 20 | 1/1 | v1.flight_times_complete:source-timed outbound/inbound flight segments must include both departure and arrival times<br>sections[0].variants[0].flight_times: 항공편은 확인했지만 출도착 시각이 모두 원문 근거로 연결되지 않았습니다. |
| #방콕(BX)_[스탠다드]_0828TL_파타야 원파티오 다색 골프 (컴 10만원).hwp | 성공 | 1 | 0/0/1 | 98 | 20 | 1/1 | v1.high_risk_structured_fact_values:high-risk structured facts must have values or an explicit safe state<br>v1.flight_times_complete:source-timed outbound/inbound flight segments must include both departure and arrival times |
| #방콕(BX)_[스탠다드]_0828TL_아유타야 다색 무제한 골프 (컴 10만원).hwp | 성공 | 1 | 0/1/0 | 102 | 20 | 1/1 | v1.flight_times_complete:source-timed outbound/inbound flight segments must include both departure and arrival times<br>sections[0].variants[0].flight_times: 항공편은 확인했지만 출도착 시각이 모두 원문 근거로 연결되지 않았습니다. |
| #방콕(BX)_[스탠다드]_0828TL_시라차 J타운 다색 골프 (컴 10만원).hwp | 성공 | 1 | 0/1/0 | 16 | 17 | 1/1 | v1.flight_times_complete:source-timed outbound/inbound flight segments must include both departure and arrival times<br>sections[0].variants[0].flight_times: 항공편은 확인했지만 출도착 시각이 모두 원문 근거로 연결되지 않았습니다. |
| #방콕(BX)_[스탠다드]_0828TL 파타야 품격 자유 다색 골프 (컴 10만원).hwp | 성공 | 1 | 0/1/0 | 114 | 18 | 1/1 | v1.flight_times_complete:source-timed outbound/inbound flight segments must include both departure and arrival times<br>sections[0].variants[0].flight_times: 항공편은 확인했지만 출도착 시각이 모두 원문 근거로 연결되지 않았습니다. |
| #방콕(BX)_[스탠다드]_0828TL 타나시티 2색 골프 (컴 10만원).hwp | 성공 | 1 | 0/1/0 | 114 | 20 | 1/1 | v1.flight_times_complete:source-timed outbound/inbound flight segments must include both departure and arrival times<br>sections[0].variants[0].flight_times: 항공편은 확인했지만 출도착 시각이 모두 원문 근거로 연결되지 않았습니다. |
| #방콕(BX)_[세이브]_0828TL아티타야 무제한 골프 (컴 7만원).hwp | 성공 | 1 | 0/0/1 | 114 | 21 | 1/1 | v1.high_risk_structured_fact_values:high-risk structured facts must have values or an explicit safe state<br>v1.flight_times_complete:source-timed outbound/inbound flight segments must include both departure and arrival times |
| #방콕(BX)_[세이브]_0828TL_썬밸리 무제한 2색골프 (컴 10만원).hwp | 성공 | 1 | 0/1/0 | 114 | 20 | 1/1 | v1.flight_times_complete:source-timed outbound/inbound flight segments must include both departure and arrival times<br>sections[0].variants[0].flight_times: 항공편은 확인했지만 출도착 시각이 모두 원문 근거로 연결되지 않았습니다. |
| #마쓰야마_[스탠다드]_0828TL_시내 다색 골프 2박3일 (컴10만원).hwp | 성공 | 1 | 1/0/0 | 66 | 13 | 1/1 | - |
| #나리타_[스탠다드]_(0828TL) 조조 초시CC(구,레인보이힐스CC) 3박4일(컴10만원).hwp | 성공 | 1 | 0/1/0 | 350 | 18 | 1/1 | v1.minimum_departure:minimum departure evidence exists<br>v1.shopping_reflected:source shopping section is reflected in ledger |

## 고객이라면 이렇게 판단합니다

- 가격과 출발일이 원문 근거와 연결되고, 일정이 실제 모바일 화면에서 깨지지 않는 상품만 구매 후보로 봅니다.
- 관광지 미매칭, 옵션/쇼핑 해석 불명확, 항공·호텔·취소조건 누락이 하나라도 있으면 “문의 필요” 또는 비공개가 맞습니다.
- 이번 결과는 고객 공개 전 단계입니다. 이 리포트는 자동 승인·DB 공개·캐시 반영을 수행하지 않았습니다.
- 다음 공개 게이트는 운영 DB shadow 저장 → 핵심 필드 diff → 동일 snapshot 모바일 proof → 정책 기준 자동 판정 → CAS atomic publication 순서입니다.

## 정확도 해석

이 수치는 정답 원문과 자동 추출 결과의 완전한 의미 정확도(precision/recall)가 아니라, 추출 성공·근거 연결·규칙 통과·렌더 계약 통과를 측정한 안전성 지표입니다. 실제 가격 숫자와 고객 문구의 사업적 정확도는 운영 DB shadow와 사람 검수 표본에서 최종 확정해야 합니다.
