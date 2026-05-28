# 게이미피케이션 시스템 운영 런북

> 최종 갱신: 2026-05-28

## 개요

고객 충성도 향상을 위한 게이미피케이션 시스템. 마일스톤, 배지, 출석체크, 챌린지로 구성됨.

- **코드 위치**: `src/lib/gamification-service.ts`
- **DB 마이그레이션**: `supabase/migrations/20260528170000_mileage_expiration_and_badges.sql`, `20260528173000_mileage_challenges.sql`
- **API 진입점**: `src/app/api/gamification/checkin/route.ts`, `src/app/api/gamification/challenges/route.ts`

## 기능별 설명

### 마일스톤 (Milestones)
누적 결제액 구간별 보상. 보상은 마일리지 적립 + 선택적 배지.

| 임계값 | 레이블 | 보너스 마일리지 |
|--------|--------|----------------|
| 1,000,000 | 첫 100만 | 10,000P |
| 3,000,000 | 300만 달성 | 30,000P |
| 5,000,000 | 500만 달성 | 50,000P |
| 10,000,000 | 1000만 달성 | 100,000P |

- 마일리지 적립 시 `mileage_transactions`에 `EARNED` 타입으로 기록, `expires_at` 설정
- `increment_customer_mileage` RPC 호출로 고객 잔액 갱신

### 배지 (Badges)
고객의 활동(출석체크 스트릭, 마일스톤 달성 등)에 따라 배지 부여.

- **테이블**: `customer_badges` (마이그레이션 파일 참조)
- **API**: `GET /api/customers/me/badges`

### 출석 체크 / 스트릭 (Check-in / Streak)
일일 출석 체크, 연속 출석일에 따른 보상.

- **API**: `POST /api/gamification/checkin` — 당일 첫 출석 체크 (멱등성 보장)
- **API**: `GET /api/gamification/checkin` — 현재 스트릭 조회
- **스트릭 보상**: 7일 연속 500P, 30일 연속 3,000P

### 챌린지 (Challenges)
시즌별/기간 한정 도전 과제. 자동 진행도 추적.

- **API**: `GET /api/gamification/challenges` — 진행 중인 챌린지 목록
- **API**: `POST /api/gamification/challenges` — 챌린지 생성 (관리자 전용)

## 관련 파일

| 파일 | 역할 |
|------|------|
| `src/lib/gamification-service.ts` | 핵심 로직 (마일스톤/배지/출석/챌린지) |
| `src/lib/mileage-expiration.ts` | 마일리지 만료일 계산 |
| `src/lib/mileage-service.ts` | 마일리지 적립/사용 |
| `src/app/api/gamification/*` | API 라우트 |
| `src/app/api/customers/me/badges/route.ts` | 배지 조회 API |
| `src/app/mypage/mileage/page.tsx` | 마이페이지 마일리지/게이미피케이션 화면 |

## 운영 주의사항

1. 마일리지 보상 시 반드시 `expires_at`을 설정할 것 (유효기간은 `app_settings`의 `mileage_validity_months` 참조)
2. 출석 체크는 `ON CONFLICT DO NOTHING`으로 멱등성 보장
3. 마일스톤 달성 체크는 `checkAndAwardMilestones()` 호출로 트리거
