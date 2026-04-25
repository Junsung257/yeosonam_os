# 여소남 OS 환경변수 레퍼런스

> Vercel 프로젝트 환경변수 설정 가이드 — Production 배포 전 필수 확인

## 🔑 필수 (Required) — 설정 안 하면 앱 작동 불가

| 키 | 용도 | 예시 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase 프로젝트 URL | `https://ixaxnvbmhzjvupissmly.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase 익명 키 (클라이언트) | `eyJhbGciOi...` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase 서비스 키 (서버) | `eyJhbGciOi...` |
| `NEXT_PUBLIC_BASE_URL` | 사이트 루트 URL | `https://yeosonam.com` |
| `GOOGLE_AI_API_KEY` | Gemini 2.5 Flash (블로그·카드뉴스·Pillar 생성) | `AIza...` |

## 📨 알림톡 (Solapi) — 배포 시점에 전부 없음, 추후 등록 필요

**⚠️ 현재 `.env.local` 에 Solapi 계열 키 0개.** 없어도 앱은 작동하지만, 알림톡은 skip + DB 로그만 남음.

| 키 | 용도 | 등록 필요도 |
|---|---|---|
| `SOLAPI_API_KEY` | Solapi API 키 | 🔴 알림톡 쓰려면 필수 |
| `SOLAPI_API_SECRET` | Solapi API Secret | 🔴 |
| `KAKAO_SENDER_NUMBER` | 발신번호 (예: 051-000-0000) | 🔴 |
| `KAKAO_TEMPLATE_REVIEW_REQUEST` | 리뷰 요청 (post-travel 크론) | 🔴 [가이드](./solapi-review-template-guide.md) |
| `KAKAO_TEMPLATE_BALANCE` | 잔금 안내 | 🟡 |
| `KAKAO_TEMPLATE_PASSPORT` | 여권 만료 경고 | 🟡 |
| `KAKAO_TEMPLATE_PREPARATION` | D-7 준비물 | 🟡 |
| `KAKAO_TEMPLATE_VOUCHER_ISSUED` | 바우처 발행 | 🟡 |
| `KAKAO_TEMPLATE_AFFILIATE_CELEBRATION` | 제휴 축하 | 🟢 |
| `KAKAO_CHANNEL_ID` | 서버용 채널 ID (`NEXT_PUBLIC_KAKAO_CHANNEL_ID` 와 같은 값) | 🟡 |

**승인 소요**: 각 템플릿 1~2일. 병렬로 여러 개 신청 가능.

## 🤖 자기학습 (Self-Learning) — 블로그 프롬프트 자동 개선

| 키 | 용도 | 기본값 |
|---|---|---|
| `AUTO_APPROVE_LEARNING` | 학습 제안 자동 승인 | `false` (HITL 권장) |

**`true` 로 설정 시**: `blog-learn` 크론(매주 일 23시)이 성과 분석 후 즉시 `prompt_versions` 신규 활성화.
**`false` (기본)**: `/admin/agent-actions` 에 제안만 등록. 사장님 승인 필요.

## ✉️ 알림 · 색인 API (선택)

| 키 | 용도 |
|---|---|
| `INDEX_NOW_KEY` | Bing/네이버 IndexNow API 키 |
| `GOOGLE_INDEXING_CREDENTIALS` | Google Indexing API 서비스 계정 JSON |
| `SLACK_WEBHOOK_URL` | Slack 어드민 알림 |
| `REVALIDATE_SECRET` | ISR 강제 무효화 시크릿 |

## 📊 트래킹 · 광고 (선택)

| 키 | 용도 |
|---|---|
| `META_ACCESS_TOKEN` | Meta Ads 광고 API (배포 상태) |
| `META_AD_ACCOUNT_ID` | Meta 광고 계정 |
| `META_PAGE_ID` | Meta 페이지 |
| `GOOGLE_ADS_*` | Google Ads API (미구현, 향후) |
| `NAVER_AD_*` | 네이버 검색광고 API (미구현, 향후) |

## 🔄 외부 API (선택)

| 키 | 용도 |
|---|---|
| `PEXELS_API_KEY` | 이미지 fallback (블로그·카드뉴스) |
| `ANTHROPIC_API_KEY` | Claude API (IR 파이프라인용) |

## 🏗 배포 (Vercel 자동 관리)

| 키 | 설정 |
|---|---|
| `VERCEL_URL` | Vercel 자동 주입 |
| `NODE_ENV` | `production` / `preview` 자동 |

---

## 🚨 누락 시 영향도

| 누락 변수 | 영향 |
|---|---|
| `GOOGLE_AI_API_KEY` 없음 | 블로그 자동 생성 fallback (하드코딩 시즌 토픽만 사용) |
| `SOLAPI_*` 없음 | 알림톡 발송 실패, DB 로그만 남음 |
| `KAKAO_TEMPLATE_REVIEW_REQUEST` 없음 | 리뷰 요청 알림톡 skip. 콘솔 경고만 |
| `AUTO_APPROVE_LEARNING=false` | 자기학습 수동 승인 필요 (권장 모드) |
| `PEXELS_API_KEY` 없음 | 이미지 없이 블로그 생성 (품질 저하) |

## 📝 로컬 개발용 .env.local 예시

```bash
# 필수
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_key
NEXT_PUBLIC_BASE_URL=http://localhost:3000
GOOGLE_AI_API_KEY=your_gemini_key

# Solapi (있을 시)
SOLAPI_API_KEY=your_solapi_key
SOLAPI_API_SECRET=your_solapi_secret
SOLAPI_SENDER_NUMBER=051-000-0000
KAKAO_TEMPLATE_REVIEW_REQUEST=TEMPLATE_ID_FROM_SOLAPI

# 외부 API
PEXELS_API_KEY=your_pexels_key
ANTHROPIC_API_KEY=your_claude_key

# 선택
AUTO_APPROVE_LEARNING=false
REVALIDATE_SECRET=your_random_secret
```
