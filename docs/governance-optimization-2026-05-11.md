# Governance Optimization — 2026-05-11

> **무엇**: Claude Code 거버넌스 MD 파일군의 토큰·정확도·자동화 전수 최적화.
> **왜**: Anthropic 공식 200줄 한도 초과(329줄) + Lost in the Middle 효과로 핵심 규칙 누락 + `/register` 호출당 ~30K 토큰 낭비 + advisory-only 규칙들의 강제력 부족.
> **결과**: 매 세션 ~2,500 토큰 즉시 절감 + `/register` 호출당 ~75% 토큰 절감 + path-scoped rules로 도메인 작업 시에만 규칙 활성.

---

## 적용된 변경 (2 commits)

### `e5d9cea` chore(governance): CLAUDE.md 다이어트 + path-scoped rules + slash command frontmatter

| 변경 | Before | After |
|---|---|---|
| `.claude/CLAUDE.md` (매 세션 자동 로드) | 329줄 / 22KB | **194줄 / 11.6KB** (Anthropic 200 한도 내) |
| 도메인 레시피 위치 | CLAUDE.md 본문 §1~§8 | `.claude/rules/*.md` 8개 (path-scoped) |
| `AGENTS.md` 자동 로드 | 미연결 (Claude Code는 AGENTS.md 직접 안 읽음) | `@../AGENTS.md` import로 자동 로드 |
| 슬래시 커맨드 frontmatter | 1/6 (admin-dashboard만) | 6/6 (description·model·allowed-tools·disable-model-invocation) |
| `db/error-registry.md` (738줄) | 최근 10건 anchor 없음 | 상단에 **ACTIVE CHECKLIST top 10** 박제 |
| 일회성 페이지 감사 로그 | `docs/page-audit-2026-05-10.md` | `docs/audits/page-audit-2026-05-10.md` |
| MD 사이즈 가드 | 없음 | `.claude/scripts/check-md-size.js` (PostToolUse 훅용) |

### `dc633ce` refactor(register): commands → skills 디렉토리 구조 마이그레이션

| 변경 | Before | After |
|---|---|---|
| `/register` 본문 위치 | `.claude/commands/register.md` (1431줄, 호출당 ~30K 토큰) | `.claude/skills/register/SKILL.md` (296줄, ~7K 토큰) |
| 세부 규칙 분리 | 한 파일에 모두 | `references/*.md` 6개 (필요시 Read) |

`.claude/skills/register/references/`:
- `zero-hallucination-policy.md` (499줄) — 3-1~3-12, 4, 4-1, 5, 6, validatePackage 경고
- `parsing-rules.md` (268줄) — Step 1-b·1.5·2.7
- `region-and-ir-pipe.md` (75줄) — IR 파이프 3엔진
- `routing-and-assembly.md` (136줄) — 경로 A/B-1/B-2
- `agent-self-audit.md` (90줄) — Step 6.5 프로토콜
- `post-register-audit.md` (137줄) — Step 7-1~7-5

---

## 사용 가이드 (사장님용)

### 1. 평소 작업 — 변화 없음
- `/register` 호출은 동일하게 작동 (frontmatter에 `disable-model-invocation: true` 박제)
- 모든 슬래시 커맨드(`/manage-attractions`, `/validate-product`, `/assemble-product`, `/register-product`, `/admin-dashboard-review`) 그대로 사용

### 2. Claude가 자동으로 활성하는 규칙
| 작업하는 파일 | 자동 로드되는 룰 |
|---|---|
| `src/lib/booking-state-machine.ts`, `src/app/api/bookings/**` | `.claude/rules/booking-system.md` |
| `src/app/api/**`, `src/middleware.ts` | `.claude/rules/api-routes.md` |
| `src/app/**/*.tsx`, `src/components/**` | `.claude/rules/frontend.md` |
| `src/lib/llm-*`, `src/lib/content-pipeline/**` | `.claude/rules/external-apis.md` |
| `src/lib/notification-adapter.ts`, `src/app/api/notify/**` | `.claude/rules/notifications.md` |
| `src/lib/card-news/**`, `src/app/api/card-news\|blog/**` | `.claude/rules/marketing-copy.md` |
| `src/lib/supabase.ts`, `supabase/migrations/**` | `.claude/rules/db-recipes.md` |
| `src/lib/**`, `src/components/**`, `db/**` | `.claude/rules/utilities.md` |

→ **사장님이 신경 쓸 일 없음**. Claude가 해당 파일을 읽을 때 자동 진입.

### 3. 신규 규칙 추가 방법
- **전역 규칙** (모든 작업에 적용): `.claude/CLAUDE.md`에 추가. 단 200줄 한도 유지.
- **특정 파일 패턴에만 적용**: `.claude/rules/<topic>.md` 신규 생성 + frontmatter `paths:` 지정.

```yaml
---
description: 어드민 권한 관련 규칙
paths:
  - "src/app/admin/**/*.tsx"
  - "src/app/api/admin/**/*.ts"
---
# Admin 권한 규칙
- ...
```

### 4. `/register` 본문 변경
- 절차 수정 → `.claude/skills/register/SKILL.md`
- 세부 규칙 추가 → `.claude/skills/register/references/<적절한 파일>.md`
- 새로운 사장님 결정·정책 → `docs/register-changelog.md`에 append (본문 직접 수정 금지)

### 5. Error Registry 갱신
- 신규 ERR 발견 → `db/error-registry.md` 본문에 append + 상단 **ACTIVE CHECKLIST**의 가장 오래된 항목 #10 제거하고 새 항목 #1로 prepend.
- FIXED 항목은 본문에 그대로 보존 (append-only).

