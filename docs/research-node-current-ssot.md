# 여소남 조사 노드·외부 리서치 현재 SSOT

> Last updated: 2026-08-31
> Scope: 공식 웹페이지·소셜·영상에서 조사 신호를 수집하고 여소남 OS의 검토 큐에 넣는 경계

## 1. 결정

여소남 Production은 상품·예약·고객·정산·발행의 최종 권위를 계속 가집니다. 외부 조사 노드는 별도 PC에서 시장 반응과 공식 페이지 변화 후보만 수집하고, 전용 intake API를 통해 `agent_tasks`의 사람 검토 대기 상태로만 제출합니다.

이 노드에는 다음을 주지 않습니다.

- Supabase URL·anon·service role·secret key
- 상품 공개·블로그 발행·고객·예약·결제·정산 권한
- 대표 개인 브라우저 프로필과 주계정 cookie
- 모델 API key와 자동 공개 권한

## 2. 현재 소유권과 도입 순서

2026-09-01 저장소 감사 기준 정기 작업의 소유자는 Vercel Cron이며 Inngest는 명시 플래그가 없으면 부작용을 실행하지 않습니다. Cron·함수의 정확한 개수는 문서에 복사하지 않고 `npm run audit:automation-runtime:ci` 결과로 확인합니다.

| 후보 | 현재 결정 | 코드베이스 근거 |
|---|---|---|
| Playwright | 기존 표준 유지 | 모바일 proof·고객 route canary·audit config가 이미 존재 |
| Promptfoo | 오프라인 challenger 유지 | 고정 버전·zero-cost corpus 회귀가 이미 CI 경계에 존재 |
| Docling·PaddleOCR | shadow benchmark만 유지 | 원문 provenance·표·가격·일정 보존 반복 검증이 선행 조건 |
| Trigger.dev·Temporal | 도입 안 함 | 기존 Vercel Workflow·DB outbox·lease·CAS가 권위를 가져 중복 control plane이 됨 |
| Inngest | 신규 소유권 부여 안 함 | 기존 코드는 타입·멱등성을 보강하되 두 명시 플래그 없이 부작용 금지 |
| Crawl4AI | 지금 도입 안 함 | Python 운영면을 추가하기 전에 기존 TypeScript·Playwright 스택의 Crawlee로 공식 페이지 간극을 검증 |
| Crawlee | 격리형 30일 파일럿 | 전용 PC·reviewed hostname manifest·intake-only token·DB 접속 금지 |
| Agent-Reach·OpenCLI | OpenCLI 직접 검증 후 보류 | 소셜 cookie·확장·플랫폼 차단을 Production과 분리해 증명해야 함 |
| Langfuse | 도입 안 함 | 기존 OTel·Sentry·비용 ledger와 중복되고 고객 데이터 평면이 하나 더 생김 |

도입 순서는 다음과 같습니다.

1. 기존 Promptfoo·브라우저 보안 파일럿·OCR 교차검증을 기본 게이트로 유지합니다.
2. `npm run audit:automation-runtime:ci`로 Cron/Inngest 소유권과 인증 표식을 감시합니다.
3. `tools/research-node`의 Crawlee 공식 페이지 수집을 먼저 30일 파일럿합니다.
4. OpenCLI는 정확한 GitHub Release·버전·SHA를 고정한 조사 전용 계정으로만 실험합니다.
5. YouTube·Reddit·X 등 3개 이상 채널의 실제 본문·빈 결과·로그인 오류 감지가 30일 안정화된 뒤에만 Agent-Reach 라우터를 검토합니다.

Agent-Reach는 Production 엔진이 아니라 전용 조사 PC의 도구 선택기로만 사용합니다. `main.zip`, `latest`, Chrome 웹스토어의 비공식 확장, 개인 프로필은 허용하지 않습니다.

## 3. ResearchSignal V1 계약

조사 노드는 `POST /api/internal/research/signals`에 아래의 검증된 신호만 제출합니다.

- HTTPS 출처 URL, 플랫폼, 수집 시간, 게시 시간
- `opencli`, `agent-reach`, `crawlee`, `manual` 중 수집기와 exact semver 또는 commit SHA
- SHA-256 본문 hash와 비식별 저자 hash
- PII가 마스킹된 실제 제목·본문 excerpt·evidence type
- `officialSource=false`와 조사 노드가 판단한 confidence

다음 입력은 4xx로 거부합니다.

