# 2026-07-19 고객 출시 직전 전수 감사

> 성격: 코드·계약·테스트·Git/PR 상태를 근거로 한 출시 준비 증거 문서. 현재 정책의 SSOT가 아니며, 각 도메인의 `*-current-ssot.md`가 우선한다.

## 1. 결론

**출시 판정: HOLD**

2026-07-19 기준으로 즉시 악용 가능한 관리자·고객·정산·관광지·백엔드 신뢰 경계 일부를 차단하고 PR까지 정리했다. Supabase JWT 신뢰 루트 수정도 PR #759의 전체 CI·Vercel·성능 분석 통과 후 main에 반영했다. 그러나 RFQ와 tenant portal의 교차 접근 경계는 단계적 rollout 전용 draft PR #760·#761에 머물러 있다. 결제 완료 기능의 검증 기반 재구축, 운영 브라우저 기반 시각·기능 검증, 정식 deep security scan도 남아 있다. 이 영역들이 닫히기 전에는 고객 전체 공개를 승인하지 않는다.

## 2. 감사 범위와 한계

### 조사 범위

- Next.js 고객/공개 화면, 공통 error boundary, mypage, package CTA
- `/admin`, `/m/admin`과 관리자 API
- 예약, billing key, voucher, checkout, Slack/Kakao webhook
- 정산·은행 거래 동기화와 Supabase migration history 정합성
- 관광지 후보 관리자 API
- RFQ와 tenant portal의 인증·tenant 경계
- CI, Vercel preview, Git worktree, 열린 PR, 오래된 브랜치 상태

### 근거

- 코드 기준 관리자 페이지 약 126개, API route 약 236개를 inventory하고 위험 route를 source-to-sink로 우선 검토했다.
- 변경마다 악성 요청과 정상 control을 포함한 focused regression test, changed-file ESLint, type-check, `git diff --check`, GitHub CI/Vercel을 사용했다.
- Supabase는 migration history와 schema를 read-only로 비교했으며 원격 schema/data mutation은 수행하지 않았다.

### 아직 완료되지 않은 검증

- 사용자 Chrome runtime이 연결되지 않아 desktop/mobile 실제 화면의 screenshot 비교, focus 이동, modal, overflow, 실제 CTA journey는 검증하지 못했다. 코드 기반 UX 감사만 완료했다.
- Codex Security의 정식 deep-security-scan 사전점검은 수행했지만, 현재 세션이 coordinator 포함 4개 thread라 정확히 6개 usable worker를 요구하는 규격을 충족하지 못해 `blocked` 판정을 받았다. 설정은 임의 변경하지 않았고 정식 scan은 시작하지 않았다. 이 문서는 정식 deep scan 결과를 주장하지 않는다.
- 실제 결제·예약·PII·외부 발행을 발생시키는 production smoke는 수행하지 않았다.

## 3. 완료된 P0 조치

| 영역 | 조치 | 증거/상태 |
|---|---|---|
| 정산 | Clobe bank memo 동기화, fingerprint, 예약 정산 키, migration history reconciliation | PR #752 merge, CI/Vercel green |
| 관광지 | entity-master candidate GET/PATCH를 admin-only, private/no-store로 변경 | PR #753 merge, CI/Vercel green |
| 관리자 인증 | `/admin`, `/m/admin`을 generic JWT가 아닌 실제 admin guard로 보호 | PR #754 merge, runtime auth regression 포함 |
| 민감 관리자 API | packages mutation, dashboard, capital, agent-actions를 admin-only로 보호하고 private/no-store 적용 | PR #754 merge |
| 고객 신뢰 | mypage fake booking/mileage 제거, 깨진 링크 제거, public error의 raw stack/message 노출 차단 | PR #754 merge |
| 리드/동의 | package CTA의 무동의 fake lead 전송 제거, placeholder name/phone 및 consent 미동의 거부 | PR #754 merge |
| 예약 생성 | `POST /api/bookings`가 body parse/DB 이전에 admin/server guard 요구 | PR #755 merge, 전체 CI/Vercel green |
| Webhook | Slack 서명 검증, Kakao 관리자센터 정적 `x-api-key`, 운영 secret 누락 fail-closed | PR #755 merge |
| Billing/Voucher | billing key와 voucher mutation admin/server guard, guide-token scope·결과 binding 재검증 | PR #755 merge |
| Voucher DB | route/page 인증 이후 service-role client 사용, anon client 회귀 차단 | PR #755 merge |
| Checkout | 호출자 제공 금액·PII를 신뢰하던 미사용 complete endpoint를 검증 재구축 전까지 503 차단 | PR #755 merge |
| Admin KPI | 하위 재무 API admin/private, KST 오늘 상한, 미래 출발 제외, 조회 실패와 실제 0원 구분 | PR #757 merge, 전체 CI/Vercel green |
| Blog 품질 | 본문·이미지 관련성 gate 강화와 안전하지 않은 fallback 재생성 연기 | PR #756·#758 merge, 전체 CI/Vercel green |

