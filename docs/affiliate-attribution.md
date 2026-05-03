# 제휴(어필리에이터) 유입·정산 기준 — 운영 메모

## 유입 식별

- **`?ref=추천코드`** 또는 **`/with/추천코드`** 진입 시 브라우저에 **`aff_ref` 쿠키(최대 30일)** 가 설정됩니다. (ASCII 추천코드는 **대문자로 정규화**되어 저장·조회되어 소문자 링크에서도 동일 파트너로 귀속됩니다.)
- 이후 같은 브라우저에서 예약 API가 쿠키를 읽어 **`bookings.affiliate_id`** 및 예약 시점 커미션 스냅샷을 남깁니다.

## 코브랜딩 랜딩 조회수

- `/with/…` 페이지는 `affiliate_touchpoints.sub_id = 'co_brand_landing'` 로 **방문 1회마다 best-effort 기록**합니다.
- 파트너 대시보드의 **「최근 30일 방문」**은 이 기록을 집계합니다.

## 정산과의 관계

- 정산 주기·자격(귀국일·상태·최소 건수·금액 등)은 **`settlement-calc.ts` · `settlements` 테이블**이 SSOT입니다.
- 파트너 화면의 정산·예약 금액은 **운영 어드민과 동일 DB 필드**를 사용하도록 맞춰 두었습니다.

## 법·동의 (PIPA 2026-09 대비)

- 마케팅 동의·쿠키 정책은 `src/lib/consent.ts` 및 **`/legal/partner-attribution`** 고객 안내와 함께 검토합니다.
- 동의 배너를 다시 켤 경우, 미들웨어의 `aff_ref` 발급을 **`hasMarketingConsent` / 쿠키**와 연동하는 것을 권장합니다.

### 환경 변수 (서버)

| 변수 | 설명 |
|------|------|
| `AFFILIATE_REF_STRICT_MARKETING_CONSENT=true` | `ys_marketing_consent=true` 가 있을 때만 `aff_ref` **30일**. 없으면 **세션 쿠키**만 발급 (`?ref=`, `/with/`, `/api/influencer/track` 공통). |
| (미설정 또는 그 외) | 기존과 동일하게 **항상 30일** `aff_ref` (사장님 암무동의 운영). |

클라이언트에서 마케팅 동의 시 `setMarketingConsent(true)` 가 `ys_marketing_consent` 쿠키를 심습니다 (`consent.ts`).
