# 에이전트 MCP·호스트 도구 연결

상태: current
검증일: 2026-09-01
권위 영역: 저장소에 안전하게 남길 수 있는 MCP와 로컬 호스트 연결 계약

## 기본 원칙

저장소에는 도구의 목적, 최소 권한, 검증 명령만 둔다. 사용자 홈 절대 경로, 로그인 상태, 토큰, 키, 개인 계정 이름은 current 문서에 저장하지 않는다.

- OAuth를 지원하면 평문 PAT보다 OAuth를 우선한다.
- 프로젝트 범위와 read-only 옵션을 제공하면 둘 다 사용한다.
- 쓰기 도구는 기본 비활성화하고 작업 단위로 승인한다.
- Production DB, 배포, 외부 발행을 MCP의 기본 경로로 만들지 않는다.
- MCP 출력과 도구 인자는 비밀·PII 로그 수집 대상에서 제외한다.

## Supabase

로컬 hosted OAuth 연결은 `project_ref`, `read_only=true`, 필요한 feature group만 지정한다. 저장소 템플릿에는 PAT나 `sb_secret_*` 값을 넣지 않는다.

계정 전체 Supabase 플러그인과 프로젝트 범위 MCP를 동시에 활성화하지 않는다. 프로젝트 범위에서는 `list_projects`, 조직·프로젝트·branch 관리, migration, Edge Function 배포, SQL 쓰기 도구가 표면에서 사라져야 한다. 설정 변경 뒤 새 세션에서 실제 도구 목록까지 확인한다. 저장 파일만 맞고 현재 세션에 계정 도구가 남아 있으면 검증 실패다.

Production 앱의 서버 키는 MCP 자격증명과 분리한다. 폐기 전에는 값을 출력하지 않고 해시 기반 사용처 감사로 앱 런타임과의 분리를 확인한다.

## Codex 실행 프로필

일반 프로필은 `workspace-write`와 `on-request` 승인을 기본으로 한다. 감사 프로필은 `read-only`다. 고권한 프로필은 사용자가 명시적으로 선택하며 위험 동작에도 승인을 유지한다.

프로젝트의 `.codex`와 `.mcp.json`은 비밀 없는 로컬 설정이며 Git 추적 대상이 아니다. CI는 저장소 파일만 검사하고 로컬 health check는 값을 노출하지 않고 안전 속성만 보고한다.

## Claude Code

프로젝트 settings는 파일 읽기와 좁은 테스트를 허용할 수 있다. 다음은 자동 허용하거나 hook에서 실행하지 않는다.

- DB migration·재색인·데이터 수정
- Production 배포와 외부 발행
- 광범위한 `node -e` 또는 임의 셸 실행
- 매 파일 수정 후 전체 타입 검사
- 환경 파일, 개인 키, MCP·Codex 자격증명 읽기

`**/*token*` 같은 광범위 deny는 정상 route·migration·디자인 토큰까지 숨기므로 사용하지 않는다. 실제 비밀 파일의 정확한 경로만 deny한다.

## 경로 독립성

Serena 같은 프로젝트 분석기는 현재 작업 디렉터리에서 프로젝트를 찾도록 설정한다. 외부 CLI는 검증된 버전을 고정한다. 특정 PC의 설치 완료 여부는 current 문서가 아니라 로컬 health-check 결과로 확인한다.

## 검증

```bash
npm run check:agent-host -- --repo-only
npm run check:agent-host
```

첫 명령은 CI에서 추적 파일만 검사한다. 두 번째는 로컬 프로필의 최소 권한, 버전 고정, 비밀 비포함, Supabase 연결 충돌을 값 노출 없이 확인한다.
