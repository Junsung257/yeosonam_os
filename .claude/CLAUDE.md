@../AGENTS.md

# Claude Code 어댑터

공통 정책과 도메인 라우팅은 루트 `AGENTS.md`가 권위다. 이 파일은 Claude Code에서만 필요한 차이를 정의한다.

## 점진적 컨텍스트

- 사용자 요청, 관련 구현, AGENTS의 도메인 라우팅부터 확인한다.
- 해당 도메인의 SSOT와 인접 테스트만 추가로 읽는다.
- 모든 `.mdc`, 모든 SSOT, 전체 상태 문서를 매 작업마다 읽지 않는다.
- 파일 수만으로 탐색 방식이나 서브에이전트를 강제하지 않는다. 위험도와 병렬 가치로 결정한다.
- 외부 라이브러리·서비스 동작이 중요하면 현재 공식 문서를 확인한다.

## Claude 경로 규칙

`.claude/rules`는 경로별 보조 레시피다. 관련 파일을 다룰 때만 선택한다.

| 경로 | 보조 규칙 |
|---|---|
| `src/app/api`, `supabase`, `db` | `rules/db-recipes.md`, `rules/api-routes.md` |
| `src/app` TSX, `src/components` | `rules/frontend.md` |
| 예약·알림 | `rules/booking-system.md`, `rules/notifications.md` |
| 외부 API·마케팅 문구 | `rules/external-apis.md`, `rules/marketing-copy.md` |
| 공통 유틸 검토 | `rules/utilities.md` |

## 스킬

- `.agents/skills`가 원본이다.
- `.claude/skills`는 `npm run sync:agent-skills`로 생성한다.
- 생성 사본을 직접 고치지 않는다.
- 상품 등록은 사용자가 명시적으로 호출할 때만 `register` 스킬을 사용한다.
- 미디어 큐는 `blog-media-worker` 계약을 따르며 API 키·Pexels·직접 DB fallback을 사용하지 않는다.

## 실행과 완료

- 탐색은 `rg`와 인접 구현을 우선한다.
- 수정 후 좁은 테스트부터 실행하고 필요할 때만 타입 검사·빌드로 확장한다.
- Production 배포, DB 적용, 외부 발행, 결제·예약·자격증명 변경을 자동 hook으로 실행하지 않는다.
- 완료 보고에는 변경, 검증, 남은 승인·수동 단계가 포함돼야 한다.
