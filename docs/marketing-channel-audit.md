# 마케팅 채널 전수조사 결과 — 2026-05-26

> 이 문서는 여소남 OS의 모든 마케팅 채널을 전수 조사한 결과와 개선 내역을 기록합니다.

---

## 채널 현황 요약

| 채널 | 상태 | 색인/발행 | 우선순위 |
|------|------|-----------|---------|
| **블로그 (naver_blog)** | 발행 중 (32건 published) | IndexNow(Bing) ✅, Google ❌ (JWT 에러) | **P0** |
| **Threads** | **활성화 완료** ✅ (원래 disabled) | 아직 발행 이력 없음 | P1 |
| **Instagram** | `enabled=false` | 발행 안 됨 | P2 |
| **Facebook** | `enabled=false` | 발행 안 됨 | P2 |
| **Twitter/X** | `enabled=false` | Bearer Token 미설정 | P2 |
| **Naver Cafe** | `enabled=false` | NAVER_CAFE_ID 미설정 | P2 |
| **Meta Ads** | DRY_RUN=1 | 광고 구조는 있으나 실제 집행 안 됨 | P2 |
| **Google Ads** | Google Ads 키 미설정 | 시작 전 | P3 |
| **Naver SearchAd** | `NEXT_PUBLIC_NAVER_ADS_*` 설정됨 | 미사용 상태 | P3 |

---

## 블로그 현황

### 발행 통계

| 지표 | 값 |
|------|-----|
| 전체 발행 글 | 32건 (naver_blog, published) |
| 보관됨 | 15건 |
| Draft | 11건 + 2건 (instagram_card, google_search) |
| slug 한글 포함 | 다수 (예: `일본-포켓와이파이-vs-...`) |
| `og_image_url` null | **83%** (대부분 null) |
| `view_count` | 0~3 (거의 조회 안 됨) |
| `landing_enabled` | 전부 false |

### 발견된 문제 (조치 완료)

1. **✅ slug를 영문/로마자 기반으로 생성** (한글 제거)
   - `src/app/api/blog/generate/route.ts` 수정
   - `slugifyTopic()` 함수로 변경 (한글 대신 로마자 slug)
   - 템플릿(API 키 없을 때)도 동일 적용

2. **✅ SEO description 카테고리별 맞춤형 템플릿**
   - `src/app/api/cron/blog-publisher/route.ts` 수정
   - 비자/입국 → 서류 정보 중심
   - 일정 → 경비/맛집 중심
   - 준비 → 체크리스트 중심
   - 현지정보 → 맛집/교통 중심
   - 기본 → 실용 여행 정보

3. **✅ 발행 시 OG 이미지 자동 할당 (Pexels)**
   - `generateFromTopic`에 Pexels 이미지 검색 로직 추가
   - destination 기반 키워드로 cover image 자동 첨부

### 발견된 문제 (해결 필요)

4. **🔴 Google Indexing API 전부 실패**
   - `google_error: "invalid_grant: Invalid JWT Signature."`
   - Service Account Private Key 만료/불일치
   - **조치 필요**: Google Cloud Console에서 새 JSON 키 발급 → `.env.local` + Vercel 업데이트
   - IndexNow(Bing)는 정상 작동 중

5. **⚠️ 발행된 한글 slug 글들은 수정 필요**
   - 기존 32개 글 중 한글 slug 포함된 글들 리라이팅 또는 redirect 필요
   - slug가 이미 DB에 저장되어 있어 당장 수정 어려움
   - 향후 신규 글은 `slugifyTopic`으로 영문 slug 생성

---

## Threads

### 현재 상태 (조치 완료)

| 항목 | 값 |
|------|-----|
| 환경변수 | ✅ `THREADS_ACCESS_TOKEN`, `THREADS_USER_ID` 설정됨 |
| DB 설정 | ✅ `social_platform_configs.enabled=true` (기존 false) |
| 발행 이력 | ❌ 아직 없음 (content_distributions에 threads 행 0건) |
| 발행 가능 | ✅ `src/lib/threads-publisher.ts` — Meta Graph API v1.0 |
| 토큰 리프레시 | `meta-token-resolver.ts` → `tenant_api_tokens` 테이블에서 조회 |
| 본문 검증 | ✅ `validateThreadsBody()` — 500자 제한, engagement-bait 탐지 |

### 자동 발행 조건

마케팅 파이프라인이 `content_distributions`에 `platform='threads_post'`, `status='approved'`인 행을 만들면 자동 발행 후보가 됩니다.
social_platform_configs가 활성화되었으므로, 다음에 크론이 돌 때 Threads 발행을 시도합니다.

---

## Sitemap / robots.txt

### 상태 (조치 완료)

| 항목 | 이전 | 이후 |
|------|------|------|
| **robots.txt** | 없음 | **추가됨** (Next.js MetadataRoute.Robots) |
| Sitemap | 정상 생성 | 유지 |
| Sitemap blog 경로 | `channel='naver_blog'` 발행 글 | 유지 |

robots.txt에서 `/admin/`, `/api/`, `/m/`, `/login`, `/register`는 `Disallow` 처리.

---

## Social Platform Configs (DB)

최종 상태:

| 플랫폼 | enabled | account_id | 비고 |
|--------|---------|------------|------|
| threads | ✅ true | 26487653514247617 | 활성화 완료 |
| instagram | ❌ false | null | META_IG_USER_ID 있음 |
| facebook | ❌ false | null | META_PAGE_ID 있음 |
| twitter | ❌ false | null | TWITTER_BEARER_TOKEN 미설정 |
| naver_cafe | ❌ false | null | NAVER_CAFE_ID 미설정 |

---

## 다음 액션

| 우선순위 | 작업 | 담당자 |
|---------|------|--------|
| **P0 🔴** | Google Cloud Console → Service Account 새 JSON 키 발급 | **사용자 필요** |
| P1 | Google 색인 문제 해결 후 전체 블로그 재색인 요청 | 키 발급 후 진행 |
| P1 | Threads 첫 발행 테스트 | 자동 (크론) |
| P2 | Instagram/Facebook 활성화 (토큰 필요) | 추후 |
| P2 | Meta Ads DRY_RUN 해제 검토 | 추후 |
| P3 | Google Ads / Naver SearchAd 연동 | 추후 |