- 빈 본문·빈 배열·로그인 오류·로봇 차단 페이지
- `main`, `latest` 같은 움직이는 수집기 버전
- localhost·private IP·인증정보가 든 URL·비표준 포트
- 제목과 excerpt의 이메일·전화·주민번호는 디스크 기록 전에 마스킹되고 intake에서도 다시 마스킹되며 원문은 저장하지 않음
- 외부 조사 결과를 공식 사실이나 자동 공개 가능 근거로 선언하는 신호

동일 신호는 deterministic idempotency key로 중복 작업을 만들지 않습니다. 저장된 작업은 medium risk, `agent_tasks.status=queued`, `task_context.disposition=review_required`, `publicationAllowed=false`, `productFactAllowed=false`입니다. AI 운영실은 마스킹된 제목·요약·출처·수집기·신뢰도와 이 금지 경계를 관찰 전용으로 표시하며, 안전한 승인·재개 엔진이 연결되기 전에는 어떤 고객 표면에도 반영하지 않습니다.

## 4. 근거 사용 경계

소셜·영상·커뮤니티 신호는 주제 발굴, 시장 반응, 불편 분류에만 사용합니다. 가격·항공·호텔·일정·포함사항·취소규정·예약 가능 여부의 최종 근거는 반드시 공식 원문과 해당 도메인 검증 경로에서 다시 확인합니다. 조사 신호는 운영 결정을 직접 실행하지 않습니다.

## 5. 전용 조사 PC 실행

```bash
cd tools/research-node
npm ci
npm run collect -- --manifest=source-manifest.example.json --out=outputs/signals.json --no-browser
npm run check -- --input=outputs/signals.json
npm run submit -- --input=outputs/signals.json
```

기본 수집은 Cheerio로 시작하고 JavaScript 렌더링이 반드시 필요한 reviewed source에서만 Playwright Chromium으로 fallback합니다. 수집 대상은 버전 관리된 manifest의 exact hostname 허용 목록으로 제한합니다. 공개 DNS를 확인한 IP는 실제 transport에 고정하며 Cheerio redirect는 따르지 않습니다. Playwright fallback은 시작 시 resolver rule로 고정된 문서 hostname만 허용하고 다른 subdomain·private·loopback·link-local 요청은 차단합니다. 브라우저는 incognito context와 service worker 차단으로 실행합니다. 제출에 필요한 환경 변수는 `RESEARCH_INTAKE_URL`, `RESEARCH_NODE_INGEST_TOKEN` 두 개뿐입니다.

intake API는 유효 토큰 확인 뒤 분산 Upstash rate-limit을 요구합니다. 분산 backend가 없거나 장애가 나면 per-instance 메모리 제한으로 완화하지 않고 503으로 실패-폐쇄합니다.

수집 보고서는 `sourceCount`, `signals`, `failures`를 하나의 배치로 검증합니다. 일부 소스 실패·중복 source ID·비정상 HTTP 상태가 있으면 제출하지 않습니다. `--previous=<직전 정상 보고서>`를 주면 직전 성공 건수의 절반 미만으로 급락한 결과도 실패 처리합니다.

## 6. Inngest 전환 게이트

Inngest로 정기 작업을 옮길 때는 하나의 작업만 canary하고 다음을 같은 배포에서 처리합니다.

1. Inngest signing/event key와 서비스 연결을 검증합니다.
2. 이벤트 ID·멱등성·테넌트 단위 concurrency·재시도를 staging에서 검증합니다.
3. 기존 Vercel Cron 소유권을 제거합니다.
4. 동일 배포에서 `INNGEST_SCHEDULES_ENABLED=true`를 설정합니다.
5. 결제는 재무 승인 후 `INNGEST_BILLING_ENABLED=true`를 별도로 설정합니다.

둘 중 하나만 반영된 상태는 허용하지 않습니다. 현재 기본값은 모두 `false`입니다.

## 7. 검증 명령

```bash
npm run audit:automation-runtime:ci
npm run audit:llm-telemetry:ci
npx vitest run src/inngest/runtime-policy.test.ts src/lib/research/research-signal.test.ts src/lib/research/research-node-auth.test.ts
npm run type-check
```

조사 노드의 채널별 건강 검사는 명령 exit code만 보지 않고 실제 본문, 필수 필드, 빈 결과, 로그인 오류, 직전 성공 건수 대비 급변을 함께 검사합니다.
