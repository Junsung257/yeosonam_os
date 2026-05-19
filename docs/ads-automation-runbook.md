# 광고 자동화 — 사장님 1페이지 운영 가이드

> 시간당 cron 이 광고 잔액 동기화 + ROAS 기준 키워드 PAUSE/BID + 자정 1회 롱테일 발굴.
> 모든 코드 인프라는 박혀있고, **API 키 등록 + APPLY_CHANGES 토글만으로 작동**.
> 작동 상태는 `/admin/marketing/ads-automation` 에서 한 화면 확인.

---

## 0. 안전 모드 (기본값)

| Vercel env | 기본값 | 의미 |
|---|---|---|
| `AD_OPTIMIZER_APPLY_CHANGES` | **`false`** | 외부 광고 플랫폼에 적용 안 됨 (dry-run 로그만) |
| `AD_OPTIMIZER_APPLY_OFFPEAK_RULE` | `false` | 새벽 1-7시 입찰 0.85× 자동 감액 OFF |
| `AD_ROAS_TARGET_PCT` | `150` | ROAS < 150% 키워드는 PAUSE 후보 |
| `AD_FLAG_UP_BID_FACTOR` | `1.1` | 순익 상위 20% 키워드 입찰가 ×1.1 자동 상향 |
| `AD_OFFPEAK_BID_FACTOR` | `0.85` | 새벽 감액 배수 |
| `AD_MIN_BID_KRW` | `70` | 입찰 하한 |
| `AD_LONGTAIL_CPC_MAX` | `100` | 롱테일 CPC 상한 (이하만 발굴 큐 등록) |

**키 등록 후에도 `APPLY_CHANGES=true` 박을 때까지 외부 변경은 0건**. 1~2주 dry-run 로그 검토 권장.

---

## 1. Meta (페이스북·인스타) — 5분 발급

| 단계 | 어디서 | 결과물 |
|---|---|---|
| 1 | https://business.facebook.com → 비즈니스 설정 → 시스템 사용자 | 시스템 사용자 생성 (`ads_management` + `pages_read_engagement` 권한) |
| 2 | 위 시스템 사용자 → 토큰 생성 → **만료 없음** 선택 | `META_ACCESS_TOKEN` (긴 문자열) |
| 3 | 비즈니스 광고 관리자 좌측 상단 | `META_AD_ACCOUNT_ID` ← `act_숫자` 형식 |
| 4 | 비즈니스 페이지 → 정보 → 페이지 ID | `META_PAGE_ID` ← 숫자 |
| 5 | Vercel → Project → Settings → Environment Variables | 위 3개 등록 후 Redeploy |

**완료 직후 작동**: 시간당 cron 이 잔액 동기화 + 임계값 미달 시 Slack 알림.

---

## 2. 네이버 검색광고 — 당일 발급

| 단계 | 어디서 | 결과물 |
|---|---|---|
| 1 | https://manage.searchad.naver.com 로그인 → 우측 상단 도구 → API 사용 관리 → 신규 API 라이선스 | API Key + Secret Key + Customer ID |
| 2 | Vercel env 3개 등록 | `NAVER_AD_API_KEY` / `NAVER_AD_SECRET` / `NAVER_AD_CUSTOMER_ID` |
| 3 | Redeploy | — |

**완료 직후 작동**:
- 키워드 성과 매시간 조회 (impressions/clicks/ctr/cpc/conversions/spend)
- ROAS 분석 + dry-run 로그
- 자정 1회 `/keywordstool` 로 롱테일 발굴 → DB upsert (`is_longtail=true`)

---

## 3. Google Ads — 1~3주 (Developer Token 승인 대기)

### 3-1. Basic Access 신청 (오늘 바로)

| 단계 | 어디서 | 결과물 |
|---|---|---|
| 1 | https://ads.google.com → Manager Account (MCC) 로그인. 없으면 무료 추가 생성 | — |
| 2 | 우측 상단 도구 → API 센터 → **Apply for Basic Access** | 신청서 제출 |
| 3 | 신청 폼 (회사 정보 + 사용 목적: 키워드 자동 최적화 + 예상 일일 호출 ~100건) | Google 승인 메일 (영업일 3~14일) |
| 4 | 승인 후 API 센터에서 | **22자 Developer Token** = `GOOGLE_ADS_DEVELOPER_TOKEN` |