---

## ⏳ 사장님이 직접 적용해야 하는 두 파일

자동모드 안전장치(self-modification 방지)로 Claude가 직접 적용하지 못함. 5분 안에 끝남.

### 파일 ① `.claude/settings.json` 통째 교체

```json
{
  "permissions": {
    "allow": [
      "Bash(node -e *)",
      "Read(//c/Users/admin/Downloads/**)",
      "Bash(node db/batch_pexels_photos.js --force)",
      "Bash(git status)", "Bash(git status --short)",
      "Bash(git diff)", "Bash(git diff --stat)", "Bash(git diff HEAD)", "Bash(git diff HEAD -- *)",
      "Bash(git log --oneline -20)", "Bash(git log --oneline -10)", "Bash(git log --oneline -5)",
      "Bash(git log --format=* -20)",
      "Bash(git branch)", "Bash(git branch -a)",
      "Bash(npx tsc --noEmit)",
      "Bash(node db/post_register_audit.js*)",
      "Bash(node db/audit_schema_drift.js*)",
      "Bash(node db/audit_api_field_drift.js*)",
      "Bash(node db/cove_audit.js*)",
      "Bash(node db/dump_package_result.js*)",
      "Bash(node db/rag_reindex_all.js*)",
      "Bash(node db/resync_paid_amounts.js*)"
    ],
    "deny": [
      "Bash(git add -A)", "Bash(git add -A *)",
      "Bash(git add .)", "Bash(git add . *)",
      "Bash(git add --all)", "Bash(git add --all *)"
    ]
  },
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write",
        "hooks": [{ "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.claude/scripts/block-temp-scripts.js\"", "shell": "powershell" }]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Edit|Write|MultiEdit",
        "hooks": [{ "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.claude/scripts/check-md-size.js\"", "shell": "powershell" }]
      }
    ]
  }
}
```

**바뀌는 점**:
- 🔴 **위험 제거**: 매 세션 종료 시 자동으로 `vercel --prod` 배포되던 Stop 훅 폐기 (가장 critical)
- 🛡️ `git add -A` / `git add .` / `git add --all` 차단 (의도치 않은 파일 staging 방지)
- ⚠️ CLAUDE.md(>200줄) / `.claude/rules/*.md`(>150줄) / `.claude/commands/*.md`(>500줄) 자동 경고
- 🚫 `db/seed_*` / `db/temp_*` 임시 스크립트 작성 차단

### 파일 ② `.claude/scripts/block-temp-scripts.js` 신규 작성

```js
#!/usr/bin/env node
let stdinData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (stdinData += c));
process.stdin.on('end', () => {
  try {
    const fp = JSON.parse(stdinData || '{}')?.tool_input?.file_path || '';
    if (/[\\/]db[\\/](seed|temp)_/i.test(fp)) {
      process.stderr.write(`🚫 Blocked: ${fp} is forbidden (CLAUDE.md Pre-Flight Check). Use existing API/UI.\n`);
      process.exit(2);
    }
  } catch {}
});
```

**적용 후**: Claude Code 재시작 (`/exit` → `claude`) 시 자동 활성.

---

## 검증 결과 (2026-05-11)

| 검증 항목 | 결과 |
|---|---|
| `.claude/rules/*.md` paths 패턴이 실제 src 파일과 매칭 | ✅ 8/8 정상 |
| `register/SKILL.md` → `references/*.md` 링크 | ✅ 6/6 정상 |
| `register/SKILL.md` → `docs/register-changelog.md` 링크 | ✅ 정상 |
| `.claude/CLAUDE.md` → `rules/*.md` 링크 | ✅ 8/8 정상 |
| AGENTS.md docs 표 정합성 | ✅ register-changelog, audits 반영 |
| 슬래시 커맨드 frontmatter 누락 | ✅ 6/6 보유 (admin-dashboard 포함) |

---

## 외부 근거 (참고 자료)

- [Anthropic 공식 200줄 가이드](https://code.claude.com/docs/en/memory) "target under 200 lines per CLAUDE.md file"
- [Skills > CLAUDE.md 절차](https://code.claude.com/docs/en/skills) "a section of CLAUDE.md has grown into a procedure"
- [Hooks deterministic 권장](https://code.claude.com/docs/en/best-practices) "actions that must happen every time with zero exceptions"
- Lost in the Middle: Liu et al., TACL 2024 — 중간부 30%+ 정확도 하락
- 공식 명시: "Claude Code reads CLAUDE.md, **not** AGENTS.md" — `@AGENTS.md` import 필수

---

## 다음 추천 작업 (선택)

이번 PR로는 진행하지 않음. 추후 별도 PR로 검토 가능:

| 작업 | 효과 | 위험도 |
|---|---|---|
| `db/JARVIS_V2_DESIGN.md` 1090줄 압축 | 60KB 정리 | 중간 (코드 구현 여부 확인 필요) |
| `db/error-registry.md` FIXED 항목 archive 분리 | 본문 ~70% 축소 | 낮음 (append-only 운영) |
| `docs/registration-improvement-plan.md` 218줄 점검 | TOP 10 완료 여부 갱신 | 낮음 |
| `admin-dashboard-review.md` skills 디렉토리 마이그레이션 | 일관성 | 낮음 |
| LLM `cache_control` lint 스크립트 + CI gate | API 비용 90% 할인 강제 | 중간 |
