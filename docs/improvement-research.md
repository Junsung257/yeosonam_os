# 여소남 OS — 개선 리서치 종합 보고서

> **생성일**: 2026-05-27  
> **목적**: 프로젝트 개선 포인트를 오픈소스/논문/GitHub/인터넷에서 검증된 도구와 패턴 기반으로 정리  
> **범위**: 코드를 새로 짜지 않고 도입/설정만 하면 되는 항목 위주

---

## 현황 요약 (CURRENT_STATUS.md 기준)

| 항목 | 현재 상태 |
|------|-----------|
| **프레임워크** | Next.js 14.2.20 (App Router) |
| **언어** | TypeScript |
| **DB** | Supabase (PostgreSQL), migrations 233개 파일 |
| **유틸** | `src/lib/` 600+ 파일 |
| **AI** | OpenAI / Anthropic / Gemini — `llm-gateway.ts` 통합 |
| **배포** | Vercel |
| **보안** | middleware JWT 검증, RLS, PII 마스킹 (`secure_chats`, `rfq_messages`) |
| **Sentry** | `sentry.server.config.ts`, `sentry.edge.config.ts`, `sentry.client.config.ts`, `global-error.tsx` — **이미 도입 완료** |
| **sitemap.ts** | `src/app/sitemap.ts` — 정적 + 동적(packages/rfq/blog/destinations) 생성 중 |
| **robots.ts** | `src/app/robots.ts` — `/admin/`, `/api/`, `/m/`, `/login`, `/register` disallow |
| **metadataBase** | `src/app/layout.tsx` — 설정됨 |
| **JSON-LD** | 블로그 상세(`/blog/[slug]`)에만 부분 적용, 루트/패키지/목적지 페이지 미적용 |
| **Rate Limiting** | `src/lib/rate-limiter.ts` — Upstash Redis + in-memory fallback, `rateLimit` / `rateLimitAI` 함수 존재 |
| **Bundle Analyzer** | `@next/bundle-analyzer` 패키지는 있음 (`ANALYZE=true`) — 실행은 보류 상태 |
| **DOMPurify** | `src/app/admin/blog/[id]/page.tsx`에서만 사용, 전역 XSS 방어 아님 |
| **eslint-plugin-jsx-a11y** | 패키지 설치됨 (`^6.10.0`), IDE 규칙만 활성 — CI 단계 테스트 없음 |
| **Dependabot** | `.github/`에 설정 파일 없음 — 미도입 |
| **canonical URL** | 개별 확인 필요 (블로그 상세는 있음) |

---

## 1. P0 — 지금 당장 조치 가능한 항목

### P0-1: Next.js 보안 패치 — ^14.2.25 (CVE-2025-29927)

**문제**: 현재 Next.js 14.2.20. CVE-2025-29927은 `x-middleware-subrequest` 헤더를 조작해 middleware 인증을 우회할 수 있는 취약점. CVSS 9.1 (Critical). 14.2.25+에서 패치됨.

**조치**: `package.json`에서 `"next": "^14.2.25"`로 업데이트 후 `npm install`

