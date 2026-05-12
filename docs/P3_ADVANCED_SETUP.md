# P3 Advanced Automation Setup Guide

**대상:** 팀장, DevOps 담당자  
**설정 난이도:** 중간 (환경변수 설정 필요)

---

## 📋 P3 제공 기능

### 1️⃣ Sentry 에러 추적 (프로덕션)

**프로덕션 환경에서 모든 에러를 실시간 수집**

```bash
# 1. Sentry 계정 생성
# https://sentry.io → 가입 → 새 프로젝트 → JavaScript/React

# 2. 환경변수 설정 (Vercel Settings)
NEXT_PUBLIC_SENTRY_DSN=https://xxxxx@oxxxxxx.ingest.sentry.io/xxxxx
SENTRY_DSN=https://xxxxx:xxxxx@oxxxxxx.ingest.sentry.io/xxxxx

# 3. 자동으로 작동 (src/sentry.client.ts, src/sentry.server.ts)
# - 에러 캡처
# - 세션 리플레이 (에러 발생 시)
# - 성능 모니터링 (10% 샘플링)
```

**효과:**
- 🚨 실시간 에러 알림 (Sentry 대시보드)
- 📹 사용자 세션 리플레이 (에러 재현)
- ⚡ 성능 메트릭 수집 (LCP, FCP, 등)

---

### 2️⃣ Slack 실시간 알림

**배포, 에러, PR 병합 자동 Slack 알림**

```bash
# 1. Slack 워크스페이스에서 Incoming Webhook 생성
# https://api.slack.com/apps → Create New App → Webhooks

# 2. 3개 Webhook 생성:
# - #errors (에러)
# - #deployments (배포)
# - #releases (릴리스)

# 3. GitHub Secrets 추가
SLACK_WEBHOOK=https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXX

# 또는 각 채널별:
SLACK_ERROR_WEBHOOK=...
SLACK_DEPLOYMENT_WEBHOOK=...
SLACK_RELEASE_WEBHOOK=...
```

**자동 알림:**
```
[에러 감지] #errors 채널 → 즉시 @here 멘션
[배포 시작] #deployments 채널 → 상태 업데이트
[릴리스 완료] #releases 채널 → 버전 및 Changelog
[PR 병합] #releases 채널 → 머지 알림
```

---

### 3️⃣ semantic-release (자동 버전 관리)

**커밋 메시지로 자동 버전 결정 + 배포**

```bash
# Conventional Commits 사용
git commit -m "feat: add new feature"     # → minor version bump (1.1.0)
git commit -m "fix: fix bug"              # → patch version bump (1.0.1)
git commit -m "feat!: breaking change"    # → major version bump (2.0.0)

# main 브랜치 push → 자동으로:
# 1. 버전 결정 (Commit analyzer)
# 2. CHANGELOG 생성
# 3. GitHub Release 생성
# 4. Slack 알림
# 5. NPM publish (선택)
# 6. Vercel 배포 (자동)
```

**효과:**
- ✅ 수동 버전 관리 제거
- 📝 자동 CHANGELOG 생성
- 🚀 원클릭 배포 (단순히 main에 push)

---

### 4️⃣ Vitest 유닛 테스트

**빠른 유닛 테스트 프레임워크**

```bash
# 테스트 작성
npm run test:unit

# 커버리지 리포트
npm run test:unit -- --coverage
# 기준: 80% lines, 80% functions, 75% branches

# 특정 파일만 테스트
npm run test:unit -- booking-state-machine.spec.ts

# Watch 모드 (개발 중)
npm run test:unit -- --watch
```

**테스트 파일 위치:**
```
tests/unit/
├── lib/
│   └── booking-state-machine.spec.ts
├── setup.ts
└── ... (추가 테스트)
```

**PR 검증:**
- ✅ 모든 테스트 통과 필수
- ✅ 커버리지 80% 이상 필수
- ✅ 커버리지 하락 시 PR 차단

---

## 🔧 설치 & 설정

### Step 1: 환경변수 설정

**GitHub Settings → Secrets and variables → Actions**

```
SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx
NEXT_PUBLIC_SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx
SLACK_WEBHOOK=https://hooks.slack.com/services/T00/B00/XXX
```

### Step 2: Pre-commit hooks 설정 (로컬)

```bash
# .husky 디렉토리 생성
npx husky install

# 또는 수동:
npm install -D husky lint-staged
npx husky install
npx husky add .husky/pre-commit "npx lint-staged"
```

이제 `git commit` 시 자동으로:
- ESLint 자동 수정
- Prettier 포맷팅
- TypeScript 타입 검증

