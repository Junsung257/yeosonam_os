# Free-Travel 100 시나리오 명세

형식: `사전조건 | 입력 | 기대 SSE/API | 기대 UI | 기대 DB/운영`

## A. 사용자 검색/추천 UX (1-35)

1. 기본 왕복 검색 | 부산-도야마 3박4일 성인2 | params/flights/hotels/activities/done | 카드 3종 노출 | session 생성
2. 항공권 확보 문구 | "항공권 이미 구매" 포함 | flights 빈배열 + done | 호텔/액티비티 중심 노출 | session skipFlights=true
3. 날짜 축약 입력 | `5/7~10` | params.dateFrom/dateTo 정규화 | 올바른 일정 표시 | 세션 날짜 저장
4. 인원 복합 입력 | `성인3+아동1` | params.adults=3,children=1 | 인원 반영 문구 | pax 저장
5. 룸구성 입력 | `방2개, 성인2 / 성인1+아동1` | params.roomPlan 파싱 | 룸구성 배지 노출 | plan_json roomPlan 저장
6. 목적지 동의어 | `토야마/도야마` | destinationIata=TOY | 동일 결과 UX | destination 정규화
7. 출발지 도시명 | `김해 출발` | departure=PUS | 캘린더 from=PUS | departure 저장
8. 오타 포함 문장 | 도야먀 등 오타 | fallback 목적지 추론 | 추천 유지 | 추론 로그
9. 영문 목적지 | `Toyama` | destination 매핑 보정 | 결과 정상 | destination canonical
10. Enter 검색 | 엔터 입력 | runSearch 1회 | 중복요청 없음 | session 1건
11. Shift+Enter 줄바꿈 | Shift+Enter | 검색 미실행 | 입력만 유지 | DB 변경 없음
12. 빈 입력 클릭 | 공백만 | 400/에러 이벤트 | 입력 가이드 노출 | DB 없음
13. 긴 자연어 | 500자 이상 | status heartbeat 유지 | 로딩 끊김 없음 | session 생성
14. 결과 0건 | provider empty | done + reason | 대체 날짜/목적지 제안 | fallback 플래그 저장
15. 호텔만 성공 | flights/activities 실패 | hotels 이벤트만 수신 | 호텔 섹션 노출 | plan_json 부분 저장
16. 액티비티만 성공 | flights/hotels 실패 | activities 이벤트 | 액티비티 섹션 노출 | 부분 저장
17. summary 실패 | compose 실패 | summary fallback | 기본 코멘트 노출 | aiSummary fallback 기록
18. 비교견적 실패 | package query 실패 | comparison fallback | 비교 카드 안내문 | comparison.available=false
19. 캘린더 조회 성공 | params에 IATA 존재 | fare-calendar entries | 날짜칩 노출 | DB 영향 없음
20. 캘린더 클릭 재검색 | 칩 클릭 | 새 plan 요청 | 새 결과 갱신 | 기존 session와 분리
21. 캘린더 API 실패 | 5xx | silent 금지 에러배지 | 캘린더 오류 문구 | 오류 로그
22. 호텔 상세 성공 | gid/checkIn/out 유효 | stay-detail 200 | 상세패널 노출 | DB 영향 없음
23. 호텔 상세 실패 | gid invalid | 400 | 상세 실패 문구 | 오류 로그
24. 액티비티 상세 성공 | gid/url 유효 | tna-detail 200 | 포함사항 노출 | -
25. 액티비티 옵션 성공 | date 선택 | tna-options 리스트 | 옵션 가격 노출 | -
26. 액티비티 옵션 실패 | date invalid | 400 | 재선택 가이드 | -
27. 전화번호 정상 저장 | 010-1234-5678 | session POST 200 | 저장 완료 배너 | customer_phone 저장
28. 전화번호 형식 오류 | 010123 | 400 | 형식 오류 표시 | DB 미변경
29. sessionId 누락 저장 | done 누락 상태 | 409/400 | 다시 검색 유도 | DB 미변경
30. 연속 검색 중단 | 검색 중 새 검색 | 이전 abort | 최신 결과만 렌더 | 최신 session만 사용
31. 네트워크 끊김 | SSE 중断 | error 이벤트 | 재시도 버튼 노출 | 부분데이터 보존
32. 모바일 화면 | 360px | 레이아웃 깨짐 없음 | 스크롤 가능 | -
33. 다국어 혼합 | 한/영 혼합 입력 | 파싱 유지 | 추천 정상 | 파싱 로그
34. 특수문자 입력 | 이모지 포함 | sanitize 후 검색 | 앱 크래시 없음 | -
35. 프로모션 항공 클릭 | idle 배너 클릭 | 검색 트리거 | 입력/결과 연동 | -

