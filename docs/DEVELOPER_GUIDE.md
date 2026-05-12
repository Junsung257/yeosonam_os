# 여소남 OS — 개발자 가이드

**대상:** 프론트엔드/백엔드 개발자  
**최종 업데이트:** 2026-05-11

---

## 🚀 빠른 시작

### 로컬 환경 설정

```bash
# 1. 저장소 클론
git clone https://github.com/Junsung257/yeosonam_os.git
cd yeosonam_os

# 2. 의존성 설치
npm install

# 3. 환경변수 설정
cp .env.example .env.local
# 편집: ANTHROPIC_API_KEY, SUPABASE_*, 등

# 4. 개발 서버 시작
npm run dev
# → http://localhost:3000
```

---

## 📝 개발 워크플로우

### 1단계: 브랜치 생성 & 기능 구현

```bash
# main에서 브랜치 생성
git checkout -b feature/my-feature

# 파일 수정
code src/lib/my-util.ts

# 파일 저장 (Ctrl+S)
# → .claude/settings.json PostToolUse 훅 자동 실행
# → npx tsc --noEmit 실행 (30초)
# → 타입 에러 즉시 표시
```

**PostToolUse 훅의 역할:**
- 파일 저장 후 즉시 TypeScript 검증
- 런타임 에러를 개발 타임에 감지
- 30초 내 결과 피드백

### 2단계: 커밋 & PR 생성

```bash
# 변경사항 확인
git status
git diff src/lib/my-util.ts

# 커밋 (명확한 메시지 필수)
git add src/lib/my-util.ts
git commit -m "feat: add utility function for X"
# 커밋 메시지 형식: type(scope): subject
# 예: feat(lib): add date formatter
#    fix(api): handle timeout in booking endpoint
#    docs(readme): update setup instructions

# 원격 푸시
git push origin feature/my-feature

# GitHub에서 PR 생성
# → GitHub Actions 자동 실행
```

### 3단계: PR 자동 검증 (L2 게이트)

PR 생성 후 자동으로 5개 검사 실행 (병렬):

| 검사 | 시간 | 기준 | 실패 시 |
|------|------|------|--------|
| **type-safety.yml** | 3분 | TS 에러 = 0 | 차단 |
| **claude-code-analysis.yml** | 5분 | ESLint 위반 = 0 | 차단 |
| **ci.yml** | 20분 | 빌드 성공 | 차단 |
| **lighthouse-ci.yml** | 10분 | LCP < 2.5s, 성능 ≥80% | 차단 |
| **test-quality.yml** | 8분 | 시각 회귀 없음 | 차단 |

**PR 코멘트 예시:**
```
✅ Type Safety Report
✅ TypeScript strict mode check passed
✅ Type coverage meets threshold (92%)

✅ Code Analysis
✅ ESLint: 0 violations
✅ Trivy: 0 CRITICAL/HIGH vulnerabilities

❌ Lighthouse Performance
LCP: 2.8s (should be < 2.5s)
Click "Details" to see full report
```

**모든 검사 통과 시에만 병합 가능**

### 4단계: 코드 리뷰 & 병합

```bash
# 검사 실패 시 수정
git add src/
git commit -m "fix: address PR review comments"
git push origin feature/my-feature
# → GitHub Actions 자동 재실행

# 모든 검사 통과 후 병합 (Squash & Merge 권장)
```

---

## 🔍 자주 사용하는 커맨드

### 개발 중

```bash
# 개발 서버 시작
npm run dev

# TypeScript 검증
npx tsc --noEmit
npx tsc --noEmit --strict  # 더 엄격한 검사

# 린트 검사
npx eslint src --format=compact
npx eslint src --fix       # 자동 수정

# 타입 커버리지 확인
node scripts/check-type-coverage.js

# 시각 회귀 테스트
npm run test:visual
npm run test:visual:update  # 베이스라인 업데이트
```

### 빌드 & 배포

```bash
# 프로덕션 빌드
npm run build

# 빌드 후 시작
npm run start

# Lighthouse CI 로컬 실행
npm install -g @lhci/cli
lhci autorun
```

### 데이터베이스

```bash
# Supabase 타입 재생성 (마이그레이션 변경 후)
npm run db:types

# Supabase 마이그레이션 상태 확인
npm run db:status

# Supabase 로컬 스택 시작
npm run db:start
```

---

## 📦 파일 구조

```
여소남OS/
├── src/
│   ├── app/              # Next.js App Router
│   │   ├── api/          # API 라우트
│   │   ├── admin/        # 어드민 페이지
│   │   └── layout.tsx    # 루트 레이아웃
│   ├── lib/              # 유틸리티 & 비즈니스 로직
│   │   ├── supabase.ts
│   │   ├── booking-state-machine.ts
│   │   ├── payment-matcher.ts
│   │   └── ...
│   ├── components/       # React 컴포넌트
│   ├── types/            # TypeScript 타입 정의
│   │   └── database.types.ts  # 자동 생성
│   └── styles/           # CSS & Tailwind
├── supabase/
│   ├── migrations/       # 데이터베이스 마이그레이션
│   └── config.toml
├── tests/
│   ├── visual/           # Playwright 시각 테스트
│   └── unit/             # 유닛 테스트 (향후)
├── .github/workflows/    # GitHub Actions
├── docs/                 # 문서
├── scripts/              # 유틸리티 스크립트
├── package.json
├── tsconfig.json
├── next.config.js
└── .env.local           # 환경변수 (로컬만)
```