### Step 3: package.json 스크립트 추가

```json
{
  "scripts": {
    "test:unit": "vitest",
    "test:unit:ui": "vitest --ui",
    "test:unit:coverage": "vitest --coverage"
  }
}
```

---

## 📊 자동 파이프라인 (전체 흐름)

```
개발자 커밋
    ↓
[로컬] Pre-commit hooks
├─ ESLint --fix
├─ Prettier --write
└─ tsc --noEmit
    ↓
git push origin feature/...
    ↓
[GitHub] PR 생성
├─ type-safety.yml (TS strict)
├─ unit-tests.yml (Vitest)
├─ claude-code-analysis.yml (ESLint + Trivy)
├─ lighthouse-ci.yml (성능)
├─ test-quality.yml (시각)
├─ api-security.yml (OWASP)
└─ bundle-monitor.yml (크기)
    ↓
[전체 검사 통과] → 병합 가능
    ↓
git push to main
    ↓
[GitHub] semantic-release 트리거
├─ 버전 자동 결정
├─ CHANGELOG 생성
├─ GitHub Release 생성
├─ Slack #releases 알림
└─ Vercel 배포
    ↓
[프로덕션] Sentry 모니터링 활성
├─ 에러 추적
├─ 성능 모니터링
└─ Slack #errors 알림 대기
```

---

## 🚨 에러 발생 시 흐름

```
사용자: [프로덕션 에러 발생]
    ↓
Sentry: 에러 수집 → 분석
    ↓
[Critical 에러인가?]
    ↓ YES
Slack #errors: @here 멘션 + 스택 트레이스
    ↓
팀: 즉시 대응 (평균 5분)
    ↓
git commit -m "fix: resolve X error"
    ↓
git push to main
    ↓
semantic-release: v1.0.x 버전 업 + 배포
    ↓
Slack #releases: 패치 배포 알림
```

---

## 💾 환경변수 체크리스트

### Sentry (선택, 권장)
- [ ] SENTRY_DSN (서버 사이드)
- [ ] NEXT_PUBLIC_SENTRY_DSN (클라이언트 사이드)

### Slack (선택, 권장)
- [ ] SLACK_WEBHOOK (또는 개별)
- [ ] SLACK_ERROR_WEBHOOK
- [ ] SLACK_DEPLOYMENT_WEBHOOK
- [ ] SLACK_RELEASE_WEBHOOK

### GitHub (필수)
- [ ] GITHUB_TOKEN (자동 제공)

---

## 📚 다음 단계

### P3-B: OpenHands (완전 자율 에이전트)
```bash
docker run -it \
  -e LLM_API_KEY=$ANTHROPIC_API_KEY \
  ghcr.io/all-hands-ai/openhands:latest
```

### P3-C: E2E 테스트 확장
```bash
# Playwright로 추가 시나리오
npm run test:e2e -- booking-flow.spec.ts
```

### P3-E: 모니터링 대시보드
- Sentry 대시보드 (에러 추적)
- Vercel Analytics (성능)
- GitHub Insights (코드 메트릭)

---

## ✅ 검증 체크리스트

설정 완료 후:

- [ ] Sentry 대시보드 에러 보임
- [ ] Slack #errors 채널에 테스트 에러 알림 받음
- [ ] main 병합 후 semantic-release 실행 확인
- [ ] Slack #releases에 버전 알림 받음
- [ ] `npm run test:unit` 실행됨
- [ ] Pre-commit hook이 자동 실행됨

---

## 📞 문제 해결

### Sentry 에러가 보이지 않음
```bash
# 1. Secrets 확인 (GitHub Settings)
# 2. Vercel deployment 재배포
# 3. Sentry 프로젝트 설정 확인
```

### Slack 알림이 안 옴
```bash
# 1. Webhook URL 유효성 확인
# 2. Slack 채널에서 앱 권한 확인
# 3. GitHub Actions 로그 확인
```

### Vitest 테스트 실패
```bash
# 1. npm install 다시 실행
# 2. node_modules 삭제 후 npm ci
# 3. vitest.config.ts 설정 확인
```

---

## 🎓 학습 자료

- [Sentry 문서](https://docs.sentry.io)
- [semantic-release 가이드](https://semantic-release.gitbook.io)
- [Vitest 문서](https://vitest.dev)
- [Slack API](https://api.slack.com)

---

**모든 P3 기능이 설정되면 완전히 자동화된 DevOps 체제를 갖춘 엔터프라이즈급 플랫폼이 됩니다.**