### 3-2. OAuth Client 발급 (Developer Token 받은 후)

| 단계 | 어디서 | 결과물 |
|---|---|---|
| 1 | https://console.cloud.google.com → 프로젝트 선택 → API 및 서비스 → 사용자 인증 정보 | "OAuth 2.0 클라이언트 ID" 생성 (Web application) |
| 2 | 승인된 리디렉션 URI: `https://www.yeosonam.com/api/auth/google-callback` | — |
| 3 | 생성 완료 | `GOOGLE_ADS_CLIENT_ID` + `GOOGLE_ADS_CLIENT_SECRET` |
| 4 | Vercel env 등록 (이 두 개 + `GOOGLE_ADS_DEVELOPER_TOKEN` + `GOOGLE_ADS_CUSTOMER_ID`) | — |
| 5 | https://www.yeosonam.com/admin/marketing/ads-automation 접속 → **🔑 Google Ads OAuth 시작** 버튼 클릭 | Google 로그인 → 자동 콜백 → `tenant_api_tokens` DB 에 refresh_token 암호화 저장 |
| 6 | Vercel env 에 `GOOGLE_ADS_REFRESH_TOKEN` 도 등록 (DB 저장과 별개로 SDK 호출용) | — |

**완료 직후 작동**: 네이버와 같은 흐름 (성과 조회 + ROAS 분석 + 롱테일 발굴).

---

## 4. 자동화 ON 전환 (전체 키 등록 + 1~2주 dry-run 검토 후)

1. `/admin/marketing/ads-automation` 에서 **3 플랫폼 모두 ✓ 등록됨** 확인
2. dry-run 로그 1~2주 검토 (예상보다 너무 많이 PAUSE 하는지 등)
3. Vercel env 에 `AD_OPTIMIZER_APPLY_CHANGES=true` 박음 → Redeploy
4. 시간당 cron 이 **실제 광고 플랫폼에 PAUSE/BID 적용 시작**
5. 잔액 부족 시 Slack + `/admin/marketing/ads-automation` 페이지 자동 표시

---

## 5. 트러블슈팅

| 증상 | 원인 | 조치 |
|---|---|---|
| 어드민 페이지에 "키 필요" 가 계속 표시 | env 미등록 또는 오타 | Vercel env 이름 확인 (NAVER_AD vs NAVER_ADS 주의) |
| dry-run 로그도 0건 | cron 미실행 또는 keyword_performances 비어있음 | `/api/cron/ad-optimizer?cron_secret=...` 수동 실행, DB 확인 |
| Google OAuth 버튼 클릭 후 "tenant_id 필수" | `tenants` 테이블 비어있음 | DB seed 확인 |
| PAUSE 됐는데 외부 광고 그대로 | APPLY_CHANGES=false | env 토글 ON |

---

## 6. 비용 추정 (보수적)

업계 평균 광고 자동 최적화 ROI = **광고비 15~25% 절감 + 광고 매니저 인건비 100% 절감**.

| 월 광고비 | 15% 절감 시 | 1년 절감 |
|---|---|---|
| 100만원 | 15만원 | **180만원** |
| 300만원 | 45만원 | **540만원** |
| 500만원 | 75만원 | **900만원** |

---

**관련 코드**:
- 분석 두뇌: [`src/lib/ad-controller.ts`](../src/lib/ad-controller.ts)
- 네이버 호출: [`src/lib/naver-ads/`](../src/lib/naver-ads/)
- 구글 호출: [`src/lib/google-ads/client.ts`](../src/lib/google-ads/client.ts)
- 메타 호출: [`src/lib/meta-api.ts`](../src/lib/meta-api.ts)
- 시간당 cron: [`src/app/api/cron/ad-optimizer/route.ts`](../src/app/api/cron/ad-optimizer/route.ts)
- 어드민 페이지: [`src/app/admin/marketing/ads-automation/page.tsx`](../src/app/admin/marketing/ads-automation/page.tsx)
- 상태 API: [`src/app/api/admin/ads-automation/status/route.ts`](../src/app/api/admin/ads-automation/status/route.ts)