**근거**:
- [CVE-2025-29927 NVD](https://nvd.nist.gov/vuln/detail/CVE-2025-29927)
- [Next.js Security Advisory GHSA-f82v-jwr5-mffw](https://github.com/nextcloud/security-advisories/ghsa-f82v-jwr5-mffw)
- [Next.js 14.2.25 릴리즈 노트](https://github.com/vercel/next.js/releases/tag/v14.2.25)

> **참고**: middleware는 보안 경계가 아님. Server Action/Route Handler에서도 인증 재검증 필요. 현재 middleware.ts는 cookie 기반 JWT 검증을 수행 중이므로, Route Handler 레벨의 `createRouteHandlerClient`에서 세션 재확인이 이중 방어가 됨.

---

### P0-2: sitemap.ts 분할 — `generateSitemaps`로 대규모 사이트맵 대응

**문제**: 현재 단일 `sitemap()` 함수에서 45,000개 제한으로 모든 URL을 한 번에 생성. 현재 URL 수가 적어 문제되지 않지만, 블로그 글이 증가하면 단일 파일 크기 제한(50MB / 50,000 URL)에 도달 가능. 또한 단일 함수에서 모든 DB 쿼리를 수행하므로 타임아웃 위험.

**조치**: `sitemap.ts`를 `sitemap.tsx`로 변경하고 `generateSitemaps`를 사용해 사이트맵을 분할. 예:
- 정적 경로 전용 사이트맵
- 패키지 전용 사이트맵
- 블로그 전용 사이트맵
- 목적지 전용 사이트맵

**근거**:
- [Next.js Sitemaps — generateSitemaps](https://nextjs.org/docs/app/api-reference/functions/generate-sitemaps)

> **우선순위 조정**: 현재 URL 수가 임계치에 근접하지 않았으므로 P0보다 P1로 완화 가능. 단, 블로그 양이 급증하는 시점 전에 선제 도입 권장.

---

## 2. P1 — 단기 도입 항목 (1~2주 내)

### P1-1: JSON-LD Structured Data 전면 적용

**문제**: 현재 JSON-LD는 블로그 상세 페이지(`/blog/[slug]`)에만 부분 적용. 루트 페이지(Organization + WebSite), 패키지 상세(Product), 목적지 페이지(BreadcrumbList)에 structured data가 없어 검색엔진의 리치 결과 노출 기회 상실.

**조치**: `src/lib/blog-jsonld.ts` 패턴을 참고해 다음 JSON-LD 추가:
- `layout.tsx` (루트): `Organization` + `WebSite` (검색 액션 포함)
- `/packages/[id]`: `Product` + `BreadcrumbList`
- `/destinations/[city]`: `BreadcrumbList` + `TravelAction` (가능하면)

**근거**:
- [Google Rich Results Test](https://search.google.com/test/rich-results)
- [JSON-LD for Organization](https://developers.google.com/search/docs/appearance/structured-data/organization)
- [JSON-LD for BreadcrumbList](https://developers.google.com/search/docs/appearance/structured-data/breadcrumb)
- [JSON-LD for Product (travel package)](https://developers.google.com/search/docs/appearance/structured-data/product)
- [Schema.org TravelAction](https://schema.org/TravelAction)

---

### P1-2: SEO — robots.ts에 `/admin/*` 중복 크롤링 방지 + canonical 전면 점검

**문제**: 현재 `robots.ts`는 기본 설정만 있음. Google Search Console에서 `/admin/` 하위 경로가 중복 크롤링될 수 있음. 개별 페이지 canonical 태그 적용 여부 미확인 상태.

**조치**:
1. `robots.ts`에 `crawlDelay: 10` 추가 (서버 부하 방지)
2. 모든 페이지에서 canonical URL이 올바르게 설정되었는지 Google Search Console → URL 검사로 확인
3. `/legal/*`, `/tenant/*` 등 검색 불필요 페이지도 disallow 대상에 추가 검토

**근거**:
- [Next.js robots.txt](https://nextjs.org/docs/app/api-reference/file-conventions/metadata/robots)
- [Google Search Console URL inspection](https://support.google.com/webmasters/answer/9012289)

---

### P1-3: Rate Limiting — @upstash/ratelimit 전 API Route 적용

**문제**: `rateLimiter.ts`는 Upstash Redis (@upstash/ratelimit) 기반으로 잘 구현되어 있으나, 실제 적용된 API Route는 일부(`/api/jarvis`, `/api/concierge/search`, `/api/admin/invoice/parse`, `/api/m/passport/[token]`)에만 한정. 민감한 API(`/api/bookings`, `/api/customers`, `/api/qa/chat`)에 rate limit 미적용.

**조치**: `src/middleware.ts`에 글로벌 rate limit 적용하거나, 주요 API Route에 `rateLimit()` 래퍼 추가. Upstash Redis env var가 없으면 자동 in-memory fallback.

**추천 임계값**:
- `/api/qa/chat`: IP당 30회/분
- `/api/bookings` POST: IP당 10회/분
- `/api/*` 일반: IP당 60회/분
- `/api/ai/*`: IP당 20회/분 (failClosed=true로 정책 무결성 우선)

**근거**:
- [@upstash/ratelimit GitHub](https://github.com/upstash/ratelimit)
- [Vercel Edge Rate Limiting 패턴](https://vercel.com/docs/security/rate-limiting)

---

### P1-4: Bundle Analyzer 활성화 — 번들 최적화

**문제**: `package.json`에 `"analyze": "cross-env ANALYZE=true next build"`와 `@next/bundle-analyzer`는 이미 있음. 문서에 "보류 상태"로 표기. 분석 결과 없이 dynamic import 최적화 지점을 알 수 없음.

**조치**:
1. `next.config.ts` 또는 `next.config.mjs`로 `@next/bundle-analyzer` 설정 확인 (아직 없으면 추가)
2. `npm run analyze` 실행 → 결과 HTML에서 큰 번들 식별
3. 큰 라이브러리(날짜 파서, 차트 라이브러리 등)를 `dynamic(() => import(...), { ssr: false })`로 지연 로딩

**근거**:
- [@next/bundle-analyzer](https://www.npmjs.com/package/@next/bundle-analyzer)
- [Next.js Dynamic Imports](https://nextjs.org/docs/pages/building-your-application/optimizing/lazy-loading)

---

## 3. P2 — 중기 도입 항목 (1~3개월)

### P2-1: AI 비용 최적화 — Cascading/Confidence-gated LLM Routing

**현황**: `src/lib/llm-gateway.ts`에 이미 `longCache`, `escalateIfLowConfidence` 구현 존재. DeepSeek V4 Flash를 primary, Gemini 2.5 Flash를 fallback으로 사용 중. LiteLLM은 미도입.

**개선 포인트**:

1. **DeepSeek Cache 활용 극대화**: 동일 system prompt를 분리해 호출하면 DeepSeek이 자동 prompt cache hit → input token 90% 할인. 현재 system prompt가 user prompt와 분리되어 있는지 확인.

2. **Cascading (FrugalGPT 스타일)**:
   - 저비용 모델(DeepSeek Flash) 먼저 시도
   - confidence < threshold면 상위 모델(DeepSeek Pro → Gemini Flash)
   - 40-70% 쿼리를 저렴한 모델로 처리 가능 (FrugalGPT 논문 기반)

3. **Semantic Cache 도입 검토**: 유사 질문이 반복되는 QA 챗봇에 적용 시 zero-cost hit 가능.

> **판단**: LiteLLM 도입은 현재 인프라 대비 오버헤드가 큼. 기존 `llm-gateway.ts`의 라우팅 테이블을 확장하는 것이 더 실용적.

**근거**:
- [FrugalGPT (Chen et al. 2023)](https://arxiv.org/abs/2305.05176) — LLM Cascading 비용 최적화
- [RouteLLM (arXiv 2024)](https://arxiv.org/abs/2406.02767) — confidence-gated routing
- [LiteLLM GitHub](https://github.com/BerriAI/litellm) — 100+ LLM 통합 프록시
- [DeepSeek Cache Documentation](https://api-docs.deepseek.com/guides/kv_cache)

---

### P2-2: DB 성능 — RLS auth.uid() InitPlan 최적화

**문제**: Supabase RLS에서 `auth.uid()`를 직접 사용하면 PostgreSQL이 InitPlan으로 처리해 서브쿼리가 매번 재실행 → 최대 171ms 소요. `(SELECT auth.uid())`로 래핑하면 0.1ms로 1700배 개선.

**현황 확인 필요**: 현재 RLS 정책에서 `auth.uid()` 패턴 사용 여부를 Supabase Dashboard → Advisors 탭에서 `auth_rls_initplan` 탐지 항목으로 확인.

**권장 조치**:
- 모든 RLS 정책에서 `auth.uid()` → `(SELECT auth.uid())`로 변경
- Supabase Dashboard → SQL Editor에서 `pg_stat_statements`로 느린 쿼리 식별
- 누락된 FK 인덱스 확인 (Phase 3 마이그레이션 `20260518020000_*`에 일부 반영됨)

**근거**:
- [Supabase — Common RLS Performance Pitfalls](https://supabase.com/docs/guides/auth/row-level-security#common-performance-pitfalls)
- [Supabase RLS InitPlan 최적화 (커뮤니티 가이드)](https://github.com/supabase/supabase/discussions/15355)
- [PostgreSQL pg_stat_statements 공식 문서](https://www.postgresql.org/docs/current/pgstatstatements.html)

---

### P2-3: XSS 방어 — 전역 DOMPurify 도입

**문제**: 현재 `DOMPurify`는 블로그 HTML 편집기에서만 사용. `dangerouslySetInnerHTML`를 사용하는 다른 컴포넌트(예: 상품 설명, AI 생성 콘텐츠)는 sanitize 없이 렌더링 중.

**조치**:
1. `src/lib/dom-sanitizer.ts` 생성 (DOMPurify wrapper, 허용 태그 whitelist 관리)
2. 모든 `dangerouslySetInnerHTML` 사용처를 Grep으로 찾아 sanitize 적용
3. 서버 사이드에서도 sanitize할 수 있는 `sanitize-html` 또는 `isomorphic-dompurify` 도입 검토

**근거**:
- [DOMPurify GitHub](https://github.com/cure53/DOMPurify)
- [OWASP XSS Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html)
- [isomorphic-dompurify](https://www.npmjs.com/package/isomorphic-dompurify) (서버/클라이언트 겸용)

---

### P2-4: 접근성 (a11y) — CI 파이프라인 구축

**현황**: `eslint-plugin-jsx-a11y`는 설치되어 있고 `next lint`에서 IDE 레벨 검사는 가능. 그러나 CI에서 a11y를 강제하지 않음. `axe-core` 기반 테스트는 전혀 없음.

**조치**:

1. **eslint 규칙 강화**: `.eslintrc.json`에서 jsx-a11y 규칙을 error로 승격:
   ```json
   {
     "rules": {
       "jsx-a11y/alt-text": "error",
       "jsx-a11y/click-events-have-key-events": "warn",
       "jsx-a11y/no-static-element-interactions": "warn"
     }
   }
   ```

2. **@axe-core/playwright 도입 (CI)**: E2E 테스트 파이프라인에서 WCAG 2.2 AA 위반 자동 감지:
   ```
   npm install -D @axe-core/playwright
   ```
   `playwright.e2e.config.ts`에 a11y 체크 통합.

3. **vitest-axe (컴포넌트 레벨)**:
   ```
   npm install -D vitest-axe
   ```
   핵심 컴포넌트(폼, 모달, 테이블)에 단위 접근성 테스트 추가.

**근거**:
- [eslint-plugin-jsx-a11y](https://github.com/jsx-eslint/eslint-plugin-jsx-a11y)
- [@axe-core/playwright](https://www.npmjs.com/package/@axe-core/playwright)
- [vitest-axe](https://www.npmjs.com/package/vitest-axe)
- WCAG 2.2의 ~57%는 axe-core로 자동 탐지 가능 (Deque 연구)
- [Next.js Accessibility Best Practices](https://nextjs.org/docs/app/building-your-application/optimizing/accessibility)

---

### P2-5: Dependabot — 의존성 취약점 자동 관리

**문제**: `npm audit`은 `package.json`에 스크립트만 있고 CI에서 강제되지 않음. Dependabot 설정 파일이 없어 취약점 발견 시 수동 대응만 가능.

**조치**:

1. **`.github/dependabot.yml` 생성**:
   ```yaml
   version: 2
   updates:
     - package-ecosystem: "npm"
       directory: "/"
       schedule:
         interval: "weekly"
         day: "monday"
         time: "09:00"
         timezone: "Asia/Seoul"
       open-pull-requests-limit: 10
       labels:
         - "dependencies"
         - "automerge"
   ```

2. **CI에 `npm audit` 추가** (high/critical에서 fail):
   GitHub Actions 워크플로에 step 추가:
   ```yaml
   - name: npm audit
     run: npm audit --audit-level=high
   ```

**근거**:
- [Dependabot 공식 문서](https://docs.github.com/en/code-security/dependabot/dependabot-version-updates)
- [npm audit 문서](https://docs.npmjs.com/cli/commands/npm-audit/)
- [OWASP Dependency-Check](https://owasp.org/www-project-dependency-check/) — SCA 심화 도구 (필요 시)

---

## 4. P3 — 장기 검토 항목 (3개월+)

### P3-1: Core Web Vitals 정밀 측정 및 최적화

**이미 적용된 항목**:
- `next/font` — self-host, `font-display:swap` (CLS 개선)
- `next/image` — 기본 lazy loading, priority 속성 LCP 요소에 사용
- Sentry Web Vitals 수집 가능 (`src/lib/web-vitals-collector.ts`)

**추가 개선**:
1. **LCP 최적화**: Largest Contentful Paint 요소(주로 히어로 이미지)에 `priority` 속성 + 적절한 `sizes` 속성 확인
2. **이미지 sizes 속성**: 모바일에서 이미지 다운로드 50-70% 절감 가능. 주요 페이지의 next/image에 `sizes="(max-width: 768px) 100vw, 50vw"` 등 적용
3. **CLS 최적화**: 이미지/광고/임베드 컨테이너에 명시적 `width`/`height` 또는 `aspect-ratio` CSS 적용

**근거**:
- [web.dev — Optimize LCP](https://web.dev/optimize-lcp/)
- [web.dev — Optimize CLS](https://web.dev/optimize-cls/)
- [next/image — sizes 속성](https://nextjs.org/docs/app/api-reference/components/image#sizes)

---

### P3-2: Supabase Advisors 정기 검토

Supabase Dashboard → Advisors 탭에서 다음을 주기적으로 확인:

| Advisor 항목 | 설명 | 빈도 |
|-------------|-----|------|
| `auth_rls_initplan` | auth.uid() InitPlan 탐지 | 분기 |
| Missing Indexes | 느린 쿼리 기반 인덱스 추천 | 월 |
| Cache Hit Ratio | 이상적인 99% 미만 시 튜닝 | 분기 |
| Connection Pool | Vercel에서 Too Many Clients 발생 시 | 필요 시 |

**근거**:
- [Supabase Advisors 공식 문서](https://supabase.com/docs/guides/platform/advisors)

---

## 5. 우선순위 종합 표

| ID | 항목 | 영역 | 난이도 | 영향 | 선행 조건 |
|----|------|------|--------|------|-----------|
| **P0-1** | Next.js ^14.2.25 (CVE-2025-29927) | 보안 | 하 | 치명적 | 없음 |
| **P0-2** | generateSitemaps 분할 | SEO | 중 | 중 | 없음 |
| **P1-1** | JSON-LD 전면 적용 | SEO | 중 | 중 | 없음 |
| **P1-2** | robots.ts 개선 + canonical 점검 | SEO | 하 | 중 | 없음 |
| **P1-3** | Rate Limiting 전 API 확대 | 보안/안정성 | 중 | 높음 | P0-1 선행 (middleware 우회 방어) |
| **P1-4** | Bundle Analyzer 활성화 | 성능 | 하 | 중 | `next.config.ts` 설정 필요 |
| **P2-1** | AI Cascading Routing 최적화 | 비용 | 중-상 | 높음 | llm-gateway.ts 분석 선행 |
| **P2-2** | RLS auth.uid() InitPlan 최적화 | DB 성능 | 중 | 중-높음 | Supabase Advisors 확인 |
| **P2-3** | 전역 DOMPurify XSS 방어 | 보안 | 중 | 중 | `dangerouslySetInnerHTML` 사용처 파악 |
| **P2-4** | a11y CI 파이프라인 | UX/품질 | 중 | 중 | 없음 |
| **P2-5** | Dependabot + npm audit CI | 보안 | 하 | 중 | GitHub Actions 워크플로 수정 |
| **P3-1** | Core Web Vitals 정밀 최적화 | 성능 | 중 | 중 | Bundle Analyzer 결과 선행 |
| **P3-2** | Supabase Advisors 정기 검토 | DB/운영 | 하 | 중 | 없음 |

---

## 6. 즉시 실행 권장 순서

1. **오늘**: `npm install next@^14.2.25` (P0-1, 5분)
2. **오늘**: `npm run analyze` 실행 후 번들 현황 파악 (P1-4, 10분)
3. **이번 주**: JSON-LD를 `layout.tsx` 루트에 추가 (P1-1, 1시간)
4. **이번 주**: rate-limit을 주요 API Route에 확대 적용 (P1-3, 2시간)
5. **다음 주**: DOMPurify wrapper 생성 후 `dangerouslySetInnerHTML` 사용처 일괄 적용 (P2-3, 3시간)
6. **다음 주**: Dependabot 설정 + `npm audit` CI 추가 (P2-5, 30분)
7. **2주 내**: `.eslintrc.json` a11y 규칙 강화 + vitest-axe 도입 (P2-4, 2시간)
8. **2주 내**: Supabase Advisors 확인 후 RLS InitPlan 최적화 (P2-2, 1시간)
9. **3주 내**: sitemap.ts → generateSitemaps 분할 (P0-2, 2시간)
10. **1개월 내**: AI Cascading routing metrics 분석 후 튜닝 (P2-1, 4시간)

---

## 7. 참고 문서/링크

| 주제 | URL |
|------|-----|
| CVE-2025-29927 (Next.js middleware bypass) | https://nvd.nist.gov/vuln/detail/CVE-2025-29927 |
| Next.js Security GHSA-f82v-jwr5-mffw | https://github.com/nextcloud/security-advisories/ghsa-f82v-jwr5-mffw |
| Supabase RLS Performance Pitfalls | https://supabase.com/docs/guides/auth/row-level-security#common-performance-pitfalls |
| @upstash/ratelimit | https://github.com/upstash/ratelimit |
| FrugalGPT (LLM Cascading) | https://arxiv.org/abs/2305.05176 |
| RouteLLM (Confidence-gated Routing) | https://arxiv.org/abs/2406.02767 |
| DeepSeek KV Cache | https://api-docs.deepseek.com/guides/kv_cache |
| DOMPurify | https://github.com/cure53/DOMPurify |
| axe-core / @axe-core/playwright | https://www.npmjs.com/package/@axe-core/playwright |
| eslint-plugin-jsx-a11y | https://github.com/jsx-eslint/eslint-plugin-jsx-a11y |
| @next/bundle-analyzer | https://www.npmjs.com/package/@next/bundle-analyzer |
| Dependabot | https://docs.github.com/en/code-security/dependabot |
| Next.js sitemap (generateSitemaps) | https://nextjs.org/docs/app/api-reference/functions/generate-sitemaps |
| JSON-LD Structured Data (Google) | https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data |
| Supabase Advisors | https://supabase.com/docs/guides/platform/advisors |
| Next.js Accessibility | https://nextjs.org/docs/app/building-your-application/optimizing/accessibility |
