# GitHub Actions Workflow SOP (2026-09-01)

이 디렉토리에 새 워크플로를 추가하거나 기존 워크플로를 수정할 때 아래 체크리스트를 통과한다.
목표는 최소 권한, 재현 가능한 공급망, 결정적인 머지 게이트와 정보성 검사의 분리다.

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
  uses: actions/github-script@3a2844b7e9c422d3c10d287c895573f7108da1b3 # v9.0.0
```

### 3. `workflow_dispatch`는 실제 수동 실행 경로에만 사용

`workflow_dispatch` 전용 워크플로는 push 실행을 만들지 않는다. 다만 사용하지 않는 워크플로를 비활성화하는 수단으로 남겨두면 소유권과 실행 계약이 불명확해진다.

실제 수동 운영 경로와 owner가 있으면 유지하고, 그렇지 않으면 호출 관계·최근 실행·대체 경로를 확인한 뒤 일반 PR로 제거한다. 파일을 단순히 오래 실행하지 않았다는 이유만으로 자동 삭제하지 않는다.

### 4. 외부 액션 버전 고정 + deprecated 확인

- `aquasecurity/trivy-action@master` 같은 floating tag 금지 (재현성 깨짐) → 외부 액션은 40자리 commit SHA로, Docker action은 `sha256` image digest로 고정하고 옆에 검증한 release 버전을 주석으로 남긴다.
- `npm run verify:ci-action-pins`가 모든 workflow의 검토 대상 action을 정확한 승인 SHA로 확인하고, 전체 외부 action·container가 immutable reference인지 검사한다.
- 매 분기 deprecated 액션 점검:
  - Node 24 기반 최신 major와 GitHub-hosted runner 호환성을 확인한다.
  - major tag를 그대로 쓰지 않고 검증한 tag가 가리키는 commit SHA를 사용한다.

### 5. 보안 스캔 step 은 `continue-on-error: true`

Trivy / CodeQL / Snyk 등은 정보성이지 머지 게이트가 아니다.
SARIF 업로드 403 같은 외부 실패가 메인 CI 통과를 막지 않게 한다.

예외: 현재 PR/push가 새로 추가한 commit 범위만 검사하는 Gitleaks CLI는 결정론적 품질 게이트로 취급한다. 과거 전체 history finding 때문에 새 PR을 막지 않으며, secret 내용은 항상 완전히 redaction한다. 별도 라이선스가 필요한 Gitleaks Action 대신 MIT CLI의 고정 버전과 SHA-256 checksum을 사용한다.

```yaml
- name: Trivy scan
  continue-on-error: true
  uses: aquasecurity/trivy-action@a9c7b0f06e461e9d4b4d1711f154ee024b8d7ab8 # v0.36.0
```

### 6. dummy env 시 build/visual 테스트는 `continue-on-error`

CI 빌드 env 가 dummy supabase secret 일 때, Playwright visual 테스트는 실제 데이터 fetch 실패.
real secrets 검증은 Vercel Preview 가 맡고 CI 는 빌드 통과만 보장한다.

### 7. PR 머지 전 `gh run list --limit 5` 로 확인

머지 직후 push to main 실행이 모두 success 인지 본다.
하나라도 fail 이면 즉시 위 체크리스트 다시 본다.

### 8. optional secret 사용 step 은 job-level env + `if: env.X != ''` gate

`SLACK_WEBHOOK` 같이 사장님이 나중에 추가할 secret 의존 step 은,
secret 없을 때 fail 되지 않게 **job-level env 로 secret 을 노출 → step if 에서 빈 값 체크**.

```yaml
jobs:
  notify:
    runs-on: ubuntu-latest
    env:
      SLACK_WEBHOOK: ${{ secrets.SLACK_WEBHOOK }}   # ← job 레벨로 한 번 expose
    steps:
      - name: Notify release
        if: env.SLACK_WEBHOOK != ''                  # ← 빈 값이면 skip (fail 아님)
        uses: slackapi/slack-github-action@dcb1066f776dd043e64d0e8ba94ca15cc7e1875d # v4.0.0
        with:
          webhook: ${{ env.SLACK_WEBHOOK }}
          webhook-type: incoming-webhook
```

이유: secrets 컨텍스트는 step-level `if:` 에서 직접 못 읽음 + step-level `env:` 도
같은 step 의 `if:` 에서 안전하게 못 읽음. **job-level env 가 유일하게 안전한 패턴**.

---

## 검증된 패턴 예시

`ci.yml` (Continuous Integration) — 2026-09-01 검증:
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
- **2026-05-15 v4**: 사용하지 않는 워크플로 3개 (api-docs / pr-lifecycle / test-quality) 삭제 + ci.yml Security Scan codeql v3 업그레이드. 당시 startup failure의 직접 원인은 보존된 실행 기록으로 재확인하기 전까지 `workflow_dispatch` 자체로 단정하지 않는다.
