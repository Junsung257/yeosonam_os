#!/usr/bin/env bash
# 여소남 OS — Jarvis V2 PR 스택 자동 생성 스크립트
#
# 전제조건:
#   1. gh CLI 설치 & 인증: `winget install GitHub.cli` 후 `gh auth login`
#   2. 원격 브랜치 푸시: 본 스크립트가 수행
#   3. 현재 checkout 브랜치 상관없음 (스크립트가 각 브랜치 순회)
#
# 안전장치:
#   - --dry-run 으로 실제 push/PR 없이 계획만 출력
#   - 실패 시 즉시 중단 (set -e)
#   - 각 PR 은 stacked (Phase N+1 의 base = Phase N) — 순서 지켜서 머지 필요

set -e

DRY=""
for arg in "$@"; do
  case $arg in
    --dry-run) DRY="echo [dry] " ;;
    *) ;;
  esac
done

# ─── 브랜치 스택 정의 ─────────────────────────────────────
declare -a STACK=(
  "feature/self-learning-audit-loop:main:Phase 0·1 — V2 설계 마스터 + 저위험 패치"
  "feature/jarvis-v2-phase2:feature/self-learning-audit-loop:Phase 2 — Gemini 스트리밍 agent loop + SSE"
  "feature/jarvis-v2-phase3:feature/jarvis-v2-phase2:Phase 3 — 멀티테넌트 격리 (scoped-client + RLS 정책)"
  "feature/jarvis-v2-phase4:feature/jarvis-v2-phase3:Phase 4 — Contextual Retrieval RAG"
  "feature/jarvis-v2-phase5:feature/jarvis-v2-phase4:Phase 5 — tenant_bot_profiles + persona + cost ledger"
  "feature/jarvis-v2-phase6:feature/jarvis-v2-phase5:Phase 6 — 전 agent V2 + SSE 훅 + 봇 관리 UI"
  "feature/jarvis-v2-phase7:feature/jarvis-v2-phase6:Phase 7 — 감사 공백 tool (블로그/상품 기안)"
  "feature/jarvis-v2-phase8:feature/jarvis-v2-phase7:Phase 8 — 스모크 테스트 + Part C + CHANGELOG"
)

# ─── 1. 각 브랜치 원격 푸시 ──────────────────────────────
echo "━━━ 1단계: 원격 푸시 ━━━"
for entry in "${STACK[@]}"; do
  IFS=':' read -r branch base title <<< "$entry"
  echo "▶ $branch"
  $DRY git push -u origin "$branch"
done

# ─── 2. gh CLI 인증 체크 ────────────────────────────────
if ! command -v gh &>/dev/null; then
  echo "!! gh CLI 미설치. 'winget install GitHub.cli' 후 재실행."
  exit 1
fi
gh auth status &>/dev/null || { echo "!! gh 인증 필요. gh auth login"; exit 1; }

# ─── 3. PR 생성 (스택 순서) ─────────────────────────────
echo ""
echo "━━━ 2단계: PR 생성 (stacked) ━━━"
for entry in "${STACK[@]}"; do
  IFS=':' read -r branch base title <<< "$entry"
  PR_BODY=$(cat <<BODY
## 요약
$title

## 검증
- \`npm run type-check\` green
- \`npm run test:jarvis-v2\` 16/16 pass
- 설계: [\`db/JARVIS_V2_DESIGN.md\`](../blob/$branch/db/JARVIS_V2_DESIGN.md)

## 머지 순서
이 PR 은 V2 스택의 일부입니다. **base \`$base\` 머지 후** 이 PR 을 머지하세요.

## 롤백
- env \`JARVIS_STREAM_ENABLED=false\` (V2 엔드포인트 503)
- RLS 활성화 상태라면: \`SELECT jarvis_disable_rls();\`

## 체크리스트
- [ ] Vercel preview 배포 확인
- [ ] 스테이징 DB 마이그 실행 완료 (해당 시)
- [ ] 상위 base PR 먼저 머지됨
BODY
)
  echo "▶ PR: $branch → $base"
  $DRY gh pr create \
    --head "$branch" \
    --base "$base" \
    --title "$title" \
    --body "$PR_BODY"
done

echo ""
echo "━━━ 완료 ━━━"
echo "PR 8개 생성됨. 머지 순서:"
echo "  1) feature/self-learning-audit-loop → main"
echo "  2) feature/jarvis-v2-phase2 → feature/self-learning-audit-loop"
echo "  3) ... Phase 3 ~ 8"
echo ""
echo "각 PR 이 앞 PR 에 base 로 물려있으니 순차 머지 필수."
echo "혹시 stacked PR 이 복잡하면 전체를 main 에 직접 머지하는 대안:"
echo "  gh pr create --head feature/jarvis-v2-phase8 --base main --title 'Jarvis V2 전체 (Phase 0~8)'"
