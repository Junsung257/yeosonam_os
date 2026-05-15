# GitHub Actions Workflow SOP (2026-05-15)

이 디렉토리에 새 워크플로 추가하거나 기존 워크플로 수정할 때 **반드시** 아래 체크리스트 통과.
미준수 시 사장님 메일함이 fail 노이즈로 폭격 당함 (실제 발생: 2026-05-12 ~ 2026-05-15).

## 필수 체크리스트

### 1. `permissions:` 명시 (default `read-only` 의존 금지)

`actions/github-script` 가 PR 코멘트 / 라벨 / 리뷰 / 이슈 생성 / SARIF 업로드 등 쓰기를 호출하면
**워크플로 또는 잡 레벨에 `permissions:` 블록을 반드시 명시**한다.

```yaml
permissions:
  contents: read           # checkout 만 하면 read
  pull-requests: write     # PR 코멘트/리뷰/라벨
  issues: write            # 이슈 생성
  security-events: write   # SARIF (CodeQL/Trivy) 업로드
```

빠뜨리면 `403 Resource not accessible by integration` → 워크플로 fail → 메일 노이즈.

### 2. PR 코멘트/리뷰 step 은 `continue-on-error: true`

권한이 박혀있어도 외부 요인 (rate limit, fork PR, organization 설정 변경 등) 으로 실패 가능.
정보성 코멘트가 빠진다고 워크플로 자체를 죽일 이유 없음.

```yaml
- name: Post test results
  if: always() && github.event_name == 'pull_request'
  continue-on-error: true   # ← 필수
  uses: actions/github-script@v7
```

### 3. 사용 안 하는 워크플로는 **삭제**, `workflow_dispatch:` only 로 두지 말 것

`on: workflow_dispatch:` 만 남기면 push 이벤트마다 GitHub 가 0-job startup_failure run 을 만들고,
워크플로 레지스트리에 파일경로가 name 으로 박혀버린다 (지우기 전까진 매 push 마다 fail 메일).

⚠️ 과거 시도 (PR #66 v2, PR #67 v3) 가 이 함정에 빠졌다. 트리거 제거만 한다고 메일 안 멈춤.

**원칙**: 1주 이상 안 쓰는 워크플로 = `git rm`.

### 4. 외부 액션 버전 고정 + deprecated 확인

- `aquasecurity/trivy-action@master` 같은 floating tag 금지 (재현성 깨짐) → 가능하면 SHA pin.
- 매 분기 deprecated 액션 점검:
  - `github/codeql-action/*@v2` → `@v3` (v2 deprecated 2025-01).
  - `actions/upload-artifact@v3` → `@v4`.
  - `actions/checkout@v3` → `@v4`.

### 5. 보안 스캔 step 은 `continue-on-error: true`

Trivy / CodeQL / Snyk 등은 정보성이지 머지 게이트가 아니다.
SARIF 업로드 403 같은 외부 실패가 메인 CI 통과를 막지 않게 한다.

```yaml
- name: Trivy scan
  continue-on-error: true
  uses: aquasecurity/trivy-action@master
```

### 6. dummy env 시 build/visual 테스트는 `continue-on-error`

CI 빌드 env 가 dummy supabase secret 일 때, Playwright visual 테스트는 실제 데이터 fetch 실패.
real secrets 검증은 Vercel Preview 가 맡고 CI 는 빌드 통과만 보장한다.

### 7. PR 머지 전 `gh run list --limit 5` 로 확인

머지 직후 push to main 실행이 모두 success 인지 본다.
하나라도 fail 이면 즉시 위 체크리스트 다시 본다.

---

## 검증된 패턴 예시

`ci.yml` (Continuous Integration) — 2026-05-15 박제:
- Code Quality / Build / Performance / Security 4 잡 분리
- `status` 잡이 quality+build 만 게이트 (security/performance 는 정보성)
- Security 잡: `permissions: security-events: write` + `continue-on-error: true` 둘 다

`migration-safety.yml` — 2026-05-15 박제:
- Workflow-level `permissions: pull-requests: write, issues: write`
- Comment step `continue-on-error: true`

`pr-quality-gate.yml` — TypeScript + Vitest 게이트 (필수 통과)

---

## 메일 노이즈 사고 이력

- **PR #35** (2026-05-12 v1): 데모 워크플로 5개 제거
- **PR #66** (2026-05-13 v2): 11개 워크플로의 push/PR 트리거 제거 → workflow_dispatch 만 남김
- **PR #67** (2026-05-14 v3): 6개 schedule 제거
- **2026-05-15 v4 (현재)**: v2 의 함정 — workflow_dispatch only 가 startup_failure 로 매 push fail 메일.
  죽은 워크플로 3개 (api-docs / pr-lifecycle / test-quality) 삭제 + ci.yml Security Scan codeql v3 업그레이드.