## B. API/LLM/Provider 안정성 (36-70)

36. plan body 비JSON | invalid body | 400 JSON_FORMAT | 에러 문구 | 로그 code
37. message 누락 | `{}` | 400 VALIDATION | 입력 가이드 | -
38. sessionId 비UUID | 잘못된 UUID | 자동 재발급 또는 400 | 경고표시 | 새 id
39. LLM extract timeout | deepseek timeout | retry 후 fallback | 로딩 유지 | errors 저장
40. LLM extract JSON파싱 실패 | raw 텍스트 | fallback parser | 결과 유지 | parse_error metric
41. LLM 완전 불가 | key 없음 | error code LLM_UNAVAILABLE | 수동 입력 가이드 | -
42. 날짜 역전 | dateTo<dateFrom | 서버 교정/거절 | 수정 안내 | 교정 로그
43. nights 불일치 | nights 잘못됨 | date diff 재계산 | UI nights 정합 | 정합값 저장
44. skipFlights 오검출 방지 | 일반 문장 | skipFlights=false | 항공 검색 수행 | -
45. destinationIata 미매핑 | 미지 도시 | 도시명 그대로 검색 | 일부 결과 허용 | mapping_miss 로그
46. flights provider timeout | 3~6초 초과 | flights 빈배열 | 타 카테고리 지속 | providerErrors
47. stays provider timeout | timeout | hotels 빈배열 후 fallback | fallback 뱃지 | fallback 저장
48. activities provider timeout | timeout | activities 빈배열 후 fallback | fallback 뱃지 | -
49. provider 응답 스키마 변경 | 필드명 변경 | 안전 파싱 | 앱 크래시 없음 | schema_error 로그
50. providerUrl 없음 | 빈 링크 | affiliate 생성 스킵 | 예약버튼 숨김 | -
51. mylink 단건 생성 | 유효 url | 변환 링크 반환 | 예약 링크 정상 | click 추적 가능
52. mylink 부분 실패 | 10개 중 2개 실패 | partial success 포맷 | 실패건 안내 | 실패건 로그
53. mylink 429 | rate limit | 백오프 재시도 | 지연 안내 | retry_count
54. fare-calendar NaN nights | nights=abc | 400 | 오류 메시지 | -
55. stay-detail 날짜형식 오류 | checkIn invalid | 400 | 입력오류 | -
56. tna-detail URL 허용도메인 위반 | 외부 도메인 | 400 | 안전 경고 | 보안 로그
57. tna-options 과거 날짜 | yesterday | 400 | 미래날짜 안내 | -
58. comparison 산출 통화 가정 | KRW만 | 계산 정상 | 금액 범위 노출 | totalMin/Max 저장
59. roomPlan 기반 객실 계산 | 2+2 split | 객실수 정확 계산 | 총액 정확 | calc trace
60. 액티비티 아동 단가 | child price 존재 | 총액 분리 계산 | 안내 문구 | -
61. done 누락 타임아웃 | SSE 종결 누락 | timeout->error/done-safe | 무한로딩 방지 | timeout metric
62. status heartbeat | 장시간 처리 | 5초 상태 이벤트 | 살아있는 로딩 | -
63. requestId 불일치 이벤트 | 이전 응답 유입 | discard | 화면 오염 없음 | discard count
64. 세션 저장 비활성 DB | supabase off | done persisted=false | 안내 노출 | 저장 건너뜀
65. session POST row=0 | 없는 세션 id | 404 | 만료 안내 | no-update 로그
66. session GET 단건 invalid id | 짧은 id | 400 | 오류 메시지 | -
67. session GET 목록 권한 없음 | 비관리자 | 403 | 접근불가 | audit log
68. session 목록 마스킹 | phone 포함 | 마스킹값 반환 | 화면 마스킹 | PII 보호
69. book/cancel 미지원 | 호출됨 | 503 feature_not_enabled | 대체 경로 안내 | code 기록
70. 에러코드 표준화 | 모든 route | code/message/details | 일관 에러 UX | 모니터링 용이

