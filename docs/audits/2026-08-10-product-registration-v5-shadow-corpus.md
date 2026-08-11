# 상품등록 V5 전수 Shadow/Quarantine 검증 결과

- 실행 시각: 2026-08-10T01:43:53.464Z
- 처리 모드: 원문 기반 오프라인 격리 검증 (고객 노출 없음)
- 원본 폴더: `C:\Users\admin\Downloads\코덱스테스트`

## 고객 관점 최종 판정

**limited_manual_pilot** — 일부 섹션만 고객 공개 후보입니다. 나머지는 사람 검수 전에는 고객에게 보여주면 안 됩니다.

- 원문 추출 40/40건 성공
- 고객 공개 후보 4/66개 섹션
- 검수 필요 44개, 차단 18개
- 근거 연결률 100%
- 고객 화면 계약 통과 66/66개

## 전체 수치

| 항목 | 결과 |
|---|---:|
| 원문 파일 | 40건 |
| 추출 성공 | 40/40 (100%) |
| 정규화 성공 | 40/40 (100%) |
| 상품 섹션 | 66개 |
| 자동 공개 후보 | 4개 (6%) |
| 사람 검수 필요 | 44개 (67%) |
| 공개 차단 | 18개 (27%) |
| 가격 규칙 | 865개 |
| 일정 항목 | 3729개 |
| claim 근거 연결률 | 100% (602/602) |
| 고객 화면 계약 통과 | 66/66 (100%) |

## 파일별 결과

