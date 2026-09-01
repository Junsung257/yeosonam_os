# Yeosonam Research Node

별도 조사 PC에서 공식 웹페이지를 수집하는 격리형 파일럿입니다. Production 앱의 의존성이 아니며 `SUPABASE_SERVICE_ROLE_KEY`, 고객·예약·결제 키, 블로그·상품 공개 권한을 절대 설정하지 않습니다.

## 안전 경계

- 검토된 manifest의 정확한 HTTPS host만 수집하고, DNS가 사설 주소를 반환하면 시작하지 않습니다.
- Cheerio 리다이렉트는 끄며 Playwright의 문서·스크립트·XHR도 승인 host와 공개 DNS를 다시 확인합니다. 이미지·미디어·폰트와 교차 host 요청은 차단합니다.
- 일반 HTML은 Cheerio를 우선하고 본문 검사가 실패할 때만 Playwright를 사용합니다.
- 빈 본문, 필수 필드 누락, 로그인 오류, HTTP 오류, 부분 배치는 성공으로 처리하지 않습니다.
- 결과는 `official_source_candidate`일 뿐 공식 근거가 아닙니다.
- 제출 권한은 `/api/internal/research/signals` 한 곳뿐이며 모든 결과는 `agent_tasks` 검토 큐에 머뭅니다.
- token 탈취 방지를 위해 제출 대상은 `https://www.yeosonam.com/api/internal/research/signals`로 코드에서 고정합니다.
- OpenCLI나 Agent-Reach는 이 폴더와 별도로 설치하고, 공식 배포물·고정 버전·전용 Chrome 프로필만 사용합니다.

## 설치와 실행

```bash
npm ci --ignore-scripts
npx playwright install chromium
npm run collect -- --manifest=source-manifest.example.json --out=outputs/signals.json
npm run check -- --input=outputs/signals.json
```

직전 정상 보고서가 있으면 건수 급락도 함께 검사합니다.

```bash
npm run check -- --input=outputs/signals.json --previous=outputs/signals.previous.json
```

브라우저 fallback 없이 HTTP 수집 계약만 확인하려면 `--no-browser`를 추가합니다.

제출 전 `.env.example`의 두 값만 별도 비밀 저장소에서 주입합니다. `.env` 파일은 커밋하지 않습니다.

```bash
npm run submit -- --input=outputs/signals.json
```

제출기는 `sourceCount === signals.length`, `failures=[]`, 신호별 실제 제목·본문·HTTP 상태가 모두 검증된 전체 배치만 전송합니다. 하나라도 실패하면 정상 신호만 골라 보내지 않습니다.

Agent-Reach는 OpenCLI 직접 운영으로 세 개 이상의 채널을 30일간 검증한 뒤 라우팅·doctor 유지비가 실제 병목일 때만 fork commit SHA를 고정해 추가합니다.
