# Sentry 설정 가이드 (설치만 완료, 활성화는 사장님 승인 후)

## 현재 상태

- ✅ `@sentry/nextjs` 패키지 설치 완료
- ⏸️  `sentry.config.ts` / `sentry.server.config.ts` 미생성 (DSN 필요)
- ⏸️  `next.config.js` Sentry wrap 미적용

## 활성화 절차 (내일 이후 진행)

### 1. Sentry 계정에서 DSN 발급
1. https://sentry.io 가입 → Organization → Project 생성 (platform: "Next.js")
2. `Settings → Projects → [yeosonam] → Client Keys (DSN)` 복사

### 2. 환경변수 설정
```bash
# .env.local
NEXT_PUBLIC_SENTRY_DSN="https://...@....ingest.sentry.io/..."
SENTRY_AUTH_TOKEN="..."  # 소스맵 업로드용 (Settings → Account → API → Auth Tokens)
SENTRY_ORG="yeosonam"
SENTRY_PROJECT="yeosonam-os"
```

### 3. 초기화 실행 (한 번만)
```bash
npx @sentry/wizard@latest -i nextjs
```
자동으로 다음 파일 생성:
- `sentry.client.config.ts`
- `sentry.server.config.ts`
- `sentry.edge.config.ts`
- `next.config.js` 수정 (withSentryConfig 래핑)

### 4. 빌드 검증
```bash
npm run build
# 에러 없이 완료 + "Sentry" 로그 출력 확인
```

## 활성화 후 캡처될 이벤트

- ✅ Unhandled exceptions (서버 + 클라이언트)
- ✅ API route 에러 (500)
- ✅ Zod validation 실패 (`STRICT_VALIDATION=true` 시)
- ✅ React rendering 에러 (Error Boundary)

## 추천 설정 (sentry.server.config.ts)

```typescript
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 0.1,          // 프로덕션 트래픽 10%만 트레이스
  profilesSampleRate: 0.1,
  beforeSend(event) {
    // PII 마스킹
    if (event.request?.cookies) delete event.request.cookies;
    return event;
  },
});
```

## 알림 채널 연동 (선택)

Sentry → Settings → Integrations → Slack / Discord / Email 설정
- Zod validation 실패 이벤트는 별도 태그 (`tag: validation_failed`) 로 필터링
- 쿠알라 같은 반복 이슈는 Fingerprint 그룹화

## 의사결정 필요 사항

사장님이 내일 결정해주실 것:
1. **Sentry 계정 생성 여부** (무료 5k events/월, 유료 $26+/월)
2. **Slack 연동 여부** (회사 슬랙 워크스페이스 있어야 함)
3. **샘플링 비율** (트래픽 대비 비용)

**결정 후 위 절차 5분 내 완료 가능합니다.**
