# 블로그 검색 품질 일일 프로세스

## 기준

우리 블로그의 실제 발행 원본은 네이버 블로그가 아니라 `https://www.yeosonam.com/blog` 입니다. DB 채널명이 `naver_blog`여도 운영 기준은 다음 순서입니다.

1. 네이버 검색 노출 가능성
2. 구글 색인 안정성
3. 글 품질, 이미지, 렌더링, CTA, 예약 전환
4. 기존 글 수리 결과를 다음 글 생성 프롬프트에 반영

네이버 블로그 직접 발행은 아직 활성 기능이 아닙니다. `src/lib/naver-blog-export.ts`는 어댑터 스텁이고, 현재 자동화의 목표는 자체 `/blog` 글을 네이버와 구글 검색 기준에 맞게 관리하는 것입니다.

## 100점 계산식

품질 통과는 평균 점수가 아니라 하드게이트입니다.

- `PASS`: 모든 필수 검사가 성공하고, 실패 항목 0개, 런타임 오류 0개, 보고 점수 100점
- `FAIL`: 위 조건 중 하나라도 깨진 상태
- `strictScore`: 진단용 점수입니다. `critical -25`, `major -15`, `minor -5`를 100점에서 차감합니다.
- `fleetScore`: 전체 검사 대상 중 100점 상태인 비율입니다. 예: 30개 중 18개만 100점이면 `60/100`

즉 `avg=92/100`이어도 실패 글이 있으면 전체 결과는 실패입니다.

## 실행 명령

기본 일일 샘플 감사:

```bash
npm run audit:blog-search-daily
```

실패 시 종료코드까지 엄격하게 받고 싶을 때:

```bash
npm run audit:blog-search-daily:strict
```

전체 공개 글과 전체 sitemap 기준 최종 감사:

```bash
npm run audit:blog-search-full
```

로컬 서버 기준 확인:

```bash
npm run audit:blog-search-daily -- --base=http://localhost:3000 --preferred-origin=http://localhost:3000
```

결과 JSON은 `.tmp/blog-search-quality-daily-*.json`에 저장됩니다.

## 검사 항목

`audit:blog-search-daily`는 다음 필수 검사를 묶어서 실행합니다.

- `render_integrity`: 마크다운 원문 노출, 깨진 본문 구조, 렌더링 오류
- `image_quality`: 깨진 이미지, alt 누락, 중복 이미지
- `seo_quality`: 제목, H1/H2, 롱테일 키워드, 내부 링크, 구조화 데이터
- `editorial_intent`: 날씨/준비물/일정/비자/환전 등 글 의도별 필수 블록
- `revenue_funnel`: 상품 추천, CTA, 클릭/문의/예약 추적
- `google_domain`: www canonical, OG URL, sitemap origin, GSC 도메인 정합성
- `site_indexability`: robots, noindex, canonical mismatch, duplicate title

## 색인 처리 원칙

Google 일반 블로그 글은 Indexing API 강제 제출을 기본값으로 쓰지 않습니다. 우리 시스템은 sitemap 제출, GSC URL Inspection, canonical/indexability 감사를 우선합니다.

Naver는 Search Advisor/IndexNow 상태와 네이버 SERP 의도를 우선합니다. 글 생성 프롬프트는 네이버 검색 의도와 롱테일 키워드에 맞추고, 발행 후에는 IndexNow와 sitemap 상태를 봅니다.

## 수리 루프

매일 검사 결과가 실패하면 다음 순서로 처리합니다.

1. 새 글 발행 또는 재색인 요청을 차단합니다.
2. 실패 글의 제목, 본문, 표/리스트, 공식 출처, 이미지, CTA를 수리합니다.
3. 같은 글을 다시 `audit:blog-search-daily:strict`로 확인합니다.
4. 100점 글만 재색인 요청 대상에 넣습니다.
5. 같은 실패가 2회 반복되면 자동 수리 대신 수동 검토 대상으로 전환합니다.
6. 반복 실패 패턴은 `blog-learn`, prompt version, deterministic gate 중 하나에 반영합니다.

## 일일 요약 API

`/api/cron/blog-daily-summary`는 `search_standard`를 포함합니다.

- `search_standard.primary_market = naver`
- `search_standard.secondary_market = google`
- `search_standard.naver.indexnow_success_rate`
- `search_standard.google.sitemap_success_rate`
- `search_standard.health_issues`

Naver IndexNow 또는 Google sitemap 성공률이 80% 미만이면 `admin_alerts`에 `blog_search_indexing` 알림을 남깁니다.
