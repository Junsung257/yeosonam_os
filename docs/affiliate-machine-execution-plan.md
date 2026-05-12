# Affiliate Marketing Machine 실행 플랜 (2026-05-03)

여소남 코드베이스 기준으로 제휴(인플루언서) 매출 머신을 순차 구축하기 위한 실행 문서입니다.

## 목표

- 운영 자동화: 사람 개입 없이 모집, 심사, 정산, 이상탐지까지 흐르게 한다.
- 매출 최적화: 클릭 추적이 아닌 예약/정산 귀속 정확도를 높인다.
- 리스크 통제: 셀프결제, 봇, 비정상 패턴을 조기 탐지해 손실을 줄인다.

## Phase 0 — 기초 통제 (완료)

- [x] 예약 생성 시 셀프 리퍼럴(전화/이메일 매칭) 커미션 차단
  - 파일: `src/app/api/bookings/route.ts`
- [x] 셀프 리퍼럴 차단 건 감사로그 저장
  - 파일: `src/app/api/bookings/route.ts`
- [x] 인플루언서 대시보드 `sub_id` 성과(30일 클릭/유니크 세션/패키지 수) 노출
  - 파일: `src/app/api/influencer/dashboard/route.ts`
- [x] 이상탐지 크론에 `self_referral_suspected` 시그널 추가
  - 파일: `src/app/api/cron/affiliate-anomaly-detect/route.ts`
- [x] 파트너 신청 Invite-only 게이트(환경변수 기반) 적용
  - 파일: `src/app/api/partner-apply/route.ts`
  - 환경변수: `AFFILIATE_INVITE_CODES=CODE1,CODE2`
- [x] 링크 생성 시 `sub_id` 기반 shortlink 발급
  - 파일: `src/app/api/influencer/links/route.ts`

## Phase 1 — 귀속 정확도 향상 (진행 중)

- [x] `sub_id` 성과 리포트(30일 클릭/유니크/패키지) 대시보드 노출
- [x] 프로모코드 귀속(`promo_code -> affiliate`) 예약 플로우 연결
- [x] 예약 시 귀속 스냅샷(`attribution_model`, `attribution_split`) 저장
- [x] `sub_id`별 일 집계 테이블/크론 구축 (`affiliate_sub_attribution_daily`)
- [x] 멀티터치 모델 재계산 배치 추가 (`/api/cron/affiliate-attribution-recalc`)
- [x] 멀티터치 모델 3종 정책 테이블화(운영 UI 노출)
- [x] 모델 비교 지표 일 집계 캐시 테이블/크론 구축 (`affiliate_model_compare_daily`)

## Phase 2 — 전환 UX 강화 (대기)

- [x] 코브랜딩 랜딩 신뢰 배너 템플릿화 (`/with/[slug]`)
- [x] 팬 전용 가격 대비(일반가 vs 팬가) 1차 반영
- [x] 기간 한정 문구(72시간) 노출
- [x] 인플루언서 컨텍스트를 QA 챗봇 프롬프트에 주입
- [x] 파트너 포털 대시보드에 30일 퍼널/채널(Sub-ID)/리워드 이벤트 노출

## Phase 3 — 리텐션/락인 (대기)

- [x] 티어 게이지(대시보드) + 승급 보상 크론 초안
- [x] 휴면 복귀 자동 캠페인 크론 초안
- [x] 베스트 사례/CS 스크립트 허브 API
- [x] 파트너 포털에 성공사례/CS 스크립트 메뉴 연결
- [x] 실시간 수익 알림(15분 주기 축하 알림 크론) 초안
- [x] Lifetime 0.5% 장기 귀속 실험군 배포(할당+정산 배치)

## 파트너 포털 확장

- [x] `/influencer/[code]/products`에 `sub_id` 입력 기반 링크 생성
- [x] 파트너 프로모코드 CRUD API (`/api/influencer/promo-codes`)
- [x] 프로모코드 관리 UI(생성/사용량 조회) 1차 반영
- [x] 플레이북 UI (`/influencer/[code]/playbook`) 추가
- [x] 관리자 분석 화면에 멀티터치 모델 설정 UI 추가
- [x] 관리자 분석 화면에 최근 30일 Sub-ID 상위 성과 테이블 추가
- [x] 관리자 프로모코드 성과 리포트 페이지 추가 (`/admin/affiliate-promo-report`)
- [x] 관리자 분석 API가 Sub-ID 일집계 테이블 우선 사용
- [x] 관리자 분석 화면에 모델 비교 카드(First/Last/Linear 후보) 추가
- [x] 관리자 분석 화면에 모델 변경 영향 금액(커미션 풀) 표시
- [x] 관리자 분석 화면에 Sub-ID 일별 트렌드 카드 추가
- [x] 파트너 상세 화면에 프로모코드 성과 블록 추가
- [x] 프로모코드 리포트 기간 필터(7/30/90일) + CSV 내보내기 추가
- [x] 관리자 분석 화면에 크론 헬스 카드(최근 7일 성공/실패/마지막 실패) 추가

## 신규 크론

- `/api/cron/affiliate-attribution-recalc` (매일 06:30)
- `/api/cron/affiliate-sub-daily-rollup` (매일 06:20)
- `/api/cron/affiliate-model-compare-rollup` (매일 06:40)
- `/api/cron/affiliate-live-celebration` (15분마다)
- `/api/cron/affiliate-lifetime-commission` (매일 07:00)
- `/api/cron/affiliate-anomaly-detect` (매일 09:00)
- `/api/cron/affiliate-content-24h-report` (매일 09:00)
- `/api/cron/affiliate-tier-rewards` (매일 10:00)
- `/api/cron/affiliate-reactivation-campaign` (매일 11:00)
- `/api/cron/affiliate-settlement-draft` (매월 1일 02:00)
- `/api/cron/affiliate-dormant` (매월 1일 02:30)

## 운영 체크리스트

- [ ] 주간: 이상탐지 결과(`notify_affiliate_anomaly`) 리뷰
- [ ] 월간: 정산 기안/확정 누락 점검
- [ ] 분기: 셀프 리퍼럴 오탐률 샘플링 점검
- [ ] 반기: 등급/보상 정책 재학습
- [x] 주요 어필리에이트 크론 실패 시 `notify_affiliate_cron_failure` 액션 자동 적재
- [x] 주요 어필리에이트 크론 성공/실패 감사로그(`AFFILIATE_CRON_SUCCEEDED/FAILED`) 적재
- [x] 주요 어필리에이트 크론 `CRON_SECRET` 검증 적용(무단 호출 차단)
- [x] 휴면 비활성 크론의 `force` 인증 우회 제거(인증 강제)

