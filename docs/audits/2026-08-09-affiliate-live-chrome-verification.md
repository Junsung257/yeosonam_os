# 어필리에이트 라이브 Chrome 검증 — 2026-08-09

## 범위

로그인된 Chrome 세션에서 `https://www.yeosonam.com`의 공개 신청, 파트너 포털, 코브랜딩 랜딩, 레거시 포털, 관리자 제휴 화면을 읽기 전용으로 확인했다. 신청 제출·로그인 시도·예약·정산·지급·데이터 변경은 실행하지 않았다.

## 판정

운영 사이트는 **출시 보류**다. 현재 운영 빌드는 `affiliate-critical-remediation` 브랜치의 정본 포털·약관·세션·원장 변경을 반영하지 않은 이전 빌드로 보인다. 로컬 수정본에는 해당 라우트와 계약이 존재하므로, 우선 스테이징 배포 후 동일 검증을 재실행해야 한다.

## 확인된 증거

| 영역 | 실제 결과 | 판정 |
|---|---|---|
| 정본 포털 | `/partner`가 토큰 안내만 표시 | 이전 포털 노출 |
| 정본 로그인/상품 | `/partner/login`, `/partner/products`, `/partner/onboarding` 404 | P0 |
| 정본 API | `/api/partner/catalog`, `/api/partner/terms` 404 | P0 |
| 신청 | `/partner-apply` 폼은 열리지만 필수 약관·광고 표시 동의 UI 없음 | P0 |
| 혜택 표시 | 여러 화면에 `TEST2026` 제휴 혜택 배너 노출 | 허위/테스트 상태 노출 |
| 코브랜딩 | `/with/TEST2026` 404 | 관리자 링크와 공개 랜딩 불일치 |
| 인증 | `/affiliate/login`과 `/influencer/TEST2026`가 레거시 PIN 인증 사용 | 정본 인증 미전환 |
| 콘텐츠 API | `/api/influencer/content?code=...`가 인증 없이 빈 목록 반환 | 인증 계약 미반영 가능성 |
| 관리자 프로필 | `/admin/affiliate-profiles` 404 | 운영 검토 화면 미배포 |
| 분석 | 크론 0/0을 100%로 표시 | `never_run` 계약 미반영 |
| 차단 동작 | 비인증 `/influencer/TEST2026/products`는 인증 요구 표시 | 부분 정상 |

## 후속 게이트

1. `affiliate-critical-remediation`를 스테이징에 배포하고 Supabase reversible migration을 적용한다.
2. 정본 `/partner` 라우트, `/api/partner/*`, 약관 동의, 초대·OTP, `affiliate_sessions`를 스테이징에서 확인한다.
3. 활성 상태인 테스트 파트너와 일회용 초대 링크로 인증된 Chrome 세션을 만든다.
4. 승인 → 활성화 → 상품 선택 → publication 생성 → 테스트 클릭 → 예약 귀속 → ledger → 정산서 PDF 순서로 실행한다.
5. 동일한 URL 목록을 운영에서 재확인하고, 404·테스트 배너·레거시 PIN·인증 없는 콘텐츠 응답이 없을 때만 출시 판정을 갱신한다.

## 변경 사항

- 관리자 파트너 미리보기의 포털 링크를 `/influencer/{code}`에서 세션 기반 `/partner`로 변경했다.
- 관리자 파트너 상세의 로그인 링크를 `/partner/login`으로 통일했다.
- 정본 라우트·API·프로필 검토 화면 존재 여부를 계약 테스트로 고정했다.