---

## 🛡️ 코딩 규칙 (CLAUDE.md 숙지)

### 필수 체크리스트 (모든 작업 시작 전)

- [ ] 기존 기능 탐색했는가? (Glob, Grep)
- [ ] 관련 커맨드 MD 파일 읽었는가? (`.claude/commands/`)
- [ ] Error Registry 확인했는가? (`db/error-registry.md`)
- [ ] 임시 스크립트 대신 기존 API 사용 검토했는가?

### 타입 안전성

```typescript
// ❌ 나쁜 예
const booking: any = { ... };
const data = result as any;

// ✅ 좋은 예
import { BookingData } from '@/types/booking';
const booking: BookingData = { ... };
const data = result as BookingData;
```

### 데이터 검증

```typescript
// ❌ 사용자 입력을 그대로 DB에
const booking = await db.insert({
  name: req.body.name  // 위험!
});

// ✅ 스키마 검증 후 DB 저장
import { BookingSchema } from '@/lib/schemas';
const validated = BookingSchema.parse(req.body);
const booking = await db.insert(validated);
```

### HTML 렌더링

```typescript
// ❌ XSS 위험
<div dangerouslySetInnerHTML={{ __html: userContent }} />

// ✅ DOMPurify로 새니타이징
import DOMPurify from 'isomorphic-dompurify';
<div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(userContent) }} />
```

---

## 🚨 일반적인 문제 & 해결법

### 1. TypeScript 에러 "Type 'any' is not assignable"

**원인:** 타입이 너무 느슨함

```bash
# 검사
npx tsc --noEmit --strict

# 수정: 구체적인 타입 정의
import { Product } from '@/types/database';
const product: Product = await fetchProduct(id);
```

### 2. ESLint 에러 "Prefer 'interface' over 'type'"

```bash
npx eslint src --fix  # 자동 수정
```

### 3. PR에서 Lighthouse 성능 실패 (LCP > 2.5s)

**확인:**
```bash
npm run build && npm run dev
npx lighthouse http://localhost:3000 --view
```

**최적화:**
- 번들 크기 줄이기 (불필요한 import 제거)
- 이미지 최적화 (next/image 사용)
- 코드 스플리팅 (dynamic imports)

### 4. 시각 테스트 실패 (Playwright)

```bash
# 베이스라인 업데이트 (의도적 변경 시)
npm run test:visual:update

# 실패 분석
npm run test:visual -- --debug
```

### 5. Supabase 타입이 최신이 아님

```bash
npm run db:types  # 수동 재생성
# 또는 GitHub에서 supabase-types-update PR 자동 병합
```

---

## 📚 추천 라이브러리 & 패턴

### 상태 관리
- **Booking state machine:** `src/lib/booking-state-machine.ts`
- **Mileage/Grade calculation:** `src/lib/mileage.ts`

### 데이터 검증
- **Zod schemas:** `src/lib/package-schema.ts`
- **API response types:** `src/types/database.ts`

### 외부 API
- **Gemini (컨텐츠):** `ANTHROPIC_API_KEY` 필수
- **Supabase (DB):** `SUPABASE_URL`, `SUPABASE_KEY`
- **Solapi (알림):** `SOLAPI_KEY`

### 성능 최적화
- **ISR (Incremental Static Regeneration):** `/api/revalidate`
- **SWR (Stale-While-Revalidate):** `useSWR()` 훅
- **Code splitting:** `dynamic(() => import(...))`

---

## 🔐 보안 체크리스트

- [ ] 환경변수에 API 키 저장 (코드에 하드코딩 금지)
- [ ] SQL 인젝션 방지 (Supabase parameterized queries 사용)
- [ ] XSS 방지 (DOMPurify로 HTML 새니타이징)
- [ ] CSRF 토큰 확인 (POST 요청)
- [ ] 민감한 정보 로깅 금지 (PII, 신용카드 등)

---

## 📞 도움말

### 문서
- **CLAUDE.md** — 프로젝트 규칙 & 도메인별 가이드
- **ai-automation-runbook.md** — 자동화 도구 사용법
- **ai-automation-implementation.md** — 구현 상세 내용

### 오류 조회
- **db/error-registry.md** — 알려진 오류 & 해결법
- **docs/pending-settings.md** — 설정 체크리스트

### 이슈 & PR
- GitHub Issues: 버그 리포트, 기능 요청
- GitHub Discussions: 아키텍처 논의
- GitHub PRs: 코드 리뷰

---

## ✅ 배포 전 체크리스트

PR 병합 전 확인:

- [ ] 모든 GitHub Actions 통과 ✅
- [ ] 코드 리뷰 승인됨
- [ ] Changelog 업데이트됨 (중요 변경사항)
- [ ] 환경변수 설정됨 (Vercel Settings)
- [ ] 마이그레이션 검토됨 (스키마 변경 시)

**배포 커맨드:**
```bash
git merge --squash feature/my-feature
git push origin main
# → Vercel 자동 배포
```

---

## 🎓 학습 자료

- [Next.js 공식 문서](https://nextjs.org/docs)
- [TypeScript 핸드북](https://www.typescriptlang.org/docs)
- [Supabase 가이드](https://supabase.com/docs)
- [Tailwind CSS](https://tailwindcss.com/docs)

---

**Questions? Check CLAUDE.md or open a GitHub Issue with the `question` label.**