| 파일 | 추출 | 섹션 | 후보/검수/차단 | 가격 | 일정 | 고객 화면 | 주요 사유 |
|---|---:|---:|---:|---:|---:|---:|---|
| 특가 - BX세부에스타디럭스패키지 0806.hwp | 성공 | 1 | 0/1/0 | 7 | 11 | 1/1 | attraction_unmatched_queue_clear:1 unmatched attraction events require review<br>entity_attraction_unresolved_clear:1 unresolved attraction entities require review |
| [일정표]하노이 VN 0925 황금연휴 특가 PKG - 0702.hwp | 성공 | 2 | 0/2/0 | 5 | 165 | 2/2 | attraction_unmatched_queue_clear:8 unmatched attraction events require review<br>entity_attraction_unresolved_clear:8 unresolved attraction entities require review |
| [일정표]다낭 LJ 특가모음 PKG - 0813발권.hwp | 성공 | 1 | 0/1/0 | 4 | 59 | 1/1 | attraction_unmatched_queue_clear:3 unmatched attraction events require review<br>entity_attraction_unresolved_clear:3 unresolved attraction entities require review |
| [일정표] BX 부산출발 나달 노노 특가일정 3박5일 260919,20 -8.14발권.hwp | 성공 | 1 | 0/1/0 | 1 | 62 | 1/1 | v1.options_reflected:source option section is reflected in ledger<br>attraction_unmatched_queue_clear:10 unmatched attraction events require review |
| [요금표]싱가폴 7C 부산출발 8~10월 8.14이전발권 - 0803.hwp | 성공 | 4 | 0/4/0 | 260 | 246 | 4/4 | v1.options_reflected:source option section is reflected in ledger<br>attraction_unmatched_queue_clear:9 unmatched attraction events require review |
| [요금표]세부 LJ 부산출발 샹그릴라 특가 - 8.14발권 (0731).hwp | 성공 | 2 | 0/2/0 | 8 | 147 | 2/2 | attraction_unmatched_queue_clear:2 unmatched attraction events require review<br>entity_attraction_unresolved_clear:2 unresolved attraction entities require review |
| [요금표]보홀 7C 부산출발 8~10월 특가 8.14이전발권 - 0731.hwp | 성공 | 1 | 0/1/0 | 68 | 52 | 1/1 | attraction_unmatched_queue_clear:8 unmatched attraction events require review<br>option_review_queue_clear:2 option events require review |
| [요금표]몽골 7C 저녁출발 9월 - 0826발권.hwp | 성공 | 1 | 0/1/0 | 7 | 81 | 1/1 | attraction_unmatched_queue_clear:22 unmatched attraction events require review<br>entity_attraction_unresolved_clear:22 unresolved attraction entities require review |
| [요금표]다낭 KE 아침출발 2날짜 스팟특가 PKG - 8월발권.hwp | 성공 | 3 | 0/3/0 | 3 | 177 | 3/3 | attraction_unmatched_queue_clear:5 unmatched attraction events require review<br>entity_attraction_unresolved_clear:5 unresolved attraction entities require review |
| [★LJ-399특가] 다낭 8~9월 399 스팟특가_0813발권.hwp | 성공 | 1 | 0/1/0 | 3 | 67 | 1/1 | attraction_unmatched_queue_clear:6 unmatched attraction events require review<br>entity_attraction_unresolved_clear:6 unresolved attraction entities require review |
| [★KE-499특가] 다낭 9월 499 스팟특가 3박4일_0827발권.hwp | 성공 | 1 | 0/1/0 | 2 | 63 | 1/1 | attraction_unmatched_queue_clear:6 unmatched attraction events require review<br>entity_attraction_unresolved_clear:6 unresolved attraction entities require review |
| [VN,VJ-8월특가] 하노이 0902 노노옌뜨 스팟특가_0727.hwp | 성공 | 2 | 0/0/2 | 4 | 150 | 2/2 | v1.high_risk_structured_fact_values:high-risk structured facts must have values or an explicit safe state<br>GATE_BLOCKED:blocked |
| [TW-8월선발] 부산출발-나트랑&달랏 3박,4박-패키지_(0728).hwp | 성공 | 7 | 0/0/7 | 117 | 433 | 7/7 | v1.flight_times_complete:source-timed outbound/inbound flight segments must include both departure and arrival times<br>GATE_BLOCKED:blocked |
| [LJ]푸꾸옥 3박 ♥특가♥노옵션스페셜팩 0910 0918 (0814발권) 0804.hwp | 성공 | 1 | 0/1/0 | 2 | 41 | 1/1 | v1.minimum_departure:minimum departure evidence exists<br>ATTRACTION_UNMATCHED:3 |
| [LJ-8월선발] 부산출발-나트랑&달랏 3박,4박-패키지_(0803).hwp | 성공 | 7 | 0/0/7 | 40 | 433 | 7/7 | v1.flight_times_complete:source-timed outbound/inbound flight segments must include both departure and arrival times<br>GATE_BLOCKED:blocked |
| [BX전세기] 0818 장가계 4박 5일 노노 499 특가 - 컴10만_영진 정리★.hwp | 성공 | 1 | 0/1/0 | 1 | 75 | 1/1 | v1.minimum_departure:minimum departure evidence exists<br>attraction_unmatched_queue_clear:20 unmatched attraction events require review |
| [BX전세기] 0815 장가계 3박 4일 노노 699 특가 - 컴10만.hwp | 성공 | 1 | 0/1/0 | 1 | 63 | 1/1 | v1.minimum_departure:minimum departure evidence exists<br>attraction_unmatched_queue_clear:16 unmatched attraction events require review |
| [BX-8월선발] 부산출발-나트랑&달랏 3박5일-패키지_(0729).hwp | 성공 | 6 | 0/6/0 | 121 | 352 | 6/6 | attraction_unmatched_queue_clear:9 unmatched attraction events require review<br>entity_attraction_unresolved_clear:9 unresolved attraction entities require review |
| [0825발권 BX] 알테라 세미PKG 특가  - 컴 10%.hwp | 성공 | 1 | 0/1/0 | 3 | 48 | 1/1 | v1.price:variant has price evidence; final price is owned by ProductRegistrationResult pricing |
| [0814발권] 진에어 노팁 노옵션 바나힐특식 - 컴 10%.hwp | 성공 | 1 | 0/1/0 | 3 | 66 | 1/1 | v1.minimum_departure:minimum departure evidence exists<br>attraction_unmatched_queue_clear:4 unmatched attraction events require review |
| BX다낭호이안알란씨,페닌슐라 노노패키지 0803.hwp | 성공 | 2 | 0/2/0 | 30 | 108 | 2/2 | attraction_unmatched_queue_clear:8 unmatched attraction events require review<br>entity_attraction_unresolved_clear:8 unresolved attraction entities require review |
| BX나트랑달랏품격노팁노옵션 0803.hwp | 성공 | 1 | 0/1/0 | 20 | 66 | 1/1 | attraction_unmatched_queue_clear:14 unmatched attraction events require review<br>entity_attraction_unresolved_clear:14 unresolved attraction entities require review |
| 8,9월 특가 4박) BX방콕썬밸리무제한골프 0724.hwp | 성공 | 1 | 0/1/0 | 5 | 48 | 1/1 | attraction_unmatched_queue_clear:1 unmatched attraction events require review<br>entity_attraction_unresolved_clear:1 unresolved attraction entities require review |
| 0813 증편특가★투어폰 26년 7월 백두산 ADM증편-컴15만.hwp | 성공 | 1 | 0/1/0 | 5 | 72 | 1/1 | v1.minimum_departure:minimum departure evidence exists<br>attraction_unmatched_queue_clear:5 unmatched attraction events require review |
| #후쿠오카_[스탠다드]_(0828TL)초석 시내 다색 골프 2박3일 (컴10만원).hwp | 성공 | 1 | 1/0/0 | 16 | 35 | 1/1 | - |
| #코타_[세이브]_0825TL_코타 보르네오 무제한(컴 7%).hwp | 성공 | 1 | 0/1/0 | 8 | 53 | 1/1 | v1.minimum_departure:minimum departure evidence exists<br>attraction_unmatched_queue_clear:1 unmatched attraction events require review |
| #장가계_[스탠다드]_0814TL_천문산 골프&관광 4일, 5일 (컴10만).hwp | 성공 | 1 | 0/1/0 | 21 | 50 | 1/1 | v1.shopping_reflected:source shopping section is reflected in ledger<br>attraction_unmatched_queue_clear:1 unmatched attraction events require review |
| #오키나와_[스탠다드]_(0828TL)조조 시내 다색 골프 3박4일(컴10만원).hwp | 성공 | 1 | 0/1/0 | 27 | 29 | 1/1 | attraction_unmatched_queue_clear:4 unmatched attraction events require review<br>entity_attraction_unresolved_clear:4 unresolved attraction entities require review |
| #오사카_[스탠다드]_(0828TL)조석 시내 다색골프(이즈미사노)_컴10만원.hwp | 성공 | 1 | 1/0/0 | 16 | 34 | 1/1 | - |
| #세부 [스탠다드]_0827TL_세부 3색 골프 3박5일(컴10%).hwp | 성공 | 1 | 0/1/0 | 16 | 39 | 1/1 | v1.shopping_reflected:source shopping section is reflected in ledger<br>GATE_NEEDS_REVIEW |
| #방콕(BX)_[프리미엄]_0828TL_방콕+리버데일 2색 골프 (컴 10만원).hwp | 성공 | 1 | 0/1/0 | 2 | 47 | 1/1 | v1.minimum_departure:minimum departure evidence exists<br>attraction_unmatched_queue_clear:2 unmatched attraction events require review |
| #방콕(BX)_[스탠다드]_0828TL_파타야 원파티오 다색 골프 (컴 10만원).hwp | 성공 | 1 | 0/0/1 | 2 | 47 | 1/1 | v1.high_risk_structured_fact_values:high-risk structured facts must have values or an explicit safe state<br>GATE_BLOCKED:blocked |
| #방콕(BX)_[스탠다드]_0828TL_아유타야 다색 무제한 골프 (컴 10만원).hwp | 성공 | 1 | 0/1/0 | 2 | 47 | 1/1 | v1.minimum_departure:minimum departure evidence exists<br>attraction_unmatched_queue_clear:2 unmatched attraction events require review |
| #방콕(BX)_[스탠다드]_0828TL_시라차 J타운 다색 골프 (컴 10만원).hwp | 성공 | 1 | 0/1/0 | 2 | 41 | 1/1 | v1.minimum_departure:minimum departure evidence exists<br>attraction_unmatched_queue_clear:1 unmatched attraction events require review |
| #방콕(BX)_[스탠다드]_0828TL 파타야 품격 자유 다색 골프 (컴 10만원).hwp | 성공 | 1 | 1/0/0 | 2 | 42 | 1/1 | - |
| #방콕(BX)_[스탠다드]_0828TL 타나시티 2색 골프 (컴 10만원).hwp | 성공 | 1 | 1/0/0 | 2 | 42 | 1/1 | - |
| #방콕(BX)_[세이브]_0828TL아티타야 무제한 골프 (컴 7만원).hwp | 성공 | 1 | 0/0/1 | 2 | 48 | 1/1 | v1.high_risk_structured_fact_values:high-risk structured facts must have values or an explicit safe state<br>GATE_BLOCKED:blocked |
| #방콕(BX)_[세이브]_0828TL_썬밸리 무제한 2색골프 (컴 10만원).hwp | 성공 | 1 | 0/1/0 | 2 | 47 | 1/1 | attraction_unmatched_queue_clear:2 unmatched attraction events require review<br>entity_attraction_unresolved_clear:2 unresolved attraction entities require review |
| #마쓰야마_[스탠다드]_0828TL_시내 다색 골프 2박3일 (컴10만원).hwp | 성공 | 1 | 0/1/0 | 12 | 33 | 1/1 | v1.minimum_departure:minimum departure evidence exists<br>GATE_NEEDS_REVIEW |
| #나리타_[스탠다드]_(0828TL) 조조 초시CC(구,레인보이힐스CC) 3박4일(컴10만원).hwp | 성공 | 1 | 0/1/0 | 13 | 10 | 1/1 | v1.shopping_reflected:source shopping section is reflected in ledger<br>attraction_unmatched_queue_clear:1 unmatched attraction events require review |

## 고객이라면 이렇게 판단합니다

- 가격과 출발일이 원문 근거와 연결되고, 일정이 실제 모바일 화면에서 깨지지 않는 상품만 구매 후보로 봅니다.
- 관광지 미매칭, 옵션/쇼핑 해석 불명확, 항공·호텔·취소조건 누락이 하나라도 있으면 “문의 필요” 또는 비공개가 맞습니다.
- 이번 결과는 고객 공개 전 단계입니다. 이 리포트는 자동 승인·DB 공개·캐시 반영을 수행하지 않았습니다.
- 다음 공개 게이트는 운영 DB shadow 저장 → V3/V5 핵심 필드 diff → 동일 snapshot 모바일 proof → 관리자 승인 → atomic publication 순서입니다.

## 정확도 해석

이 수치는 정답 원문과 자동 추출 결과의 완전한 의미 정확도(precision/recall)가 아니라, 추출 성공·근거 연결·규칙 통과·렌더 계약 통과를 측정한 안전성 지표입니다. 실제 가격 숫자와 고객 문구의 사업적 정확도는 운영 DB shadow와 사람 검수 표본에서 최종 확정해야 합니다.

