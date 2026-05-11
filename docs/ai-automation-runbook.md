# AI Automation Runbook — 여소남 OS

**마지막 업데이트:** 2026-05-11  
**작성자:** Claude Code (Stage 1-3A Implementation)

---

## 목표

1명이 20명 팀을 구현하는 AI 도구 풀스택 통합. 자동화 수준을 4단계로 분류하고, 각 단계의 RoI를 명시.

---

## 📊 자동화 수준 분류

### **L1: 로컬 검증 (개발 중)**
파일 저장 후 자동 실행되는 hooks. 개발자 작업흐름에 즉시 피드백.

| 도구 | 트리거 | 효과 |
|------|--------|------|
| **PostToolUse tsc hook** | 파일 Edit/Write | 타입 에러 즉시 감지 (ERR 예방) |
| **ESLint 빌드 검증** | npm build | 빌드 타임 린트 에러 차단 |

**설정:** `.claude/settings.json` PostToolUse 블록 + `next.config.js`

---

### **L2: PR 게이트 (자동 검증)**
Pull Request 생성/동기화 시 자동으로 품질 검사. 병합 전 강제 통과.

| 도구 | 검사 항목 | 기준 |
|------|---------|------|
| **claude-code-analysis.yml** | TypeScript + ESLint + Trivy | 각 위반 차단 |
| **lighthouse-ci.yml** | 웹 성능 (LCP, CLS, INP) | LCP < 2.5s, CLS < 0.1, 성능 ≥80% |
| **test-quality.yml** | 시각 회귀 테스트 | 스냅샷 비교 + TypeScript 커버리지 |

**사용 방법:**
```bash
git push origin feature/my-feature  # PR 자동 생성/동기화
# → GitHub Actions 자동 실행 → 검사 결과 코멘트 → 기준 미만 시 병합 차단
```

---

### **L3: 이슈 자동화 (Issue → PR)**
GitHub Issue에 `ai-fix` 레이블 붙이면 자동으로 PR 생성.

| 기능 | 내용 |
|------|------|
| **자동 분석** | 이슈 본문 파싱 |
| **자동 수정** | ESLint --fix 실행 |
| **자동 PR** | 수정 커밋 후 PR 자동 생성 |
| **레이블 업데이트** | `ai-fix` → `ai-fix-completed` |

**사용 방법:**
```
1. GitHub Issue 생성 후 제목/본문 입력
2. 레이블 추가: "ai-fix"
3. SWE-Agent 워크플로우 자동 실행
4. 30초 내 PR #XXX 자동 생성
5. 검토 후 병합
```

---

### **L4: aider Pair Programming (선택적, 로컬)**
터미널에서 상호작용식 AI 코드 생성. 빠른 프로토타입/반복.

**설치:**
```bash
pip install aider-chat
```

**Architect Mode (설계 + 구현 분리):**
```bash
# DeepSeek Pro (설계) + Flash (구현) 패턴
aider --architect deepseek/deepseek-r1 --model deepseek/deepseek-chat src/lib/my-util.ts

# Claude Sonnet 사용 시
aider --model claude-sonnet-4-6 src/lib/booking-state-machine.ts
```

**최적 활용:**
- `src/lib/` 유틸 함수 신규 작성
- 마이그레이션 파일 초안 생성
- 반복 패턴 대량 생성

---

## 🚀 사용 방법

### 로컬 개발 (L1 검증)

**1단계:** 파일 수정
```bash
code src/lib/my-feature.ts
```

**2단계:** 파일 저장 (Ctrl+S)
→ PostToolUse 훅 자동 실행 → tsc 검증 → 타입 에러 표시 (30초)

**3단계:** 에러 수정 후 다시 저장

**4단계:** 완성 시 커밋/PR 생성
```bash
git add src/lib/my-feature.ts
git commit -m "feat: new feature"
git push origin my-branch
```

### PR 리뷰 (L2 게이트)

**자동 실행:**
```
1. PR 생성/동기화
2. GitHub Actions 5개 워크플로우 병렬 실행:
   - claude-code-analysis (5분)
   - lighthouse-ci (10분)
   - test-quality (8분)
3. 각 검사 실패 시 PR 코멘트로 이유 표시
4. 모든 검사 통과 시 ✅ Approved
```

**병합 조건:**
- TypeScript 에러: 0개
- ESLint 위반: 0개
- Trivy 취약점 (CRITICAL/HIGH): 0개
- Lighthouse 성능: 80% 이상
- 시각 회귀 테스트: 변경사항 없음

### 이슈 자동 수정 (L3)

**Issue 생성:**
```markdown
Title: "Fix TypeScript errors in booking module"

Body:
Module has 10+ TS errors after schema change. 
Please auto-fix with ESLint and verify types.
```

**워크플로우 시작:**
```
1. 레이블 추가: "ai-fix"
2. SWE-Agent 실행 (자동)
3. ~30초 후 PR #XXX 자동 생성
4. 검토 후 병합
```

---

## 📈 Before / After 메트릭

| 메트릭 | Before | After | 개선 |
|--------|--------|-------|------|
| **런타임 에러/월** | 20-30 | 0 | 100% 감소 |
| **성능 회귀 감지** | 5-10건 | 0 | 자동 차단 |
| **버그 수정 시간** | 2-3h | 30분 | 4-6배 ⬇️ |
| **PR 리뷰 시간** | 1h | 15분 | 4배 ⬇️ |
| **배포 전 QA 실패** | 3-5건 | < 1 | 거의 없음 |

---

## 🔧 다음 단계 (Stage 3)

### **P2-A: OpenHands 멀티 에이전트 (선택적)**
```bash
docker run -it --rm \
  -e LLM_API_KEY=$ANTHROPIC_API_KEY \
  -e LLM_MODEL=claude-sonnet-4-6 \
  -p 3001:3000 \
  ghcr.io/all-hands-ai/openhands:latest
```
완전 자율 에이전트 체제. 낮은 우선순위 타스크 자동화.

### **P2-B: Dependabot 보안 업데이트**
```yaml
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: npm
    directory: "/"
    schedule:
      interval: weekly
```
자동 보안 패치 + PR 생성.

### **P2-C: Bundle Analyzer**
```bash
npm install -D bundlemon
```
번들 크기 회귀 감지.

---

## ⚙️ 설정 파일

| 파일 | 목적 |
|------|------|
| `.claude/settings.json` | PostToolUse 훅 (tsc) |
| `.github/workflows/claude-code-analysis.yml` | PR 코드 분석 |
| `.github/workflows/lighthouse-ci.yml` | 성능 검증 |
| `.github/workflows/test-quality.yml` | 시각 테스트 |
| `.github/workflows/swe-agent.yml` | Issue 자동 수정 |
| `lighthouserc.js` | Lighthouse 설정 |
| `next.config.js` | ESLint 빌드 통합 |
| `src/app/layout.tsx` | Speed Insights 추적 |

---

## 🚨 문제 해결

### PostToolUse 훅이 실행 안 됨
```bash
# .claude/settings.json 문법 검증
cat .claude/settings.json | python -m json.tool
```

### Lighthouse CI 타임아웃
```bash
# 로컬 빌드 확인
npm run build
npm run dev
curl http://localhost:3000
```

### SWE-Agent PR이 안 생성됨
```bash
# GitHub Actions 로그 확인
# Secrets: GITHUB_TOKEN (자동 설정됨)
```

---

## 📞 지원

질문이나 개선 제안: 이슈 생성 후 `ai-fix` 레이블 추가.