## 4. 열린 출시 차단 사항

### P0 — 출시 전 반드시 닫기

1. **Supabase JWT 신뢰 루트**
   - 기존 verifier가 검증 전 토큰의 `iss`를 JWKS 위치로 사용할 수 있는 신뢰 경계 문제를 확인했다.
   - configured Supabase URL에 issuer/JWKS를 고정하고 `aud`, role, UUID subject, expiry, algorithm을 검증하는 수정과 forged issuer 회귀 테스트를 PR #759에 분리했다.
   - PR #759는 전체 test, visual regression, Vercel, Lighthouse, bundle analysis를 통과한 뒤 squash merge했고 main merge commit은 `37ce1d74`다.

2. **RFQ·Tenant portal 단계적 rollout**
   - RFQ의 PII/message/proposal 경계, tenant ID spoofing, 공개 share mutation, tenant portal의 사용자→tenant 귀속을 보완한 코드는 각각 draft PR #760·#761에 있다.
   - 독립 재감사에서 RFQ 공유 메시지 내부 필드, 제안 입력·AI 출력 검증, reaction 남용, timeout 중복 실행, chat 회귀를 추가 발견해 #760에서 보강했다. Tenant 쪽은 공개 재고 상업 데이터, RFQ 자유입력 PII, tier unlock API 우회, 정산 오류의 0원 은폐를 #761에서 보강했다.
   - 두 PR은 #759가 반영된 최신 main을 재병합하고 교차 회귀 테스트·ESLint·전체 type-check를 통과했지만 의도적으로 merge-blocked 상태다. read-only 운영 schema/policy/history 확인, Phase-A membership migration 승인·적용, 실제 membership provisioning, RFQ·tenant Phase-B 동시 배포가 필요하다.
   - Phase-A migration은 membership table/index/grant/own-row RLS만 추가하는 additive 변경이다. authenticated RFQ direct access의 default-deny와 Jarvis 함수 권한 변경은 재작성·버전 고정·별도 승인이 필요한 Phase-C 제안으로 분리했다.
   - 이 감사에서는 Supabase 원격 migration apply/repair나 schema/data mutation을 수행하지 않았다. 운영 적용 전까지 main의 기존 RFQ RLS와 tenant 귀속 부재는 출시 차단 상태다.
   - RFQ owner-action token과 bid/select 원자적 RPC는 추가 P1 gate로 남아 있다.

3. **결제 완료 정상 기능**
   - 현재 endpoint는 안전을 위해 503으로 닫혀 있다.
   - 고객 결제를 열려면 provider 승인 결과와 DB 결제 레코드를 서버에서 재조회하고 금액·주문·고객 binding 및 idempotency를 검증해야 한다.

4. **실제 브라우저 QA**
   - 공개 홈→상품→CTA, 로그인→mypage, admin dashboard, mobile guide를 desktop/mobile에서 검증해야 한다.
   - reference와 동일 viewport/state의 screenshot 비교, keyboard focus, modal trap, overflow, reduced-motion을 포함한다.

5. **정식 deep security scan**
   - 코드 변경이 안정화된 뒤 variance-reduced multi-round scan과 finding validation을 별도 수행한다.

### P1 — 공개 직후로 미루지 않는 것을 권장

- Free-travel의 추정값/가상 데이터 provenance 표기
- Package fetch 실패를 빈 결과로 오인하게 하는 상태
- Group preset hash 불일치
- Chat widget/modal 접근성, landmark, legal link, reduced-motion
- CI의 accessibility 검증 경로 정상화
- Slack webhook replay/idempotency
- Session client singleton 경계, mileage RPC 인자 drift, 상태 전이 race
- Passport token race와 partner token 평문 저장
- Tenant-aware RBAC의 구조적 부재

## 5. Git·PR 정리 결과

### 이번 감사에서 처리

- PR #453, #569, #752, #753, #754 merge 완료
- #752의 migration version을 production-recorded history와 맞추고 신규 index는 forward-only migration으로 분리
- PR #755는 backend immediate P0 전용으로 분리하고 최신 main 병합·재검증 후 merge
- 사용자 소유 untracked 파일 `data/attractions/`, `yeosonam-os-gpt-analysis-20260710.zip` 보존
- dirty worktree `C:/dev/yeosonam-os-open-repair` 보존