## C. 운영/정산/대사 (71-100)

71. reservations sync 성공 | sync=1 | confirmed 예약 반영 | booked 증가 | 상태 업데이트
72. reservations sync 부분실패 | 일부 API 실패 | partial 응답 | 경고 노출 | 실패내역 저장
73. utmContent 없는 예약 | missing sub | 미매칭 큐 이동 | 운영 알림 | unmatched 후보
74. manual booking 등록 | book-manual PATCH | ok + 상태 booked | UI 즉시반영 | ref 저장
75. manual booking 잘못 입력 수정 | 재PATCH | 최신값 반영 | 이력 표시 | audit trail
76. revenues 조회 성공 | 기간 필터 | rows 반환 | KPI 계산 | -
77. revenues 권한 오류 | API key 권한부족 | 502/403 | 운영 경고 | error log
78. commissions 필터 | ota/status/date | 정확 필터링 | 목록 일치 | -
79. reconcile 업로드 정상 | report JSON | matched/unmatched 반환 | 결과 토스트 | report upsert
80. reconcile JSON 스키마 오류 | 필드 누락 | 400 zod | 오류 상세 | -
81. reconcile 중복 업로드 | 같은 월 | upsert overwrite | diff 안내 | report 갱신
82. reconcile partial 상태 | 일부만 매칭 | partially_reconciled | 상태 배지 | matched_count 저장
83. reconcile full 상태 | 전건 매칭 | fully_reconciled | 완료 배지 | full 플래그
84. direct 매칭 | sub_id 일치 | direct 매칭 | 근거 표시 | match_reason=direct
85. fuzzy 매칭 | 금액 유사 | fuzzy 매칭 | 근거 표시 | match_reason=fuzzy
86. manual 매칭 | 운영자 연결 | manual 확정 | 처리자 표시 | match_reason=manual
87. fuzzy 오탐 방지 | 동액 다건 | 날짜조건 추가 | 잘못매칭 감소 | confidence 저장
88. unmatched 자동 생성 | 매칭실패 | unmatched row insert | 수동확인 큐 | 레코드 생성
89. unmatched 후보 추천 | admin 화면 | 후보 3개 제안 API | 클릭 연결 | link table 저장
90. unmatched 보류 | resolve 불가 | on_hold 상태 | 보류배지 | 상태 저장
91. unmatched 무효 | 잘못 리포트 | invalid 상태 | 무효배지 | 사유 저장
92. 정산 리포트 diff | 정정본 업로드 | 추가/삭제/변경 계산 | diff 표 | diff_json 저장
93. 보고서 월 경계 | UTC/KST 경계 | 올바른 월 집계 | 값 정확 | TZ 일관
94. 다중 예약 세션 | 세션 1:N 예약 | 타임라인 정확 | 중복충돌 없음 | booking 별도 저장
95. 세션 타임라인 조회 | 리드→예약→수익→정산 | aggregate API | 타임라인 UI | 조인 정확
96. admin guard 일관성 | 모든 admin route | 401/403 통일 | 접근제어 정상 | audit
97. 장애 재시도 훅 | 외부 API 장애 | 백오프 재시도 | 상태 표기 | retry metric
98. 정산 KPI 계산 | 매칭률/누락률 | 정확 지표 반환 | 대시보드 갱신 | 집계 저장
99. 롤백 시나리오 | reconcile 오작동 | 이전 스냅샷 복구 | 운영 가이드 | restore 로그
100. 감사 로그 시나리오 | 수동 조작 전부 | actor/time/reason 저장 | 이력 탭 노출 | audit row

## 우선순위 태그

- P0: 1,2,3,4,12,14,20,27,28,30,36,37,39,41,46,47,48,61,63,65,70,71,79,80,82,84,88,96,97,98
- P1: 5,6,7,15,16,17,18,19,21,22,23,24,25,26,31,32,40,42,43,45,49,52,53,54,55,56,57,58,59,60,72,73,74,75,76,77,78,81,83,85
- P2: 8,9,10,11,13,29,33,34,35,38,44,50,51,62,64,66,67,68,69,86,87,89,90,91,92,93,94,95,99,100