### 보존한 오래된 PR/브랜치

- #749, #573, #570, #568, #352는 오래되거나 변경량이 크며 일부 유용 패치가 섞여 있다.
- 오래된 브랜치를 그대로 merge하지 않았고 필요한 작은 패치만 현재 main에 선별 반영했다.
- 폐기·close·강제 되돌리기는 복구 판단이 필요한 파괴적 조치이므로 명시 승인 전까지 보존한다.

### 별도 병행 변경

- #756 `fix(blog): harden content and image relevance`는 다른 작업 흐름에서 전체 CI/Vercel green 후 merge됐다.
- 실제 Pexels 후보 육안 검수와 기존 fallback 글 운영 정리는 코드 merge와 별개의 운영 gate로 남아 있다.
- #757 `fix(admin): correct and protect dashboard KPIs`는 독립 재검토 RELEASE-CLEAR, 최신 main 회귀 19개·ESLint·전체 type-check와 전체 CI/Vercel green 후 merge됐다.
- #758 `fix(blog): defer unsafe fallback regeneration`도 전체 CI/Vercel green 후 merge됐고, 이 감사 브랜치는 #758까지 포함한 최신 `origin/main`을 병합했다.
- #762 `fix(blog): repair private regeneration quality checks`도 전체 CI/Vercel/성능 분석 green 후 merge됐고, 감사·RFQ·tenant 세 브랜치 모두 해당 main을 다시 병합해 회귀 검증했다.

### 진행 중인 출시 PR

- #759 `fix(auth): pin Supabase JWT trust root`는 전체 CI/Vercel/성능 분석 green 후 merge했고 원격 작업 브랜치도 정리했다.
- #760 `draft: enforce RFQ tenant and persistence boundaries`는 draft/merge-blocked다. 최신 main 재병합 후 RFQ·JWT·middleware 교차 회귀 12 files/81 tests, ESLint, 전체 type-check, diff check를 통과했지만 rollout 선행 조건 전에는 merge하지 않는다.
- #761 `draft: enforce tenant portal membership isolation`은 draft/merge-blocked다. 최신 main 재병합 후 tenant·JWT·middleware 교차 회귀 7 files/78 tests, ESLint, 전체 type-check, migration 검증을 통과했다. CI의 기존 admin-only 정적 계약과 새 tenant-membership 계약 충돌도 수정·재검증했지만 rollout 선행 조건이 남아 있다.

## 6. 출시 게이트

| Gate | 통과 조건 | 현재 |
|---|---|---|
| Git/CI | 대상 PR 전체 required check + Vercel green, main 반영 확인 | #759까지 main 반영, #760·#761 draft 유지 |
| Auth/tenant | admin, RFQ, tenant portal의 서버측 귀속 검증 | 미통과 |
| Money | 결제 완료의 provider/DB-backed verification + idempotency | 미통과 |
| PII | 공개/교차 tenant 조회 불가, 로그·error 노출 없음 | 부분 통과 |
| DB | migration history 정합, 승인된 forward-only migration | 부분 통과 |
| Customer UX | 실제 desktop/mobile 핵심 journey와 오류 상태 검증 | 미검증 |
| Security | 정식 deep scan 결과에서 validated P0/P1 없음 | 미검증 |
| Operations | 필수 secret/env, alert, rollback, owner 확인 | 미검증 |

## 7. 병렬 작업 구역

1. Backend boundary: PR #755 merge와 전체 CI/Vercel green 확인 완료
2. JWT trust root: PR #759 전체 CI/Vercel green 후 merge 완료
3. RFQ: PR #760 최신 main 재병합·교차 검증 완료, tenant rollout과 함께 Phase-B 준비
4. Tenant portal: PR #761 최신 main 재병합·교차 검증 완료, additive Phase-A 승인·membership provisioning·Phase-B 배포 준비
5. Admin KPI: PR #757 merge와 전체 CI/Vercel green 확인 완료
6. Visual QA: 사용자 Chrome 연결 후 desktop/mobile journey
7. Security closure: 코드 동결 뒤 정식 deep scan 및 validated finding 수정

## 8. 최종 공개 판단 규칙

P0 항목 하나라도 열려 있거나 실제 브라우저 핵심 journey가 미검증이면 `HOLD`를 유지한다. 모든 P0가 merge되고 main CI/Vercel, 운영 설정, browser QA, 정식 security validation이 완료된 뒤에만 `GO`로 전환한다.
